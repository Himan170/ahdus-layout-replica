import { describe, it, expect } from 'vitest';
import { measureUntil } from './timing';

const busy = (ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* the machine is busy */ } };

describe('measureUntil (v0.18.2: timing tests a busy moment does not fail)', () => {
  it('a busy first round (every run slow) is measured again after a pause: the fast time counts', async () => {
    let round = 0;
    let calls = 0;
    const { fastest, rounds } = await measureUntil(2, () => { calls++; busy(round === 0 ? 40 : 1); if (calls % 6 === 0) round++; },
      (t) => Math.max(...t) < 20, { gapMs: 10 });
    expect(rounds).toBe(2); // one slow round only measured once more
    expect(Math.max(...fastest)).toBeLessThan(20);
  });
  it('a real slow-down is slow in every round and still over the limit (at most `rounds` rounds)', async () => {
    const { fastest, rounds } = await measureUntil(1, () => busy(25), ([t]) => t < 20, { rounds: 3, runs: 2, gapMs: 10 });
    expect(rounds).toBe(3);
    expect(fastest[0]).toBeGreaterThanOrEqual(20);
  });
  it('a fast run needs one round', async () => {
    const { rounds } = await measureUntil(3, () => busy(0), () => true);
    expect(rounds).toBe(1);
  });
});
