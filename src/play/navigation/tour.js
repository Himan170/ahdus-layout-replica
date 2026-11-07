/**
 * play/navigation/tour.js
 *
 * PURE: the company tour's plan (v0.14.3, private-docs/EXPERIENCE_PLAN.md 3.5, decisions in its
 * section 6). Made from the layout and the seats, with nothing to author. No Babylon, no UI
 * (TourSystem and its panel are v0.14.4).
 *
 * planTour(layout, people, departments, options) → the stops in order:
 *   1. the main entrance (where a walk starts: entranceSpawn), then the reception;
 *   2. each department once (`room.departmentRef`, its rooms on one floor grouped; a department on
 *      several floors stops where most of its rooms are), floor by floor: the ground floor first,
 *      then up by the stairs;
 *   3. one washroom and one meeting room per floor, not all of them: the one that adds the least
 *      walking to that floor's tour;
 *   4. within a floor the shortest walking order: nearest neighbour, then 2-opt, over walking
 *      distances on the walk map (one Dijkstra field per stop answers every distance from it, on a
 *      copy of the walk map with 0.3 m cells: ~9 times fewer cells, so Meridian plans in ~150 ms);
 *      a floor's tour ends at the stairs up when there is a floor to visit above. Then each leg is a
 *      findRoute between two stops (the exact route the walker takes, stairs included);
 *   5. back to reception at the end (`backToReception`, default true).
 * Each stop: id, kind, name, floor, its rooms, the spot to stand on and the way to face, a short
 * text (name, type, floor, the department's description when the page gave one, "N people work
 * here", up to 3 names from the seats: name and department only, never anything else) and the
 * `leg` that leads to it: the route (as findRoute's legs), its length and time, text directions
 * ("Through Lobby & Reception, turn right along the corridor, …") and the passing mentions.
 * Passing mentions: a room whose door the route passes within MENTION_DISTANCE (4 m), in sight,
 * gets "On your left: Restrooms" at that point of the route, once in the whole tour, so the tour
 * covers every room without stopping at each.
 * Rooms that can't be walked to are left out and listed in `skipped` with the reason (findRoute's
 * answer: "it has no door", …). Every leg is a route over the walk map: never through a wall.
 * Tests: navigation/__tests__/tour.test.js (Meridian, the viewer's sample, random layouts, speed).
 */

import { floorsInOrder, roomRect, rectContains } from '../building';
import { roomOpenings, wallThicknessOf } from '../geometry';
import { visitorSpot } from '../people';
import { createWalkMapCache, groundFloorId, FREE } from './walkMap';
import { entranceSpawn, nearestFree, facingYaw } from './entrance';
import {
  pathLength, floorLinks, findRoute, cellsClear, areaOf, WALK_SPEED, SNAP_DISTANCE,
} from './route';
import { buildPlaces, roomDoorSpots, words, ROOM_TYPE_LABEL, FACILITIES } from './places';

