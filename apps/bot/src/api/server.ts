import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type GuildConfig } from '@apexbot/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { store } from '../data/store.js';
import { discordClient } from '../discord/bot.js';

interface Session { uid: string; username: string; guilds: string[]; exp: number }
const configPatch = z.object({
  mode: z.enum(['standby', 'active']).optional(), strictness: z.enum(['low', 'medium', 'high']).optional(),
  prefixes: z.array(z.string().min(1).max(5)).min(1).max(8).optional(), badWordsEnabled: z.boolean().optional(),
  blockedTerms: z.array(z.string().min(2).max(80)).max(500).optional(), aiEnabled: z.boolean().optional(),
  aiAuditRate: z.number().min(0).max(0.25).optional(), moderatorChannelId: z.string().regex(/^\d+$/).nullable().optional(),
  loggingChannelId: z.string().regex(/^\d+$/).nullable().optional(), exemptRoleIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
  ignoredChannelIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
  appealsChannelId: z.string().regex(/^\d+$/).nullable().optional(),
  reportedMessageBehavior: z.enum(['report', 'enforce']).optional(), dmOffenders: z.boolean().optional(), pingOffenders: z.boolean().optional(),
  adminBypass: z.boolean().optional(), deleteSpamMessages: z.boolean().optional(), appealCooldownMinutes: z.number().int().min(1).max(10_080).optional(),
  pcExpiryDays: z.number().int().min(30).max(365).nullable().optional(),
  muteRoleId: z.string().regex(/^\d+$/).nullable().optional(),
  progressionLevels: z.array(z.object({
    level: z.number().int().min(1).max(10), label: z.string().min(1).max(80),
    actions: z.array(z.object({ type: z.enum(['delete', 'warn', 'mute', 'temp_ban', 'kick', 'ban']), durationMinutes: z.number().min(1 / 12).max(52_596_000).nullable().optional() })).min(1).max(6),
  })).min(1).max(10).optional(),
}).strict();

function encodeSession(value: Session): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', env.COOKIE_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}
function decodeSession(value?: string): Session | null {
  if (!value) return null; const [body, signature] = value.split('.'); if (!body || !signature) return null;
  const expected = createHmac('sha256', env.COOKIE_SECRET).update(body).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const session = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
  return session.exp > Date.now() ? session : null;
}
function sessionFor(request: FastifyRequest): Session | null { return decodeSession(request.cookies.apex_session); }
function requireGuild(request: FastifyRequest, guildId: string): Session {
  const session = sessionFor(request); if (!session) throw Object.assign(new Error('Authentication required.'), { statusCode: 401 });
  if (!session.guilds.includes(guildId)) throw Object.assign(new Error('Manage Server permission required.'), { statusCode: 403 });
  return session;
}

