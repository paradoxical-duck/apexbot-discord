import { describe, expect, it } from 'vitest';
import { currentFtcSeason } from './client.js';

describe('FTC season selection', () => {
  it('rolls over in September', () => {
    expect(currentFtcSeason(new Date('2026-08-31T12:00:00Z'))).toBe(2025);
    expect(currentFtcSeason(new Date('2026-09-01T00:00:00Z'))).toBe(2026);
  });
});