/** A pause at each stop (s): the estimated time. */
export const STOP_PAUSE = 20;
/** A room whose door the route passes this close (m), in sight, gets a passing mention. */
export const MENTION_DISTANCE = 4;
/** At most this many names on a stop. */
export const NAMES_MAX = 3;
/** One of each per floor. */
export const TOUR_FACILITIES = ['RESTROOM', 'MEETING'];
/** A department's description is cut to this many characters. */
export const DESCRIPTION_MAX = 280;
/** Directions: a change of heading bigger than this is a turn (radians, 50°). */
const TURN = (50 * Math.PI) / 180;
/** …and a door within this angle of the way you walk is "ahead". */
const AHEAD = (25 * Math.PI) / 180;
/** The ordering's grid: this many walk map cells a side (0.1 m → 0.3 m). */
export const COARSE = 3;
/** Route samples for directions and mentions (m). */
const SAMPLE_STEP = 0.25;
/** A room crossed for less than this (m) is a doorway, not a room you walk through. */
const MIN_RUN = 1;
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (r) => r.floor ?? r.floorId ?? 0;
const OUTWARD = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const keyOf = (name) => words(name).join(' ');
const roomName = (r) => r?.name?.trim() || ROOM_TYPE_LABEL[r?.type] || 'Room';
/** A room's name in a sentence: its own name, else "the office". */
const roomPhrase = (r) => (r?.name?.trim() ? r.name.trim() : `the ${(ROOM_TYPE_LABEL[r?.type] ?? 'room').toLowerCase()}`);
const isCorridor = (r) => r?.type === 'CORRIDOR' || /\b(corridor|hallway|hall)\b/i.test(r?.name ?? '');
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sayList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * The tour's plan.
 * @param {{ rooms, objects, floors }} layout  store shape (v1 field names)
 * @param {{ personId, deskId, name?, department? }[]} [people]  the seats (setPeople's list)
 * @param {{ name: string, description?: string }[]} [departments]  the page's descriptions
 * @param {{ catalog?: object, maps?: { get(layout, floorId) }, speed?: number, pause?: number,
 *   backToReception?: boolean }} [options]
 * @returns {TourPlan}
 */
export function planTour(layout, people = [], departments = [], options = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { speed = WALK_SPEED, pause = STOP_PAUSE, backToReception = true } = options;
  const floors = layout.floors ?? {};
  const rooms = list(layout.rooms);
  const objects = list(layout.objects);
  const maps = options.maps ?? createWalkMapCache({ catalog: options.catalog });
  const order = floorsInOrder(floors).map((f) => f.id);
  if (!order.length) order.push(0);
  const ground = order.includes(groundFloorId(floors)) ? groundFloorId(floors) : order[0];
  const floorName = (f) => floors[f]?.name || (f === ground ? 'Ground Floor' : `Floor ${f}`);
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const mapOf = (f) => maps.get(layout, f);

  // who sits in which room (name and department only)
  const index = buildPlaces(layout, people);
  const seated = new Map();
  for (const p of index.places) {
    if (p.kind !== 'person' || !p.roomId) continue;
    if (!seated.has(p.roomId)) seated.set(p.roomId, []);
    seated.get(p.roomId).push({ name: p.name, department: p.department ?? null });
  }
  const descriptions = new Map();
  for (const d of list(departments)) {
    if (!d || typeof d.name !== 'string' || !d.name.trim()) continue;
    const text = typeof d.description === 'string' ? d.description.trim().slice(0, DESCRIPTION_MAX) : '';
    if (text) descriptions.set(keyOf(d.name), text);
  }

  const spawn = entranceSpawn(layout, { maps, catalog: options.catalog });
  const links = floorLinks(layout, { maps });
  const skipped = [];
  const skip = (room, kind, answer) => {
    if (skipped.some((s) => s.roomId === room.id)) return;
    skipped.push({
      roomId: room.id, name: roomName(room), floor: floorOf(room), floorName: floorName(floorOf(room)), kind,
      problem: answer?.problem ?? 'NO_ROUTE', message: answer?.message ?? `No walking route to ${roomName(room)}`,
    });
  };
  /** Why a room can't be walked to from the entrance (findRoute knows at once, without searching). */
  const whyNot = (room) => {
    const spot = roomDoorSpots(room)[0];
    const r = findRoute(layout, spawn, { ...spot, floor: floorOf(room) }, { maps, name: roomName(room) });
    return r.problem ? r : { problem: 'OTHER_STAIRS', message: `Not on the tour: ${roomName(room)} is only reached by other stairs` };
  };

  // ── the reception ──
  const groundRooms = rooms.filter((r) => floorOf(r) === ground);
  const receptionRoom = (spawn.door?.room?.type === 'RECEPTION' ? spawn.door.room : null)
    ?? groundRooms.find((r) => r.type === 'RECEPTION') ?? null;
  const receptionDesk = objects.find((o) => o.assetType === 'RECEPTION_DESK' && floorOf(o) === ground
    && (!receptionRoom || o.roomId === receptionRoom.id || rectContains(roomRect(receptionRoom), o.x, o.z))) ?? null;

  // ── departments: their rooms, the floor where most of them are ──
  const byDept = new Map();
  for (const room of rooms) {
    const name = room.departmentRef?.trim();
    if (!name || room === receptionRoom) continue;
    const key = keyOf(name);
    if (!key) continue;
    if (!byDept.has(key)) byDept.set(key, { key, name, rooms: [] });
    byDept.get(key).rooms.push(room);
  }
  const deptFloor = (d) => {
    const count = new Map();
    for (const r of d.rooms) count.set(floorOf(r), (count.get(floorOf(r)) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0][0];
  };
  const peopleIn = (r) => seated.get(r.id)?.length ?? 0;
  const area = (r) => r.width * r.depth;

  // ── each floor: its stops in walking order ──
  const stops = [];
  const make = (stop) => { stops.push(stop); return stop; };
  const entrance = make({
    id: 'entrance', kind: 'entrance', facility: null, name: 'Main entrance', floor: ground, floorName: floorName(ground),
    roomId: null, rooms: [], department: null, description: null,
    spot: { x: spawn.x, z: spawn.z, floor: ground }, yaw: spawn.yaw, look: spawn.door ? { x: spawn.door.x, z: spawn.door.z } : null,
    people: 0, names: [], lines: [], text: '', leg: null,
  });

  let reception = null;
  let arrival = { x: spawn.x, z: spawn.z, floor: ground };
  let lastFloorStop = entrance;
  const visitedFloors = [];
  const stopRooms = new Set();

  /** Something to see on a floor: a department's room or a facility. */
  const worthSeeing = (f) => rooms.some((r) => floorOf(r) === f && (r.departmentRef?.trim() || TOUR_FACILITIES.includes(r.type)));
  /** The floors from `fi` up can't be walked to on the tour: their rooms are skipped, with the reason. */
  const unreachableFrom = (fi) => {
    for (const f of order.slice(fi)) for (const r of rooms) if (floorOf(r) === f) skip(r, 'room', whyNot(r));
  };

  for (let fi = 0; fi < order.length; fi++) {
    const floor = order[fi];
    const map = mapOf(floor);
    const floorRooms = rooms.filter((r) => floorOf(r) === floor);
    // where the tour arrives on this floor: everything is measured from there
    // the walkable area where the tour arrives: everything else on this floor can't be walked to from here
    const startArea = areaOf(map, arrival.x, arrival.z);
    if (startArea < 0) { // nowhere to stand where it arrives
      unreachableFrom(fi);
      break;
    }
    const reached = (p) => areaOf(map, p.x, p.z) === startArea;
    const coarse = coarseOf(map);
    const startField = coarseField(coarse, arrival);
    /** A spot on this floor the body fits on and the tour can reach (null: none within 1.5 m). */
    const place = (p) => {
      if (map.isClear(p.x, p.z) && reached(p)) return { x: p.x, z: p.z, floor };
      const s = nearestFree(map, p.x, p.z, { maxDistance: SNAP_DISTANCE, accept: (x, z) => reached({ x, z }) });
      return s && { x: s.x, z: s.z, floor };
    };
    /** The nearest reachable spot just inside one of a room's doors (null: none). */
    const roomSpot = (room) => {
      let best = null;
      for (const s of roomDoorSpots(room)) {
        const p = place(s);
        if (p && (!best || coarseCost(startField, p) < coarseCost(startField, best))) best = p;
      }
      return best;
    };
    for (const r of floorRooms) if (!roomSpot(r)) skip(r, 'room', whyNot(r));

    const here = []; // this floor's stops, before ordering
    if (floor === ground && (receptionRoom || receptionDesk)) {
      const deskSpot = receptionDesk && visitorSpot(receptionDesk);
      const spot = (deskSpot && place(deskSpot)) || (receptionRoom && roomSpot(receptionRoom));
      if (spot) {
        const look = receptionDesk ? { x: receptionDesk.x, z: receptionDesk.z } : { x: receptionRoom.x, z: receptionRoom.z };
        reception = {
          id: 'reception', kind: 'reception', facility: null, name: receptionRoom ? roomName(receptionRoom) : 'Reception',
          floor, floorName: floorName(floor), roomId: receptionRoom?.id ?? null,
          rooms: receptionRoom ? [{ id: receptionRoom.id, name: roomName(receptionRoom) }] : [],
          department: null, description: textOf(receptionRoom?.description), spot, yaw: facingYaw(spot, look), look,
          people: 0, names: [], lines: [], text: '', leg: null,
        };
        if (receptionRoom) stopRooms.add(receptionRoom.id);
      }
    }
    for (const d of byDept.values()) {
      if (deptFloor(d) !== floor) continue;
      const its = d.rooms.filter((r) => floorOf(r) === floor);
      const ranked = [...its].sort((a, b) => peopleIn(b) - peopleIn(a) || area(b) - area(a));
      let main = null;
      let spot = null;
      for (const r of ranked) { spot = roomSpot(r); if (spot) { main = r; break; } }
      if (!main) { for (const r of its) skip(r, 'department', whyNot(r)); continue; }
      const reachable = its.filter((r) => r === main || roomSpot(r));
      stopRooms.add(main.id);
      here.push({
        id: `department:${d.key}`, kind: 'department', facility: null, name: d.name, floor, floorName: floorName(floor),
        roomId: main.id, rooms: reachable.map((r) => ({ id: r.id, name: roomName(r) })), department: d.name,
        description: descriptions.get(d.key) ?? textOf(main.description),
        elsewhere: d.rooms.filter((r) => floorOf(r) !== floor).map((r) => ({ id: r.id, name: roomName(r), floor: floorOf(r) })),
        spot, yaw: facingYaw(spot, main), look: { x: main.x, z: main.z },
        people: 0, names: [], lines: [], text: '', leg: null,
      });
    }
    // one of each facility: candidates (rooms of that type the tour can reach, not a department's stop)
    const covered = new Set(here.map((s) => roomsById.get(s.roomId)?.type));
    const candidates = [];
    for (const type of TOUR_FACILITIES) {
      if (covered.has(type)) continue;
      for (const r of floorRooms) {
        if (r.type !== type || stopRooms.has(r.id)) continue;
        const spot = roomSpot(r);
        if (!spot) continue;
        candidates.push({
          id: `room:${r.id}`, kind: 'facility', facility: type, name: roomName(r), floor, floorName: floorName(floor),
          roomId: r.id, rooms: [{ id: r.id, name: roomName(r) }], department: r.departmentRef?.trim() || null,
          description: textOf(r.description), spot, yaw: facingYaw(spot, r), look: { x: r.x, z: r.z },
          people: 0, names: [], lines: [], text: '', leg: null,
        });
      }
    }
    // stairs up, when a floor above has something to see
    const next = order[fi + 1];
    const more = next !== undefined && order.slice(fi + 1).some(worthSeeing);
    const ups = more ? links.filter((l) => l.from.floor === floor && l.to.floor === next && reached(l.from)) : [];
    if (!here.length && !candidates.length && !(floor === ground && reception) && !ups.length) {
      if (more) unreachableFrom(fi + 1);
      break;
    }

    // cost fields: from where the floor starts and from each stop, to every point that matters here
    const first = floor === ground && reception ? reception : null;
    const startPoint = first ? first.spot : arrival;
    const ends = ups.map((l) => ({ x: l.from.x, z: l.from.z, floor, link: l }));
    const field = (p) => coarseField(coarse, p);
    const startF = first ? field(first.spot) : startField;
    const D = createDistances();
    const pts = [{ ref: first ?? 'start', p: startPoint, f: startF }, ...here.map((s) => ({ ref: s, p: s.spot, f: field(s.spot) }))];
    for (const e of ends) pts.push({ ref: e, p: e, f: field(e) });
    for (const c of candidates) pts.push({ ref: c, p: c.spot, f: null });
    for (const a of pts) D.add(a.ref, a.p, a.f);

    // the order (for each way up: the best one)
    let best = null;
    for (const end of ends.length ? ends : [null]) {
      let seq = nearestNeighbour(D, pts[0].ref, here);
      if (end) seq.push(end);
      twoOpt(D, seq, !!end);
      for (const type of TOUR_FACILITIES) seq = insertBest(D, seq, candidates.filter((c) => c.facility === type), !!end);
      twoOpt(D, seq, !!end);
      const cost = D.path(seq);
      if (!best || cost < best.cost) best = { seq, cost, end };
    }
    const chosen = best.seq.filter((s) => s !== pts[0].ref && s !== best.end);
    for (const s of chosen) if (s.kind === 'facility') stopRooms.add(s.roomId);

    // the legs: into the floor (from the last stop below), then stop to stop
    const floorStops = first ? [first, ...chosen] : chosen;
    for (const s of floorStops) {
      s.leg = legBetween(lastFloorStop, s);
      make(s);
      lastFloorStop = s;
    }
    if (floorStops.length) visitedFloors.push(floor);
    if (!best.end) {
      if (more) unreachableFrom(fi + 1); // something to see up there, but no stairs lead there from here
      break;
    }
    arrival = { x: best.end.link.to.x, z: best.end.link.to.z, floor: next };
  }

  // back to reception
  if (backToReception && reception && lastFloorStop !== reception && stops.length > 2) {
    const back = make({
      ...reception, id: 'return', kind: 'return', name: reception.name, lines: [], text: '', leg: null,
    });
    back.leg = legBetween(lastFloorStop, back);
  }

  // ── the walk between two stops: the route the walker takes (stairs included) ──
  function legBetween(a, b) {
    const r = findRoute(layout, a.spot, b.spot, { maps, name: b.name });
    return r.problem ? makeLeg([], r) : makeLeg(r.legs);
  }

  function makeLeg(legs, problem = null) {
    let length = 0;
    for (const l of legs) length += pathLength(l.points) + (l.stairsAtEnd?.length ?? 0);
    return { legs, length, seconds: length / speed, directions: '', steps: [], mentions: [], ...(problem ? { problem: problem.problem, message: problem.message } : {}) };
  }

  // ── the words: each stop's text, each leg's directions and passing mentions ──
  const doors = doorsByFloor(rooms);
  const mentioned = new Set();
  const walkedThrough = new Set();
  stops.forEach((s, n) => {
    s.n = n + 1;
    const its = s.rooms.map((r) => roomsById.get(r.id)).filter(Boolean);
    const sitting = its.flatMap((r) => seated.get(r.id) ?? []);
    s.people = sitting.length;
    s.names = sitting.slice(0, NAMES_MAX).map((p) => ({ name: p.name, department: p.department }));
    if (s.leg) {
      describeLeg(s, n ? stops[n - 1] : null);
      mentionsOn(s);
    }
  });
  stops.forEach((s) => { s.lines = linesOf(s); s.text = s.lines.join('\n'); });

  const length = stops.reduce((sum, s) => sum + (s.leg?.length ?? 0), 0);
  const walkSeconds = length / speed;
  const pauseSeconds = pause * stops.length;
  const seconds = walkSeconds + pauseSeconds;
  const minutes = Math.max(1, Math.round(seconds / 60));
  entrance.lines = [...entrance.lines, `The tour: ${stops.length - 1} stop${stops.length === 2 ? '' : 's'}, about ${minutes} min`];
  entrance.text = entrance.lines.join('\n');

  // rooms neither a stop, mentioned nor walked through
  const notSkipped = (r) => !skipped.some((k) => k.roomId === r.id);
  const missed = rooms.filter((r) => notSkipped(r) && !stopRooms.has(r.id) && !mentioned.has(r.id) && !walkedThrough.has(r.id))
    .map((r) => ({ roomId: r.id, name: roomName(r), floor: floorOf(r) }));

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    stops,
    floors: visitedFloors,
    length,
    seconds,
    walkSeconds,
    pauseSeconds,
    minutes,
    mentions: stops.flatMap((s) => (s.leg?.mentions ?? []).map((m) => ({ ...m, stop: s.n }))),
    skipped,
    missed,
    ms: t1 - t0,
  };

  // ── helpers that need the plan's state ──

  function linesOf(s) {
    const lines = [s.name];
    const typeLabel = s.kind === 'department' ? 'Department' : s.kind === 'facility' ? FACILITIES[s.facility]?.label
      : s.kind === 'reception' ? 'Reception' : s.kind === 'return' ? null : null;
    if (s.kind === 'entrance') lines.push(`${s.floorName} · the tour starts here`);
    else if (s.kind === 'return') lines.push(`Back where the tour began · ${s.floorName}`);
    else {
      const roomsText = s.kind === 'department'
        ? (s.rooms.length > 1 ? `${s.rooms.length} rooms: ${sayList(s.rooms.map((r) => r.name))}` : (s.rooms[0] && keyOf(s.rooms[0].name) !== keyOf(s.name) ? s.rooms[0].name : ''))
        : '';
      lines.push([typeLabel, roomsText, s.floorName].filter(Boolean).join(' · '));
      if (s.description) lines.push(s.description);
      if (s.people) lines.push(`${s.people} ${s.people === 1 ? 'person works' : 'people work'} here`);
      if (s.names.length) {
        const sameDept = s.department && s.names.every((p) => p.department && keyOf(p.department) === keyOf(s.department));
        const names = s.names.map((p) => (sameDept || !p.department ? p.name : `${p.name} (${p.department})`));
        lines.push(s.people > s.names.length ? `Among them: ${sayList(names)}` : sayList(names));
      }
      if (s.elsewhere?.length) {
        const byFloor = new Map();
        for (const r of s.elsewhere) { if (!byFloor.has(r.floor)) byFloor.set(r.floor, []); byFloor.get(r.floor).push(r.name); }
        for (const [f, names] of byFloor) lines.push(`Also on ${floorName(f)}: ${sayList(names)}`);
      }
    }
    return lines;
  }

  /** Text directions for the leg into stop `s` (from `prev`). */
  function describeLeg(s, prev) {
    const steps = [];
    const leg = s.leg;
    if (leg.problem) { leg.directions = leg.message; return; }
    const goalRoom = roomsById.get(s.roomId) ?? null;
    let along = 0;
    leg.legs.forEach((part, li) => {
      const samples = sampleLine(part.points);
      const runs = roomRuns(samples, part.floor, rooms);
      for (const r of runs) if (r.room) walkedThrough.add(r.room.id);
      const lastPart = li === leg.legs.length - 1;
      const stairsHere = (r) => r.room?.type === 'STAIRCASE' && ((part.stairsAtEnd && r === runs.at(-1)) || (li > 0 && r === runs[0]));
      runs.forEach((r, ri) => {
        const at = samples[r.from];
        const isFirst = li === 0 && ri === 0;
        const isLast = lastPart && ri === runs.length - 1;
        if (stairsHere(r)) return;
        if (isFirst) {
          // where the leg starts: "out of Sales" (nothing when you start outside or in a corridor)
          if (r.room && runs.length > 1 && !isCorridor(r.room) && r.room.id !== goalRoom?.id) {
            steps.push({ text: `out of ${roomPhrase(r.room)}`, floor: part.floor, at, along: along + at.s });
          }
          return;
        }
        const turn = turnAt(samples, r.from);
        const lead = turn ? `turn ${turn} ` : '';
        if (isLast && goalRoom && r.room?.id === goalRoom.id) {
          const before = runs[ri - 1];
          const ord = before?.room && isCorridor(before.room) ? doorOrdinal(samples, before, goalRoom, part.floor) : null;
          if (ord) {
            // replaces the corridor's own "along the corridor" when that was the last step
            steps.push({ text: `${s.name} is the ${ord.ordinal} door on your ${ord.side}`, floor: part.floor, at: samples[ord.k], along: along + samples[ord.k].s });
          } else {
            steps.push({ text: `${lead}into ${s.kind === 'department' && s.rooms.length > 1 ? roomPhrase(goalRoom) : s.name}`, floor: part.floor, at, along: along + at.s });
          }
          return;
        }
        const text = !r.room ? 'outside' : isCorridor(r.room)
          ? `along ${/^(the )?(corridor|hallway|hall)( \d+)?$/i.test(r.room.name?.trim() ?? '') || !r.room.name?.trim() ? 'the corridor' : r.room.name.trim()}`
          : `through ${roomPhrase(r.room)}`;
        steps.push({ text: lead + text, floor: part.floor, at, along: along + at.s });
      });
      if (lastPart && goalRoom && !runs.some((r) => r.room?.id === goalRoom.id)) {
        const end = samples.at(-1);
        steps.push({ text: `to ${s.name}`, floor: part.floor, at: end, along: along + end.s });
      }
      if (!goalRoom && lastPart && s.kind !== 'entrance') {
        const end = samples.at(-1);
        steps.push({ text: `to ${s.name}`, floor: part.floor, at: end, along: along + end.s });
      }
      if (part.stairsAtEnd) {
        const stair = objects.find((o) => o.id === part.stairsAtEnd.objectId);
        const side = stair ? sideOf(samples, Math.max(0, samples.length - 1 - Math.round(3 / SAMPLE_STEP)), stair) : null;
        const end = samples.at(-1);
        const where = side === 'ahead' ? 'the stairs ahead' : side ? `the stairs on your ${side}` : 'the stairs';
        steps.push({ text: `${where}, ${part.stairsAtEnd.direction} to ${floorName(part.stairsAtEnd.toFloor)}`, floor: part.floor, at: end, along: along + end.s });
      }
      along += samples.at(-1).s + (part.stairsAtEnd?.length ?? 0);
    });
    // a step that repeats the one before it (a corridor crossed twice in a row) says it once
    const out = steps.filter((st, i) => i === 0 || st.text !== steps[i - 1].text);
    leg.steps = out.map((st) => ({ text: st.text, floor: st.floor, at: { x: st.at.x, z: st.at.z }, along: st.along }));
    leg.directions = out.length ? `${capital(out.map((st) => st.text).join(', '))}.` : (prev ? `To ${s.name}.` : '');
  }

  /**
   * "Sales is the third door on your left": along the corridor run before the goal (its direction:
   * from where the run starts to where the goal's door is passed), the doors on the goal's side
   * before it. null: the door is ahead, too far, or more than the sixth.
   */
  function doorOrdinal(samples, run, goalRoom, floor) {
    const floorDoors = doors.get(floor) ?? [];
    let goal = null;
    for (const d of floorDoors.filter((x) => x.roomId === goalRoom.id)) {
      for (let k = run.from; k < samples.length; k++) {
        const dd = Math.hypot(samples[k].x - d.x, samples[k].z - d.z);
        if (dd <= MENTION_DISTANCE && (!goal || dd < goal.dist)) goal = { d, k, dist: dd };
      }
    }
    if (!goal) return null;
    // the corridor's way: from where the run starts to 1.5 m before it turns into the door
    const o = samples[run.from];
    const end = samples[Math.max(run.from, Math.min(goal.k, run.to) - Math.round(1.5 / SAMPLE_STEP))];
    const ux = end.x - o.x;
    const uz = end.z - o.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 1) return null; // crossing the corridor, not walking along it
    const dir = { x: ux / ul, z: uz / ul };
    const endK = Math.max(run.from, Math.min(goal.k, run.to) - Math.round(1.5 / SAMPLE_STEP));
    const along = (p) => (p.x - o.x) * dir.x + (p.z - o.z) * dir.z;
    /** Across the corridor from the walk's nearest point before the turn (> 0: on your left), and how far. */
    const beside = (d) => {
      let best = null;
      for (let k = run.from; k <= endK; k++) {
        const dd = Math.hypot(samples[k].x - d.x, samples[k].z - d.z);
        if (!best || dd < best.dd) best = { k, dd };
      }
      const p = samples[best.k];
      return { c: dir.x * (d.z - p.z) - dir.z * (d.x - p.x), dd: best.dd };
    };
    const ga = along(goal.d);
    const { c: gc } = beside(goal.d);
    if (Math.abs(gc) < 0.8) return null; // straight ahead, not beside you
    const side = gc > 0 ? 'left' : 'right';
    const seen = [];
    for (const d of floorDoors) {
      if (d.roomId === goalRoom.id || seen.some((x) => Math.hypot(x.x - d.x, x.z - d.z) < 0.5)) continue;
      const a = along(d);
      if (a < 0.5 || a > ga - 0.5) continue; // behind you (the door you came out of) or past the goal
      const { c, dd } = beside(d);
      if (Math.sign(c) !== Math.sign(gc) || Math.abs(c) < 0.8 || dd > MENTION_DISTANCE) continue;
      seen.push(d);
    }
    return seen.length < ORDINALS.length ? { ordinal: ORDINALS[seen.length], side, k: goal.k } : null;
  }

  /** The rooms the leg into `s` passes within MENTION_DISTANCE of a door, in sight: once in the tour. */
  function mentionsOn(s) {
    const leg = s.leg;
    if (leg.problem) return;
    let along = 0;
    const found = [];
    for (const part of leg.legs) {
      const samples = sampleLine(part.points);
      const map = mapOf(part.floor);
      const inRoom = samples.map((p) => roomAt(rooms, part.floor, p.x, p.z));
      const through = new Set(roomRuns(samples, part.floor, rooms).map((r) => r.room?.id).filter(Boolean));
      const best = new Map(); // roomId → { door, k, d }
      for (const d of doors.get(part.floor) ?? []) {
        if (stopRooms.has(d.roomId) || mentioned.has(d.roomId) || through.has(d.roomId)) continue;
        for (let k = 0; k < samples.length; k++) {
          const p = samples[k];
          const dist = Math.hypot(p.x - d.x, p.z - d.z);
          if (dist > MENTION_DISTANCE) continue;
          const b = best.get(d.roomId);
          if (b && b.d <= dist) continue;
          if (inRoom[k]?.id === d.roomId) continue;
          if (!doorInSight(map, p, d)) continue;
          best.set(d.roomId, { door: d, k, d: dist });
        }
      }
      for (const [roomId, m] of best) {
        const room = roomsById.get(roomId);
        const side = sideOf(samples, m.k, m.door);
        const p = samples[m.k];
        found.push({
          roomId, name: roomName(room), side, text: side === 'ahead' ? `Ahead: ${roomName(room)}` : `On your ${side}: ${roomName(room)}`,
          at: { x: p.x, z: p.z, floor: part.floor }, door: { x: m.door.x, z: m.door.z }, distance: m.d, along: along + p.s,
        });
      }
      along += (samples.at(-1)?.s ?? 0) + (part.stairsAtEnd?.length ?? 0);
    }
    found.sort((a, b) => a.along - b.along);
    for (const m of found) {
      if (mentioned.has(m.roomId)) continue;
      mentioned.add(m.roomId);
      leg.mentions.push(m);
    }
  }
}

