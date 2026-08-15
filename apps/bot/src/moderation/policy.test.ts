import { describe, expect, it } from 'vitest';
import { progressionAction, timeoutMinutes } from './policy.js';

describe('compounding punishment policy', () => {
  it('compounds from warning to ban', () => {
    expect(progressionAction(1, 'low')).toBe('warn');
    expect(progressionAction(3, 'medium')).toBe('timeout');
    expect(progressionAction(6, 'high')).toBe('kick');
    expect(progressionAction(8, 'high')).toBe('ban');
  });
  it('increases timeout duration with progression', () => {
    expect(timeoutMinutes(3, 'medium')).toBe(10);
    expect(timeoutMinutes(4, 'medium')).toBe(60);
    expect(timeoutMinutes(5, 'medium')).toBe(1440);
  });
});
