import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApexStore } from './store.js';

afterEach(() => vi.useRealTimers());

describe('progression storage', () => {
  it('uses a verbal warning before official PC1 and advances one level at a time', async () => {
    const store = new ApexStore(); const guildId = `progression-${crypto.randomUUID()}`; const userId = 'member';
    const first = await store.advanceOffense(guildId, userId, 1, 10);
    const second = await store.advanceOffense(guildId, userId, 1, 10);
    const third = await store.advanceOffense(guildId, userId, 1, 10);
    expect(first).toMatchObject({ phase: 'verbal', after: { pc: 0 } });
    expect(second).toMatchObject({ phase: 'official', after: { pc: 1 } });
    expect(third).toMatchObject({ phase: 'pc', after: { pc: 2 } });
  });

  it('expires individual PC entries after the configured window', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const store = new ApexStore(); const guildId = `expiry-${crypto.randomUUID()}`; const userId = 'member';
    await store.updateGuildConfig(guildId, { pcExpiryDays: 30 });
    await store.setProgression(guildId, userId, 1);
    vi.setSystemTime(new Date('2026-02-01T00:00:01Z'));
    expect((await store.getProgression(guildId, userId)).pc).toBe(0);
  });
});
