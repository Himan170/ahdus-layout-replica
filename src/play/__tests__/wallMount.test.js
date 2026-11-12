import { describe, it, expect } from 'vitest';
import {
  wallPieces, mountOnWall, isOnWall, hangsOnWall, isWallItem, WALL_ITEMS, MOUNT_GAP, EXIT_GAP, TOP_GAP,
} from '../wallMount';

// sizes as assetCatalog has them (width × height × depth, m)
const CATALOG = {
  TV_DISPLAY: { defaultWidth: 1.6, defaultHeight: 0.95, defaultDepth: 0.08 },
  WHITEBOARD: { defaultWidth: 2.0, defaultHeight: 1.2, defaultDepth: 0.06 },
  EMERGENCY_EXIT: { defaultWidth: 0.6, defaultHeight: 0.25, defaultDepth: 0.08 },
  AC_UNIT: { defaultWidth: 0.9, defaultHeight: 0.3, defaultDepth: 0.22 },
  WALL_CLOCK: { defaultWidth: 0.35, defaultHeight: 0.35, defaultDepth: 0.05 },
};
const opts = { catalog: CATALOG };

/** A 6 × 4 m office: a door in its south wall (x −0.6 … 0.6, 2.1 m), a window in the north one (x 0.3 … 1.7). */
const office = (extra = {}) => ({
  id: 'room_a', name: 'Office', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }],
  windows: [{ wall: 'north', offset: 1, width: 1.4, height: 1.2, sill: 0.9 }],
  ...extra,
});
const span = (m, w) => [m.x - w / 2, m.x + w / 2];
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

