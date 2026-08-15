import ms from 'ms';
import { EmbedBuilder, type ChatInputCommandInteraction, type GuildMember, type TextChannel } from 'discord.js';
import { COMMAND_CATALOG, type ModerationAction, type ProgressionPunishment, type Strictness } from '@apexbot/shared';
import { store } from '../data/store.js';
import { ftcScout, currentFtcSeason } from '../ftc/client.js';
import { reviewMessage } from '../moderation/service.js';
import { deliverModerationResult, findMessage, isModerator, toEnvelope } from './messages.js';
import { applyPunishments, MAX_MUTE_MINUTES, reverseCaseSanctions, unmuteMember } from './sanctions.js';

const orange = 0xff6b18;

async function manualRecord(interaction: ChatInputCommandInteraction, member: GuildMember, action: ModerationAction, reason: string, delta: number) {
  const before = await store.getProgression(interaction.guildId!, member.id);
  const after = await store.adjustProgression(interaction.guildId!, member.id, 1);
  const record = await store.createCase({
    guildId: interaction.guildId!, userId: member.id, moderatorId: interaction.user.id,
    messageId: null, channelId: interaction.channelId, action, severity: delta >= 4 ? 'critical' : delta >= 3 ? 'high' : delta >= 2 ? 'medium' : 'low',
    categories: ['manual-moderation'], reason, evidence: '', pcBefore: before.pc, pcAfter: after.pc,
    source: 'manual', status: 'actioned',
  });
  await store.createLog({ guildId: interaction.guildId!, type: `manual_${action}`, actorId: interaction.user.id, targetId: member.id, channelId: interaction.channelId, messageId: null, summary: `${action.toUpperCase()} ${member.user.tag}: ${reason}`, metadata: { caseId: record.id, pcBefore: before.pc, pcAfter: after.pc } });
  return { before, after, record };
}

