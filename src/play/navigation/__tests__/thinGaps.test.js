// v0.18.8: thin gaps (thinGaps.js), the body kept out of furniture (bodyPushOut), the strips blocked on the walk map,
// pockets nobody can walk out of (entrance.freePocket), out from under the stairs never into a wall
// (building.stairPushOut isOpen), and Check my layout's THIN_GAP line with its "Snap to wall" fix.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { thinGaps, floorBlockers, bodyPushOut, THIN_GAP, isSeatLike } from '../thinGaps';
import { buildWalkMap, BLOCKED, FREE, BODY_RADIUS } from '../walkMap';
import { freePocket } from '../entrance';
import { checkLayout, CHECK_KINDS } from '../checkLayout';
import { stairPushOut, stairRects } from '../../building';
import { stairBox } from '../../stairFit';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const catalog = ASSET_TYPES;
const T = 0.15;
const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const room = (id, floor, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor, x, z, width, depth, wallHeight: 3.2, wallThickness: T, doors: [], windows: [], ...more,
});
const item = (id, assetType, x, z, more = {}) => ({
  id, assetType, floor: 0, x, y: 0, z, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...more,
});
const rec = (arr) => Object.fromEntries(arr.map((o) => [o.id, o]));
// a 6 × 6 stair room (inner faces x −6.925 / −1.075, z −2.925 / 2.925) with the same room above, a door east
const INNER = { x0: -7 + T / 2, x1: -1 - T / 2, z0: -3 + T / 2, z1: 3 - T / 2 };
const stairRooms = [
  room('s0', 0, -4, 0, 6, 6, { doors: [{ wall: 'east', offset: 1.5, width: 1, height: 2.1 }] }),
  room('s1', 1, -4, 0, 6, 6, { doors: [{ wall: 'east', offset: 1.5, width: 1, height: 2.1 }] }),
];
/** Himan's case: an L (turns left, climbs north along the west wall) `gap` m off the west and north walls. */
const lStairs = (gap, more = {}) => item('L', 'STAIRCASE', INNER.x0 + gap + 1.6, INNER.z0 + gap + 1.6,
  { rotationY: Math.PI, metadata: { stairShape: 'L-left' }, ...more });
const layoutOf = (objects, rooms = stairRooms) => ({ floors, rooms: rec(rooms), objects: rec(objects) });
const box = (s) => stairBox(s);

