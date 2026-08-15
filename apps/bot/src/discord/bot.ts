import { ActivityType, Client, EmbedBuilder, Events, GatewayIntentBits, Partials, type Message } from 'discord.js';
import { LRUCache } from 'lru-cache';
import type { GuildConfig } from '@apexbot/shared';
import { store } from '../data/store.js';
import { logger } from '../logger.js';
import { reviewMessage } from '../moderation/service.js';
import { answerPrompt } from '../moderation/ai.js';
import { COMMAND_CATALOG } from '@apexbot/shared';
import { handleSlash } from './slash-handler.js';
import { handlePrefix } from './prefix-handler.js';
import { deliverModerationResult, findMessage, toEnvelope } from './messages.js';
import { sweepExpiredSanctions } from './sanctions.js';

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
  allowedMentions: { parse: ['users'], repliedUser: false },
});

const configCache = new LRUCache<string, GuildConfig>({ max: 5000, ttl: 30_000 });
store.onConfigUpdate((guildId) => configCache.delete(guildId));
const recentByUser = new LRUCache<string, string[]>({ max: 20_000, ttl: 2 * 60_000 });
const aiPromptCooldown = new LRUCache<string, number>({ max: 20_000, ttl: 15_000 });

store.onLog((record) => {
  if (record.type === 'message_review') return;
  void sendLogEmbed(record.guildId, record.type, record.summary, record.actorId, record.targetId, record.channelId, record.messageId, record.metadata);
});

async function guildConfig(guildId: string, name: string): Promise<GuildConfig> {
  const cached = configCache.get(guildId); if (cached) return cached;
  const value = await store.getGuildConfig(guildId, name); configCache.set(guildId, value); return value;
}

async function processSafety(message: Message, forceAi = false, source?: 'report') {
  if (!message.guild || message.author.bot) return;
  const config = await guildConfig(message.guild.id, message.guild.name);
  if (!forceAi && (config.ignoredChannelIds.includes(message.channelId) || (config.adminBypass && message.member?.permissions.has('Administrator')) || message.member?.roles.cache.some((r) => config.exemptRoleIds.includes(r.id)))) return;
  const key = `${message.guildId}:${message.author.id}`; const recent = recentByUser.get(key) ?? [];
  const result = await reviewMessage(await toEnvelope(message, recent), config, { forceAi, ...(source ? { source } : {}) });
  recentByUser.set(key, [...recent, message.content].slice(-6));
  await deliverModerationResult(discordClient, message, config, result);
  return result;
}

async function eventLog(guildId: string, type: string, summary: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await store.createLog({ guildId, type, actorId: null, targetId, channelId: null, messageId: null, summary, metadata });
}

async function sendLogEmbed(guildId: string, type: string, summary: string, actorId: string | null, targetId: string | null, channelId: string | null, messageId: string | null, metadata: Record<string, unknown>) {
  const guild = discordClient.guilds.cache.get(guildId); if (!guild) return;
  const config = await guildConfig(guildId, guild.name);
  const destinations = new Set([config.loggingChannelId, type.startsWith('appeal_') ? (config.appealsChannelId ?? config.moderatorChannelId) : null].filter((item): item is string => Boolean(item)));
  if (!destinations.size) return;
  const caseId = typeof metadata.caseId === 'string' ? metadata.caseId : null;
  const embed = new EmbedBuilder()
    .setColor(type.includes('denied') ? 0x777777 : type.includes('approved') ? 0x36a269 : type.includes('appeal') ? 0xd8a227 : type.includes('config') ? 0xb61d35 : 0xe21f3f)
    .setAuthor({ name: 'ApexBot log' })
    .setTitle(type.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .setDescription(summary)
    .addFields(
      ...(actorId ? [{ name: 'Actor', value: `<@${actorId}>`, inline: true }] : []),
      ...(targetId ? [{ name: 'Member', value: `<@${targetId}>`, inline: true }] : []),
      ...(channelId ? [{ name: 'Channel', value: `<#${channelId}>`, inline: true }] : []),
      ...(caseId ? [{ name: 'Case', value: `#${caseId.slice(0, 8)}`, inline: true }] : []),
      ...(typeof metadata.reason === 'string' && metadata.reason ? [{ name: 'Reason', value: metadata.reason.slice(0, 900), inline: false }] : []),
      ...(typeof metadata.content === 'string' && metadata.content ? [{ name: 'Message', value: metadata.content.slice(0, 900), inline: false }] : []),
    )
    .setFooter({ text: `Log ${type}` })
    .setTimestamp();
  if (messageId && channelId) embed.setURL(`https://discord.com/channels/${guildId}/${channelId}/${messageId}`);
  for (const destinationId of destinations) {
    const channel = await discordClient.channels.fetch(destinationId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) await channel.send({ embeds: [embed] }).catch((error) => logger.warn({ err: error, guildId, type }, 'Could not send log embed'));
  }
}

discordClient.once(Events.ClientReady, async (client) => {
  client.user.setPresence({ activities: [{ name: 'the summit · /help', type: ActivityType.Watching }], status: 'online' });
  logger.info({ user: client.user.tag, guilds: client.guilds.cache.size }, 'ApexBot Discord gateway ready');
  for (const guild of client.guilds.cache.values()) await store.getGuildConfig(guild.id, guild.name);
  await sweepExpiredSanctions(client).catch((error) => logger.error({ err: error }, 'Initial sanction sweep failed'));
  setInterval(() => void sweepExpiredSanctions(client).catch((error) => logger.error({ err: error }, 'Sanction sweep failed')), 60_000).unref();
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) await handleSlash(interaction);
});

