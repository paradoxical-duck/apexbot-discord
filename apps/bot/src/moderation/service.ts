import type { GuildConfig, MessageEnvelope, ModerationAction, ModerationDecision, ProgressionPunishment, RiskLevel } from '@apexbot/shared';
import { store } from '../data/store.js';
import { analyzeWithAi } from './ai.js';
import { finalAction } from './policy.js';
import { routeMessage } from './router.js';

function severityFromScore(score: number): RiskLevel {
  if (score >= 14) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 6) return 'medium';
  if (score >= 2) return 'low';
  return 'none';
}

export interface ReviewResult {
  decision: ModerationDecision;
  caseId: string | null;
  pcBefore: number;
  pcAfter: number;
  phase: 'none' | 'verbal' | 'official' | 'pc';
  punishments: ProgressionPunishment[];
}

export async function reviewMessage(message: MessageEnvelope, config: GuildConfig, options: { forceAi?: boolean; source?: 'report' | 'manual' } = {}): Promise<ReviewResult> {
  const route = routeMessage(message, config, options.forceAi ?? false);
  const current = await store.getProgression(message.guildId, message.authorId);
  let decision: ModerationDecision;

  if (route.shouldCallAi) {
    const verdict = await analyzeWithAi(message, config, route);
    if (verdict) {
      const projectedPc = Math.max(0, current.pc + (verdict.harmful ? verdict.pcDelta : 0));
      const action = finalAction(verdict, config, projectedPc);
      const aiDecision: ModerationDecision = {
        action, severity: verdict.severity, confidence: verdict.confidence,
        categories: verdict.categories, pcDelta: action === 'allow' ? 0 : verdict.pcDelta,
        reason: verdict.reason, source: options.source ?? 'ai', aiAnalyzed: true, route,
      };
      const deterministic = deterministicDecision(route, options.source);
      decision = actionPriority(deterministic.action) > actionPriority(aiDecision.action)
        ? { ...deterministic, aiAnalyzed: true }
        : aiDecision;
    } else {
      decision = deterministicDecision(route, options.source);
    }
  } else decision = deterministicDecision(route, options.source);

  const originalAction = decision.action;
  const reportMayEnforce = options.source === 'report' && config.reportedMessageBehavior === 'enforce';
  const enforce = config.mode === 'active' || reportMayEnforce;
  const actionable = originalAction !== 'allow' && originalAction !== 'report';
  let progression = current;
  let phase: ReviewResult['phase'] = 'none';
  let punishments: ProgressionPunishment[] = [];

  if (actionable && enforce) {
    const advanced = await store.advanceOffense(message.guildId, message.authorId, 1, Math.min(10, config.progressionLevels.length));
    progression = advanced.after;
    phase = advanced.phase;
    if (phase === 'official' || phase === 'pc') punishments = config.progressionLevels.find((level) => level.level === progression.pc)?.actions ?? config.progressionLevels.at(-1)?.actions ?? [{ type: 'warn' }];

    const shouldDelete = originalAction === 'delete' || ['timeout', 'kick', 'ban'].includes(originalAction) || decision.route.flags.some((flag) => ['blocked-term', 'hate-term', 'repetition-spam', 'repeat-flood', 'mass-mentions', 'scam-language', 'dangerous-attachment'].includes(flag));
    if (shouldDelete && !punishments.some((item) => item.type === 'delete')) punishments = [{ type: 'delete' }, ...punishments];
    decision = { ...decision, action: representativeAction(punishments, phase) };
  } else if (decision.action !== 'allow') {
    decision = { ...decision, action: 'report' };
  }

  let caseId: string | null = null;
  if (decision.action !== 'allow') {
    const record = await store.createCase({
      guildId: message.guildId, userId: message.authorId, moderatorId: null,
      messageId: message.id, channelId: message.channelId, action: decision.action,
      severity: decision.severity, categories: decision.categories, reason: decision.reason,
      evidence: message.content.slice(0, 500), pcBefore: current.pc, pcAfter: progression.pc,
      source: decision.source, status: decision.action === 'report' ? 'open' : 'actioned',
    });
    caseId = record.id;
  }

  // Safe deterministic passes are intentionally not persisted: at Discord scale,
  // logging them would cost more Firestore writes than moderation itself. AI audits,
  // signals, and all cases remain fully auditable.
  if (decision.action !== 'allow' || decision.aiAnalyzed || route.deterministicScore > 0) {
    await store.createLog({
      guildId: message.guildId, type: 'message_review', actorId: null, targetId: message.authorId,
      channelId: message.channelId, messageId: message.id,
      summary: `${decision.action.toUpperCase()} · ${decision.reason}`,
      metadata: { caseId, action: decision.action, severity: decision.severity, reason: decision.reason, content: message.content.slice(0, 900), aiAnalyzed: decision.aiAnalyzed, score: route.deterministicScore, flags: route.flags, strictness: config.strictness, mode: config.mode, phase, punishments },
    });
  }
  return { decision, caseId, pcBefore: current.pc, pcAfter: progression.pc, phase, punishments };
}

function actionPriority(action: ModerationAction): number {
  return ['allow', 'report', 'verbal_warn', 'warn', 'delete', 'mute', 'timeout', 'kick', 'temp_ban', 'ban'].indexOf(action);
}

function representativeAction(punishments: ProgressionPunishment[], phase: ReviewResult['phase']): ModerationAction {
  if (phase === 'verbal' && punishments.length === 0) return 'verbal_warn';
  const order: ModerationAction[] = ['allow', 'verbal_warn', 'warn', 'delete', 'mute', 'timeout', 'kick', 'temp_ban', 'ban'];
  const actions = punishments.map((item) => item.type as ModerationAction);
  return actions.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'warn';
}

function deterministicDecision(route: ReturnType<typeof routeMessage>, source?: 'report' | 'manual'): ModerationDecision {
  const severity = severityFromScore(route.deterministicScore);
  const actionable = route.deterministicAction !== 'allow';
  return {
    action: route.deterministicAction,
    severity,
    confidence: actionable ? Math.min(0.99, 0.62 + route.deterministicScore * 0.03) : 1,
    categories: route.flags,
    pcDelta: severity === 'critical' ? 4 : severity === 'high' ? 3 : severity === 'medium' ? 2 : actionable ? 1 : 0,
    reason: actionable ? readableReason(route.flags) : 'No action needed',
    source: source ?? 'deterministic', aiAnalyzed: false, route,
  };
}

function readableReason(flags: string[]): string {
  if (flags.includes('hate-term')) return 'Hateful language';
  if (flags.includes('blocked-term')) return 'Blocked language';
  if (flags.includes('threat-language')) return 'Threatening language';
  if (flags.includes('scam-language') || flags.includes('lookalike-domain')) return 'Possible scam';
  if (flags.some((flag) => ['repetition-spam', 'repeat-flood', 'mass-mentions'].includes(flag))) return 'Spam';
  if (flags.includes('dangerous-attachment')) return 'Unsafe attachment';
  return 'Server rule violation';
}