export async function handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return void await interaction.reply({ content: 'ApexBot commands must be used in a server.', ephemeral: true });
  const config = await store.getGuildConfig(interaction.guild.id, interaction.guild.name);
  try {
    switch (interaction.commandName) {
      case 'ping': return void await interaction.reply({ content: `ApexBot is online. Gateway ${Math.round(interaction.client.ws.ping)}ms. ${config.mode} mode, ${config.strictness} intensity.` });
      case 'help': {
        const query = interaction.options.getString('command')?.toLowerCase();
        const rows = query ? COMMAND_CATALOG.filter((c) => c.name.includes(query)) : COMMAND_CATALOG;
        const grouped = rows.reduce<Record<string, typeof rows>>((acc, command) => { (acc[command.category] ??= []).push(command); return acc; }, {});
        const embed = new EmbedBuilder().setColor(orange).setTitle('ApexBot commands');
        for (const [category, commands] of Object.entries(grouped)) embed.addFields({ name: category.toUpperCase(), value: commands.map((c) => `**${c.name}** — ${c.description}`).join('\n').slice(0, 1024) });
        return void await interaction.reply({ embeds: [embed] });
      }
      case 'mode': {
        const mode = interaction.options.getString('mode', true) as 'standby' | 'active';
        await store.updateGuildConfig(interaction.guild.id, { mode });
        await store.createLog({ guildId: interaction.guild.id, type: 'config_mode', actorId: interaction.user.id, targetId: null, channelId: interaction.channelId, messageId: null, summary: `Moderation mode changed to ${mode}`, metadata: {} });
        return void await interaction.reply({ content: mode === 'active' ? 'Active mode enabled. Violations will be enforced.' : 'Standby mode enabled. Violations will be sent to moderators.' });
      }
      case 'report': {
        await interaction.deferReply();
        const raw = interaction.options.getString('message_id', true);
        const message = await findMessage(interaction.guild, raw, interaction.channel?.isTextBased() ? interaction.channel : undefined);
        if (!message) return void await interaction.editReply('I could not find that message in accessible server channels. A message link is the most reliable input.');
        if (message.author.bot) return void await interaction.editReply('Bot-authored messages are not eligible for AI moderation reports.');
        const result = await reviewMessage(await toEnvelope(message), config, { forceAi: true, source: 'report' });
        await deliverModerationResult(interaction.client, message, config, result);
        if (result.decision.action === 'allow') return void await interaction.editReply('No action was needed.');
        if (result.decision.action === 'report') return void await interaction.editReply(`Report sent to the moderators. Case #${result.caseId?.slice(0, 8)}.`);
        return void await interaction.editReply(`Action has been taken. Case #${result.caseId?.slice(0, 8)}.`);
      }
      case 'warn': return void await warn(interaction);
      case 'mute':
      case 'timeout': return void await timeout(interaction);
      case 'unmute': return void await unmute(interaction);
      case 'kick': return void await kick(interaction);
      case 'ban': return void await ban(interaction);
      case 'unban': return void await unban(interaction);
      case 'purge': return void await purge(interaction);
      case 'slowmode': {
        const channel = interaction.channel as TextChannel;
        const raw = interaction.options.getString('duration', true).toLowerCase();
        const duration = raw === '0' ? 0 : ms(raw as ms.StringValue);
        if (duration == null || duration < 0 || duration > 6 * 60 * 60_000) throw new Error('Slowmode must be 0 or a duration up to 6h, such as 30s, 10m, or 2h.');
        const seconds = Math.ceil(duration / 1000);
        await channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
        await store.createLog({ guildId: interaction.guildId!, type: 'manual_slowmode', actorId: interaction.user.id, targetId: null, channelId: interaction.channelId, messageId: null, summary: `Slowmode set to ${raw === '0' ? 'off' : raw}`, metadata: { seconds } });
        return void await interaction.reply(`Slowmode set to **${raw === '0' ? 'off' : raw}**.`);
      }
      case 'lock':
      case 'unlock': {
        const locked = interaction.commandName === 'lock';
        const channel = interaction.channel as TextChannel;
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: interaction.options.getString('reason') ?? `${locked ? 'Locked' : 'Unlocked'} by ${interaction.user.tag}` });
        await store.createLog({ guildId: interaction.guildId!, type: locked ? 'manual_lock' : 'manual_unlock', actorId: interaction.user.id, targetId: null, channelId: interaction.channelId, messageId: null, summary: `${locked ? 'Locked' : 'Unlocked'} #${channel.name}`, metadata: { reason: interaction.options.getString('reason') } });
        return void await interaction.reply(`${locked ? '🔒 Locked' : '🔓 Unlocked'} ${channel}.`);
      }
      case 'pc': return void await pc(interaction);
      case 'history': return void await history(interaction);
      case 'intensity': {
        const strictness = interaction.options.getString('level', true) as Strictness;
        await store.updateGuildConfig(interaction.guildId!, { strictness });
        await store.createLog({ guildId: interaction.guildId!, type: 'config_intensity', actorId: interaction.user.id, targetId: null, channelId: interaction.channelId, messageId: null, summary: `Moderation intensity set to ${strictness}`, metadata: { strictness } });
        return void await interaction.reply(`Moderation intensity set to **${strictness}**.`);
      }
      case 'logging': {
        const channel = interaction.options.getChannel('channel', true);
        await store.updateGuildConfig(interaction.guildId!, { loggingChannelId: channel.id });
        await store.createLog({ guildId: interaction.guildId!, type: 'config_logging', actorId: interaction.user.id, targetId: null, channelId: channel.id, messageId: null, summary: `Logging channel set to #${channel.name}`, metadata: { loggingChannelId: channel.id } });
        return void await interaction.reply(`Logs will be sent to <#${channel.id}>.`);
      }
      case 'appeal': return void await appeal(interaction, config.appealCooldownMinutes);
      case 'prefix': return void await prefix(interaction, config.prefixes);
      case 'topr': return void await topr(interaction);
      case 'ftc': return void await ftc(interaction);
      default: return void await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected command failure.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => undefined);
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
  }
}

async function memberOption(interaction: ChatInputCommandInteraction): Promise<GuildMember> {
  const user = interaction.options.getUser('member', true);
  return interaction.guild!.members.fetch(user.id);
}

async function manualNotice(interaction: ChatInputCommandInteraction, member: GuildMember, caseId: string, reason: string, customText?: string) {
  const config = await store.getGuildConfig(interaction.guildId!, interaction.guild!.name);
  const text = customText ?? `Action taken in **${interaction.guild!.name}**. ${reason}\nCase #${caseId.slice(0, 8)}. Use \`/appeal submit\` to appeal.`;
  if (config.dmOffenders) await member.send(text).catch(() => undefined);
  if (config.pingOffenders && interaction.channel && 'send' in interaction.channel) await interaction.channel.send({ content: `<@${member.id}> ${text}`, allowedMentions: { users: [member.id] } }).catch(() => undefined);
}

