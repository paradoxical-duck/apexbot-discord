import { ChannelType, type Client, type Guild, type GuildMember } from 'discord.js';
import type { ProgressionPunishment } from '@apexbot/shared';
import { store } from '../data/store.js';
import { logger } from '../logger.js';

export const MAX_MUTE_MINUTES = 100 * 365.25 * 24 * 60;

export function boundedMuteMinutes(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Math.min(MAX_MUTE_MINUTES, Math.max(1 / 12, value));
}

export async function ensureMuteRole(guild: Guild): Promise<string> {
  const config = await store.getGuildConfig(guild.id, guild.name);
  let role = config.muteRoleId ? await guild.roles.fetch(config.muteRoleId).catch(() => null) : null;
  role ??= guild.roles.cache.find((item) => item.name === 'Apex Muted') ?? null;
  if (!role) role = await guild.roles.create({ name: 'Apex Muted', color: 0x2b2b2b, permissions: [], reason: 'ApexBot long-term and indefinite mute role' });
  if (config.muteRoleId !== role.id) await store.updateGuildConfig(guild.id, { muteRoleId: role.id });

  const channels = guild.channels.cache.filter((channel) => [
    ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum,
    ChannelType.GuildVoice, ChannelType.GuildStageVoice,
  ].includes(channel.type));
  await Promise.all(channels.map((channel) => {
    if (!('permissionOverwrites' in channel)) return Promise.resolve();
    return channel.permissionOverwrites.edit(role!, {
    SendMessages: false,
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    Speak: false,
    }, { reason: 'ApexBot mute permissions' }).catch((error: unknown) => logger.warn({ err: error, guildId: guild.id, channelId: channel.id }, 'Could not set mute overwrite'));
  }));
  return role.id;
}

export async function applyPunishments(member: GuildMember, caseId: string, punishments: ProgressionPunishment[], reason: string): Promise<void> {
  for (const punishment of punishments) {
    if (punishment.type === 'warn' || punishment.type === 'delete') continue;
    if (punishment.type === 'mute') {
      const roleId = await ensureMuteRole(member.guild);
      await member.roles.add(roleId, reason);
      const minutes = boundedMuteMinutes(punishment.durationMinutes);
      await store.createSanction({ guildId: member.guild.id, userId: member.id, caseId, type: 'mute', roleId, expiresAt: minutes == null ? null : new Date(Date.now() + minutes * 60_000).toISOString() });
      continue;
    }
    if (punishment.type === 'temp_ban') {
      const minutes = boundedMuteMinutes(punishment.durationMinutes) ?? 14 * 24 * 60;
      await member.ban({ reason, deleteMessageSeconds: 86_400 });
      await store.createSanction({ guildId: member.guild.id, userId: member.id, caseId, type: 'temp_ban', roleId: null, expiresAt: new Date(Date.now() + minutes * 60_000).toISOString() });
      continue;
    }
    if (punishment.type === 'kick') await member.kick(reason);
    if (punishment.type === 'ban') await member.ban({ reason, deleteMessageSeconds: 86_400 });
  }
}

async function lift(client: Client, sanction: Awaited<ReturnType<typeof store.listActiveSanctions>>[number]) {
  const guild = await client.guilds.fetch(sanction.guildId).catch(() => null);
  if (!guild) return;
  if (sanction.type === 'temp_ban') await guild.members.unban(sanction.userId, `ApexBot sanction ${sanction.caseId.slice(0, 8)} expired`).catch(() => undefined);
  if (sanction.type === 'mute' && sanction.roleId) {
    const member = await guild.members.fetch(sanction.userId).catch(() => null);
    if (member) await member.roles.remove(sanction.roleId, `ApexBot sanction ${sanction.caseId.slice(0, 8)} lifted`).catch(() => undefined);
  }
  await store.liftSanction(sanction.guildId, sanction.id);
}

export async function reverseCaseSanctions(client: Client, guildId: string, userId: string, caseId: string): Promise<void> {
  const matches = (await store.listActiveSanctions(guildId)).filter((item) => item.userId === userId && item.caseId === caseId);
  await Promise.all(matches.map((item) => lift(client, item)));
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (guild) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member?.isCommunicationDisabled()) await member.timeout(null, `Appeal approved for case ${caseId.slice(0, 8)}`).catch(() => undefined);
  }
}

export async function unmuteMember(member: GuildMember, reason: string): Promise<number> {
  const matches = (await store.listActiveSanctions(member.guild.id)).filter((item) => item.userId === member.id && item.type === 'mute');
  const roleIds = new Set(matches.map((item) => item.roleId).filter((item): item is string => Boolean(item)));
  const config = await store.getGuildConfig(member.guild.id, member.guild.name);
  if (config.muteRoleId) roleIds.add(config.muteRoleId);
  for (const roleId of roleIds) await member.roles.remove(roleId, reason).catch(() => undefined);
  if (member.isCommunicationDisabled()) await member.timeout(null, reason).catch(() => undefined);
  await Promise.all(matches.map((item) => store.liftSanction(item.guildId, item.id)));
  return matches.length;
}

export async function sweepExpiredSanctions(client: Client): Promise<void> {
  const now = Date.now();
  const expired = (await store.listActiveSanctions()).filter((item) => item.expiresAt && Date.parse(item.expiresAt) <= now);
  await Promise.all(expired.map((item) => lift(client, item)));
}
