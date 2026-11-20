// v0.18.4: "Avoid stairs (use lifts)", the viewer's route option, remembered per browser (localStorage, try / catch:
// blocked storage = this visit only). PURE apart from the storage passed in (tests give their own).

export const AVOID_STAIRS_KEY = 'ahdus.avoidStairs';
export const AVOID_STAIRS_LABEL = 'Avoid stairs (use lifts)';
export const AVOID_STAIRS_NOTE = 'Routes, Take me there and the tour go between floors by lift';
export const USE_STAIRS_LABEL = 'Use the stairs this time';
export const STAIRS_ONLY_NOTE = 'Stairs only';

/** The option as last set in this browser (false when nothing is stored or storage is blocked). */
export function storedAvoidStairs(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(AVOID_STAIRS_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeAvoidStairs(on, storage = globalThis.localStorage) {
  try {
    if (on) storage?.setItem(AVOID_STAIRS_KEY, '1');
    else storage?.removeItem(AVOID_STAIRS_KEY);
  } catch { /* blocked: this visit only */ }
}

/** A route problem "Use the stairs this time" can answer: only the stairs reach it (never another problem). */
export function needsStairs(problem) {
  return problem === 'NEEDS_STAIRS';
}
