import { describe, expect, it } from 'vitest';
import { DEFAULT_GUILD_CONFIG, type GuildConfig, type MessageEnvelope } from '@apexbot/shared';
import { routeMessage } from './router.js';

const config: GuildConfig = { guildId: 'g', guildName: 'test', ...DEFAULT_GUILD_CONFIG, updatedAt: '' };
const message = (content: string, extra: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'abc123', guildId: 'g', channelId: 'c', authorId: 'u', authorName: 'user', content,
  createdAt: new Date().toISOString(), attachmentNames: [], attachmentUrls: [], mentions: 0,
  everyoneMention: false, isReply: false, ...extra,
});

describe('resource-aware moderation router', () => {
  it('skips AI for harmless tiny messages', () => expect(routeMessage(message('ok'), config).shouldCallAi).toBe(false));
  it('skips AI for ordinary short conversation', () => expect(routeMessage(message('sounds good'), config).shouldCallAi).toBe(false));
  it('catches spaced and leetspeak blocked words deterministically', () => {
    const result = routeMessage(message('you are a f.u.c.k.3.r'), config);
    expect(result.deterministicAction).toBe('delete');
    expect(result.shouldCallAi).toBe(true);
  });
  it('forces ambiguous threats through AI', () => expect(routeMessage(message('I will kill you tomorrow'), config).shouldCallAi).toBe(true));
  it('flags executable attachments even with empty text', () => {
    const result = routeMessage(message('', { attachmentNames: ['totally-safe.scr'] }), config);
    expect(result.flags).toContain('dangerous-attachment');
    expect(result.shouldCallAi).toBe(true);
  });
  it('routes new-account link spam', () => {
    const result = routeMessage(message('free nitro https://dlscord.gift/x', { accountAgeDays: 0, mentions: 4 }), config);
    expect(result.deterministicScore).toBeGreaterThanOrEqual(10);
    expect(result.flags).toContain('lookalike-domain');
  });
  it('always honors a report-forced review for nonempty content', () => expect(routeMessage(message('ordinary message'), config, true).shouldCallAi).toBe(true));
});
