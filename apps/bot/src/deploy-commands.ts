import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './discord/command-definitions.js';
import { env } from './env.js';

if (!env.DISCORD_TOKEN || !env.DISCORD_CLIENT_ID) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required.');
const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
const route = env.DISCORD_TEST_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_TEST_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
await rest.put(route, { body: commandDefinitions });
console.log(`Registered ${commandDefinitions.length} commands ${env.DISCORD_TEST_GUILD_ID ? 'to test guild' : 'globally'}.`);