/** A description string (trimmed, cut), else null. */
function textOf(v) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, DESCRIPTION_MAX) : null;
}

// ── ordering ──────────────────────────────────────────────────────────────

/** Walking costs between the points of one floor, from their cost fields (averaged both ways). */
function createDistances() {
  const items = new Map(); // ref → { p, f }
  const cache = new Map();
  const api = {
    add(ref, p, f) { items.set(ref, { p, f }); cache.clear(); },
    d(a, b) {
      if (a === b) return 0;
      const key = `${idOf(a)}|${idOf(b)}`;
      if (cache.has(key)) return cache.get(key);
      const A = items.get(a);
      const B = items.get(b);
      const ab = A?.f ? coarseCost(A.f, B.p) : Infinity;
      const ba = B?.f ? coarseCost(B.f, A.p) : Infinity;
      const v = ab < Infinity && ba < Infinity ? (ab + ba) / 2 : Math.min(ab, ba);
      cache.set(key, v);
      cache.set(`${idOf(b)}|${idOf(a)}`, v);
      return v;
    },
    path(seq) {
      let sum = 0;
      for (let i = 1; i < seq.length; i++) sum += api.d(seq[i - 1], seq[i]);
      return sum;
    },
  };
  const ids = new WeakMap();
  let next = 0;
  const idOf = (ref) => {
    if (typeof ref !== 'object' || ref === null) return String(ref);
    if (!ids.has(ref)) ids.set(ref, `#${next++}`);
    return ids.get(ref);
  };
  return api;
}

