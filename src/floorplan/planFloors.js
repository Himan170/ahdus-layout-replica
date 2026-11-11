/**
 * floorplan/planFloors.js (v0.15.5), PURE
 *
 * Floors for Studio's Plan view and the Page Up / Down keys: the floor above / below, the stairs
 * that join two floors (shown on both), and the Plan's settings kept per workplace in this browser
 * (the floor-below outline, the last zoom and place). Never saved in the layout.
 */

import { stairSize, stairOpening } from '../play/building';

const byId = (floors) => [...floors].sort((a, b) => a.id - b.id);

/** The floor `step` places above (+1) or below (−1) `current`, in id order; null when there is none. */
export function adjacentFloor(floors = [], current = 0, step = 1) {
  const sorted = byId(floors);
  const i = sorted.findIndex((f) => f.id === current);
  if (i < 0) return sorted[0]?.id ?? null;
  return sorted[i + step]?.id ?? null;
}

/** The floor right under `id`, or null (the ground floor). */
export const floorBelow = (floors, id) => adjacentFloor(floors, id, -1);

/**
 * The stairs to draw on a floor's plan: its own flights (going up), and the flights of the floor below
 * that arrive here (going down), as outlines. Each: { id, x, z, rotationY, width, length, box, dir, other }.
 * `other` = the floor at the other end.
 */
export function planStairs(objects = [], floors = [], floorId = 0) {
  const below = floorBelow(floors, floorId);
  const above = adjacentFloor(floors, floorId, 1);
  const out = [];
  for (const o of objects) {
    if (o.assetType !== 'STAIRCASE') continue;
    const floor = o.floor ?? 0;
    let dir = null;
    if (floor === floorId && above != null) dir = 'up';
    else if (floor === floorId) dir = 'nowhere';
    else if (below != null && floor === below) dir = 'down';
    if (!dir) continue;
    const { width, length } = stairSize(o);
    out.push({
      id: o.id, objectId: o.id, x: Number(o.x) || 0, z: Number(o.z) || 0, rotationY: Number(o.rotationY) || 0,
      width, length, box: stairOpening(o, { width, length }, 0), dir,
      other: dir === 'up' ? above : dir === 'down' ? below : null,
    });
  }
  return out;
}

// ── Remembered per workplace (this browser only) ─────────────────────────

const KEY = 'ahdus.planView';
const MAX_LAYOUTS = 30;

/** The key of a workplace: company + layout (AHDUS: the site). */
export const planPrefsKey = (companyId, layoutId) => `${companyId ?? 'local'}/${layoutId ?? 'none'}`;

/** The defaults: the floor below shown, the plan fitted. */
export const DEFAULT_PLAN_PREFS = Object.freeze({ below: true, zoom: 1, pan: { x: 0, y: 0 } });

const finite = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Clean what was read back (an old or hand-edited value never breaks the plan). */
export function cleanPlanPrefs(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    below: v.below !== false,
    zoom: Math.min(20, Math.max(0.05, finite(v.zoom, 1))),
    pan: { x: finite(v.pan?.x, 0), y: finite(v.pan?.y, 0) },
  };
}

function readAll(storage) {
  try {
    const all = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

/** The Plan's settings of a workplace (the defaults when none, or storage is blocked). */
export function loadPlanPrefs(key, storage = globalThis.localStorage) {
  const entry = readAll(storage)[key];
  return entry ? cleanPlanPrefs(entry) : { ...DEFAULT_PLAN_PREFS, pan: { x: 0, y: 0 } };
}

/** Keep them (newest first, at most MAX_LAYOUTS workplaces). False when storage is blocked. */
export function savePlanPrefs(key, prefs, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const all = readAll(storage);
    all[key] = { ...cleanPlanPrefs(prefs), at: now };
    const keys = Object.keys(all).sort((a, b) => (all[b].at ?? 0) - (all[a].at ?? 0));
    for (const k of keys.slice(MAX_LAYOUTS)) delete all[k];
    storage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