discordClient.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    const config = await guildConfig(message.guild.id, message.guild.name);
    if (await handlePrefix(message, config)) return;
    const explicitBotMention = new RegExp(`<@!?${discordClient.user!.id}>`).test(message.content);
    const isMentionReport = explicitBotMention && Boolean(message.reference?.messageId);
    if (isMentionReport) {
      const target = await findMessage(message.guild, message.reference!.messageId!, message.channel);
      if (!target) return void await message.reply('I could not resolve the replied message.');
      const result = await processSafety(target, true, 'report');
      if (!result || result.decision.action === 'allow') await message.reply('No action was needed.');
      else if (result.decision.action === 'report') await message.reply(`Report sent to the moderators. Case #${result.caseId?.slice(0, 8)}.`);
      else await message.reply(`Action has been taken. Case #${result.caseId?.slice(0, 8)}.`);
      return;
    }
    if (explicitBotMention) {
      const prompt = message.content.replace(new RegExp(`<@!?${discordClient.user!.id}>`, 'g'), '').trim();
      if (!prompt || /^(?:help|commands|command list)$/i.test(prompt)) {
        const embed = new EmbedBuilder().setColor(0xe21f3f).setTitle('ApexBot commands').setDescription(COMMAND_CATALOG.map((item) => `**/${item.name}** — ${item.description}`).join('\n').slice(0, 4_000));
        await message.reply({ embeds: [embed] }); return;
      }
      if (aiPromptCooldown.has(`${message.guildId}:${message.author.id}`)) return void await message.reply('Wait a few seconds before sending another prompt.');
      aiPromptCooldown.set(`${message.guildId}:${message.author.id}`, Date.now());
      await message.channel.sendTyping();
      const answer = await answerPrompt(prompt);
      await message.reply(answer ?? 'I could not answer that right now.'); return;
    }
    await processSafety(message);
  } catch (error) { logger.error({ error, messageId: message.id }, 'Message processing failed'); }
});

discordClient.on(Events.MessageUpdate, async (_before, after) => {
  if (after.partial) await after.fetch().catch(() => null);
  if (after.content && !after.author?.bot) {
    if (after.guildId) await eventLog(after.guildId, 'message_edited', `Message by ${after.author?.tag ?? 'unknown user'} edited in <#${after.channelId}>.`, after.author?.id ?? null, { before: _before.content?.slice(0, 500), content: after.content.slice(0, 500), channelId: after.channelId, messageId: after.id });
    await processSafety(after as Message).catch((error) => logger.error({ error }, 'Edit review failed'));
  }
});

discordClient.on(Events.MessageDelete, async (message) => {
  if (message.guildId && !message.author?.bot) await eventLog(message.guildId, 'message_deleted', `Message by ${message.author?.tag ?? 'unknown user'} deleted in <#${message.channelId}>.`, message.author?.id ?? null, { content: message.content?.slice(0, 500), messageId: message.id });
});
discordClient.on(Events.GuildMemberAdd, (member) => void eventLog(member.guild.id, 'member_joined', `${member.user.tag} joined the server.`, member.id, { accountCreated: member.user.createdAt.toISOString() }));
discordClient.on(Events.GuildMemberRemove, (member) => void eventLog(member.guild.id, 'member_left', `${member.user.tag} left the server.`, member.id));
discordClient.on(Events.GuildBanAdd, (ban) => void eventLog(ban.guild.id, 'member_banned', `${ban.user.tag} was banned.`, ban.user.id));
discordClient.on(Events.GuildBanRemove, (ban) => void eventLog(ban.guild.id, 'member_unbanned', `${ban.user.tag} was unbanned.`, ban.user.id));
discordClient.on(Events.VoiceStateUpdate, (before, after) => {
  if (before.channelId === after.channelId) return;
  void eventLog(after.guild.id, 'voice_state', `${after.member?.user.tag ?? 'Member'} moved ${before.channelId ? `from <#${before.channelId}>` : ''} ${after.channelId ? `to <#${after.channelId}>` : 'out of voice'}.`, after.id);
});

discordClient.on(Events.Error, (error) => logger.error({ error }, 'Discord client error'));

export async function startDiscord(token: string) { await discordClient.login(token); }
