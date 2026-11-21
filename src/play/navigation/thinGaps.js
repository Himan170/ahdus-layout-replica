/**
 * play/navigation/thinGaps.js (v0.18.8)
 *
 * PURE: the strips of floor too narrow for a person, and what keeps the walking body out of furniture.
 *
 *   thinGaps(layout, floorId, { catalog })   → [{ a, b, gap, box, across, ... }]
 *     a gap wider than 0 (TOUCH) and narrower than THIN_GAP (the body 0.64 m + a margin) between a staircase or a
 *     blocking item and a wall (its room's inner face, a room inside it, a Wall-tool wall), or between two of them
 *     in the same room, along X or Z, side by side for at least MIN_ALONG. Chairs never count (a meeting table's
 *     chairs stand that close on purpose, and a seat must stay reachable); stairs' ends neither (stairFit says
 *     "no room to step on" there). Used by Check my layout (THIN_GAP), the walk map (the strips are blocked) and
 *     walking (bodyPushOut).
 *   floorBlockers(layout, floorId, { catalog }) → { items, strips }   once per floor and layout
 *   bodyPushOut(blockers, { x, z, y, radius }) → { dx, dz } | null    every small step of a walk
 *     the body (a circle) out of every solid item's box as drawn (itemFootprints: scaled and turned, the box Check and
 *     the walk map use: Babylon's collisions miss most models' faces) and out of the thin strips, by an open end.
 *
 * Only staircases and items turned in quarter turns make strips (their sides then face walls along X / Z).
 */
import { itemFootprints, isSolidItem } from './walkMap';
import { stairRects, stairEnds, roomRect } from '../building';
import { wallThicknessOf } from '../geometry';
import { isChair } from '../people';
import { boxOf } from '../turnedRect';

/** The walking body's radius (walkMap.BODY_RADIUS; kept here: walkMap imports this module). */
const BODY = 0.32;
/** A gap narrower than this (m) is a thin gap: the body (0.64 m) + 0.11 m, rounded to what the message says. */
export const THIN_GAP = 0.75;
/** Closer than this (m) counts as touching: flush, no gap. */
export const TOUCH = 0.02;
/** Two things side by side for less than this (m) make no strip (a corner passing a corner). */
export const MIN_ALONG = 0.3;
/** Feet this far over the floor (m) are on something (a flight), not on the floor beside it. */
const ON_TOP = 0.3;

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (o) => o?.floor ?? o?.floorId ?? 0;
const quarter = (rot) => Math.abs((rot ?? 0) - Math.round((rot ?? 0) / (Math.PI / 2)) * (Math.PI / 2)) <= 1e-3;
const r3 = (v) => Math.round(v * 1000) / 1000;
/** Chairs, stools, lounge chairs: never part of a thin gap. */
export const isSeatLike = (type) => isChair(type) || /CHAIR|STOOL/.test(String(type ?? ''));
const area = (r) => r.width * r.depth;
const inRoom = (r, x, z) => x >= r.x - r.width / 2 && x <= r.x + r.width / 2 && z >= r.z - r.depth / 2 && z <= r.z + r.depth / 2;
const innermost = (rooms, x, z) => rooms.filter((r) => inRoom(r, x, z)).sort((a, b) => area(a) - area(b))[0] ?? null;
const grow = (b, t) => ({ x0: b.x0 - t, x1: b.x1 + t, z0: b.z0 - t, z1: b.z1 + t });
const holds = (a, b) => a !== b && area(a) > area(b) && b.x - b.width / 2 >= a.x - a.width / 2 - 0.02 && b.x + b.width / 2 <= a.x + a.width / 2 + 0.02
  && b.z - b.depth / 2 >= a.z - a.depth / 2 - 0.02 && b.z + b.depth / 2 <= a.z + a.depth / 2 + 0.02;

/** The things that make thin gaps on a floor: { id, kind: 'stairs' | 'item', name, assetType, box, ends?, room }. */
function gapBlockers(layout, floorId, catalog, rooms) {
  const out = [];
  for (const o of list(layout.objects)) {
    if (floorOf(o) !== floorId || !o) continue;
    const name = o.label || catalog[o.assetType]?.label || (o.assetType === 'STAIRCASE' ? 'Stairs' : 'Item');
    if (o.assetType === 'STAIRCASE') {
      if (!quarter(o.rotationY)) continue;
      const ends = stairEnds(o);
      for (const r of stairRects(o)) {
        const box = boxOf(r);
        out.push({ id: o.id, kind: 'stairs', name: o.label || 'Stairs', assetType: o.assetType, box, ends, room: innermost(rooms, o.x, o.z) });
      }
      continue;
    }
    if (o.assetType === 'WALL_SEGMENT' || isSeatLike(o.assetType) || !isSolidItem(o, catalog)) continue;
    if ((Number(o.y) || 0) > 0.05 || !quarter(o.rotationY)) continue; // on a table top; turned at an angle
    for (const r of itemFootprints(o, catalog)) {
      out.push({ id: o.id, kind: 'item', name, assetType: o.assetType, box: boxOf(r), room: innermost(rooms, o.x, o.z) });
    }
  }
  return out;
}

