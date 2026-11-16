/**
 * catalog/manifest.js: PURE (v0.18.0). The asset manifest: furniture and prefabs described as DATA
 * (catalog/*.json), so a new item needs no code. No Babylon: walkMap, people and the library read it
 * too; utils/manifestMesh.js draws what it describes and utils/assetCatalog.js adds its items to
 * ASSET_TYPES (the 53 hand-built items stay as they are).
 *
 * An item: { id, label, short?, chip, icon?, category?, size: { w, d, h }, solid?, shadow?, place?,
 *   parts?   [{ shape: 'box' | 'cyl', size: [w, h, d] (cyl: [diameter, h]), at: [x, y, z] (y = its
 *            bottom), material: 'wood' | 'fabric' | 'metal' | 'glass' | 'matte' | 'gloss' + ':#hex', pick? }]
 *   builder? a parametric builder by name ('workstation'), with `params` (its defaults)
 *   footprint? [{ x, z, w, d }]  what blocks walking, in metres at its catalogue size (default: the size)
 *   seats?   [{ x, z, yaw }]  where its chair goes (desks)
 *   desk?    { workSide: 1 | -1, typing?: 'screen' }  a desk people sit at; typing: its own screen
 *            and keyboard count as "types at a desk" (people.workClip)
 *   source?  where it comes from (docs/ASSET_LICENSES.md) }
 * A prefab: { id, label, layout: 'single' | 'cluster' | 'row' | 'manager' | 'cabin', seats, desk,
 *   params: { deskWidth, deskDepth, partition, partitionHeight }, room? } (play/prefab.js lays it out).
 * A bad entry is left out with a reason (`problems`), never a crash.
 */

import WORKSTATIONS from './workstations.json';