describe('thinGaps', () => {
  it('the L 0.2 m off two walls: a strip along each wall, measured on its real 3.2 × 3.2 outline', () => {
    const gaps = thinGaps(layoutOf([lStairs(0.2)]), 0, { catalog });
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(gaps.every((g) => g.a.id === 'L' && g.b.kind === 'wall')).toBe(true);
    expect(gaps.every((g) => Math.abs(g.gap - 0.2) < 1e-6)).toBe(true);
    expect(new Set(gaps.map((g) => g.across))).toEqual(new Set(['x', 'z']));
  });

  it('flush (0) or wide enough (0.75 m and more): no strip; just under 0.75: a strip', () => {
    expect(thinGaps(layoutOf([lStairs(0)]), 0, { catalog })).toHaveLength(0);
    expect(thinGaps(layoutOf([lStairs(0.01)]), 0, { catalog })).toHaveLength(0); // touching
    expect(thinGaps(layoutOf([lStairs(THIN_GAP)]), 0, { catalog })).toHaveLength(0);
    expect(thinGaps(layoutOf([lStairs(0.8)]), 0, { catalog })).toHaveLength(0);
    expect(thinGaps(layoutOf([lStairs(0.7)]), 0, { catalog }).length).toBeGreaterThan(0);
  });

  it('a stair end is never a thin gap (stairFit says "no room to step on" there)', () => {
    // a straight flight (1.2 × 4), its bottom end 0.3 m off the south wall, far from the side walls
    const s = item('S', 'STAIRCASE', -4, 0, { rotationY: 0 });
    const b = box(s);
    const moved = { ...s, z: s.z + (INNER.z1 - 0.3 - b.z1) };
    const gaps = thinGaps(layoutOf([moved]), 0, { catalog });
    expect(gaps).toHaveLength(0);
  });

  it('a cabinet 0.3 m off a wall: a strip; between two cabinets 0.4 m apart: a strip; chairs never', () => {
    const cab = item('cab', 'FILING_CABINET', 0, 0);
    const w = catalog.FILING_CABINET.defaultWidth;
    const big = room('big', 0, 5, 0, 10, 10); // inner x 0.075 .. 9.925
    const atWall = { ...cab, x: big.x - 5 + T / 2 + 0.3 + w / 2, z: 0 };
    const g1 = thinGaps(layoutOf([atWall], [big]), 0, { catalog });
    expect(g1).toHaveLength(1);
    expect(g1[0].gap).toBeCloseTo(0.3, 6);
    expect(g1[0].b.kind).toBe('wall');
    const pair = [{ ...cab, id: 'c1', x: 4, z: 0 }, { ...cab, id: 'c2', x: 4 + w + 0.4, z: 0 }];
    const g2 = thinGaps(layoutOf(pair, [big]), 0, { catalog });
    expect(g2.map((g) => [g.a.id, g.b.id, +g.gap.toFixed(3)])).toEqual([['c1', 'c2', 0.4]]);
    // a meeting table's chairs, 0.2 m from it: no gaps at all
    const table = item('t', 'TABLE_MEETING', 5, 0);
    const chairs = [-1, 0, 1].map((k, i) => item(`ch${i}`, 'CHAIR_OFFICE', 5 + k, 1.0));
    expect(isSeatLike('CHAIR_OFFICE')).toBe(true);
    expect(thinGaps(layoutOf([table, ...chairs], [big]), 0, { catalog })).toHaveLength(0);
  });

  it('a strip with a door beside it is a way through, not a thin gap', () => {
    const big = room('big', 0, 5, 0, 10, 10, { doors: [{ wall: 'west', offset: 0, width: 1, height: 2.1 }] });
    const w = catalog.FILING_CABINET.defaultWidth;
    const cab = item('cab', 'FILING_CABINET', big.x - 5 + T / 2 + 0.3 + w / 2, 0);
    expect(thinGaps(layoutOf([cab], [big]), 0, { catalog })).toHaveLength(0);
  });

  it('turned at an angle (30°): no strip (its sides face no wall)', () => {
    expect(thinGaps(layoutOf([lStairs(0.2, { rotationY: Math.PI + Math.PI / 6 })]), 0, { catalog })).toHaveLength(0);
  });

  it('the same body as the walk map', () => {
    expect(BODY_RADIUS).toBe(0.32);
  });
});

describe('bodyPushOut: the body never inside a solid item as drawn (scaled, turned)', () => {
  const big = room('big', 0, 5, 0, 20, 20);
  it('a stretched + turned meeting table (1.5 × 1.2, 90°): 1.68 m along X, 4.8 m along Z', () => {
    const t = item('t', 'TABLE_MEETING', 8.5, 0, { rotationY: Math.PI / 2, scaleX: 1.5, scaleZ: 1.2 });
    const bl = floorBlockers(layoutOf([t], [big]), 0, { catalog });
    // 0.1 m into its east side: pushed east by 0.22 (to touching)
    const out = bodyPushOut(bl, { x: 8.5 + 0.84 + 0.22, z: 0, y: 0, radius: 0.32 });
    expect(out.dx).toBeCloseTo(0.1, 2);
    expect(Math.abs(out.dz)).toBeLessThan(1e-6);
    // beside its long side 2 m from the middle (inside the 4.8 m length): still pushed
    expect(bodyPushOut(bl, { x: 8.5 + 0.84 + 0.2, z: 2.0, y: 0, radius: 0.32 })).not.toBeNull();
    // past its end (z 2.4 + 0.32): free
    expect(bodyPushOut(bl, { x: 8.5, z: 2.4 + 0.33, y: 0, radius: 0.32 })).toBeNull();
    // standing on top of it (feet over its top): nothing
    expect(bodyPushOut(bl, { x: 8.5, z: 0, y: 1.0, radius: 0.32 })).toBeNull();
  });

  it('inside a table (put there): out by the nearest side, all the way', () => {
    const t = item('t', 'TABLE_MEETING', 0, 0);
    const bl = floorBlockers(layoutOf([t], [big]), 0, { catalog });
    const out = bodyPushOut(bl, { x: 0.3, z: 0.5, y: 0, radius: 0.32 });
    expect(out.dz).toBeGreaterThan(0); // the +Z side is nearest (0.2 m to it)
    expect(0.5 + out.dz).toBeGreaterThanOrEqual(0.7 + 0.32 - 0.01);
  });

  it('chairs block too (walk past, not through)', () => {
    const c = item('c', 'CHAIR_OFFICE', 0, 0);
    const bl = floorBlockers(layoutOf([c], [big]), 0, { catalog });
    expect(bodyPushOut(bl, { x: 0.35, z: 0, y: 0, radius: 0.32 })).not.toBeNull();
  });

  it('in a thin strip beside the L: out of it (never further in)', () => {
    const L = lStairs(0.2);
    const bl = floorBlockers(layoutOf([L]), 0, { catalog });
    expect(bl.strips.length).toBeGreaterThan(0);
    // in the west strip, beside the first flight
    const at = { x: INNER.x0 + 0.1, z: 0, y: 0, radius: 0.32 };
    let p = { x: at.x, z: at.z };
    for (let i = 0; i < 40; i++) {
      const out = bodyPushOut(bl, { ...at, ...p });
      if (!out) break;
      p = { x: p.x + out.dx, z: p.z + out.dz };
    }
    expect(bodyPushOut(bl, { ...at, ...p })).toBeNull();
    const inWestStrip = p.x < INNER.x0 + 0.2 && p.z > INNER.z0 && p.z < L.z + 1.6;
    expect(inWestStrip).toBe(false);
  });
});