/** From `start`, always to the nearest stop not yet visited. */
export function nearestNeighbour(D, start, items) {
  const seq = [start];
  const left = new Set(items);
  while (left.size) {
    const at = seq.at(-1);
    let best = null;
    let bestD = Infinity;
    for (const s of left) {
      const v = D.d(at, s);
      if (!best || v < bestD) { best = s; bestD = v; }
    }
    seq.push(best);
    left.delete(best);
  }
  return seq;
}

/**
 * 2-opt on an open path: the first point stays first, the last too when `fixedEnd`. Reverses a part
 * of the order while that makes the walk shorter (a few passes; stops when nothing improves).
 */
export function twoOpt(D, seq, fixedEnd) {
  const last = seq.length - (fixedEnd ? 2 : 1); // the last index that may move
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 1; i < last; i++) {
      for (let j = i + 1; j <= last; j++) {
        const a = seq[i - 1];
        const b = seq[i];
        const c = seq[j];
        const d = seq[j + 1];
        const before = D.d(a, b) + (d !== undefined ? D.d(c, d) : 0);
        const after = D.d(a, c) + (d !== undefined ? D.d(b, d) : 0);
        if (after < before - 1e-6) {
          seq.splice(i, j - i + 1, ...seq.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return seq;
}

/** The one candidate that adds the least walking, put where it adds the least (none: unchanged). */
export function insertBest(D, seq, candidates, fixedEnd) {
  let best = null;
  for (const c of candidates) {
    for (let i = 1; i <= seq.length; i++) {
      if (fixedEnd && i === seq.length) continue; // never after the stairs
      const a = seq[i - 1];
      const b = seq[i];
      const add = D.d(a, c) + (b !== undefined ? D.d(c, b) - D.d(a, b) : 0);
      if (add < Infinity && (!best || add < best.add)) best = { c, i, add };
    }
  }
  if (!best) return seq;
  const out = [...seq];
  out.splice(best.i, 0, best.c);
  return out;
}

// ── the ordering's grid ───────────────────────────────────────────────────

const coarseCache = new WeakMap();
/**
 * A copy of a walk map with COARSE × COARSE cells in one: free when any of its cells is FREE. Every
 * step the body can take is still a step there (the doors stay open), walls stay closed (they are
 * 0.8 m and more of blocked cells), so its distances are the walk map's within a few per cent.
 */
export function coarseOf(map) {
  let c = coarseCache.get(map);
  if (c) return c;
  const cols = Math.ceil(map.cols / COARSE);
  const rows = Math.ceil(map.rows / COARSE);
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < map.rows; j++) {
    const row = Math.floor(j / COARSE) * cols;
    for (let i = 0; i < map.cols; i++) if (map.cells[j * map.cols + i] === FREE) free[row + Math.floor(i / COARSE)] = 1;
  }
  const cell = map.cell * COARSE;
  c = {
    cols, rows, free, cell, x0: map.x0, z0: map.z0,
    indexOf(x, z) {
      const i = Math.floor((x - map.x0) / cell);
      const j = Math.floor((z - map.z0) / cell);
      return i < 0 || j < 0 || i >= cols || j >= rows ? -1 : j * cols + i;
    },
  };
  coarseCache.set(map, c);
  return c;
}

/** Walking distances from a spot to every cell of a coarse grid (Dijkstra, 8 neighbours, no corner cutting). */
export function coarseField(c, from) {
  const { cols, rows, free, cell } = c;
  const g = new Float64Array(cols * rows).fill(Infinity);
  const field = { c, g };
  const s = c.indexOf(from.x, from.z);
  if (s < 0 || !free[s]) return field;
  const heap = createHeap();
  g[s] = 0;
  heap.push(s, 0);
  const diag = cell * Math.SQRT2;
  while (heap.size) {
    const [k, gk] = heap.pop();
    if (gk > g[k]) continue;
    const i = k % cols;
    const j = (k - i) / cols;
    for (let q = 0; q < 8; q++) {
      const di = DI8[q];
      const dj = DJ8[q];
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (!free[nk]) continue;
      if (q >= 4 && (!free[k + di] || !free[k + dj * cols])) continue;
      const ng = gk + (q >= 4 ? diag : cell);
      if (ng < g[nk]) { g[nk] = ng; heap.push(nk, ng); }
    }
  }
  return field;
}

/** A coarse field's distance at a spot (Infinity: not reached). */
export function coarseCost(field, p) {
  const k = field.c.indexOf(p.x, p.z);
  return k < 0 ? Infinity : field.g[k];
}

const DI8 = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ8 = [0, 0, 1, -1, 1, -1, 1, -1];

/** A binary min-heap of (node, key). */
function createHeap() {
  let nodes = new Int32Array(1024);
  let keys = new Float64Array(1024);
  let size = 0;
  const swap = (a, b) => {
    const n = nodes[a]; nodes[a] = nodes[b]; nodes[b] = n;
    const k = keys[a]; keys[a] = keys[b]; keys[b] = k;
  };
  return {
    get size() { return size; },
    push(n, key) {
      if (size === nodes.length) {
        const nn = new Int32Array(size * 2); nn.set(nodes); nodes = nn;
        const nk = new Float64Array(size * 2); nk.set(keys); keys = nk;
      }
      let i = size++;
      nodes[i] = n; keys[i] = key;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= keys[i]) break;
        swap(i, p); i = p;
      }
    },
    pop() {
      const out = [nodes[0], keys[0]];
      size--;
      if (size > 0) {
        nodes[0] = nodes[size]; keys[0] = keys[size];
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < size && keys[l] < keys[m]) m = l;
          if (r < size && keys[r] < keys[m]) m = r;
          if (m === i) break;
          swap(i, m); i = m;
        }
      }
      return out;
    },
  };
}