const ID = /^[A-Z][A-Z0-9_]{1,40}$/;
const SHAPES = new Set(['box', 'cyl']);
const FINISHES = new Set(['wood', 'fabric', 'metal', 'glass', 'matte', 'gloss']);
const BUILDERS = new Set(['workstation']);
export const PREFAB_LAYOUTS = Object.freeze(['single', 'cluster', 'row', 'manager', 'cabin']);
export const PARTITION_KINDS = Object.freeze(['none', 'fabric', 'glass']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const positive = (v) => isNum(v) && v > 0 && v <= 50;
const vec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

/** 'fabric:#4a5568' → { finish: 'fabric', hex: '#4a5568' }, or null. */
export function parseMaterial(text) {
  if (typeof text !== 'string') return null;
  const [finish, hex = finish === 'glass' ? '#a8d4f5' : '#9aa1a8'] = text.split(':');
  if (!FINISHES.has(finish) || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return { finish, hex: hex.toLowerCase() };
}

function checkPart(p, i) {
  if (!p || !SHAPES.has(p.shape)) return `part ${i + 1}: shape must be box or cyl`;
  if (!vec(p.size, p.shape === 'cyl' ? 2 : 3) || !p.size.every((v) => v > 0)) return `part ${i + 1}: bad size`;
  if (!vec(p.at, 3)) return `part ${i + 1}: bad position`;
  if (!parseMaterial(p.material)) return `part ${i + 1}: bad material`;
  return null;
}

/** One item: the catalogue entry it becomes (ASSET_TYPES' shape, plus the manifest's own fields), or a reason. */
export function readItem(raw, known = {}) {
  if (!raw || typeof raw !== 'object') return { problem: 'not an object' };
  const { id } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return { problem: `bad id ${JSON.stringify(id)}` };
  if (Object.hasOwn(known, id)) return { problem: `${id}: already in the catalogue` };
  if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 60) return { problem: `${id}: bad label` };
  const s = raw.size ?? {};
  if (!positive(s.w) || !positive(s.d) || !positive(s.h)) return { problem: `${id}: size needs w, d and h in metres` };
  const hasParts = Array.isArray(raw.parts) && raw.parts.length > 0;
  if (!hasParts && !BUILDERS.has(raw.builder)) return { problem: `${id}: needs parts or a known builder` };
  if (hasParts) {
    for (let i = 0; i < raw.parts.length; i++) {
      const bad = checkPart(raw.parts[i], i);
      if (bad) return { problem: `${id}: ${bad}` };
    }
  }
  const footprint = Array.isArray(raw.footprint)
    ? raw.footprint.filter((f) => f && isNum(f.x) && isNum(f.z) && positive(f.w) && positive(f.d)) : null;
  const seats = Array.isArray(raw.seats) ? raw.seats.filter((p) => p && isNum(p.x) && isNum(p.z)) : [];
  const desk = raw.desk && typeof raw.desk === 'object'
    ? { workSide: raw.desk.workSide === -1 ? -1 : 1, typing: raw.desk.typing === 'screen' ? 'screen' : null } : null;
  return {
    def: {
      label: raw.label.trim(),
      short: typeof raw.short === 'string' ? raw.short.slice(0, 12) : null,
      icon: typeof raw.icon === 'string' ? raw.icon : null,
      category: typeof raw.category === 'string' ? raw.category : 'Furniture',
      chip: typeof raw.chip === 'string' ? raw.chip : 'More',
      defaultWidth: s.w,
      defaultDepth: s.d,
      defaultHeight: s.h,
      solid: raw.solid !== false,
      shadow: raw.shadow !== false,
      place: raw.place === 'table' || raw.place === 'wall' ? raw.place : 'floor',
      parts: hasParts ? raw.parts : null,
      builder: hasParts ? null : raw.builder,
      params: raw.params && typeof raw.params === 'object' ? { ...raw.params } : {},
      footprint: footprint?.length ? footprint : null,
      seats: seats.map((p) => ({ x: p.x, z: p.z, yaw: isNum(p.yaw) ? p.yaw : Math.PI })),
      desk,
      source: typeof raw.source === 'string' ? raw.source : '',
      manifest: true,
    },
  };
}

/** One prefab, or a reason. `types`: every item type there is (a prefab's desk must be one). */
export function readPrefab(raw, types = {}) {
  if (!raw || typeof raw !== 'object') return { problem: 'not an object' };
  const { id } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return { problem: `bad prefab id ${JSON.stringify(id)}` };
  if (!PREFAB_LAYOUTS.includes(raw.layout)) return { problem: `${id}: unknown layout ${raw.layout}` };
  if (!Object.hasOwn(types, raw.desk)) return { problem: `${id}: unknown desk ${raw.desk}` };
  const seats = Math.round(raw.seats ?? 1);
  if (!(seats >= 1 && seats <= 16)) return { problem: `${id}: 1 to 16 seats` };
  if (raw.layout === 'cluster' && seats % 2) return { problem: `${id}: a cluster has an even number of seats` };
  const p = raw.params ?? {};
  const room = raw.room && positive(raw.room.width) && positive(raw.room.depth)
    ? { type: String(raw.room.type ?? 'OFFICE'), name: String(raw.room.name ?? raw.label), width: raw.room.width, depth: raw.room.depth }
    : null;
  if (raw.layout === 'cabin' && !room) return { problem: `${id}: a cabin needs a room` };
  return {
    prefab: {
      id,
      label: String(raw.label ?? id).slice(0, 60),
      layout: raw.layout,
      seats,
      desk: raw.desk,
      params: {
        deskWidth: positive(p.deskWidth) ? p.deskWidth : types[raw.desk].defaultWidth,
        deskDepth: positive(p.deskDepth) ? p.deskDepth : types[raw.desk].defaultDepth,
        partition: PARTITION_KINDS.includes(p.partition) ? p.partition : 'fabric',
        partitionHeight: isNum(p.partitionHeight) ? p.partitionHeight : 0.45,
      },
      room,
    },
  };
}

/**
 * A whole manifest file → { types: { [id]: def }, prefabs: [...], problems: string[] }.
 * @param {object} json
 * @param {Record<string, object>} [known]  the hand-built catalogue (an id there is not taken again)
 */
export function readManifest(json, known = {}) {
  const problems = [];
  const types = {};
  if (!json || json.format !== 'ahdus-catalog' || json.version !== 1) {
    return { types, prefabs: [], problems: ['not an ahdus-catalog version 1 file'] };
  }
  for (const raw of Array.isArray(json.items) ? json.items : []) {
    const { def, problem } = readItem(raw, { ...known, ...types });
    if (problem) problems.push(problem);
    else types[raw.id] = def;
  }
  const prefabs = [];
  const all = { ...known, ...types };
  for (const raw of Array.isArray(json.prefabs) ? json.prefabs : []) {
    const { prefab, problem } = readPrefab(raw, all);
    if (problem) problems.push(problem);
    else if (prefabs.some((p) => p.id === prefab.id)) problems.push(`${prefab.id}: twice`);
    else prefabs.push(prefab);
  }
  return { types, prefabs, problems };
}

/** The app's manifest (every pack; one for now). */
export const MANIFEST = readManifest(WORKSTATIONS);
/** The manifest's item types: id → def (no meshes: assetCatalog adds buildMesh). */
export const MANIFEST_TYPES = MANIFEST.types;
/** The prefabs, in the library's order. */
export const PREFABS = MANIFEST.prefabs;

export function prefabById(id) {
  return PREFABS.find((p) => p.id === id) ?? null;
}

/** Desks of the manifest: type → { width, depth, workSide, typing } (play/people.js). */
/**
 * v0.18.0: an item of a type this version doesn't know (a layout made with a newer Studio): drawn as a
 * plain grey box of a desk's size standing on the floor, and walked round as that size (one warning per type).
 */
export const UNKNOWN_ITEM_SIZE = Object.freeze({ width: 1.4, depth: 0.7, height: 0.75 });

export function manifestDesks(types = MANIFEST_TYPES) {
  const out = {};
  for (const [id, d] of Object.entries(types)) {
    if (d.desk) out[id] = { width: d.defaultWidth, depth: d.defaultDepth, workSide: d.desk.workSide, typing: d.desk.typing, screen: d.params?.screen !== false };
  }
  return out;
}