describe('the walk map: thin strips blocked, a seat at a table still reachable', () => {
  it('the cells of a 0.4 m strip beside the L are BLOCKED (a body would fit, nobody should go in)', () => {
    const map = buildWalkMap(layoutOf([lStairs(0.4)]), 0, { catalog });
    expect(map.at(INNER.x0 + 0.2, 0)).toBe(BLOCKED);
    expect(map.at(-2.5, 1.5)).toBe(FREE); // the open floor of the room
  });

  it('behind a chair at a meeting table there is free floor (click-to-walk reaches the seat)', () => {
    const big = room('big', 0, 5, 0, 12, 8);
    const t = item('t', 'TABLE_MEETING', 5, 0);
    const chairs = [-1, 0, 1].map((k, i) => item(`ch${i}`, 'CHAIR_OFFICE', 5 + k, 1.0, { rotationY: Math.PI }));
    const map = buildWalkMap(layoutOf([t, ...chairs], [big]), 0, { catalog });
    expect(map.at(5, 1.0 + 0.3 + 0.4)).toBe(FREE);
  });
});

describe('freePocket: a patch of floor closed in by items', () => {
  const hall = room('hall', 0, 5, 0, 12, 8);
  const ring = [
    item('N', 'DESK_STANDARD', 6, -0.9), item('S', 'DESK_STANDARD', 6, 0.9),
    item('W', 'DESK_STANDARD', 4.9, 0, { rotationY: Math.PI / 2 }), item('E', 'DESK_STANDARD', 7.1, 0, { rotationY: Math.PI / 2 }),
  ];
  it('inside four desks: a pocket; on the hall floor: none', () => {
    const map = buildWalkMap(layoutOf(ring, [hall]), 0, { catalog });
    expect(map.at(6, 0)).toBe(FREE);
    const pocket = freePocket(map, 6, 0);
    expect(pocket).not.toBeNull();
    expect(pocket.size * map.cell * map.cell).toBeLessThan(1);
    expect(freePocket(map, 2, 2.5)).toBeNull();
    expect(freePocket(map, 6, -0.9)).toBeNull(); // not FREE (a desk)
  });
  it('one desk out of the ring: no pocket', () => {
    const map = buildWalkMap(layoutOf(ring.slice(0, 3), [hall]), 0, { catalog });
    expect(freePocket(map, 6, 0)).toBeNull();
  });
});

