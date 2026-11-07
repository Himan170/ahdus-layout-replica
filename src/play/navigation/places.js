/**
 * play/navigation/places.js
 *
 * PURE: everything you can search for in a layout (v0.13.3,
 * private-docs/NAVIGATION_PLAN.md 4.4), and the search itself. No Babylon.
 *
 * buildPlaces(layout, people) makes one index:
 *   - person      every person given to setPeople whose desk is in the layout:
 *                 their name and department ONLY (nothing else is copied, so an
 *                 email or anything else in the list can never show or match);
 *   - room        every room (its name, else its type), except the facilities;
 *   - department  `room.departmentRef` shared by several rooms (or by one room
 *                 with another name): all its rooms;
 *   - facility    rooms of type RESTROOM (washroom, restroom, toilet, WC…),
 *                 MEETING, RECEPTION, STAIRCASE, and the items RECEPTION_DESK
 *                 and STAIRCASE when no room of that kind holds them.
 * searchPlaces(index, query, { from }) matches every word of the query against
 * the start of the words of a place (name first, then department, room, type
 * and facility words) and groups the results: People / Rooms / Facilities,
 * the best first. A query naming a facility ("washroom") lists them all,
 * nearest first; while walking (`from` has x, z) a "Nearest washroom" entry
 * comes first, whose goals go to findNearestRoute (route.js).
 *
 * Each place has `goals`: where a walk to it ends ({ x, z, floor }): just
 * inside each door of a room, behind a person's chair (their aisle side; at a
 * reception desk: in front of its counter, people.visitorSpot), in
 * front of a staircase's bottom step. Tests: navigation/__tests__/places.test.js.
 */

import { floorAbove, stairDimsFor } from '../building';
import { roomOpenings, wallThicknessOf } from '../geometry';
import { deskSeats, seatPose, isDesk, visitorSpot } from '../people';
import { stairBottom } from './route';

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (r) => r.floor ?? r.floorId ?? 0;

/** The facilities: what a room type or an item is called, and the words that find it. */
export const FACILITIES = {
  RESTROOM: {
    label: 'Washroom', nearest: 'Nearest washroom',
    words: ['washroom', 'washrooms', 'restroom', 'restrooms', 'toilet', 'toilets', 'wc', 'bathroom', 'bathrooms', 'lavatory', 'loo'],
  },
  MEETING: {
    label: 'Meeting room', nearest: 'Nearest meeting room',
    words: ['meeting', 'meetings', 'conference', 'boardroom'],
  },
  RECEPTION: {
    label: 'Reception', nearest: 'Nearest reception',
    words: ['reception', 'receptionist', 'lobby'],
  },
  STAIRS: {
    label: 'Stairs', nearest: 'Nearest stairs',
    words: ['stairs', 'stair', 'staircase', 'stairway', 'steps'],
  },
};

/** Room type → facility. */
const ROOM_FACILITY = { RESTROOM: 'RESTROOM', MEETING: 'MEETING', RECEPTION: 'RECEPTION', STAIRCASE: 'STAIRS' };
/** Item type → facility. */
const ITEM_FACILITY = { RECEPTION_DESK: 'RECEPTION', STAIRCASE: 'STAIRS' };
const ITEM_LABEL = { RECEPTION_DESK: 'Reception desk', STAIRCASE: 'Staircase' };

/** What a room type is called (as Studio's ROOM_TYPES labels). */
export const ROOM_TYPE_LABEL = {
  OFFICE: 'Office', MEETING: 'Meeting Room', RECEPTION: 'Reception', CORRIDOR: 'Corridor',
  PRODUCTION: 'Production Area', STAIRCASE: 'Staircase', SERVER_ROOM: 'Server Room', RESTROOM: 'Restroom',
};

export const GROUPS = ['people', 'rooms', 'facilities'];
export const GROUP_TITLES = { people: 'People', rooms: 'Rooms', facilities: 'Facilities' };
/** At most this many results per group (searchPlaces' `limit`). */
export const GROUP_LIMIT = 6;
/** A walk to a room ends this far inside its door (m, from the wall's inside face). */
export const INSIDE_DOOR = 0.6;
/** …to a person this far behind their chair (m): the aisle, facing them. */
export const BEHIND_SEAT = 0.7;

