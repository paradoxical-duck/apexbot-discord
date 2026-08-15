import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const mod = PermissionFlagsBits.ModerateMembers;

export const commandDefinitions = [
  new SlashCommandBuilder().setName('help').setDescription('Browse ApexBot commands')
    .addStringOption((o) => o.setName('command').setDescription('Optional command name')),
  new SlashCommandBuilder().setName('ping').setDescription('Check ApexBot latency and status'),
  new SlashCommandBuilder().setName('mode').setDescription('Switch AI moderation mode').setDefaultMemberPermissions(mod)
    .addStringOption((o) => o.setName('mode').setDescription('Standby reports; active enforces').setRequired(true).addChoices({ name: 'Standby', value: 'standby' }, { name: 'Active', value: 'active' })),
  new SlashCommandBuilder().setName('report').setDescription('Force AI review of a message')
    .addStringOption((o) => o.setName('message_id').setDescription('Discord message ID or message link').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member and advance their progression counter').setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Member to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('mute').setDescription('Timeout a member').setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Member to mute').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Examples: 10m, 2h, 100y. Omit for indefinite'))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Member to timeout').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Examples: 10m, 2h, 100y. Omit for indefinite'))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unmute').setDescription('Remove all active mutes from a member').setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Member to unmute').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('member').setDescription('Member to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete recent message days').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user ID').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('count').setDescription('1–100 messages').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('member').setDescription('Only this member')),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set this channel’s slowmode').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('duration').setDescription('Examples: 30s, 10m, 2h, or 0 to disable').setRequired(true)),
  new SlashCommandBuilder().setName('lock').setDescription('Lock the current channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock the current channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('pc').setDescription('Manage a member progression counter').setDefaultMemberPermissions(mod)
    .addSubcommand((s) => s.setName('view').setDescription('View progression').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('add').setDescription('Increase progression').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1).setMaxValue(20)))
    .addSubcommand((s) => s.setName('remove').setDescription('Reduce progression').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1).setMaxValue(20)))
    .addSubcommand((s) => s.setName('set').setDescription('Set an exact progression level').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('PC level').setRequired(true).setMinValue(0).setMaxValue(10)))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset progression').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))),
  new SlashCommandBuilder().setName('history').setDescription('View a member’s moderation cases').setDefaultMemberPermissions(mod)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('intensity').setDescription('Set moderation strictness').setDefaultMemberPermissions(mod)
    .addStringOption((o) => o.setName('level').setDescription('Moderation intensity').setRequired(true).addChoices({ name: 'Low', value: 'low' }, { name: 'Medium', value: 'medium' }, { name: 'High', value: 'high' })),
  new SlashCommandBuilder().setName('logging').setDescription('Set the channel for all ApexBot logs').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for reports, cases, and server logs').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  new SlashCommandBuilder().setName('appeal').setDescription('Submit or resolve a moderation appeal')
    .addSubcommand((s) => s.setName('submit').setDescription('Appeal one of your cases').addStringOption((o) => o.setName('case').setDescription('Case number').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why this action should be reconsidered').setMaxLength(800)))
    .addSubcommand((s) => s.setName('approve').setDescription('Approve an appeal').addStringOption((o) => o.setName('case').setDescription('Case number').setRequired(true)).addStringOption((o) => o.setName('note').setDescription('Moderator note').setMaxLength(500)))
    .addSubcommand((s) => s.setName('deny').setDescription('Deny an appeal').addStringOption((o) => o.setName('case').setDescription('Case number').setRequired(true)).addStringOption((o) => o.setName('note').setDescription('Moderator note').setMaxLength(500))),
  new SlashCommandBuilder().setName('prefix').setDescription('Manage prefix commands').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('list').setDescription('List prefixes'))
    .addSubcommand((s) => s.setName('add').setDescription('Add a prefix').addStringOption((o) => o.setName('value').setDescription('1–5 characters').setRequired(true).setMinLength(1).setMaxLength(5)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a prefix').addStringOption((o) => o.setName('value').setDescription('Prefix').setRequired(true))),
  new SlashCommandBuilder().setName('topr').setDescription('Dozer-compatible FTC team OPR lookup')
    .addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName('season').setDescription('Starting year')),
  new SlashCommandBuilder().setName('ftc').setDescription('FTCScout team, event, match, and award intelligence')
    .addSubcommand((s) => s.setName('team').setDescription('Team profile').addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('search').setDescription('Search teams by name').addStringOption((o) => o.setName('query').setDescription('Team name').setRequired(true).setMinLength(2)))
    .addSubcommand((s) => s.setName('stats').setDescription('OPR and percentile stats').addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('season').setDescription('Starting year')))
    .addSubcommand((s) => s.setName('opr').setDescription('Alias for stats').addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('season').setDescription('Starting year')))
    .addSubcommand((s) => s.setName('matches').setDescription('Recent matches').addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('season').setDescription('Starting year')).addStringOption((o) => o.setName('event').setDescription('Optional event code')))
    .addSubcommand((s) => s.setName('events').setDescription('Season events and record').addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('season').setDescription('Starting year')))
    .addSubcommand((s) => s.setName('awards').setDescription('Team awards').addIntegerOption((o) => o.setName('number').setDescription('Team number').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('season').setDescription('Starting year')))
    .addSubcommand((s) => s.setName('event').setDescription('Event details').addStringOption((o) => o.setName('code').setDescription('Event code').setRequired(true)).addIntegerOption((o) => o.setName('season').setDescription('Starting year'))),
].map((command) => command.toJSON());