describe('under the stairs: out by a side with free floor, never into the wall', () => {
  it('a straight flight 0.1 m off a wall, the body under it near the wall side: out by the open side', () => {
    const s = item('S', 'STAIRCASE', INNER.x0 + 0.1 + 0.6, 0, { rotationY: 0 });
    const L = layoutOf([s]);
    const map = buildWalkMap(L, 0, { catalog });
    const rooms = Object.values(L.rooms);
    const r = stairRects(s)[0];
    // under its high end (headroom lower than the body), 0.15 m from its wall side
    const at = { x: INNER.x0 + 0.1 + 0.15, z: r.z + 1.2 };
    const open = (px, pz) => map.at(px, pz) === FREE;
    const out = stairPushOut({ ...at, y: 0, floors, rooms, stairs: [s], isOpen: open });
    expect(out).not.toBeNull();
    expect(out.dx).toBeGreaterThan(0); // away from the west wall, though that side is nearer
    expect(at.x + out.dx).toBeGreaterThanOrEqual(r.x + r.hw + 0.32 - 0.01); // all the way out of the flight's side
  });
});

describe('Check my layout: THIN_GAP', () => {
  const kinds = (problems) => problems.filter((p) => p.kind === CHECK_KINDS.THIN_GAP);
  it('the L 0.2 m off two walls: one warning, the exact words, Fix it = Snap to wall (flush in the corner)', () => {
    const L = lStairs(0.2);
    const { problems } = checkLayout(layoutOf([L]), { catalog });
    const thin = kinds(problems);
    expect(thin).toHaveLength(1);
    expect(thin[0].severity).toBe('warning');
    expect(thin[0].blocksWalking).toBeFalsy();
    expect(thin[0].message).toBe('Thin gap next to Stairs - people can get stuck. Push it to the wall or leave at least 0.75 m.');
    expect(thin[0].key).toBe(`${CHECK_KINDS.THIN_GAP}:L`);
    expect(thin[0].fix.label).toBe('Snap to wall');
    const [[id, patch]] = thin[0].fix.moves;
    expect(id).toBe('L');
    const moved = { ...L, ...patch };
    const b = box(moved);
    expect(b.x0).toBeCloseTo(INNER.x0, 6);
    expect(b.z0).toBeCloseTo(INNER.z0, 6);
    // after the fix: no thin gap left
    expect(kinds(checkLayout(layoutOf([moved]), { catalog }).problems)).toHaveLength(0);
  });

  it('a named staircase is called by its name; locked: the warning, no fix', () => {
    const p = kinds(checkLayout(layoutOf([lStairs(0.3, { label: 'Main stairs', isLocked: true })]), { catalog }).problems)[0];
    expect(p.message.startsWith('Thin gap next to Main stairs - ')).toBe(true);
    expect(p.fix).toBeUndefined();
  });

  it('a filing cabinet 0.3 m off a wall, desks 0.4 m apart: no Check line (a choice; walking keeps people out)', () => {
    const big = room('big', 0, 5, 0, 10, 10);
    const w = catalog.FILING_CABINET.defaultWidth;
    const cab = item('cab', 'FILING_CABINET', big.x - 5 + T / 2 + 0.3 + w / 2, 2);
    const desks = [item('d1', 'DESK_STANDARD', 5, 0), item('d2', 'DESK_STANDARD', 5, 1.2)];
    expect(kinds(checkLayout(layoutOf([cab, ...desks], [big]), { catalog }).problems)).toHaveLength(0);
    expect(thinGaps(layoutOf([cab, ...desks], [big]), 0, { catalog }).length).toBeGreaterThan(0); // walking still blocks them
  });

  it('stairs next to a cabinet (a 0.3 m strip between them): the warning, about the stairs, no wall to snap to', () => {
    const big = room('big', 0, 5, 0, 12, 12, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] });
    const up = room('up', 1, 5, 0, 12, 12);
    const s = item('S', 'STAIRCASE', 5, 0, { rotationY: 0 });
    const b = box(s);
    const w = catalog.FILING_CABINET.defaultWidth;
    const cab = item('cab', 'FILING_CABINET', b.x1 + 0.3 + w / 2, s.z);
    const p = kinds(checkLayout(layoutOf([s, cab], [big, up]), { catalog }).problems);
    expect(p).toHaveLength(1);
    expect(p[0].objectId).toBe('S');
    expect(p[0].others).toEqual(['cab']);
    expect(p[0].fix).toBeUndefined();
  });

  it('chairs around a meeting table: no thin-gap warning', () => {
    const big = room('big', 0, 5, 0, 12, 8);
    const t = item('t', 'TABLE_MEETING', 5, 0);
    const chairs = [
      ...[-1, 0, 1].map((k, i) => item(`n${i}`, 'CHAIR_OFFICE', 5 + k, -1.0)),
      ...[-1, 0, 1].map((k, i) => item(`s${i}`, 'CHAIR_OFFICE', 5 + k, 1.0, { rotationY: Math.PI })),
      item('w', 'CHAIR_OFFICE', 3.05, 0, { rotationY: Math.PI / 2 }), item('e', 'CHAIR_OFFICE', 6.95, 0, { rotationY: -Math.PI / 2 }),
    ];
    expect(kinds(checkLayout(layoutOf([t, ...chairs], [big]), { catalog }).problems)).toHaveLength(0);
  });

  it('flush against the walls, or 0.75 m off them: nothing to say', () => {
    expect(kinds(checkLayout(layoutOf([lStairs(0)]), { catalog }).problems)).toHaveLength(0);
    expect(kinds(checkLayout(layoutOf([lStairs(0.75)]), { catalog }).problems)).toHaveLength(0);
  });
});