/** Lower case, no accents, words of letters and digits: "Data & AI" → ['data', 'ai']. */
export function words(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const OUTWARD = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/** Just inside each door of a room (world x, z); the room's middle if it has none. */
export function roomDoorSpots(room) {
  const T = wallThicknessOf(room);
  const spots = [];
  for (const door of roomOpenings(room)) {
    if (door.kind !== 'door') continue;
    const n = OUTWARD[door.wall];
    if (!n) continue;
    const alongX = door.wall === 'north' || door.wall === 'south';
    const centre = alongX
      ? { x: room.x + door.offset, z: room.z + n.z * room.depth / 2 }
      : { x: room.x + n.x * room.width / 2, z: room.z + door.offset };
    const d = T / 2 + INSIDE_DOOR;
    spots.push({ x: centre.x - n.x * d, z: centre.z - n.z * d });
  }
  return spots.length ? spots : [{ x: room.x, z: room.z }];
}

/** The innermost room of a floor holding a point (null: none). */
function roomAround(rooms, floor, x, z) {
  let best = null;
  for (const r of rooms) {
    if (floorOf(r) !== floor) continue;
    if (Math.abs(x - r.x) > r.width / 2 || Math.abs(z - r.z) > r.depth / 2) continue;
    if (!best || r.width * r.depth < best.width * best.depth) best = r;
  }
  return best;
}

const roomName = (r) => (r ? (r.name?.trim() || ROOM_TYPE_LABEL[r.type] || 'Room') : '');
const joinDetail = (...parts) => parts.filter(Boolean).join(' · ');

/**
 * One index of everything that can be searched.
 * @param {{ rooms, objects, floors }} layout  store shape (v1 names)
 * @param {{ personId, deskId, name?, department? }[]} [people]  setPeople's list
 * @returns {{ places: Place[], byId: Map<string, Place> }}
 */
export function buildPlaces(layout, people = []) {
  const floors = layout.floors ?? {};
  const rooms = list(layout.rooms);
  const objects = list(layout.objects);
  const objectsById = new Map(objects.map((o) => [o.id, o]));
  const floorName = (f) => floors[f]?.name || `Floor ${f}`;
  const places = [];

  /** A place: `words` [name words, other words] are what the search matches. */
  const add = (p, nameText, otherText = []) => {
    const name = words(nameText);
    const other = otherText.flatMap(words).filter((w) => !name.includes(w));
    places.push({ ...p, floorName: floorName(p.floor), words: { name, other }, nameKey: words(nameText).join(' ') });
  };

  const roomOf = (o) => (o.roomId && rooms.find((r) => r.id === o.roomId && floorOf(r) === floorOf(o)))
    || roomAround(rooms, floorOf(o), o.x ?? 0, o.z ?? 0);

  // Rooms and room facilities
  for (const room of rooms) {
    const floor = floorOf(room);
    const name = roomName(room);
    const typeLabel = ROOM_TYPE_LABEL[room.type] ?? '';
    const facility = ROOM_FACILITY[room.type] ?? null;
    const dept = room.departmentRef?.trim() || '';
    const goals = roomDoorSpots(room).map((s) => ({ ...s, floor }));
    add({
      id: `room:${room.id}`, kind: facility ? 'facility' : 'room', group: facility ? 'facilities' : 'rooms',
      name, detail: joinDetail(facility ? FACILITIES[facility].label : typeLabel, dept !== name ? dept : '', floorName(floor)),
      floor, roomId: room.id, roomName: name, department: dept || null, facility,
      entityId: room.id, highlight: [room.id], x: room.x, z: room.z, goals,
    }, name, [typeLabel, dept, ...(facility ? FACILITIES[facility].words : [])]);
  }

  // Departments: their rooms
  const byDept = new Map();
  for (const room of rooms) {
    const dept = room.departmentRef?.trim();
    if (!dept) continue;
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(room);
  }
  for (const [dept, its] of byDept) {
    if (its.length === 1 && words(roomName(its[0])).join(' ') === words(dept).join(' ')) continue; // the room is enough
    const sorted = [...its].sort((a, b) => floorOf(a) - floorOf(b));
    const first = sorted[0];
    const floorsOf = [...new Set(sorted.map(floorOf))];
    add({
      id: `department:${dept}`, kind: 'department', group: 'rooms', name: dept,
      detail: joinDetail('Department', its.length === 1 ? roomName(first) : `${its.length} rooms`, floorsOf.map(floorName).join(', ')),
      floor: floorOf(first), roomId: first.id, roomName: roomName(first), department: dept, facility: null,
      entityId: first.id, highlight: sorted.map((r) => r.id), x: first.x, z: first.z,
      goals: sorted.flatMap((r) => roomDoorSpots(r).map((s) => ({ ...s, floor: floorOf(r) }))),
    }, dept, ['department', ...its.map(roomName)]);
  }

  // Item facilities (a reception desk, a staircase) not in a room of their kind
  for (const o of objects) {
    const facility = ITEM_FACILITY[o.assetType];
    if (!facility) continue;
    const floor = floorOf(o);
    const room = roomOf(o);
    if (room && ROOM_FACILITY[room.type] === facility) continue;
    const name = o.label?.trim() || ITEM_LABEL[o.assetType];
    let goal = { x: o.x, z: o.z };
    let detail = joinDetail(FACILITIES[facility].label, floorName(floor), room ? roomName(room) : '');
    if (o.assetType === 'STAIRCASE') {
      goal = stairBottom(o, stairDimsFor(floors, o));
      const above = floorAbove(floors, floor);
      detail = joinDetail('Stairs', above ? `${floorName(floor)} to ${floorName(above.id)}` : floorName(floor));
    } else if (isDesk(o.assetType)) {
      const pose = seatPose(o.id, objects, floors);
      goal = visitorSpot(o) ?? (pose ? behind(pose) : goal);
    }
    add({
      id: `item:${o.id}`, kind: 'facility', group: 'facilities', name, detail,
      floor, roomId: room?.id ?? null, roomName: roomName(room), department: null, facility,
      entityId: o.id, highlight: [o.id], x: o.x, z: o.z, goals: [{ ...goal, floor }],
    }, name, [ITEM_LABEL[o.assetType], ...FACILITIES[facility].words]);
  }

  // People at their desks: name and department only
  const seats = people?.length ? deskSeats(objects) : null;
  for (const p of list(people)) {
    if (!p || p.personId == null || p.deskId == null) continue;
    const desk = objectsById.get(String(p.deskId));
    if (!desk) continue; // their desk is not in this layout
    const floor = floorOf(desk);
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Someone';
    const dept = typeof p.department === 'string' ? p.department.trim() : '';
    const room = roomOf(desk);
    const pose = seatPose(desk.id, objects, floors, seats);
    const at = pose ?? { x: desk.x, z: desk.z };
    add({
      id: `person:${p.personId}`, kind: 'person', group: 'people', name,
      detail: joinDetail(dept, [floorName(floor), roomName(room)].filter(Boolean).join(', ')),
      floor, roomId: room?.id ?? null, roomName: roomName(room), department: dept || null, facility: null,
      personId: String(p.personId), deskId: desk.id,
      entityId: desk.id, highlight: [desk.id, ...(pose?.chairId ? [pose.chairId] : [])],
      x: at.x, z: at.z, goals: [{ ...(visitorSpot(desk) ?? (pose ? behind(pose) : { x: desk.x, z: desk.z })), floor }],
    }, name, [dept]);
  }

  return { places, byId: new Map(places.map((p) => [p.id, p])) };
}

/** BEHIND_SEAT behind a seated (or standing) person: facing them from the aisle. */
function behind(pose) {
  return { x: pose.x - Math.sin(pose.yaw) * BEHIND_SEAT, z: pose.z - Math.cos(pose.yaw) * BEHIND_SEAT };
}

/**
 * How well one query word matches a place (lower is better), or null.
 * 0: a name word, exactly · 1: the start of a name word · 2: another word,
 * exactly · 3: the start of another word · 4: inside a name word (3+ letters).
 */
function wordScore(q, { name, other }) {
  let best = null;
  const take = (s) => { if (best === null || s < best) best = s; };
  for (const w of name) {
    if (w === q) return 0;
    if (w.startsWith(q)) take(1);
    else if (q.length >= 3 && w.includes(q)) take(4);
  }
  for (const w of other) {
    if (w === q) take(2);
    else if (w.startsWith(q)) take(3);
  }
  return best;
}

/** The facilities a query names ("wash" → RESTROOM): every query word must be one of their words' starts. */
export function facilitiesNamed(query) {
  const qs = words(query);
  if (!qs.length) return [];
  return Object.entries(FACILITIES)
    .filter(([, f]) => qs.every((q) => q.length >= 2 && f.words.some((w) => w.startsWith(q))))
    .map(([key]) => key);
}

/**
 * Search the index.
 * @param {{ places: any[] }} index  buildPlaces (its Place records)
 * @param {string} query
 * @param {{ from?: { x?: number, z?: number, floor?: number } | null, limit?: number }} [options]
 *   from: where you are (walking: x, z and floor; from above: the floor shown), for "nearest first";
 *   limit: results per group (GROUP_LIMIT)
 * @returns {{ query: string, groups: { people: Result[], rooms: Result[], facilities: Result[] },
 *   more: { people: number, rooms: number, facilities: number }, total: number, order: string[] }}
 *   a Result is a Place (or a "nearest" entry: kind 'nearest', facility, goals of all of them);
 *   order: the groups in the order to show them (groupOrder)
 */
export function searchPlaces(index, query, options = {}) {
  const { from = null, limit = GROUP_LIMIT } = options;
  const qs = words(query);
  const groups = { people: [], rooms: [], facilities: [] };
  const more = { people: 0, rooms: 0, facilities: 0 };
  if (!qs.length) return { query: String(query ?? ''), groups, more, total: 0, order: [...GROUPS] };
  const whole = qs.join(' ');
  const named = new Set(facilitiesNamed(query));

  const found = [];
  for (const p of index.places) {
    let score = 0;
    if (p.facility && named.has(p.facility)) {
      score = 2.5; // "washroom": every washroom, nearest first
    } else {
      for (const q of qs) {
        const s = wordScore(q, p.words);
        if (s === null) { score = null; break; }
        score += s;
      }
      if (score === null) continue;
      if (p.nameKey === whole) score -= 2; // the whole name
      else if (p.nameKey.startsWith(whole)) score -= 1;
    }
    found.push({ p, score, away: distanceFrom(p, from) });
  }
  found.sort((a, b) => a.score - b.score || a.away - b.away || a.p.name.localeCompare(b.p.name));

  const best = { people: Infinity, rooms: Infinity, facilities: Infinity };
  for (const { p, score } of found) {
    if (score < best[p.group]) best[p.group] = score;
    const g = groups[p.group];
    if (g.length < limit) g.push(p);
    else more[p.group] += 1;
  }

  // Walking: "Nearest washroom" first (findNearestRoute decides which, from where you stand)
  if (from && Number.isFinite(from.x) && Number.isFinite(from.z)) {
    const nearest = [];
    for (const key of named) {
      const all = index.places.filter((p) => p.facility === key);
      if (all.length < 1) continue;
      nearest.push({
        id: `nearest:${key}`, kind: 'nearest', group: 'facilities', name: FACILITIES[key].nearest,
        detail: 'From where you stand', facility: key, floor: from.floor ?? 0, floorName: '',
        roomId: null, roomName: '', department: null, entityId: null, highlight: [],
        places: all.map((p) => p.id), goals: all.flatMap((p) => p.goals.map((g) => ({ ...g, placeId: p.id }))),
      });
    }
    groups.facilities.unshift(...nearest);
  }

  const total = GROUPS.reduce((n, g) => n + groups[g].length + more[g], 0);
  return { query: String(query ?? ''), groups, more, total, order: groupOrder(best) };
}

/**
 * The groups in the order shown: People, Rooms, Facilities; Rooms first when
 * a room or department matches better than any person ("Engineering",
 * "Sales": the department, then its people). A tie keeps People first: a
 * person whose name matches as well as a room's ("Sal") stays on top.
 */
export function groupOrder(best) {
  return best.rooms < best.people ? ['rooms', 'people', 'facilities'] : [...GROUPS];
}

/** For sorting: other floors far away, then the straight line (0 when `from` has no point). */
function distanceFrom(p, from) {
  if (!from) return 0;
  const floors = from.floor === undefined ? 0 : Math.abs((p.floor ?? 0) - from.floor) * 1000;
  const line = Number.isFinite(from.x) && Number.isFinite(from.z) ? Math.hypot(p.x - from.x, p.z - from.z) : 0;
  return floors + line;
}

/** A search result as the API gives it (no index internals): the same fields for every kind. */
export function publicPlace(p) {
  return {
    id: p.id, kind: p.kind, group: p.group, name: p.name, detail: p.detail,
    floorId: p.floor, floorName: p.floorName, roomId: p.roomId, roomName: p.roomName,
    department: p.department ?? null, facility: p.facility ?? null,
    ...(p.personId ? { personId: p.personId, deskId: p.deskId } : {}),
    entityId: p.entityId, ...(p.kind === 'nearest' ? { places: [...p.places] } : {}),
  };
}

/** Every result of a search, in the order shown (result.order: People, Rooms, Facilities, or Rooms first). */
export function flatResults(result) {
  return (result.order ?? GROUPS).flatMap((g) => result.groups[g]);
}

/**
 * @typedef {object} Place
 * @property {string} id  'person:<personId>' | 'room:<roomId>' | 'department:<name>' | 'item:<objectId>'
 * @property {'person' | 'room' | 'department' | 'facility'} kind
 * @property {'people' | 'rooms' | 'facilities'} group
 * @property {string} name
 * @property {string} detail  e.g. "Engineering · Floor 1, Engineering 2"
 * @property {number} floor
 * @property {string} floorName
 * @property {string | null} roomId
 * @property {string} roomName
 * @property {string | null} department
 * @property {string | null} facility  a FACILITIES key
 * @property {string} [personId]
 * @property {string} [deskId]
 * @property {string} entityId  the room or item to fly to (LayoutEngine.focusOn)
 * @property {string[]} highlight  the rooms / items to outline
 * @property {number} x
 * @property {number} z
 * @property {{ x: number, z: number, floor: number }[]} goals  where a walk to it ends
 */
