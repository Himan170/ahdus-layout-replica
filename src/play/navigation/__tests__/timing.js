/**
 * navigation/__tests__/timing.js (v0.18.2): speed checks that a busy machine doesn't fail.
 *
 * A timing test shares the CPU with the other test files (vitest runs them side by side), a GC pause or
 * another program: one slow measurement says little. `measureUntil` measures in rounds, keeping each
 * case's fastest time; another round runs only while the result is over its limit, after a short pause
 * (the busy moment may pass), at most `rounds` times. A real slow-down is slow in every round and still
 * fails; the limits themselves are not raised.
 */

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {number} cases   how many things are timed (routes, plans…)
 * @param {(i: number) => void} run   runs case i once (timed)
 * @param {(fastest: number[]) => boolean} ok   true: the times are good enough, stop
 * @param {{ rounds?: number, runs?: number, gapMs?: number }} [options]
 *   rounds: at most this many rounds (4), runs: timings per case in a round (3), gapMs: the pause between rounds
 * @returns {Promise<{ fastest: number[], rounds: number }>} each case's fastest time (ms) over all rounds
 */
export async function measureUntil(cases, run, ok, { rounds = 4, runs = 3, gapMs = 300 } = {}) {
  const fastest = new Array(cases).fill(Infinity);
  let round = 0;
  while (round < rounds) {
    if (round > 0) await pause(gapMs);
    round++;
    for (let i = 0; i < cases; i++) {
      for (let k = 0; k < runs; k++) {
        const t0 = performance.now();
        run(i);
        fastest[i] = Math.min(fastest[i], performance.now() - t0);
      }
    }
    if (ok(fastest)) break;
  }
  return { fastest, rounds: round };
}