// The real file (private-docs, Himan's laptop only): read here at run time, never copied into the repo
const REAL = 'private-docs/rusborn-2026-11-15.json';
describe.skipIf(!fs.existsSync(REAL))('the real Rusborn layout (private-docs, read at run time)', () => {
  const load = () => {
    const { layout } = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
    return { floors: layout.floors, rooms: rec(list(layout.rooms)), objects: rec(list(layout.objects)) };
  };
  const check = (layout) => checkLayout(layout, { catalog }).problems.filter((p) => p.kind === CHECK_KINDS.THIN_GAP);
  const seat = (layout, id) => isSeatLike(layout.objects[id]?.assetType);

  it('no thin-gap line about a chair; every line in the exact words; a fix leaves no thin gap for that item', () => {
    const layout = load();
    const thin = check(layout);
    for (const p of thin) {
      expect(seat(layout, p.objectId)).toBe(false);
      expect(p.message).toMatch(/^Thin gap next to .+ - people can get stuck\. Push it to the wall or leave at least 0\.75 m\.$/);
      if (!p.fix) continue;
      const fixed = { ...layout, objects: { ...layout.objects } };
      for (const [id, patch] of p.fix.moves) fixed.objects[id] = { ...fixed.objects[id], ...patch };
      // the wall strip is gone (a strip between two items is not a wall's to close)
      expect(thinGaps(fixed, p.floorId, { catalog }).some((g) => g.a.id === p.objectId && g.b.kind === 'wall')).toBe(false);
    }
  });

  it('its stairs as an L (as on the live site; in memory only): any thin gap beside them snaps flush', () => {
    const layout = load();
    const stair = Object.values(layout.objects).find((o) => o.assetType === 'STAIRCASE');
    expect(stair).toBeTruthy();
    const asL = { ...layout, objects: { ...layout.objects, [stair.id]: { ...stair, metadata: { ...stair.metadata, stairShape: 'L-left' } } } };
    const p = check(asL).find((q) => q.objectId === stair.id);
    if (p?.fix) {
      const fixed = { ...asL, objects: { ...asL.objects } };
      for (const [id, patch] of p.fix.moves) fixed.objects[id] = { ...fixed.objects[id], ...patch };
      expect(check(fixed).some((q) => q.objectId === stair.id)).toBe(false);
    }
  });

  it('the walk map of each floor: no chair is ever in a strip, and the file is not changed', () => {
    const before = fs.readFileSync(REAL, 'utf8');
    const layout = load();
    for (const f of Object.values(layout.floors)) {
      const bl = floorBlockers(layout, f.id, { catalog });
      expect(Array.isArray(bl.items)).toBe(true);
      for (const g of thinGaps(layout, f.id, { catalog })) {
        expect(seat(layout, g.a.id)).toBe(false);
        if (g.b.id) expect(seat(layout, g.b.id)).toBe(false);
      }
    }
    expect(fs.readFileSync(REAL, 'utf8')).toBe(before);
  });
});
