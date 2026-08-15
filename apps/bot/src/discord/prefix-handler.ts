import ms from 'ms';
import { EmbedBuilder, type GuildMember, type Message, type TextChannel } from 'discord.js';
import { COMMAND_CATALOG, type GuildConfig, type ModerationAction, type ProgressionPunishment, type Strictness } from '@apexbot/shared';
import { store } from '../data/store.js';
import { currentFtcSeason, ftcScout } from '../ftc/client.js';
import { reviewMessage } from '../moderation/service.js';
import { deliverModerationResult, findMessage, isModerator, toEnvelope } from './messages.js';
import { applyPunishments, MAX_MUTE_MINUTES, reverseCaseSanctions, unmuteMember } from './sanctions.js';

const orange = 0xff6b18;
const tokenize = (value: string) => [...value.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
const idFrom = (value?: string) => value?.match(/\d{15,22}/)?.[0];

async function record(message: Message, member: GuildMember, action: ModerationAction, reason: string, delta: number) {
  const before = await store.getProgression(message.guildId!, member.id); const after = await store.adjustProgression(message.guildId!, member.id, 1);
  const item = await store.createCase({ guildId: message.guildId!, userId: member.id, moderatorId: message.author.id, messageId: null, channelId: message.channelId, action, severity: delta >= 4 ? 'critical' : delta >= 3 ? 'high' : delta >= 2 ? 'medium' : 'low', categories: ['manual-moderation'], reason, evidence: '', pcBefore: before.pc, pcAfter: after.pc, source: 'manual', status: 'actioned' });
  await store.createLog({ guildId: message.guildId!, type: `manual_${action}`, actorId: message.author.id, targetId: member.id, channelId: message.channelId, messageId: message.id, summary: `${action} ${member.user.tag}: ${reason}`, metadata: { caseId: item.id, pc: after.pc } });
  return { after, item };
}

export async function handlePrefix(message: Message, config: GuildConfig): Promise<boolean> {
  const prefix = [...config.prefixes].sort((a, b) => b.length - a.length).find((p) => message.content.startsWith(p));
  if (!prefix) return false;
  const parts = tokenize(message.content.slice(prefix.length).trim()); const command = parts.shift()?.toLowerCase();
  if (!command) return false;
  const modOnly = ['mode', 'intensity', 'warn', 'mute', 'timeout', 'unmute', 'kick', 'ban', 'unban', 'purge', 'slowmode', 'lock', 'unlock', 'pc', 'history', 'prefix'];
  if (modOnly.includes(command) && !isModerator(message.member)) { await message.reply('You need moderation permissions for that command.'); return true; }
  try {
    if (command === 'ping') { await message.reply(`ApexBot is online. Gateway ${Math.round(message.client.ws.ping)}ms. ${config.mode} mode, ${config.strictness} intensity.`); return true; }
    if (command === 'help') {
      const query = parts[0]?.toLowerCase(); const rows = query ? COMMAND_CATALOG.filter((c) => c.name.includes(query)) : COMMAND_CATALOG;
      await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle('ApexBot command deck').setDescription(rows.map((c) => `**${prefix}${c.prefixSyntax}** — ${c.description}`).join('\n').slice(0, 4000))] }); return true;
    }
    if (command === 'mode') {
      const mode = parts[0] as 'active' | 'standby'; if (!['active', 'standby'].includes(mode)) throw new Error(`Usage: ${prefix}mode <active|standby>`);
      await store.updateGuildConfig(message.guildId!, { mode }); await store.createLog({ guildId: message.guildId!, type: 'config_mode', actorId: message.author.id, targetId: null, channelId: message.channelId, messageId: message.id, summary: `Moderation mode set to ${mode}`, metadata: { mode } }); await message.reply(mode === 'active' ? 'Active mode enabled. Violations will be enforced.' : 'Standby mode enabled. Violations will be sent to moderators.'); return true;
    }
    if (command === 'intensity') {
      const strictness = parts[0]?.toLowerCase() as Strictness;
      if (!['low', 'medium', 'high'].includes(strictness)) throw new Error(`Usage: ${prefix}intensity <low|medium|high>`);
      await store.updateGuildConfig(message.guildId!, { strictness }); await store.createLog({ guildId: message.guildId!, type: 'config_intensity', actorId: message.author.id, targetId: null, channelId: message.channelId, messageId: message.id, summary: `Moderation intensity set to ${strictness}`, metadata: { strictness } }); await message.reply(`Moderation intensity set to **${strictness}**.`); return true;
    }
    if (command === 'report') {
      const raw = parts[0] ?? message.reference?.messageId; if (!raw) throw new Error(`Reply to a message or use ${prefix}report <message-id>.`);
      const target = await findMessage(message.guild!, raw, message.channel); if (!target) throw new Error('I could not find that message. Use its full message link for cross-channel reports.');
      const result = await reviewMessage(await toEnvelope(target), config, { forceAi: true, source: 'report' }); await deliverModerationResult(message.client, target, config, result);
      if (result.decision.action === 'allow') await message.reply('No action was needed.');
      else if (result.decision.action === 'report') await message.reply(`Report sent to the moderators. Case #${result.caseId?.slice(0, 8)}.`);
      else await message.reply(`Action has been taken. Case #${result.caseId?.slice(0, 8)}.`); return true;
    }
    if (command === 'warn' || command === 'mute' || command === 'timeout' || command === 'kick' || command === 'ban') {
      const userId = idFrom(parts.shift()); if (!userId) throw new Error(`Usage: ${prefix}${command} @member ${command === 'warn' ? '<reason>' : '[duration] [reason]'}`);
      const member = await message.guild!.members.fetch(userId);
      if (command === 'warn') { const reason = parts.join(' ') || 'No reason provided'; const { after, item } = await record(message, member, 'warn', reason, 1); const punishments = config.progressionLevels.find((level) => level.level === after.pc)?.actions ?? config.progressionLevels.at(-1)?.actions ?? [{ type: 'warn' as const }]; await applyPunishments(member, item.id, punishments, reason); if (config.dmOffenders) await member.send(`Action taken in **${message.guild!.name}**. ${reason}\nCase #${item.id.slice(0, 8)}. Use \`/appeal submit\` to appeal.`).catch(() => undefined); await message.reply(`Warning recorded for ${member}. PC **${after.pc}** ladder actions applied. Case #${item.id.slice(0, 8)}.`); return true; }
      if (command === 'mute' || command === 'timeout') {
        const candidate = parts[0]; const parsed = candidate ? ms(candidate as ms.StringValue) : undefined;
        const hasDuration = Boolean(candidate && parsed);
        if (hasDuration) parts.shift();
        if (hasDuration && (parsed! < 5_000 || parsed! / 60_000 > MAX_MUTE_MINUTES)) throw new Error('Mute duration must be between 5 seconds and 100 years. Omit it for an indefinite mute.');
        const reason = parts.join(' ') || 'No reason provided'; const { after, item } = await record(message, member, 'mute', reason, 2);
        const punishment: ProgressionPunishment = { type: 'mute', durationMinutes: hasDuration ? parsed! / 60_000 : null };
        await applyPunishments(member, item.id, [punishment], reason);
        await message.reply(`Muted ${member} ${hasDuration ? `for **${candidate}**` : 'indefinitely'}. PC **${after.pc}**. Case #${item.id.slice(0, 8)}.`); return true;
      }
      if (command === 'kick') { const reason = parts.join(' ') || 'No reason provided'; await member.kick(reason); const { after, item } = await record(message, member, 'kick', reason, 3); await message.reply(`Kicked **${member.user.tag}**. PC **${after.pc}**. Case #${item.id.slice(0, 8)}.`); return true; }
      const reason = parts.join(' ') || 'No reason provided'; await member.ban({ reason, deleteMessageSeconds: 86_400 }); const { after, item } = await record(message, member, 'ban', reason, 4); await message.reply(`Banned **${member.user.tag}**. PC **${after.pc}**. Case #${item.id.slice(0, 8)}.`); return true;
    }
    if (command === 'unban') { const userId = idFrom(parts.shift()); if (!userId) throw new Error(`Usage: ${prefix}unban <user-id> [reason]`); const reason = parts.join(' ') || 'No reason provided'; const user = await message.guild!.members.unban(userId, reason); if (!user) throw new Error('Discord did not return the unbanned user.'); await store.createLog({ guildId: message.guildId!, type: 'manual_unban', actorId: message.author.id, targetId: user.id, channelId: message.channelId, messageId: message.id, summary: `Unbanned ${user.tag}`, metadata: { reason } }); await message.reply(`Unbanned **${user.tag}**.`); return true; }
    if (command === 'unmute') { const userId = idFrom(parts.shift()); if (!userId) throw new Error(`Usage: ${prefix}unmute @member [reason]`); const member = await message.guild!.members.fetch(userId); const reason = parts.join(' ') || `Unmuted by ${message.author.tag}`; const lifted = await unmuteMember(member, reason); await store.createLog({ guildId: message.guildId!, type: 'manual_unmute', actorId: message.author.id, targetId: member.id, channelId: message.channelId, messageId: message.id, summary: `Unmuted ${member.user.tag}`, metadata: { reason, sanctionsLifted: lifted } }); await message.reply(`Unmuted ${member}.`); return true; }
    if (command === 'purge') { const count = Math.min(100, Math.max(1, Number(parts[0]) || 0)); const channel = message.channel as TextChannel; const deleted = await channel.bulkDelete(count + 1, true); await store.createLog({ guildId: message.guildId!, type: 'manual_purge', actorId: message.author.id, targetId: null, channelId: message.channelId, messageId: message.id, summary: `Deleted ${Math.max(0, deleted.size - 1)} messages`, metadata: { count: deleted.size - 1 } }); const notice = await channel.send(`Deleted **${Math.max(0, deleted.size - 1)}** messages.`); setTimeout(() => notice.delete().catch(() => undefined), 3000); return true; }
    if (command === 'slowmode') { const raw = (parts[0] ?? '').toLowerCase(); const duration = raw === '0' ? 0 : ms(raw as ms.StringValue); if (duration == null || duration < 0 || duration > 6 * 60 * 60_000) throw new Error(`Usage: ${prefix}slowmode <30s|10m|2h|0>, up to 6h.`); const seconds = Math.ceil(duration / 1000); await (message.channel as TextChannel).setRateLimitPerUser(seconds, `Set by ${message.author.tag}`); await store.createLog({ guildId: message.guildId!, type: 'manual_slowmode', actorId: message.author.id, targetId: null, channelId: message.channelId, messageId: message.id, summary: `Slowmode set to ${raw === '0' ? 'off' : raw}`, metadata: { seconds } }); await message.reply(`Slowmode set to **${raw === '0' ? 'off' : raw}**.`); return true; }
    if (command === 'lock' || command === 'unlock') { const locked = command === 'lock'; await (message.channel as TextChannel).permissionOverwrites.edit(message.guild!.roles.everyone, { SendMessages: locked ? false : null }); await store.createLog({ guildId: message.guildId!, type: locked ? 'manual_lock' : 'manual_unlock', actorId: message.author.id, targetId: null, channelId: message.channelId, messageId: message.id, summary: `${locked ? 'Locked' : 'Unlocked'} channel`, metadata: {} }); await message.reply(locked ? 'Channel locked.' : 'Channel unlocked.'); return true; }
    if (command === 'pc') {
      const op = parts.shift()?.toLowerCase(); const userId = idFrom(parts.shift()); if (!op || !userId) throw new Error(`Usage: ${prefix}pc <view|add|remove|reset> @member [amount]`);
      const member = await message.guild!.members.fetch(userId); if (op === 'view') { const p = await store.getProgression(message.guildId!, userId); await message.reply(`${member} · PC **${p.pc}** · warnings **${p.warnings}**.`); return true; }
      const amount = op === 'set' ? Math.min(10, Math.max(0, Number(parts[0]) || 0)) : Math.max(1, Number(parts[0]) || 1); const value = op === 'set' ? await store.setProgression(message.guildId!, userId, amount) : await store.adjustProgression(message.guildId!, userId, op === 'add' ? amount : op === 'remove' ? -amount : 0, op === 'reset'); await store.createLog({ guildId: message.guildId!, type: `pc_${op}`, actorId: message.author.id, targetId: userId, channelId: message.channelId, messageId: message.id, summary: `PC ${op} for ${member.user.tag}: now ${value.pc}`, metadata: { amount, pc: value.pc } }); await message.reply(`${member} now has PC **${value.pc}**.`); return true;
    }
    if (command === 'prefix') {
      const op = parts[0] ?? 'list'; const value = parts[1]; let next = [...config.prefixes];
      if (op === 'add' && value && value.length <= 5 && !next.includes(value)) next.push(value);
      if (op === 'remove' && value) next = next.filter((p) => p !== value);
      if (!next.length) throw new Error('At least one prefix must remain.'); if (op !== 'list') { await store.updateGuildConfig(message.guildId!, { prefixes: next }); await store.createLog({ guildId: message.guildId!, type: 'config_prefix', actorId: message.author.id, targetId: null, channelId: message.channelId, messageId: message.id, summary: `Command prefixes updated`, metadata: { prefixes: next } }); }
      await message.reply(`Prefixes: ${next.map((p) => `\`${p}\``).join(' ')}`); return true;
    }
    if (command === 'history') {
      const userId = idFrom(parts.shift()); if (!userId) throw new Error(`Usage: ${prefix}history @member`);
      const rows = (await store.listCases(message.guildId!, 100)).filter((item) => item.userId === userId).slice(0, 10);
      await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(`Moderation history`).setDescription(rows.length ? rows.map((item) => `\`${item.id.slice(0, 8)}\` **${item.action}** — ${item.reason.slice(0, 90)}`).join('\n') : 'No cases recorded.')] }); return true;
    }
    if (command === 'appeal') { await handleAppeal(message, config, parts); return true; }
    if (['ftc', 'ftcteam', 'toa', 'toateam', 'ftcteaminfo'].includes(command)) { await handleFtc(message, parts); return true; }
    if (command === 'topr' || command === 'ftcopr') { await handleFtc(message, ['opr', ...parts]); return true; }
    if (command === 'ftcsearch' || command === 'teamsearch') { await handleFtc(message, ['search', ...parts]); return true; }
    return false;
  } catch (error) { await message.reply(error instanceof Error ? error.message : 'Command failed.'); return true; }
}

