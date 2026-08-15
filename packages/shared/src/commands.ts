export interface CommandHelp {
  name: string;
  category: 'moderation' | 'configuration' | 'ftc' | 'utility';
  description: string;
  moderatorOnly?: boolean;
  prefixSyntax: string;
}

export const COMMAND_CATALOG: CommandHelp[] = [
  { name: 'help', category: 'utility', description: 'Show ApexBot command help.', prefixSyntax: 'help [command]' },
  { name: 'ping', category: 'utility', description: 'Check gateway and API latency.', prefixSyntax: 'ping' },
  { name: 'mode', category: 'configuration', description: 'Switch active or standby moderation.', moderatorOnly: true, prefixSyntax: 'mode <active|standby>' },
  { name: 'report', category: 'moderation', description: 'Force AI review of a message ID or replied message.', prefixSyntax: 'report <message-id>' },
  { name: 'warn', category: 'moderation', description: 'Warn a member and advance progression.', moderatorOnly: true, prefixSyntax: 'warn @member <reason>' },
  { name: 'mute', category: 'moderation', description: 'Mute a member for up to 100 years or indefinitely.', moderatorOnly: true, prefixSyntax: 'mute @member [duration] [reason]' },
  { name: 'timeout', category: 'moderation', description: 'Alias for mute.', moderatorOnly: true, prefixSyntax: 'timeout @member [duration] [reason]' },
  { name: 'unmute', category: 'moderation', description: 'Remove all active mutes from a member.', moderatorOnly: true, prefixSyntax: 'unmute @member [reason]' },
  { name: 'kick', category: 'moderation', description: 'Kick a member.', moderatorOnly: true, prefixSyntax: 'kick @member [reason]' },
  { name: 'ban', category: 'moderation', description: 'Ban a member.', moderatorOnly: true, prefixSyntax: 'ban @member [reason]' },
  { name: 'unban', category: 'moderation', description: 'Remove a server ban.', moderatorOnly: true, prefixSyntax: 'unban <user-id> [reason]' },
  { name: 'purge', category: 'moderation', description: 'Bulk-delete recent messages.', moderatorOnly: true, prefixSyntax: 'purge <count> [@member]' },
  { name: 'slowmode', category: 'moderation', description: 'Set channel slowmode up to six hours.', moderatorOnly: true, prefixSyntax: 'slowmode <30s|10m|2h|0>' },
  { name: 'lock', category: 'moderation', description: 'Lock the current channel.', moderatorOnly: true, prefixSyntax: 'lock [reason]' },
  { name: 'unlock', category: 'moderation', description: 'Unlock the current channel.', moderatorOnly: true, prefixSyntax: 'unlock [reason]' },
  { name: 'pc', category: 'moderation', description: 'View, set, or modify a member progression counter.', moderatorOnly: true, prefixSyntax: 'pc <view|add|remove|set|reset> @member [amount]' },
  { name: 'history', category: 'moderation', description: 'View a member moderation history.', moderatorOnly: true, prefixSyntax: 'history @member' },
  { name: 'appeal', category: 'moderation', description: 'Submit or resolve a case appeal.', prefixSyntax: 'appeal [approve|deny] <case> [reason]' },
  { name: 'intensity', category: 'configuration', description: 'Set low, medium, or high moderation intensity.', moderatorOnly: true, prefixSyntax: 'intensity <low|medium|high>' },
  { name: 'prefix', category: 'configuration', description: 'List, add, or remove command prefixes.', moderatorOnly: true, prefixSyntax: 'prefix <list|add|remove> [prefix]' },
  { name: '@ApexBot help', category: 'utility', description: 'Mention ApexBot to show every command.', prefixSyntax: '@ApexBot help' },
  { name: '@ApexBot prompt', category: 'utility', description: 'Mention ApexBot with a message to ask the AI.', prefixSyntax: '@ApexBot <message>' },
  { name: 'ftc team', category: 'ftc', description: 'Show FTC team identity and location.', prefixSyntax: 'ftc team <number>' },
  { name: 'ftc search', category: 'ftc', description: 'Search FTC teams by name.', prefixSyntax: 'ftc search <name>' },
  { name: 'ftc stats', category: 'ftc', description: 'Show FTCScout OPR and percentile stats.', prefixSyntax: 'ftc stats <number> [season]' },
  { name: 'ftc matches', category: 'ftc', description: 'Show recent team matches.', prefixSyntax: 'ftc matches <number> [season]' },
  { name: 'ftc events', category: 'ftc', description: 'Show a team’s season events.', prefixSyntax: 'ftc events <number> [season]' },
  { name: 'ftc awards', category: 'ftc', description: 'Show team awards.', prefixSyntax: 'ftc awards <number> [season]' },
  { name: 'ftc event', category: 'ftc', description: 'Show event details, teams, and matches.', prefixSyntax: 'ftc event <code> [season]' },
];
