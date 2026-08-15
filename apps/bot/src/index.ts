import 'dotenv/config';
import { createApiServer } from './api/server.js';
import { env, hasDiscordCredentials } from './env.js';
import { logger } from './logger.js';
import { startDiscord } from './discord/bot.js';

const api = await createApiServer();
await api.listen({ port: env.PORT, host: '0.0.0.0' });
logger.info({ port: env.PORT }, 'ApexBot API listening');

if (hasDiscordCredentials) await startDiscord(env.DISCORD_TOKEN!);
else logger.warn('Discord credentials missing; the gateway is offline.');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down ApexBot');
  await Promise.allSettled([api.close(), import('./discord/bot.js').then(({ discordClient }) => discordClient.destroy())]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