// ── route geometry ────────────────────────────────────────────────────────

/** Points every SAMPLE_STEP along a path: { x, z, s (m from its start), dx, dz (the way you walk) }. */
export function sampleLine(points) {
  const out = [];
  let s = 0;
  if (points.length === 1) return [{ x: points[0].x, z: points[0].z, s: 0, dx: 0, dz: 1 }];
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1];
    const b = points[n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-9) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP));
    for (let k = out.length ? 1 : 0; k <= steps; k++) {
      const t = k / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: s + len * t, dx, dz });
    }
    s += len;
  }
  if (!out.length) out.push({ x: points[0].x, z: points[0].z, s: 0, dx: 0, dz: 1 });
  return out;
}

/** The innermost room of a floor holding a point (null: none). */
function roomAt(rooms, floor, x, z) {
  let best = null;
  for (const r of rooms) {
    if (floorOf(r) !== floor || Math.abs(x - r.x) > r.width / 2 || Math.abs(z - r.z) > r.depth / 2) continue;
    if (!best || r.width * r.depth < best.width * best.depth) best = r;
  }
  return best;
}

/** The rooms a path goes through in order ({ room | null, from, to }: sample indexes); doorways left out. */
export function roomRuns(samples, floor, rooms) {
  const raw = [];
  samples.forEach((p, k) => {
    const room = roomAt(rooms, floor, p.x, p.z);
    const last = raw.at(-1);
    if (last && last.room === room) last.to = k;
    else raw.push({ room, from: k, to: k });
  });
  const long = (r) => samples[r.to].s - samples[r.from].s >= MIN_RUN;
  const runs = raw.filter((r, i) => i === 0 || i === raw.length - 1 || long(r));
  // two runs of the same room after a doorway was dropped: one
  const out = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (last && last.room === r.room) last.to = r.to;
    else out.push({ ...r });
  }
  return out;
}