async function warn(interaction: ChatInputCommandInteraction) {
  const member = await memberOption(interaction); const reason = interaction.options.getString('reason', true);
  const { after, record } = await manualRecord(interaction, member, 'warn', reason, 1);
  const config = await store.getGuildConfig(interaction.guildId!, interaction.guild!.name);
  const punishments = config.progressionLevels.find((level) => level.level === after.pc)?.actions ?? config.progressionLevels.at(-1)?.actions ?? [{ type: 'warn' as const }];
  await applyPunishments(member, record.id, punishments, reason);
  const notice = `You were warned in **${interaction.guild!.name}**. PC **${after.pc}**. Case number **${record.id.slice(0, 8)}**.`;
  await manualNotice(interaction, member, record.id, reason, notice);
  await interaction.reply(`<@${member.id}> ${notice}`);
}

async function timeout(interaction: ChatInputCommandInteraction) {
  const member = await memberOption(interaction); const raw = interaction.options.getString('duration');
  const duration = raw ? ms(raw as ms.StringValue) : null;
  if (raw && (!duration || duration < 5_000 || duration / 60_000 > MAX_MUTE_MINUTES)) throw new Error('Duration must be between 5 seconds and 100 years, or omitted for an indefinite mute.');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';
  const { after, record } = await manualRecord(interaction, member, 'mute', reason, 2);
  const punishment: ProgressionPunishment = { type: 'mute', durationMinutes: duration == null ? null : duration / 60_000 };
  await applyPunishments(member, record.id, [punishment], reason);
  await manualNotice(interaction, member, record.id, reason);
  await interaction.reply(`Muted ${member} ${raw ? `for **${raw}**` : 'indefinitely'}. PC **${after.pc}**. Case #${record.id.slice(0, 8)}.`);
}

async function unmute(interaction: ChatInputCommandInteraction) {
  const member = await memberOption(interaction); const reason = interaction.options.getString('reason') ?? `Unmuted by ${interaction.user.tag}`;
  const lifted = await unmuteMember(member, reason);
  await store.createLog({ guildId: interaction.guildId!, type: 'manual_unmute', actorId: interaction.user.id, targetId: member.id, channelId: interaction.channelId, messageId: null, summary: `Unmuted ${member.user.tag}`, metadata: { reason, sanctionsLifted: lifted } });
  await interaction.reply(`Unmuted ${member}.`);
}

async function kick(interaction: ChatInputCommandInteraction) {
  const member = await memberOption(interaction); const reason = interaction.options.getString('reason') ?? 'No reason provided';
  await member.kick(reason); const { after, record } = await manualRecord(interaction, member, 'kick', reason, 3); await manualNotice(interaction, member, record.id, reason);
  await interaction.reply(`Kicked **${member.user.tag}** · PC **${after.pc}** · case **${record.id.slice(0, 8)}**`);
}

async function ban(interaction: ChatInputCommandInteraction) {
  const member = await memberOption(interaction); const reason = interaction.options.getString('reason') ?? 'No reason provided';
  const days = interaction.options.getInteger('delete_days') ?? 0;
  await member.ban({ reason, deleteMessageSeconds: days * 86_400 }); const { after, record } = await manualRecord(interaction, member, 'ban', reason, 4); await manualNotice(interaction, member, record.id, reason);
  await interaction.reply(`Banned **${member.user.tag}** · PC **${after.pc}** · case **${record.id.slice(0, 8)}**`);
}

async function unban(interaction: ChatInputCommandInteraction) {
  const userId = interaction.options.getString('user_id', true); const reason = interaction.options.getString('reason') ?? 'No reason provided';
  const user = await interaction.guild!.members.unban(userId, reason);
  if (!user) throw new Error('Discord did not return the unbanned user.');
  await store.createLog({ guildId: interaction.guildId!, type: 'manual_unban', actorId: interaction.user.id, targetId: user.id, channelId: interaction.channelId, messageId: null, summary: `UNBAN ${user.tag}: ${reason}`, metadata: {} });
  await interaction.reply(`Unbanned **${user.tag}**.`);
}

