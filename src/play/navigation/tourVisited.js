/**
 * play/navigation/tourVisited.js
 *
 * PURE: the tour's visited stops, per browser (v0.14.4, private-docs/EXPERIENCE_PLAN.md 3.5 + decision 6.4:
 * per browser only for now). One storage key, `ahdus.tourVisited`: { [layoutKey]: [stopId, …] }, at most
 * MAX_LAYOUTS layouts (the one used longest ago dropped first). Every read and write is in try / catch: a
 * private window, blocked storage or a full one keeps the ticks for this visit only (the caller's list).
 * The storage is passed in (window.localStorage in the page, a Map-backed one in tests).
 */

export const VISITED_KEY = 'ahdus.tourVisited';
/** At most this many layouts keep their ticks. */
export const MAX_LAYOUTS = 20;

/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void }} StorageLike */

/** All layouts' ticks ({} when there are none or storage can't be read). */
function readAll(storage) {
  try {
    const v = JSON.parse(storage?.getItem(VISITED_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The stops visited on this layout (stop ids, in the order visited). */
export function readVisited(storage, layoutKey) {
  const list = readAll(storage)[layoutKey];
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}

/** Write this layout's ticks (it becomes the most recent layout). false: not stored (kept by the caller only). */
function writeVisited(storage, layoutKey, ids) {
  const all = readAll(storage);
  delete all[layoutKey];
  all[layoutKey] = ids;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_LAYOUTS))) delete all[k];
  try {
    storage?.setItem(VISITED_KEY, JSON.stringify(all));
    return !!storage;
  } catch {
    return false;
  }
}

/** Tick a stop (once): the new list. */
export function markVisited(storage, layoutKey, stopId, known = readVisited(storage, layoutKey)) {
  if (known.includes(stopId)) return known;
  const next = [...known, stopId];
  writeVisited(storage, layoutKey, next);
  return next;
}

/** No ticks for this layout any more (Restart): []. */
export function clearVisited(storage, layoutKey) {
  writeVisited(storage, layoutKey, []);
  return [];
}

/** The browser's storage, or null when the page may not use it (it throws on access in some private windows). */
export function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
