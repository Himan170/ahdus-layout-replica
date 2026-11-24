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

/**
 * v0.18.10: a fixed piece of work, the same in every run and every version (a shortest-path search over a grid with a
 * binary heap on typed arrays: the kind of work planning does, none of the code it runs). Timed beside the work under
 * test, it says how fast the machine is RIGHT NOW: a busy suite slows both alike. Returns a checksum (so it isn't
 * optimised away).
 * @param {number} [size] the grid's side (cells)
 */
export function referenceWork(size = 800) {
  const n = size * size;
  const dist = new Float64Array(n).fill(Infinity);
  const heapNode = new Int32Array(n * 4);
  const heapCost = new Float64Array(n * 4);
  let len = 0;
  const push = (node, cost) => {
    let i = len++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapCost[parent] <= cost) break;
      heapNode[i] = heapNode[parent];
      heapCost[i] = heapCost[parent];
      i = parent;
    }
    heapNode[i] = node;
    heapCost[i] = cost;
  };
  const pop = () => {
    const top = heapNode[0];
    const lastNode = heapNode[--len];
    const lastCost = heapCost[len];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= len) break;
      if (c + 1 < len && heapCost[c + 1] < heapCost[c]) c++;
      if (heapCost[c] >= lastCost) break;
      heapNode[i] = heapNode[c];
      heapCost[i] = heapCost[c];
      i = c;
    }
    heapNode[i] = lastNode;
    heapCost[i] = lastCost;
    return top;
  };
  // walls: every 8th column blocked except a gap that moves (a maze-like detour), fixed for every run
  const blocked = (x, z) => x % 8 === 7 && z % size !== ((x * 37) % size);
  dist[0] = 0;
  push(0, 0);
  while (len) {
    const node = pop();
    const d = dist[node];
    const x = node % size;
    const z = (node - x) / size;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size || blocked(nx, nz)) continue;
        const nd = d + (dx && dz ? Math.SQRT2 : 1);
        const m = nz * size + nx;
        if (nd < dist[m]) {
          dist[m] = nd;
          push(m, nd);
        }
      }
    }
  }
  let sum = 0;
  for (let i = 0; i < n; i += 97) if (dist[i] !== Infinity) sum += dist[i];
  return sum;
}

/**
 * v0.18.10: how long `run` takes compared with `reference`, both timed in turns (reference, run, reference, run …),
 * each one's fastest kept: the ratio barely moves when the machine is busy (both are slowed in the same moments), and
 * a real slow-down of `run` raises it. Another round only while `ok(ratio)` is false, after a pause, at most `rounds`.
 * @param {() => void} reference   the fixed work (referenceWork)
 * @param {() => void} run   the work under test
 * @param {(ratio: number) => boolean} ok
 * @param {{ rounds?: number, runs?: number, gapMs?: number }} [options]
 * @returns {Promise<{ ratio: number, run: number, reference: number, rounds: number }>} fastest times (ms)
 */
export async function measureRatio(reference, run, ok, { rounds = 4, runs = 5, gapMs = 300 } = {}) {
  let fastRef = Infinity;
  let fastRun = Infinity;
  let round = 0;
  while (round < rounds) {
    if (round > 0) await pause(gapMs);
    round++;
    for (let k = 0; k < runs; k++) {
      let t0 = performance.now();
      reference();
      fastRef = Math.min(fastRef, performance.now() - t0);
      t0 = performance.now();
      run();
      fastRun = Math.min(fastRun, performance.now() - t0);
    }
    if (ok(fastRun / fastRef)) break;
  }
  return { ratio: fastRun / fastRef, run: fastRun, reference: fastRef, rounds: round };
}
