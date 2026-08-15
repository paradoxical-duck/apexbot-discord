import { ChannelType, EmbedBuilder, type Client, type Guild, type GuildMember, type Message, type TextBasedChannel } from 'discord.js';
import type { GuildConfig, MessageEnvelope } from '@apexbot/shared';
import type { ReviewResult } from '../moderation/service.js';
import { logger } from '../logger.js';
import { applyPunishments } from './sanctions.js';

export async function toEnvelope(message: Message, recentMessages: string[] = []): Promise<MessageEnvelope> {
  const reference = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
  const member = message.member;
  return {
    id: message.id, guildId: message.guildId!, channelId: message.channelId,
    authorId: message.author.id, authorName: message.author.tag, content: message.content,
    createdAt: message.createdAt.toISOString(),
    ...(message.editedAt ? { editedAt: message.editedAt.toISOString() } : {}),
    attachmentNames: message.attachments.map((a) => a.name), attachmentUrls: message.attachments.map((a) => a.url),
    mentions: message.mentions.users.size + message.mentions.roles.size,
    everyoneMention: message.mentions.everyone, isReply: Boolean(reference),
    ...(reference ? { replyContent: reference.content } : {}),
    accountAgeDays: (Date.now() - message.author.createdTimestamp) / 86_400_000,
    ...(member?.joinedTimestamp ? { memberAgeDays: (Date.now() - member.joinedTimestamp) / 86_400_000 } : {}),
    recentMessages,
  };
}

export async function findMessage(guild: Guild, rawId: string, preferred?: TextBasedChannel): Promise<Message | null> {
  const id = rawId.match(/\d{15,22}/g)?.at(-1);
  if (!id) return null;
  if (preferred && 'messages' in preferred) {
    const found = await preferred.messages.fetch(id).catch(() => null);
    if (found) return found;
  }
  const channels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).first(40);
  for (const channel of channels) {
    if (!('messages' in channel)) continue;
    const found = await channel.messages.fetch(id).catch(() => null);
    if (found) return found;
  }
  return null;
}

export async function deliverModerationResult(client: Client, message: Message, config: GuildConfig, result: ReviewResult): Promise<void> {
  const { decision } = result;
  if (decision.action === 'allow') return;
  const member = message.member;
  const caseNumber = result.caseId?.slice(0, 8) ?? null;
  const caseLabel = caseNumber ? `Case #${caseNumber}` : 'Moderation report';
  const embed = new EmbedBuilder()
    .setColor(decision.action === 'report' ? 0xd8a227 : 0xe21f3f)
    .setTitle(`${caseLabel} — ${actionLabel(decision.action)}`)
    .setDescription(decision.reason)
    .addFields(
      { name: 'Member', value: `<@${message.author.id}> · ${message.author.id}`, inline: true },
      { name: 'Progression', value: `${result.pcBefore} → ${result.pcAfter}`, inline: true },
      { name: 'Confidence', value: `${Math.round(decision.confidence * 100)}%`, inline: true },
      { name: 'Signals', value: decision.categories.slice(0, 6).join(', ') || 'Manual report', inline: false },
      { name: 'Message', value: message.content.slice(0, 900) || '*attachment-only message*', inline: false },
    )
    .setURL(message.url).setTimestamp();

  try {
    if (result.punishments.some((item) => item.type === 'delete') && message.deletable) await message.delete();
    if (member && result.caseId) await applyPunishments(member, result.caseId, result.punishments, `${decision.reason} — Case #${caseNumber}`);
  } catch (error) {
    logger.error({ err: error, caseId: result.caseId }, 'Could not apply moderation action');
    embed.addFields({ name: 'Enforcement error', value: 'Discord rejected part of this action. A moderator needs to finish it.' });
  }

  if (decision.action !== 'report' && caseNumber) {
    const notice = `You were ${memberAction(decision.action)} in **${message.guild?.name ?? 'this server'}**. PC **${result.pcAfter}**. Case number **${caseNumber}**.`;
    if (config.dmOffenders) await message.author.send(notice).catch(() => undefined);
    if ((config.pingOffenders || result.phase === 'verbal') && 'send' in message.channel) await message.channel.send({ content: `<@${message.author.id}> ${notice}`, allowedMentions: { users: [message.author.id] } }).catch(() => undefined);
  }

  const destinationIds = new Set([config.loggingChannelId, decision.action === 'report' ? config.moderatorChannelId : null].filter((item): item is string => Boolean(item)));
  for (const destinationId of destinationIds) {
    const channel = await client.channels.fetch(destinationId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) await channel.send({ embeds: [embed] }).catch((error) => logger.warn({ error }, 'Could not send moderation log'));
  }
}

function memberAction(action: ReviewResult['decision']['action']): string {
  return ({ report: 'reported', verbal_warn: 'warned', warn: 'warned', delete: 'warned', mute: 'muted', timeout: 'muted', kick: 'kicked', temp_ban: 'temporarily banned', ban: 'banned', allow: 'warned' } as const)[action];
}

function actionLabel(action: ReviewResult['decision']['action']): string {
  return ({ report: 'Needs review', verbal_warn: 'Verbal warning', warn: 'Warning', delete: 'Message deleted', mute: 'Muted', timeout: 'Timed out', kick: 'Kicked', temp_ban: 'Temporarily banned', ban: 'Banned', allow: 'No action' } as const)[action];
}

export function isModerator(member: GuildMember | null): boolean {
  return Boolean(member?.permissions.has('ModerateMembers') || member?.permissions.has('ManageGuild') || member?.permissions.has('Administrator'));
}