export async function createApiServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: true });
  await app.register(cookie);
  await app.register(cors, { origin: env.DASHBOARD_URL, credentials: true });
  await app.register(fastifyStatic, { root: fileURLToPath(new URL('../../../dashboard/dist/', import.meta.url)), wildcard: false });

  app.get('/api/health', async () => ({ status: 'ok', discord: discordClient.isReady(), guilds: discordClient.guilds.cache.size, timestamp: new Date().toISOString() }));
  app.get('/api/auth/discord', async (_request, reply) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return reply.code(503).send({ error: 'Discord OAuth is not configured.' });
    const state = randomBytes(24).toString('base64url');
    reply.setCookie('oauth_state', state, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: env.DISCORD_REDIRECT_URI, response_type: 'code', scope: 'identify guilds', state }).toString();
    return reply.redirect(url.toString());
  });
  app.get('/api/auth/discord/callback', async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    if (!request.cookies.oauth_state || query.state !== request.cookies.oauth_state) return reply.code(400).send('Invalid OAuth state.');
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID!, client_secret: env.DISCORD_CLIENT_SECRET!, grant_type: 'authorization_code', code: query.code, redirect_uri: env.DISCORD_REDIRECT_URI }) });
    if (!tokenResponse.ok) return reply.code(502).send('Discord token exchange failed.');
    const token = await tokenResponse.json() as { access_token: string };
    const headers = { authorization: `Bearer ${token.access_token}` };
    const [userResponse, guildResponse] = await Promise.all([fetch('https://discord.com/api/v10/users/@me', { headers }), fetch('https://discord.com/api/v10/users/@me/guilds', { headers })]);
    const user = await userResponse.json() as { id: string; username: string };
    const oauthGuilds = await guildResponse.json() as Array<{ id: string; permissions: string; owner: boolean }>;
    const allowed = oauthGuilds.filter((g) => g.owner || (BigInt(g.permissions) & 0x20n) === 0x20n || (BigInt(g.permissions) & 0x8n) === 0x8n).filter((g) => discordClient.guilds.cache.has(g.id)).map((g) => g.id);
    reply.clearCookie('oauth_state', { path: '/' });
    reply.setCookie('apex_session', encodeSession({ uid: user.id, username: user.username, guilds: allowed, exp: Date.now() + 7 * 86_400_000 }), { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86_400 });
    return reply.redirect(`${env.DASHBOARD_URL}/app`);
  });
  app.post('/api/auth/logout', async (_request, reply) => { reply.clearCookie('apex_session', { path: '/' }); return { ok: true }; });
  app.get('/api/auth/session', async (request, reply) => {
    const session = sessionFor(request); if (!session) return reply.code(401).send({ authenticated: false });
    const firebaseToken = await store.createCustomToken(session.uid, session.guilds).catch(() => null);
    return { authenticated: true, user: { id: session.uid, username: session.username }, firebaseToken };
  });
  app.get('/api/guilds', async (request, reply) => {
    const session = sessionFor(request); if (!session) return reply.code(401).send({ error: 'Authentication required.' });
    return session.guilds.map((id) => { const guild = discordClient.guilds.cache.get(id); return { id, name: guild?.name ?? id, icon: guild?.iconURL({ size: 128 }) ?? null, memberCount: guild?.memberCount ?? 0 }; });
  });
  app.get('/api/guilds/:guildId/config', async (request) => { const { guildId } = request.params as { guildId: string }; requireGuild(request, guildId); const guild = discordClient.guilds.cache.get(guildId); return store.getGuildConfig(guildId, guild?.name); });
  app.patch('/api/guilds/:guildId/config', async (request) => { const { guildId } = request.params as { guildId: string }; const session = requireGuild(request, guildId); const parsed = configPatch.parse(request.body); const patch = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as Partial<GuildConfig>; const result = await store.updateGuildConfig(guildId, patch); await store.createLog({ guildId, type: 'dashboard_config', actorId: session.uid, targetId: null, channelId: null, messageId: null, summary: 'Dashboard moderation configuration updated', metadata: { fields: Object.keys(patch) } }); return result; });
  app.get('/api/guilds/:guildId/cases', async (request) => { const { guildId } = request.params as { guildId: string }; requireGuild(request, guildId); return store.listCases(guildId); });
  app.get('/api/guilds/:guildId/logs', async (request) => { const { guildId } = request.params as { guildId: string }; requireGuild(request, guildId); return store.listLogs(guildId); });
  app.get('/api/guilds/:guildId/appeals', async (request) => { const { guildId } = request.params as { guildId: string }; requireGuild(request, guildId); return store.listAppeals(guildId); });
  app.get('/api/guilds/:guildId/resources', async (request) => {
    const { guildId } = request.params as { guildId: string }; requireGuild(request, guildId); const guild = discordClient.guilds.cache.get(guildId);
    return { channels: guild?.channels.cache.filter((c) => c.isTextBased() && !c.isDMBased()).map((c) => ({ id: c.id, name: c.name })) ?? [], roles: guild?.roles.cache.filter((r) => !r.managed && r.id !== guild.id).map((r) => ({ id: r.id, name: r.name, color: r.hexColor })) ?? [] };
  });

  app.get('/', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/*', async (request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html'));

  return app;
}
