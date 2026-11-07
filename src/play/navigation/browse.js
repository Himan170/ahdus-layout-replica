/**
 * play/navigation/browse.js
 *
 * PURE: the Find box's browse menu (v0.14.2, private-docs/EXPERIENCE_PLAN.md 3.3), shown while the
 * box is empty. Built from the search index (places.buildPlaces: the real layout and seats), never
 * a fixed list, so it only offers what this workplace has:
 *   - chips      the facility kinds that exist (Washroom, Meeting room, Reception, Stairs);
 *   - myDesk     the signed-in person's seat, if they have one;
 *   - departments  from rooms' `departmentRef` plus people's departments, with counts
 *                ("2 rooms · Floor 1 · 92 people") and a description when the page gives one
 *                (the `departments` option: [{ name, description }]);
 *   - kinds      places by kind (Offices, Meeting rooms, Washrooms, Reception, Stairs, then any other
 *                room type), each with a count and its places by floor;
 *   - floors     "Ground Floor · 13 rooms" → its rooms.
 * Recent searches (addRecent, recentPlaces): the ids of the places picked, newest first, at most
 * RECENT_MAX; the page keeps them (per browser). Tests: navigation/__tests__/browse.test.js.
 */

import { FACILITIES, ROOM_TYPE_LABEL, words } from './places';

/** How many recent searches are kept. */
export const RECENT_MAX = 5;
/** A department's description is cut to this many characters. */
export const DESCRIPTION_MAX = 280;

/** What a kind of place is called in the menu (several of them). */
export const KIND_LABELS = {
  OFFICE: 'Offices', MEETING: 'Meeting rooms', RESTROOM: 'Washrooms', RECEPTION: 'Reception', STAIRCASE: 'Stairs',
  CORRIDOR: 'Corridors', PRODUCTION: 'Production areas', SERVER_ROOM: 'Server rooms',
};
/** The kinds people look for most come first; the rest by name. */
const KIND_ORDER = ['OFFICE', 'MEETING', 'RESTROOM', 'RECEPTION', 'STAIRCASE'];
/** A facility (places.FACILITIES) → the kind its places are listed under. */
export const FACILITY_KIND = { RESTROOM: 'RESTROOM', MEETING: 'MEETING', RECEPTION: 'RECEPTION', STAIRS: 'STAIRCASE' };