/** Is this side of a flight's box one of its ends (the bottom or top step's edge)? */
const isStairEnd = (bl, axis, v) => bl.ends && [bl.ends.bottom, bl.ends.top].some((e) => Math.abs(e[axis] - v) < 0.02
  && (axis === 'x' ? e.z >= bl.box.z0 - 0.02 && e.z <= bl.box.z1 + 0.02 : e.x >= bl.box.x0 - 0.02 && e.x <= bl.box.x1 + 0.02));

/** A room's doors as { axis: 'x' | 'z' (the wall is a line of constant x / z), at, from, to }. */
function doorSpans(room) {
  return (room.doors ?? []).map((d) => {
    const w = d.width ?? 1;
    const off = d.offset ?? 0;
    if (d.wall === 'north' || d.wall === 'south') {
      return { axis: 'z', at: room.z + (d.wall === 'north' ? -1 : 1) * room.depth / 2, from: room.x + off - w / 2, to: room.x + off + w / 2 };
    }
    return { axis: 'x', at: room.x + (d.wall === 'west' ? -1 : 1) * room.width / 2, from: room.z + off - w / 2, to: room.z + off + w / 2 };
  });
}

/**
 * The thin gaps on one floor, one entry per strip.
 * @returns {{ a: { id, kind, name, assetType }, b: { kind: 'wall' | 'stairs' | 'item', id?, name? }, gap: number,
 *   box: { x0, x1, z0, z1 }, across: 'x' | 'z', roomId: string | null, aSide: 'lo' | 'hi' }[]}
 *   across: the axis the gap is measured along (a strip between x = 1 and x = 1.3 has across 'x'); aSide: the side
 *   of the strip `a` is on (lo = smaller x / z).
 */
