import { createHash } from 'node:crypto';
import type { GuildConfig, MessageEnvelope, ModerationAction, RouteSignals } from '@apexbot/shared';
import { STRICTNESS_POLICY } from '@apexbot/shared';
import { ALL_BUILT_IN_TERMS, DANGEROUS_EXTENSIONS, HATE_TERMS, SCAM_PHRASES, SUSPICIOUS_TLDS, THREAT_PHRASES } from './blocked-terms.js';
import { containsNormalizedTerm, normalizeForModeration } from './normalize.js';

const urlPattern = /(?:https?:\/\/|www\.|discord(?:app)?\.com\/invite|discord\.gg\/)[^\s]+/i;
const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const personalInfoPattern = /\b(?:home address|phone number|social security|passport number|credit card)\b/i;
const toxicityHints = /\b(?:hate|die|murder|rape|stupid|ugly|worthless|loser|idiot|moron|creep|pedo|terrorist)\b/i;
const harassmentPattern = /\byou(?:'re| are)?\s+(?:so\s+)?(?:stupid|ugly|worthless|pathetic|a loser|an idiot)\b/i;

function sampled(messageId: string, rate: number): boolean {
  const bucket = Number.parseInt(createHash('sha1').update(messageId).digest('hex').slice(0, 8), 16) / 0xffffffff;
  return bucket < rate;
}

export function routeMessage(message: MessageEnvelope, config: GuildConfig, forceAi = false): RouteSignals {
  const normalized = normalizeForModeration(message.content);
  const flags: string[] = [];
  const matchedTerms: string[] = [];
  let score = 0;
  let deterministicAction: ModerationAction = 'allow';
  const add = (flag: string, points: number) => { if (!flags.includes(flag)) flags.push(flag); score += points; };

  if (config.badWordsEnabled) {
    for (const term of [...ALL_BUILT_IN_TERMS, ...config.blockedTerms]) {
      if (containsNormalizedTerm(normalized, term)) matchedTerms.push(term);
    }
    if (matchedTerms.length) {
      const hate = matchedTerms.some((term) => HATE_TERMS.includes(term));
      add(hate ? 'hate-term' : 'blocked-term', hate ? 10 : 7);
      deterministicAction = 'delete';
    }
  }

  if (THREAT_PHRASES.some((term) => containsNormalizedTerm(normalized, term))) add('threat-language', 10);
  if (SCAM_PHRASES.some((term) => containsNormalizedTerm(normalized, term))) add('scam-language', 8);
  if (harassmentPattern.test(normalized)) add('targeted-harassment', 7);
  else if (toxicityHints.test(normalized)) add('toxicity-ambiguous', 3);
  if (personalInfoPattern.test(normalized) || ipPattern.test(normalized)) add('possible-personal-information', 6);

  if (urlPattern.test(normalized)) {
    add('contains-link', 1);
    if (SUSPICIOUS_TLDS.some((tld) => normalized.includes(tld))) add('suspicious-link', 6);
    if (/discord(?:app)?\.(?:gift|nitro)|steamcommunlty|dlscord|dicsord/i.test(normalized)) add('lookalike-domain', 9);
  }
  if (message.attachmentNames.some((name) => DANGEROUS_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))) add('dangerous-attachment', 10);
  if (message.everyoneMention) add('everyone-mention', 4);
  if (message.mentions >= 5) add('mass-mentions', Math.min(8, message.mentions));
  if (message.content.length >= 12) {
    const letters = message.content.replace(/[^a-z]/gi, '');
    const upper = letters.replace(/[^A-Z]/g, '');
    if (letters.length > 8 && upper.length / letters.length > 0.78) add('excessive-caps', 2);
  }
  if (/(.)\1{9,}/i.test(message.content) || /(.{2,12})\1{4,}/i.test(message.content)) add('repetition-spam', 3);
  if ((message.recentMessages?.filter((m) => normalizeForModeration(m) === normalized).length ?? 0) >= 2) add('repeat-flood', 5);
  if (config.deleteSpamMessages && flags.some((flag) => ['repetition-spam', 'repeat-flood', 'mass-mentions'].includes(flag))) deterministicAction = 'delete';
  if ((message.accountAgeDays ?? 999) < 3 && (urlPattern.test(normalized) || message.mentions >= 3)) add('new-account-risk', 3);
  if ((message.memberAgeDays ?? 999) < 1 && score >= 2) add('new-member-risk', 2);

  const policy = STRICTNESS_POLICY[config.strictness];
  const auditRate = Math.max(config.aiAuditRate, policy.auditRate);
  const auditSampled = config.aiEnabled && normalized.length >= 4 && sampled(message.id, auditRate);
  const shortBenign = normalized.length < 5 && score === 0;
  const obviousSafe = score === 0 && normalized.length < 20 && !urlPattern.test(normalized) && message.attachmentNames.length === 0;
  const contextualRisk = message.isReply && score >= 2;
  const shouldCallAi = config.aiEnabled && !shortBenign && (
    forceAi || score >= policy.aiThreshold || contextualRisk ||
    (score > 0 && normalized.length >= 24) ||
    (!obviousSafe && auditSampled)
  );

  if (score >= 10 && deterministicAction === 'allow') deterministicAction = 'report';
  return { normalized, deterministicScore: score, flags, matchedTerms, forceAi, shouldCallAi, auditSampled, deterministicAction };
}