describe('wall items (v0.15.6)', () => {
  it('the list: the five old types and the three new ones; a hung one is no floor obstacle', () => {
    for (const t of ['WHITEBOARD', 'TV_DISPLAY', 'PROJECTOR_SCREEN', 'EMERGENCY_EXIT', 'FIRE_EXTINGUISHER', 'WALL_CLOCK', 'WALL_SHELF', 'AC_UNIT']) {
      expect(isWallItem(t)).toBe(true);
    }
    expect(isWallItem('DESK_STANDARD')).toBe(false);
    expect(hangsOnWall({ assetType: 'TV_DISPLAY', y: 0.9 })).toBe(true);
    expect(hangsOnWall({ assetType: 'TV_DISPLAY', y: 0 })).toBe(false); // standing on the floor
    expect(hangsOnWall({ assetType: 'DESK_STANDARD', y: 1 })).toBe(false);
  });

  it('a TV goes onto the nearest wall: back against it, facing into the room, at its height', () => {
    const pieces = wallPieces([office()]);
    const m = mountOnWall({ assetType: 'TV_DISPLAY' }, { x: -1, z: 1.5 }, pieces, opts);
    const face = 2 - 0.15 / 2;
    expect(m.x).toBeCloseTo(-1);
    expect(m.z).toBeCloseTo(face - 0.04 - MOUNT_GAP);
    expect(Math.cos(m.rotationY)).toBeCloseTo(-1); // its +Z (front) turned to −Z: into the room
    expect(m.y).toBeCloseTo(WALL_ITEMS.TV_DISPLAY.centre - 0.95 / 2);
  });

  it('it slides along the wall but never across a window or a door', () => {
    const pieces = wallPieces([office()]);
    const m = mountOnWall({ assetType: 'TV_DISPLAY' }, { x: 0.8, z: 1.5 }, pieces, opts);
    const [a, b] = span(m, 1.6);
    expect(b <= 0.3 + 1e-6 || a >= 1.7 - 1e-6).toBe(true);
    expect(m.z).toBeGreaterThan(1.8); // still the north wall (the stretch past the window is too short)
    const board = mountOnWall({ assetType: 'WHITEBOARD' }, { x: 0, z: -1.5 }, pieces, opts);
    const [c, d] = span(board, 2);
    expect(d <= -0.6 + 1e-6 || c >= 0.6 - 1e-6).toBe(true);
    expect(board.z).toBeLessThan(-1.8); // the south wall, beside its door
  });

  it('never into a corner: the side walls are not in its way', () => {
    const pieces = wallPieces([office()]);
    const m = mountOnWall({ assetType: 'TV_DISPLAY' }, { x: -2.5, z: 1.7 }, pieces, opts);
    expect(m.z).toBeGreaterThan(1.8); // the north wall
    expect(span(m, 1.6)[0]).toBeGreaterThanOrEqual(-3 + 0.075 - 1e-6); // the west wall's inside face
  });

  it('an exit sign goes above the door, EXIT_GAP over its top (a taller door: higher)', () => {
    let pieces = wallPieces([office()]);
    let m = mountOnWall({ assetType: 'EMERGENCY_EXIT' }, { x: 0.2, z: -1.6 }, pieces, opts);
    expect(m.x).toBeCloseTo(0.2);
    expect(m.y).toBeCloseTo(2.2);
    expect(Math.cos(m.rotationY)).toBeCloseTo(1); // the south wall: facing +Z, into the room
    pieces = wallPieces([office({ doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.3 }] })]);
    m = mountOnWall({ assetType: 'EMERGENCY_EXIT' }, { x: 0, z: -1.6 }, pieces, opts);
    expect(m.y).toBeCloseTo(2.3 + EXIT_GAP);
  });

  it('below the top of a low wall', () => {
    const pieces = wallPieces([office({ wallHeight: 2.3 })]);
    const m = mountOnWall({ assetType: 'AC_UNIT' }, { x: -1.5, z: 1.5 }, pieces, opts);
    expect(m.y + 0.3).toBeCloseTo(2.3 - TOP_GAP);
  });

  it('a shared wall: each room hangs it on its own side', () => {
    const a = office({ doors: [], windows: [] });
    const b = office({ id: 'room_b', z: 4.15, doors: [], windows: [] });
    const pieces = wallPieces([a, b]);
    const inA = mountOnWall({ assetType: 'WALL_CLOCK' }, { x: 0, z: 1.5 }, pieces, opts);
    const inB = mountOnWall({ assetType: 'WALL_CLOCK' }, { x: 0, z: 2.6 }, pieces, opts);
    expect(inA.z).toBeCloseTo(2 - 0.025 - MOUNT_GAP);
    expect(inB.z).toBeCloseTo(2.15 + 0.025 + MOUNT_GAP);
    expect(Math.cos(inA.rotationY)).toBeCloseTo(-1);
    expect(Math.cos(inB.rotationY)).toBeCloseTo(1);
  });

  it('a wall drawn with the Wall tool, at an angle: facing away from it', () => {
    const r = Math.PI / 4;
    const wall = { id: 'w', assetType: 'WALL_SEGMENT', x: 0, y: 0, z: 0, rotationY: r, scaleX: 2, scaleY: 1, scaleZ: 1 };
    const pieces = wallPieces([], [wall]);
    const m = mountOnWall({ assetType: 'TV_DISPLAY' }, { x: 1, z: 1 }, pieces, opts);
    expect(m).not.toBeNull();
    // the TV's front points away from the wall line, towards the point
    const fx = Math.sin(m.rotationY);
    const fz = Math.cos(m.rotationY);
    expect(fx * 1 + fz * 1).toBeGreaterThan(1.3);
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(0.1 + 0.04 + MOUNT_GAP, 2);
  });

  it('outside: on the outer face; nothing near: null', () => {
    const pieces = wallPieces([office()]);
    const m = mountOnWall({ assetType: 'WALL_CLOCK' }, { x: -2, z: -3 }, pieces, opts);
    expect(m.z).toBeLessThan(-2.075);
    expect(Math.cos(m.rotationY)).toBeCloseTo(-1);
    expect(mountOnWall({ assetType: 'WALL_CLOCK' }, { x: 40, z: 40 }, pieces, opts)).toBeNull();
    expect(mountOnWall({ assetType: 'DESK_STANDARD' }, { x: 0, z: 0 }, pieces, opts)).toBeNull();
  });

  it('isOnWall: where mountOnWall put it; not on the floor, not off the wall, not across a door', () => {
    const pieces = wallPieces([office()]);
    const m = mountOnWall({ assetType: 'TV_DISPLAY' }, { x: -1, z: 1.5 }, pieces, opts);
    const tv = { assetType: 'TV_DISPLAY', x: m.x, y: m.y, z: m.z, rotationY: m.rotationY };
    expect(isOnWall(tv, pieces, opts)).toBe(true);
    expect(isOnWall({ ...tv, y: 0 }, pieces, opts)).toBe(false);
    expect(isOnWall({ ...tv, z: tv.z - 0.3 }, pieces, opts)).toBe(false);
    expect(isOnWall({ ...tv, rotationY: 0 }, pieces, opts)).toBe(false); // facing the wall
    const door = { assetType: 'TV_DISPLAY', x: 0, y: 0.9, z: -2 + 0.075 + 0.045, rotationY: 0 };
    expect(isOnWall(door, pieces, opts)).toBe(false);
    const sign = mountOnWall({ assetType: 'EMERGENCY_EXIT' }, { x: 0, z: -1.6 }, pieces, opts);
    expect(isOnWall({ assetType: 'EMERGENCY_EXIT', ...sign }, pieces, opts)).toBe(true); // above the door
  });

  it('a bigger item keeps its size against the wall', () => {
    const pieces = wallPieces([office()]);
    const m = mountOnWall({ assetType: 'TV_DISPLAY', scaleX: 1.5, scaleY: 1.5, scaleZ: 1 }, { x: -1, z: 1.5 }, pieces, opts);
    expect(span(m, 2.4)[0]).toBeGreaterThanOrEqual(-2.925 - 1e-6);
    expect(near(m.y, WALL_ITEMS.TV_DISPLAY.centre - (0.95 * 1.5) / 2)).toBe(true);
  });
});

