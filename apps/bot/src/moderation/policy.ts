import type { AiVerdict, GuildConfig, ModerationAction, RiskLevel } from '@apexbot/shared';
import { STRICTNESS_POLICY } from '@apexbot/shared';

const actionRank: ModerationAction[] = ['allow', 'report', 'warn', 'delete', 'timeout', 'kick', 'ban'];

export function progressionAction(pc: number, severity: RiskLevel): ModerationAction {
  if (severity === 'critical') return pc >= 4 ? 'ban' : 'kick';
  if (pc >= 8) return 'ban';
  if (pc >= 6) return 'kick';
  if (pc >= 3) return 'timeout';
  if (pc >= 2) return 'delete';
  if (pc >= 1) return 'warn';
  return 'allow';
}

export function finalAction(verdict: AiVerdict, config: GuildConfig, pcAfter: number): ModerationAction {
  if (!verdict.harmful) return 'allow';
  const policy = STRICTNESS_POLICY[config.strictness];
  if (verdict.confidence < policy.reportConfidence) return 'allow';
  if (verdict.confidence < policy.actionConfidence) return 'report';
  const compounded = progressionAction(pcAfter, verdict.severity);
  return actionRank.indexOf(compounded) > actionRank.indexOf(verdict.action) ? compounded : verdict.action;
}

export function timeoutMinutes(pc: number, severity: RiskLevel): number {
  if (severity === 'critical') return 60 * 24 * 7;
  return pc >= 5 ? 60 * 24 : pc >= 4 ? 60 : 10;
}