const key = (name) => words(name).join(' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** "LAB_SPACE" → "Lab space" (a room type with no label of its own). */
function typeLabel(type) {
  if (KIND_LABELS[type]) return KIND_LABELS[type];
  if (ROOM_TYPE_LABEL[type]) return ROOM_TYPE_LABEL[type];
  const text = String(type ?? 'Other').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Other';
}

/** The kind a place is listed under (a room's type; an item facility's kind), or null (people, departments). */
export function kindOf(p) {
  if (p.id?.startsWith('room:')) return p.roomType || (p.facility ? FACILITY_KIND[p.facility] : null) || 'ROOM';
  if (p.id?.startsWith('item:') && p.facility) return FACILITY_KIND[p.facility] ?? null;
  return null;
}

/** Places of several floors → [{ floor, floorName, places }], lowest floor first, by name within one. */
function byFloor(places, floorOrder) {
  const groups = new Map();
  for (const p of places) {
    if (!groups.has(p.floor)) groups.set(p.floor, { floor: p.floor, floorName: p.floorName, places: [] });
    groups.get(p.floor).places.push(p);
  }
  const rank = (f) => { const i = floorOrder.indexOf(f); return i < 0 ? Infinity : i; };
  return [...groups.values()]
    .sort((a, b) => rank(a.floor) - rank(b.floor) || a.floor - b.floor)
    .map((g) => ({ ...g, places: g.places.sort(byName) }));
}

/** The floor names of some places, lowest first: "Ground Floor, Floor 1". */
function floorNames(places, floorOrder) {
  return byFloor(places, floorOrder).map((g) => g.floorName).join(', ');
}

/**
 * The browse menu.
 * @param {{ places: object[], byId: Map<string, object>, floors?: { id: number, name: string }[] }} index  buildPlaces
 * @param {{ departments?: { name: string, description?: string }[], me?: string | number | null }} [options]
 *   departments: descriptions by department name (the page's option; names that don't exist here are left out);
 *   me: the signed-in person's personId ("My desk")
 */
export function browsePlaces(index, { departments = [], me = null } = {}) {
  const places = index.places ?? [];
  const floorOrder = (index.floors ?? []).map((f) => f.id);

  // ── Chips: the facility kinds that exist ──
  const chips = Object.entries(FACILITIES)
    .map(([facility, f]) => ({ facility, label: f.label, nearest: f.nearest, kind: FACILITY_KIND[facility],
      places: places.filter((p) => p.facility === facility && p.kind === 'facility') }))
    .filter((c) => c.places.length)
    .map(({ places: its, ...c }) => ({ ...c, count: its.length, only: its.length === 1 ? its[0] : null }));

  // ── My desk ──
  const myDesk = me != null && me !== '' ? (index.byId?.get(`person:${me}`) ?? null) : null;

  // ── Departments: rooms' departmentRef + people's departments ──
  const descriptions = new Map();
  for (const d of Array.isArray(departments) ? departments : []) {
    if (!d || typeof d.name !== 'string' || typeof d.description !== 'string') continue;
    const text = d.description.trim().replace(/\s+/g, ' ');
    if (text && key(d.name)) descriptions.set(key(d.name), text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : text);
  }
  const depts = new Map();
  const dept = (name) => {
    const k = key(name);
    if (!k) return null;
    if (!depts.has(k)) depts.set(k, { key: k, name: name.trim(), rooms: [], people: [] });
    return depts.get(k);
  };
  for (const p of places) {
    if (p.id.startsWith('room:') && p.department) dept(p.department)?.rooms.push(p);
  }
  for (const p of places) {
    if (p.kind === 'person' && p.department) dept(p.department)?.people.push(p);
  }
  const departmentList = [...depts.values()].map((d) => {
    const rooms = d.rooms.sort((a, b) => floorOrder.indexOf(a.floor) - floorOrder.indexOf(b.floor) || byName(a, b));
    const people = d.people.sort(byName);
    const floors = floorNames(rooms.length ? rooms : people, floorOrder);
    // what a pick of the whole department shows: its department place (several rooms), else its one room
    const place = index.byId?.get(`department:${rooms[0]?.department ?? d.name}`) ?? (rooms.length === 1 ? rooms[0] : null);
    return {
      key: d.key, id: `department:${d.key}`, name: d.name,
      description: descriptions.get(d.key) ?? null,
      detail: [rooms.length ? plural(rooms.length, 'room') : '', floors, people.length ? plural(people.length, 'person', 'people') : '']
        .filter(Boolean).join(' · '),
      rooms, people, place,
    };
  }).sort(byName);

  // ── Kinds of place ──
  const kinds = new Map();
  for (const p of places) {
    const k = kindOf(p);
    if (!k) continue;
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k).push(p);
  }
  const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  const kindList = [...kinds.entries()]
    .map(([k, its]) => ({
      key: k, id: `kind:${k}`, name: typeLabel(k), count: its.length,
      detail: floorNames(its, floorOrder), floors: byFloor(its, floorOrder),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || byName(a, b));

  // ── By floor: its rooms ──
  const rooms = places.filter((p) => p.id.startsWith('room:'));
  const floorList = (index.floors?.length ? index.floors : [...new Set(rooms.map((p) => p.floor))].map((id) => ({ id, name: `Floor ${id}` })))
    .map((f) => {
      const its = rooms.filter((p) => p.floor === f.id).sort(byName);
      return { floor: f.id, id: `floor:${f.id}`, name: f.name, count: its.length, detail: plural(its.length, 'room'), places: its };
    })
    .filter((f) => f.count > 0);

  return { chips, myDesk, departments: departmentList, kinds: kindList, floors: floorList };
}

/** The recent searches with this place id picked: newest first, no repeats, at most `max`. */
export function addRecent(ids, id, max = RECENT_MAX) {
  if (typeof id !== 'string' || !id) return Array.isArray(ids) ? ids.slice(0, max) : [];
  return [id, ...(Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x !== id)].slice(0, max);
}

/** The recent searches' places that still exist here (a layout or the people changed: the others are left out). */
export function recentPlaces(index, ids, max = RECENT_MAX) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const p = typeof id === 'string' ? index.byId?.get(id) : null;
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