async function purge(interaction: ChatInputCommandInteraction) {
  const count = interaction.options.getInteger('count', true); const target = interaction.options.getUser('member');
  const channel = interaction.channel as TextChannel; const messages = await channel.messages.fetch({ limit: 100 });
  const selected = messages.filter((m) => !target || m.author.id === target.id).first(count);
  const deleted = await channel.bulkDelete(selected, true);
  await store.createLog({ guildId: interaction.guildId!, type: 'manual_purge', actorId: interaction.user.id, targetId: target?.id ?? null, channelId: interaction.channelId, messageId: null, summary: `Deleted ${deleted.size} messages${target ? ` from ${target.tag}` : ''}`, metadata: { count: deleted.size } });
  await interaction.reply({ content: `Deleted **${deleted.size}** messages${target ? ` from ${target}` : ''}.`, ephemeral: true });
}

async function pc(interaction: ChatInputCommandInteraction) {
  const op = interaction.options.getSubcommand(); const member = await memberOption(interaction);
  if (op === 'view') {
    const value = await store.getProgression(interaction.guildId!, member.id);
    return void await interaction.reply({ content: `${member} · PC **${value.pc}** · offenses **${value.warnings}** · last offense ${value.lastOffenseAt ? `<t:${Math.floor(Date.parse(value.lastOffenseAt) / 1000)}:R>` : 'never'}` });
  }
  const amount = interaction.options.getInteger('amount') ?? 0;
  const value = op === 'set' ? await store.setProgression(interaction.guildId!, member.id, amount) : await store.adjustProgression(interaction.guildId!, member.id, op === 'add' ? amount : op === 'remove' ? -amount : 0, op === 'reset');
  await store.createLog({ guildId: interaction.guildId!, type: `pc_${op}`, actorId: interaction.user.id, targetId: member.id, channelId: interaction.channelId, messageId: null, summary: `PC ${op} for ${member.user.tag}: now ${value.pc}`, metadata: { amount } });
  await interaction.reply(`${member} now has PC **${value.pc}**.`);
}

async function history(interaction: ChatInputCommandInteraction) {
  const member = await memberOption(interaction); const rows = (await store.listCases(interaction.guildId!, 100)).filter((c) => c.userId === member.id).slice(0, 10);
  const embed = new EmbedBuilder().setColor(orange).setTitle(`Moderation history · ${member.user.tag}`).setDescription(rows.length ? rows.map((c) => `\`${c.id.slice(0, 8)}\` **${c.action}** · ${c.reason.slice(0, 90)} · <t:${Math.floor(Date.parse(c.createdAt) / 1000)}:R>`).join('\n') : 'No cases recorded.');
  await interaction.reply({ embeds: [embed] });
}

