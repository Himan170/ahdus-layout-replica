/**
 * ui/hiddenLayers.js (v0.15.6)
 *
 * Layers' eye: rooms and items hidden from Workplace Studio's view. A VIEW setting of this
 * browser only: never saved in the layout, never hidden for anyone else (the viewer, the
 * embed, Walk through all show everything). Kept per workplace in localStorage
 * `ahdus.hiddenLayers` = { "<company>/<layout>": { rooms: [ids], objects: [ids] } },
 * at most MAX_WORKPLACES of them (the oldest dropped), every access in try / catch.
 */

export const HIDDEN_KEY = 'ahdus.hiddenLayers';
export const MAX_WORKPLACES = 30;

export const NO_HIDDEN = Object.freeze({ rooms: Object.freeze([]), objects: Object.freeze([]) });

const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id) : []);

function readAll(storage) {
  try {
    const raw = storage?.getItem(HIDDEN_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

/** What is hidden in this workplace ({ rooms, objects }; none: NO_HIDDEN). */
export function readHidden(workplace, storage = globalThis.localStorage) {
  const entry = readAll(storage)[workplace];
  if (!entry) return NO_HIDDEN;
  return { rooms: ids(entry.rooms), objects: ids(entry.objects) };
}

/** Remember it (nothing hidden = the workplace's entry removed). */
export function writeHidden(workplace, hidden, storage = globalThis.localStorage) {
  try {
    const all = readAll(storage);
    delete all[workplace];
    if (hidden.rooms.length || hidden.objects.length) all[workplace] = { rooms: hidden.rooms, objects: hidden.objects };
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_WORKPLACES))) delete all[k];
    storage?.setItem(HIDDEN_KEY, JSON.stringify(all));
  } catch {
    // blocked storage: hidden for this visit only
  }
}

/** Hide or show one room ('rooms') or item ('objects'). */
export function toggleHidden(hidden, kind, id) {
  const list = hidden[kind] ?? [];
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return { ...hidden, [kind]: next };
}

/** Only the ids that still exist (a deleted room is not "hidden" any more). */
export function liveHidden(hidden, rooms, objects) {
  const has = (map, id) => (map instanceof Map ? map.has(id) : !!map?.[id]);
  return {
    rooms: hidden.rooms.filter((id) => has(rooms, id)),
    objects: hidden.objects.filter((id) => has(objects, id)),
  };
}

/** "3 hidden" (null when nothing is). */
export function hiddenText(hidden) {
  const n = hidden.rooms.length + hidden.objects.length;
  return n ? `${n} hidden` : null;
}