export function thinGaps(layout, floorId, { catalog = {}, width = THIN_GAP } = {}) {
  const rooms = list(layout.rooms).filter((r) => floorOf(r) === floorId && String(r.type ?? '').toUpperCase() !== 'LIFT');
  const blockers = gapBlockers(layout, floorId, catalog, rooms);
  const walls = list(layout.objects).filter((o) => o?.assetType === 'WALL_SEGMENT' && floorOf(o) === floorId)
    .flatMap((o) => itemFootprints(o, catalog).map(boxOf));
  const out = [];
  const seen = new Set();
  const push = (g) => {
    const key = `${g.a.id}|${g.b.id ?? 'wall'}|${g.across}|${r3(g.box.x0)}|${r3(g.box.z0)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(g);
  };
  const ref = (bl) => ({ id: bl.id, kind: bl.kind, name: bl.name, assetType: bl.assetType });

  // ── a blocker and a wall ──
  for (const bl of blockers) {
    const room = bl.room;
    if (!room) continue;
    const t = wallThicknessOf(room) / 2;
    const inner = grow(roomRect(room), -t);
    const solids = [
      ...rooms.filter((r) => holds(room, r) && !(inRoom(r, (bl.box.x0 + bl.box.x1) / 2, (bl.box.z0 + bl.box.z1) / 2)))
        .map((r) => grow(roomRect(r), wallThicknessOf(r) / 2)),
      ...walls.filter((w) => w.x1 > inner.x0 && w.x0 < inner.x1 && w.z1 > inner.z0 && w.z0 < inner.z1),
    ];
    const doors = doorSpans(room);
    for (const axis of ['x', 'z']) {
      const [lo, hi] = axis === 'x' ? ['x0', 'x1'] : ['z0', 'z1'];
      const [a0, a1] = axis === 'x' ? ['z0', 'z1'] : ['x0', 'x1'];
      const faces = [
        { side: 'lo', at: inner[lo], from: inner[a0], to: inner[a1], room: true },
        { side: 'hi', at: inner[hi], from: inner[a0], to: inner[a1], room: true },
        ...solids.flatMap((g) => [{ side: 'lo', at: g[hi], from: g[a0], to: g[a1] }, { side: 'hi', at: g[lo], from: g[a0], to: g[a1] }]),
      ];
      for (const f of faces) {
        const edge = f.side === 'lo' ? bl.box[lo] : bl.box[hi];
        const gap = f.side === 'lo' ? edge - f.at : f.at - edge;
        if (!(gap > TOUCH && gap < width)) continue;
        if (bl.kind === 'stairs' && isStairEnd(bl, axis, edge)) continue;
        const from = Math.max(f.from, bl.box[a0]);
        const to = Math.min(f.to, bl.box[a1]);
        if (to - from < MIN_ALONG) continue;
        // a door in that wall, beside the strip: it is a way through, not a dead end
        if (f.room && doors.some((d) => d.axis === axis && Math.abs(d.at - f.at) < t + 0.05 && d.to > from && d.from < to)) continue;
        const box = axis === 'x'
          ? { x0: Math.min(f.at, edge), x1: Math.max(f.at, edge), z0: from, z1: to }
          : { x0: from, x1: to, z0: Math.min(f.at, edge), z1: Math.max(f.at, edge) };
        push({ a: ref(bl), b: { kind: 'wall' }, gap: r3(gap), box, across: axis, roomId: room.id ?? null, aSide: f.side === 'lo' ? 'hi' : 'lo' });
      }
    }
  }

  // ── two blockers in the same room ──
  const sorted = [...blockers].sort((p, q) => p.box.x0 - q.box.x0);
  for (let i = 0; i < sorted.length; i++) {
    const A = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const B = sorted[j];
      if (B.box.x0 - A.box.x1 >= width) break; // sorted by x0: nothing further can be near in x … or in z
      if (A.id === B.id || !A.room || A.room !== B.room) continue;
      for (const axis of ['x', 'z']) {
        const [lo, hi] = axis === 'x' ? ['x0', 'x1'] : ['z0', 'z1'];
        const [a0, a1] = axis === 'x' ? ['z0', 'z1'] : ['x0', 'x1'];
        const from = Math.max(A.box[a0], B.box[a0]);
        const to = Math.min(A.box[a1], B.box[a1]);
        if (to - from < MIN_ALONG) continue;
        const [P, Q] = A.box[lo] <= B.box[lo] ? [A, B] : [B, A];
        const gap = Q.box[lo] - P.box[hi];
        if (!(gap > TOUCH && gap < width)) continue;
        if ((P.kind === 'stairs' && isStairEnd(P, axis, P.box[hi])) || (Q.kind === 'stairs' && isStairEnd(Q, axis, Q.box[lo]))) continue;
        const box = axis === 'x' ? { x0: P.box.x1, x1: Q.box.x0, z0: from, z1: to } : { x0: from, x1: to, z0: P.box.z1, z1: Q.box.z0 };
        // the stairs, else the first (one line per item in Check)
        const [a, b] = Q.kind === 'stairs' && P.kind !== 'stairs' ? [Q, P] : [P, Q];
        push({ a: ref(a), b: ref(b), gap: r3(gap), box, across: axis, roomId: A.room.id ?? null, aSide: a === P ? 'lo' : 'hi' });
      }
    }
  }
  return out;
}

/**
 * What the walking body is kept out of on one floor.
 * items: [{ id, rect (turned), top }] every solid item standing on the floor, chairs too (walk past, never through);
 * strips: thinGaps' strips with which of their sides are open (an end; the stairs' side when you are up on them).
 */
export function floorBlockers(layout, floorId, { catalog = {} } = {}) {
  const items = [];
  for (const o of list(layout.objects)) {
    if (!o || floorOf(o) !== floorId || o.assetType === 'STAIRCASE' || o.assetType === 'WALL_SEGMENT') continue;
    if (!isSolidItem(o, catalog) || (Number(o.y) || 0) > 0.3) continue;
    const top = (Number(o.y) || 0) + (catalog[o.assetType]?.defaultHeight ?? 1) * Math.abs(o.scaleY ?? 1);
    for (const rect of itemFootprints(o, catalog)) items.push({ id: o.id, rect, top });
  }
  const strips = thinGaps(layout, floorId, { catalog }).map((g) => ({
    box: g.box, across: g.across,
    // the side a staircase is on: open to someone up on the flight (stepping back onto it)
    stairsSide: g.a.kind === 'stairs' ? g.aSide : g.b.kind === 'stairs' ? (g.aSide === 'lo' ? 'hi' : 'lo') : null,
  }));
  return { items, strips };
}

/** The body (a circle at x, z) out of a turned rectangle: the push { dx, dz }, or null when clear. */
function outOfRect(rect, x, z, radius) {
  const c = Math.cos(rect.rot ?? 0);
  const s = Math.sin(rect.rot ?? 0);
  const dx = x - rect.x;
  const dz = z - rect.z;
  const lx = dx * c - dz * s; // the rectangle's own axes (turnedRect.distanceTo)
  const lz = dx * s + dz * c;
  const nx = Math.max(-rect.hw, Math.min(rect.hw, lx));
  const nz = Math.max(-rect.hd, Math.min(rect.hd, lz));
  const away = Math.hypot(lx - nx, lz - nz);
  if (away >= radius) return null;
  let ox;
  let oz;
  if (away > 1e-9) {
    const by = (radius - away) / away;
    ox = (lx - nx) * by;
    oz = (lz - nz) * by;
  } else {
    // inside it: out by the nearest side
    const toX = rect.hw - Math.abs(lx);
    const toZ = rect.hd - Math.abs(lz);
    if (toX <= toZ) { ox = Math.sign(lx || 1) * (toX + radius); oz = 0; } else { ox = 0; oz = Math.sign(lz || 1) * (toZ + radius); }
  }
  // back to the world (the inverse of the turn above)
  return { dx: ox * c + oz * s, dz: -ox * s + oz * c };
}

/**
 * The body out of a strip: its centre never in it (out by an open end, or back onto the stairs when up on them),
 * and on the floor it doesn't reach into it past an end.
 */
function outOfStrip(st, x, z, y, radius) {
  const along = st.across === 'x' ? 'z' : 'x';
  const [l0, l1] = along === 'x' ? [st.box.x0, st.box.x1] : [st.box.z0, st.box.z1];
  const [c0, c1] = st.across === 'x' ? [st.box.x0, st.box.x1] : [st.box.z0, st.box.z1];
  const a = along === 'x' ? x : z; // along the strip
  const b = st.across === 'x' ? x : z; // across it
  const vec = (dAlong, dAcross) => (along === 'x' ? { dx: dAlong, dz: dAcross } : { dx: dAcross, dz: dAlong });
  const across = b > c0 && b < c1;
  if (!across) return null;
  if (a > l0 && a < l1) {
    // inside: the nearest open way out
    const ways = [[a - l0 + radius, vec(-(a - l0 + radius), 0)], [l1 - a + radius, vec(l1 - a + radius, 0)]];
    if (st.stairsSide && y > ON_TOP) {
      // up on the flight: back onto it
      ways.push(st.stairsSide === 'lo' ? [b - c0, vec(0, -(b - c0) - 0.01)] : [c1 - b, vec(0, c1 - b + 0.01)]);
    }
    return ways.sort((p, q) => p[0] - q[0])[0][1];
  }
  if (y > ON_TOP) return null;
  // on the floor, beyond an end but reaching into the strip: back from it
  if (a <= l0 && l0 - a < radius) return vec(-(radius - (l0 - a)), 0);
  if (a >= l1 && a - l1 < radius) return vec(radius - (a - l1), 0);
  return null;
}

/**
 * Where the body must go so it overlaps no solid item and no thin strip: { dx, dz } (the sum of the pushes), or null.
 * @param {{ items, strips }} blockers  floorBlockers of the floor you walk on
 * @param {{ x: number, z: number, y?: number, radius?: number }} at  y: the feet over that floor (on a flight: > 0)
 */
export function bodyPushOut(blockers, { x, z, y = 0, radius = BODY }) {
  let dx = 0;
  let dz = 0;
  for (const it of blockers?.items ?? []) {
    if (y >= it.top - 0.05) continue; // over it (flying, on a flight beside it)
    const far = Math.hypot(x - it.rect.x, z - it.rect.z) > Math.hypot(it.rect.hw, it.rect.hd) + radius;
    if (far) continue;
    const p = outOfRect(it.rect, x + dx, z + dz, radius);
    if (p) { dx += p.dx; dz += p.dz; }
  }
  for (const st of blockers?.strips ?? []) {
    const p = outOfStrip(st, x + dx, z + dz, y, radius);
    if (p) { dx += p.dx; dz += p.dz; }
  }
  return Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6 ? { dx, dz } : null;
}

/** The body's radius these pushes use (walkMap.BODY_RADIUS: a test checks they agree). */
export const PUSH_RADIUS = BODY;