describe('wall items in the rest of the app (v0.15.6)', async () => {
  const { isSolidItem } = await import('../navigation/walkMap');
  const { checkLayout, CHECK_KINDS } = await import('../navigation/checkLayout');
  const { planDrop } = await import('../../floorplan/planMath');
  const { createFloorWalls } = await import('../floorWalls');
  const { ASSET_TYPES } = await import('../../utils/assetCatalog');
  const catalog = { catalog: ASSET_TYPES };
  const room = office({ doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [] });
  const hung = () => {
    const m = mountOnWall({ assetType: 'TV_DISPLAY' }, { x: -1, z: 1.5 }, wallPieces([room]), catalog);
    return { id: 'tv', assetType: 'TV_DISPLAY', floor: 0, x: m.x, y: m.y, z: m.z, rotationY: m.rotationY };
  };

  it('the walk map: a hung TV is no obstacle; one standing on the floor still is', () => {
    expect(isSolidItem(hung(), ASSET_TYPES)).toBe(false);
    expect(isSolidItem({ ...hung(), y: 0 }, ASSET_TYPES)).toBe(true);
  });

  it('Check my layout: a warning for a wall item off its wall, none on it; an exit sign over a door blocks nothing', () => {
    const sign = mountOnWall({ assetType: 'EMERGENCY_EXIT' }, { x: 0, z: -1.6 }, wallPieces([room]), catalog);
    const exit = { id: 'exit', assetType: 'EMERGENCY_EXIT', floor: 0, ...sign };
    const run = (objects) => checkLayout({ rooms: [room], objects, floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } } }, catalog)
      .problems.filter((p) => p.kind === CHECK_KINDS.WALL_ITEM_OFF_WALL || p.kind === CHECK_KINDS.DOOR_BLOCKED);
    expect(run([hung(), exit])).toEqual([]);
    const off = run([{ ...hung(), y: 0, z: 0 }]);
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ kind: CHECK_KINDS.WALL_ITEM_OFF_WALL, severity: 'warning', objectId: 'tv' });
    expect(off[0].message).toBe('Large Display TV is not on a wall: select it, then Mount on wall');
  });

  it("Plan view: a dragged TV goes onto the wall, turned to face the room; far from walls it stands on the floor", () => {
    const tv = { id: 'tv', assetType: 'TV_DISPLAY', floor: 0, x: 0, y: 0, z: 0, rotationY: 0 };
    const to = planDrop(tv, { x: 1, z: 1.6 }, { rooms: [room], objects: [tv] });
    expect(to.z).toBeGreaterThan(1.8);
    expect(Math.cos(to.rotationY)).toBeCloseTo(-1);
    expect(to.y).toBeGreaterThan(0.5);
    const big = office({ width: 20, depth: 20, doors: [], windows: [] });
    const mid = planDrop(tv, { x: 0, z: 0 }, { rooms: [big], objects: [tv] });
    expect(mid).toMatchObject({ x: 0, z: 0 }); // as any item: on the floor (its floor height), not turned
    expect(mid.y).toBeLessThan(0.1);
    expect(mid.rotationY).toBeUndefined();
  });

  it('the walls of a floor are made again only when the rooms or the items change', () => {
    const walls = createFloorWalls();
    const state = { rooms: { a: room }, objects: {} };
    const first = walls(state, 0);
    expect(walls(state, 0)).toBe(first);
    expect(walls({ ...state, rooms: { a: { ...room, width: 8 } } }, 0)).not.toBe(first);
    expect(walls(state, 1)).toEqual([]);
  });
});