async function handleAppeal(message: Message, config: GuildConfig, parts: string[]) {
  const possibleOperation = parts[0]?.toLowerCase();
  const operation = ['approve', 'deny'].includes(possibleOperation ?? '') ? parts.shift()! : 'submit';
  const reference = (parts.shift() ?? '').replace(/^#/, '');
  if (!reference) throw new Error(`Usage: ${config.prefixes[0]}appeal [approve|deny] <case-number> [reason]`);
  const caseRecord = await store.findCase(message.guildId!, reference); if (!caseRecord) throw new Error('Case not found.');
  if (operation === 'submit') {
    if (caseRecord.userId !== message.author.id) throw new Error('You can only appeal your own case.');
    if (await store.findAppeal(message.guildId!, caseRecord.id)) throw new Error('This case already has an appeal.');
    const last = (await store.listAppeals(message.guildId!, 500)).find((item) => item.userId === message.author.id);
    const remaining = last ? Date.parse(last.createdAt) + config.appealCooldownMinutes * 60_000 - Date.now() : 0;
    if (remaining > 0) throw new Error(`You can submit another appeal <t:${Math.ceil((Date.now() + remaining) / 1000)}:R>.`);
    const appeal = await store.createAppeal({ guildId: message.guildId!, caseId: caseRecord.id, userId: message.author.id, reason: parts.join(' ') || 'No reason provided' });
    await store.createLog({ guildId: message.guildId!, type: 'appeal_submitted', actorId: message.author.id, targetId: message.author.id, channelId: message.channelId, messageId: message.id, summary: `Appeal submitted for case #${caseRecord.id.slice(0, 8)}`, metadata: { appealId: appeal.id, caseId: caseRecord.id } });
    await message.reply(`Appeal submitted for case #${caseRecord.id.slice(0, 8)}.`); return;
  }
  if (!isModerator(message.member)) throw new Error('You need moderation permissions to resolve appeals.');
  const appeal = await store.findAppeal(message.guildId!, caseRecord.id); if (!appeal || appeal.status !== 'pending') throw new Error('No pending appeal exists for that case.');
  const approved = operation === 'approve'; const note = parts.join(' ');
  await store.resolveAppeal(message.guildId!, appeal.id, approved ? 'approved' : 'denied', message.author.id, note);
  if (approved) { const current = await store.getProgression(message.guildId!, caseRecord.userId); await store.adjustProgression(message.guildId!, caseRecord.userId, caseRecord.pcBefore - current.pc); await store.updateCase(message.guildId!, caseRecord.id, { status: 'reversed' }); await reverseCaseSanctions(message.client, message.guildId!, caseRecord.userId, caseRecord.id); }
  await store.createLog({ guildId: message.guildId!, type: approved ? 'appeal_approved' : 'appeal_denied', actorId: message.author.id, targetId: caseRecord.userId, channelId: message.channelId, messageId: message.id, summary: `Appeal ${approved ? 'approved' : 'denied'} for case #${caseRecord.id.slice(0, 8)}`, metadata: { caseId: caseRecord.id, note } });
  await message.reply(`Appeal ${approved ? 'approved' : 'denied'} for case #${caseRecord.id.slice(0, 8)}.`);
}

async function handleFtc(message: Message, parts: string[]) {
  let sub = parts.shift()?.toLowerCase() ?? 'team'; if (/^\d+$/.test(sub)) { parts.unshift(sub); sub = 'team'; }
  if (['searchteam', 'teamsearch', 'ftcsearch'].includes(sub)) sub = 'search';
  if (['topr', 'ftcopr'].includes(sub)) sub = 'opr';
  const seasonArg = Number(parts[1]) || currentFtcSeason();
  if (sub === 'search') { const teams = (await ftcScout.search(parts.join(' '), 8)).slice(0, 8); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle('FTC team search').setDescription(teams.map((t) => `**${t.number} · ${t.name}** — ${[t.city, t.state, t.country].filter(Boolean).join(', ')}`).join('\n') || 'No teams found.')] }); return; }
  if (sub === 'event') { const event = await ftcScout.event(parts[0]!, seasonArg); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(event.name).setURL(`https://ftcscout.org/events/${seasonArg}/${event.code}`).setDescription(`${event.code} · ${event.type}\n${[event.venue, event.city, event.state, event.country].filter(Boolean).join(', ')}\n${event.start} → ${event.end}`)] }); return; }
  const number = Number(parts[0]); if (!number) throw new Error('Provide a valid FTC team number.');
  if (sub === 'team') { const t = await ftcScout.team(number); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(`${t.number} · ${t.name}`).setURL(`https://ftcscout.org/teams/${t.number}`).setDescription(`${t.schoolName ?? 'FTC team'}\n${[t.city, t.state, t.country].filter(Boolean).join(', ')}\nRookie year ${t.rookieYear}`).setFooter({ text: 'Data from FTCScout' })] }); return; }
  if (sub === 'stats' || sub === 'opr' || sub === 'topr') { const s = await ftcScout.stats(number, seasonArg); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(`Team ${number} · ${seasonArg} stats`).setDescription(`**Total OPR:** ${s.tot.value.toFixed(1)} · #${s.tot.rank}\n**Auto:** ${s.auto.value.toFixed(1)} · #${s.auto.rank}\n**Driver:** ${s.dc.value.toFixed(1)} · #${s.dc.rank}\n**Endgame:** ${s.eg.value.toFixed(1)} · #${s.eg.rank}`).setFooter({ text: `Among ${s.count.toLocaleString()} teams · FTCScout` })] }); return; }
  if (sub === 'events') { const rows = (await ftcScout.events(number, seasonArg)).filter((e) => e.stats); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(`Team ${number} events`).setDescription(rows.slice(0, 15).map((e) => `**${e.eventCode}** · rank ${e.stats!.rank} · ${e.stats!.wins}-${e.stats!.losses}-${e.stats!.ties}`).join('\n') || 'No events found.')] }); return; }
  if (sub === 'awards') { const rows = await ftcScout.awards(number, seasonArg); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(`Team ${number} awards`).setDescription(rows.slice(0, 20).map((a) => `**${a.type}** · ${a.eventCode}`).join('\n') || 'No awards found.')] }); return; }
  if (sub === 'matches') { const rows = (await ftcScout.matches(number, seasonArg)).slice(-15).reverse(); await message.reply({ embeds: [new EmbedBuilder().setColor(orange).setTitle(`Team ${number} recent matches`).setDescription(rows.map((m) => `**${m.eventCode} · ${m.matchId}** · ${m.alliance} ${m.station}${m.dq ? ' · DQ' : ''}`).join('\n') || 'No matches found.')] }); return; }
  throw new Error('FTC subcommands: team, search, stats/opr, matches, events, awards, event.');
}