/** 'left' | 'right' | null: the turn where a run starts (the way you walk 0.75 m before vs after). */
function turnAt(samples, k) {
  const b = samples[Math.max(0, k - 3)];
  const a = samples[Math.min(samples.length - 1, k + 3)];
  const p = samples[k];
  const v1 = { x: p.x - b.x, z: p.z - b.z };
  const v2 = { x: a.x - p.x, z: a.z - p.z };
  if (Math.hypot(v1.x, v1.z) < 1e-6 || Math.hypot(v2.x, v2.z) < 1e-6) return null;
  const angle = Math.atan2(v1.x * v2.z - v1.z * v2.x, v1.x * v2.x + v1.z * v2.z);
  if (Math.abs(angle) < TURN) return null;
  return angle > 0 ? 'left' : 'right';
}

/**
 * Where a point is, seen from sample k walking its way: 'left' | 'right' | 'ahead' | 'behind'.
 * Facing +Z, +X is on your right (Babylon's left-handed world, as playController).
 */
export function sideOf(samples, k, target) {
  const p = samples[k];
  const { dx, dz } = headingAt(samples, k);
  const vx = target.x - p.x;
  const vz = target.z - p.z;
  const cross = dx * vz - dz * vx;
  const dot = dx * vx + dz * vz;
  const angle = Math.atan2(Math.abs(cross), dot);
  if (angle < AHEAD) return 'ahead';
  if (angle > Math.PI - AHEAD / 2) return 'behind';
  return cross > 0 ? 'left' : 'right';
}

