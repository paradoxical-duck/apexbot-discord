export type ModerationMode = 'standby' | 'active';
export type Strictness = 'low' | 'medium' | 'high';
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type ModerationAction = 'allow' | 'report' | 'verbal_warn' | 'warn' | 'delete' | 'mute' | 'timeout' | 'kick' | 'temp_ban' | 'ban';
export type PunishmentType = 'delete' | 'warn' | 'mute' | 'temp_ban' | 'kick' | 'ban';
export type ReportedMessageBehavior = 'report' | 'enforce';
export type AppealStatus = 'pending' | 'approved' | 'denied';

export interface ProgressionPunishment {
  type: PunishmentType;
  durationMinutes?: number | null;
}

export interface ProgressionLevel {
  level: number;
  label: string;
  actions: ProgressionPunishment[];
}

export interface GuildConfig {
  guildId: string;
  guildName: string;
  mode: ModerationMode;
  strictness: Strictness;
  prefixes: string[];
  badWordsEnabled: boolean;
  blockedTerms: string[];
  exemptRoleIds: string[];
  ignoredChannelIds: string[];
  moderatorChannelId: string | null;
  loggingChannelId: string | null;
  appealsChannelId: string | null;
  aiEnabled: boolean;
  aiAuditRate: number;
  reportedMessageBehavior: ReportedMessageBehavior;
  dmOffenders: boolean;
  pingOffenders: boolean;
  adminBypass: boolean;
  deleteSpamMessages: boolean;
  appealCooldownMinutes: number;
  pcExpiryDays: number | null;
  progressionLevels: ProgressionLevel[];
  muteRoleId: string | null;
  updatedAt: string;
}

export interface MessageEnvelope {
  id: string;
  guildId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  editedAt?: string;
  attachmentNames: string[];
  attachmentUrls: string[];
  mentions: number;
  everyoneMention: boolean;
  isReply: boolean;
  replyContent?: string;
  accountAgeDays?: number;
  memberAgeDays?: number;
  recentMessages?: string[];
}

export interface RouteSignals {
  normalized: string;
  deterministicScore: number;
  flags: string[];
  matchedTerms: string[];
  forceAi: boolean;
  shouldCallAi: boolean;
  auditSampled: boolean;
  deterministicAction: ModerationAction;
}

export interface AiVerdict {
  harmful: boolean;
  confidence: number;
  severity: RiskLevel;
  categories: string[];
  action: ModerationAction;
  pcDelta: number;
  reason: string;
  evidence: string;
  contextual: boolean;
}

export interface ModerationDecision {
  action: ModerationAction;
  severity: RiskLevel;
  confidence: number;
  categories: string[];
  pcDelta: number;
  reason: string;
  source: 'deterministic' | 'ai' | 'manual' | 'report';
  aiAnalyzed: boolean;
  route: RouteSignals;
}

export interface ModerationCase {
  id: string;
  guildId: string;
  userId: string;
  moderatorId: string | null;
  messageId: string | null;
  channelId: string | null;
  action: ModerationAction;
  severity: RiskLevel;
  categories: string[];
  reason: string;
  evidence: string;
  pcBefore: number;
  pcAfter: number;
  source: ModerationDecision['source'];
  status: 'open' | 'actioned' | 'dismissed' | 'reversed';
  createdAt: string;
}

export interface Appeal {
  id: string;
  guildId: string;
  caseId: string;
  userId: string;
  reason: string;
  status: AppealStatus;
  moderatorId: string | null;
  moderatorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ActiveSanction {
  id: string;
  guildId: string;
  userId: string;
  caseId: string;
  type: 'mute' | 'temp_ban';
  roleId: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
  liftedAt: string | null;
}

export interface UserProgression {
  guildId: string;
  userId: string;
  pc: number;
  pcEntries: string[];
  warnings: number;
  lastOffenseAt: string | null;
  updatedAt: string;
}

export const DEFAULT_PROGRESSION_LEVELS: ProgressionLevel[] = [
  { level: 1, label: 'Warning', actions: [{ type: 'warn' }] },
  { level: 2, label: 'One hour mute', actions: [{ type: 'delete' }, { type: 'mute', durationMinutes: 60 }] },
  { level: 3, label: 'One day mute', actions: [{ type: 'delete' }, { type: 'mute', durationMinutes: 1_440 }] },
  { level: 4, label: 'Seven day mute', actions: [{ type: 'delete' }, { type: 'mute', durationMinutes: 10_080 }] },
  { level: 5, label: 'Fourteen day temporary ban', actions: [{ type: 'delete' }, { type: 'temp_ban', durationMinutes: 20_160 }] },
  { level: 6, label: 'Permanent ban', actions: [{ type: 'delete' }, { type: 'ban' }] },
];

export interface AuditLog {
  id: string;
  guildId: string;
  type: string;
  actorId: string | null;
  targetId: string | null;
  channelId: string | null;
  messageId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const DEFAULT_GUILD_CONFIG: Omit<GuildConfig, 'guildId' | 'guildName' | 'updatedAt'> = {
  mode: 'standby',
  strictness: 'medium',
  prefixes: ['?', '!'],
  badWordsEnabled: true,
  blockedTerms: [],
  exemptRoleIds: [],
  ignoredChannelIds: [],
  moderatorChannelId: null,
  loggingChannelId: null,
  appealsChannelId: null,
  aiEnabled: true,
  aiAuditRate: 0.03,
  reportedMessageBehavior: 'report',
  dmOffenders: true,
  pingOffenders: false,
  adminBypass: true,
  deleteSpamMessages: true,
  appealCooldownMinutes: 360,
  pcExpiryDays: null,
  progressionLevels: DEFAULT_PROGRESSION_LEVELS,
  muteRoleId: null,
};

export const STRICTNESS_POLICY = {
  low: { aiThreshold: 6, reportConfidence: 0.82, actionConfidence: 0.94, auditRate: 0.01 },
  medium: { aiThreshold: 4, reportConfidence: 0.68, actionConfidence: 0.84, auditRate: 0.03 },
  high: { aiThreshold: 2, reportConfidence: 0.55, actionConfidence: 0.74, auditRate: 0.07 },
} as const;