async function appeal(interaction: ChatInputCommandInteraction, cooldownMinutes: number) {
  const operation = interaction.options.getSubcommand();
  const reference = interaction.options.getString('case', true).replace(/^#/, '');
  const caseRecord = await store.findCase(interaction.guildId!, reference);
  if (!caseRecord) throw new Error('Case not found. Use the case number shown in the punishment message.');

  if (operation === 'submit') {
    if (caseRecord.userId !== interaction.user.id) throw new Error('You can only appeal your own case.');
    if (caseRecord.status === 'reversed') throw new Error('This case has already been reversed.');
    const existing = await store.findAppeal(interaction.guildId!, caseRecord.id);
    if (existing) throw new Error(`This case already has an appeal with status: ${existing.status}.`);
    const last = (await store.listAppeals(interaction.guildId!, 500)).find((item) => item.userId === interaction.user.id);
    const remaining = last ? Date.parse(last.createdAt) + cooldownMinutes * 60_000 - Date.now() : 0;
    if (remaining > 0) throw new Error(`You can submit another appeal <t:${Math.ceil((Date.now() + remaining) / 1000)}:R>.`);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const record = await store.createAppeal({ guildId: interaction.guildId!, caseId: caseRecord.id, userId: interaction.user.id, reason });
    await store.createLog({ guildId: interaction.guildId!, type: 'appeal_submitted', actorId: interaction.user.id, targetId: interaction.user.id, channelId: interaction.channelId, messageId: null, summary: `Appeal submitted for case #${caseRecord.id.slice(0, 8)}`, metadata: { appealId: record.id, caseId: caseRecord.id, reason } });
    return void await interaction.reply(`Appeal submitted for case #${caseRecord.id.slice(0, 8)}.`);
  }

  if (!isModerator(interaction.member as GuildMember)) throw new Error('You need moderation permissions to resolve appeals.');
  const existing = await store.findAppeal(interaction.guildId!, caseRecord.id);
  if (!existing) throw new Error('No appeal exists for that case.');
  if (existing.status !== 'pending') throw new Error(`This appeal was already ${existing.status}.`);
  const approved = operation === 'approve';
  const note = interaction.options.getString('note') ?? '';
  await store.resolveAppeal(interaction.guildId!, existing.id, approved ? 'approved' : 'denied', interaction.user.id, note);
  if (approved) {
    const progression = await store.getProgression(interaction.guildId!, caseRecord.userId);
    await store.adjustProgression(interaction.guildId!, caseRecord.userId, caseRecord.pcBefore - progression.pc);
    await store.updateCase(interaction.guildId!, caseRecord.id, { status: 'reversed' });
    await reverseCaseSanctions(interaction.client, interaction.guildId!, caseRecord.userId, caseRecord.id);
  }
  await store.createLog({ guildId: interaction.guildId!, type: approved ? 'appeal_approved' : 'appeal_denied', actorId: interaction.user.id, targetId: caseRecord.userId, channelId: interaction.channelId, messageId: null, summary: `Appeal ${approved ? 'approved' : 'denied'} for case #${caseRecord.id.slice(0, 8)}`, metadata: { appealId: existing.id, caseId: caseRecord.id, note } });
  const user = await interaction.client.users.fetch(caseRecord.userId).catch(() => null);
  await user?.send(`Your appeal for case #${caseRecord.id.slice(0, 8)} was ${approved ? 'approved' : 'denied'}.${note ? ` ${note}` : ''}`).catch(() => undefined);
  await interaction.reply(`Appeal ${approved ? 'approved' : 'denied'} for case #${caseRecord.id.slice(0, 8)}.`);
}

async function prefix(interaction: ChatInputCommandInteraction, prefixes: string[]) {
  const op = interaction.options.getSubcommand(); const value = interaction.options.getString('value');
  let next = [...prefixes];
  if (op === 'add' && value && !next.includes(value)) next.push(value);
  if (op === 'remove' && value) next = next.filter((p) => p !== value);
  if (next.length === 0) throw new Error('At least one prefix must remain enabled.');
  if (next.length > 8) throw new Error('A server can have at most 8 prefixes.');
  if (op !== 'list') await store.updateGuildConfig(interaction.guildId!, { prefixes: next });
  await interaction.reply({ content: `Prefixes: ${next.map((p) => `\`${p}\``).join(' ')}`, ephemeral: true });
}

async function ftc(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const sub = interaction.options.getSubcommand(); const season = interaction.options.getInteger('season') ?? currentFtcSeason();
  if (sub === 'search') {
    const query = interaction.options.getString('query', true); const teams = (await ftcScout.search(query, 10)).slice(0, 10);
    const embed = new EmbedBuilder().setColor(orange).setTitle(`FTC team search · ${query}`).setDescription(teams.length ? teams.map((t) => `**${t.number} · ${t.name}**\n${[t.city, t.state, t.country].filter(Boolean).join(', ')}`).join('\n\n') : 'No teams found.').setFooter({ text: 'Data from FTCScout' });
    return void await interaction.editReply({ embeds: [embed] });
  }
  if (sub === 'event') {
    const code = interaction.options.getString('code', true); const [event, teams, matches] = await Promise.all([ftcScout.event(code, season), ftcScout.eventTeams(code, season), ftcScout.eventMatches(code, season)]);
    const embed = new EmbedBuilder().setColor(orange).setTitle(event.name).setURL(`https://ftcscout.org/events/${season}/${event.code}`).setDescription(`${event.code} · ${event.type}\n${[event.venue, event.city, event.state, event.country].filter(Boolean).join(', ')}`).addFields({ name: 'Dates', value: `${event.start} → ${event.end}`, inline: true }, { name: 'Field', value: `${teams.length} teams · ${matches.length} matches`, inline: true }).setFooter({ text: 'Data from FTCScout' });
    return void await interaction.editReply({ embeds: [embed] });
  }
  const number = interaction.options.getInteger('number', true);
  if (sub === 'team') {
    const team = await ftcScout.team(number);
    const embed = new EmbedBuilder().setColor(orange).setTitle(`${team.number} · ${team.name}`).setURL(`https://ftcscout.org/teams/${team.number}`).setDescription(team.schoolName || 'FIRST Tech Challenge team').addFields({ name: 'Location', value: [team.city, team.state, team.country].filter(Boolean).join(', ') || 'Unknown', inline: true }, { name: 'Rookie year', value: String(team.rookieYear), inline: true }, { name: 'Sponsors', value: team.sponsors.slice(0, 8).join(' · ') || 'Not listed' }).setFooter({ text: 'Data from FTCScout' });
    return void await interaction.editReply({ embeds: [embed] });
  }
  if (sub === 'stats' || sub === 'opr') {
    return void await ftcOprReply(interaction, number, season);
  }
  if (sub === 'events') {
    const events = (await ftcScout.events(number, season)).filter((e) => e.stats).sort((a, b) => (a.stats?.rank ?? 9999) - (b.stats?.rank ?? 9999));
    const embed = new EmbedBuilder().setColor(orange).setTitle(`Team ${number} · ${season} events`).setDescription(events.length ? events.slice(0, 12).map((e) => `**${e.eventCode}** · rank ${e.stats!.rank} · ${e.stats!.wins}-${e.stats!.losses}-${e.stats!.ties} · OPR ${e.stats!.opr?.totalPointsNp?.toFixed(1) ?? '—'}`).join('\n') : 'No scored events found.').setFooter({ text: 'Data from FTCScout' });
    return void await interaction.editReply({ embeds: [embed] });
  }
  if (sub === 'awards') {
    const awards = await ftcScout.awards(number, season);
    const embed = new EmbedBuilder().setColor(orange).setTitle(`Team ${number} · ${season} awards`).setDescription(awards.length ? awards.slice(0, 20).map((a) => `**${a.type}** · ${a.eventCode}${a.placement ? ` · #${a.placement}` : ''}${a.personName ? ` · ${a.personName}` : ''}`).join('\n') : 'No awards found.').setFooter({ text: 'Data from FTCScout' });
    return void await interaction.editReply({ embeds: [embed] });
  }
  if (sub === 'matches') {
    const event = interaction.options.getString('event') ?? undefined; const matches = (await ftcScout.matches(number, season, event)).slice(-15).reverse();
    const embed = new EmbedBuilder().setColor(orange).setTitle(`Team ${number} · recent matches`).setDescription(matches.length ? matches.map((m) => `**${m.eventCode} · match ${m.matchId}** · ${m.alliance} ${m.station}${m.dq ? ' · DQ' : ''}${m.surrogate ? ' · surrogate' : ''}`).join('\n') : 'No matches found.').setFooter({ text: 'Match participation from FTCScout' });
    return void await interaction.editReply({ embeds: [embed] });
  }
}

async function topr(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const number = interaction.options.getInteger('number', true);
  const season = interaction.options.getInteger('season') ?? currentFtcSeason();
  await ftcOprReply(interaction, number, season);
}

async function ftcOprReply(interaction: ChatInputCommandInteraction, number: number, season: number) {
  const [team, stats] = await Promise.all([ftcScout.team(number), ftcScout.stats(number, season)]);
  const metric = (label: string, value: { value: number; rank: number }) => ({ name: label, value: `**${value.value.toFixed(1)}** OPR\n#${value.rank} · top ${Math.max(0.1, value.rank / stats.count * 100).toFixed(1)}%`, inline: true });
  const embed = new EmbedBuilder().setColor(orange).setTitle(`${team.number} · ${team.name} · ${season} stats`).setURL(`https://ftcscout.org/teams/${number}?season=${season}`).addFields(metric('Total', stats.tot), metric('Autonomous', stats.auto), metric('Driver controlled', stats.dc), metric('Endgame', stats.eg)).setFooter({ text: `Ranked among ${stats.count.toLocaleString()} teams · FTCScout` });
  await interaction.editReply({ embeds: [embed] });
}