/** The way you walk at sample k, over ±1 m (a corner's last step doesn't count). */
function headingAt(samples, k, span = 4) {
  const a = samples[Math.max(0, k - span)];
  const b = samples[Math.min(samples.length - 1, k + span)];
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  return l < 1e-6 ? { dx: samples[k].dx, dz: samples[k].dz } : { dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
}

/** Every door of each floor: { roomId, x, z (the gap's centre), n (outward) , t (the wall's half thickness) }. */
function doorsByFloor(rooms) {
  const out = new Map();
  for (const room of rooms) {
    const f = floorOf(room);
    if (!out.has(f)) out.set(f, []);
    const T = wallThicknessOf(room);
    for (const door of roomOpenings(room)) {
      if (door.kind !== 'door') continue;
      const n = OUTWARD[door.wall];
      if (!n) continue;
      const alongX = door.wall === 'north' || door.wall === 'south';
      const x = alongX ? room.x + door.offset : room.x + n.x * room.width / 2;
      const z = alongX ? room.z + n.z * room.depth / 2 : room.z + door.offset;
      out.get(f).push({ roomId: room.id, x, z, n, t: T / 2 });
    }
  }
  return out;
}

/** Can you see the door from p: a clear line (walk map cells) to a spot just in front of it on your side? */
function doorInSight(map, p, d) {
  const side = (p.x - d.x) * d.n.x + (p.z - d.z) * d.n.z >= 0 ? 1 : -1;
  for (const out of [0.45, 0.7, 1]) {
    const q = { x: d.x + d.n.x * side * (d.t + out), z: d.z + d.n.z * side * (d.t + out) };
    if (cellsClear(map, p.x, p.z, q.x, q.z)) return true;
  }
  return false;
}

/**
 * @typedef {object} TourStop
 * @property {string} id  'entrance' | 'reception' | 'department:<key>' | 'room:<roomId>' | 'return'
 * @property {number} n  1, 2, … in tour order
 * @property {'entrance' | 'reception' | 'department' | 'facility' | 'return'} kind
 * @property {'RESTROOM' | 'MEETING' | null} facility
 * @property {string} name
 * @property {number} floor  @property {string} floorName
 * @property {string | null} roomId  the room it stands in (a department: its main room)
 * @property {{ id: string, name: string }[]} rooms  a department's rooms on this floor
 * @property {string | null} department  @property {string | null} description
 * @property {{ x: number, z: number, floor: number }} spot  where to stand
 * @property {number} yaw  which way to face (0 = +Z, as playController)
 * @property {{ x: number, z: number } | null} look  what it faces
 * @property {number} people  seated in its rooms
 * @property {{ name: string, department: string | null }[]} names  up to NAMES_MAX
 * @property {string[]} lines  @property {string} text  lines joined by "\n"
 * @property {TourLeg | null} leg  the walk to it (none for the entrance)
 */
/**
 * @typedef {object} TourLeg
 * @property {{ floor: number, points: { x: number, z: number }[], stairsAtEnd?: object }[]} legs  as findRoute's
 * @property {number} length  @property {number} seconds
 * @property {string} directions  "Through Lobby & Reception, turn right along the corridor, …"
 * @property {{ text, floor, at: { x, z }, along }[]} steps
 * @property {{ roomId, name, side, text, at: { x, z, floor }, door: { x, z }, distance, along }[]} mentions
 * @property {string} [problem]  @property {string} [message]  no route (should not happen: such rooms are skipped)
 */
/**
 * @typedef {object} TourPlan
 * @property {TourStop[]} stops
 * @property {number[]} floors  the floors visited, in order
 * @property {number} length  m  @property {number} seconds  walking + pauses
 * @property {number} walkSeconds  @property {number} pauseSeconds  @property {number} minutes
 * @property {object[]} mentions  every leg's, with `stop` (the stop the leg leads to)
 * @property {{ roomId, name, floor, floorName, kind, problem, message }[]} skipped  rooms that can't be walked to
 * @property {{ roomId, name, floor }[]} missed  rooms neither a stop, mentioned nor walked through
 * @property {number} ms  how long planning took
 */
