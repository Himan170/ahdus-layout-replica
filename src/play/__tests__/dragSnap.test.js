import { describe, it, expect } from 'vitest';
import { snapTargets, snapDrag, snapText, itemBox, SNAP_TOLERANCE } from '../dragSnap';
import { wallPieces } from '../wallMount';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { meridianLike } from '../navigation/__tests__/meridianLike';

const catalog = ASSET_TYPES;
// a 10 × 8 m room around (0, 0): its inside faces at x ±4.925, z ±3.925
const room = { id: 'r', floor: 0, x: 0, z: 0, width: 10, depth: 8, wallHeight: 3, wallThickness: 0.15, doors: [], windows: [] };
const desk = (id, x, z, rotationY = 0) => ({ id, assetType: 'DESK_STANDARD', floor: 0, x, y: 0, z, rotationY, scaleX: 1, scaleY: 1, scaleZ: 1 });
const half = (o) => { const b = itemBox(o, catalog); return { w: (b.x1 - b.x0) / 2, d: (b.z1 - b.z0) / 2 }; };

describe('snapping while dragging (v0.15.6)', () => {
  it('against a wall: its side on the wall face, with a guide line along the wall', () => {
    const moving = desk('m', 0, 0);
    const t = snapTargets([moving], wallPieces([room]), { catalog, ignore: ['m'] });
    const { w } = half(moving);
    const s = snapDrag(moving, { x: -4.925 + w + 0.1, z: 0.33 }, t);
    expect(s.x).toBeCloseTo(-4.925 + w, 3);
    expect(s.snapped.x).toBe('wall');
    expect(s.guides).toEqual([expect.objectContaining({ ax: -4.925, bx: -4.925, kind: 'wall' })]);
    expect(snapText(s.snapped)).toBe('Against the wall');
    expect(s.z).toBeCloseTo(0.35, 6); // the other axis: the grid (5 cm)
  });

  it('never onto the outer face from inside, nor further than the tolerance', () => {
    const moving = desk('m', 0, 0);
    const t = snapTargets([], wallPieces([room]), { catalog });
    const { w } = half(moving);
    const far = snapDrag(moving, { x: -4.925 + w + SNAP_TOLERANCE + 0.05, z: 0 }, t, { grid: 0.5 });
    expect(far.snapped.x).toBeNull();
    expect(Math.abs(far.x / 0.5 - Math.round(far.x / 0.5))).toBeLessThan(1e-6); // on the grid instead
    expect(t.walls.some((x) => x.axis === 'x' && Math.abs(x.at + 5.075) < 1e-6 && x.side === -1)).toBe(true); // the outer face exists
  });

  it('to another item: edge to edge, or middle to middle', () => {
    const other = desk('o', 1, 2);
    const moving = desk('m', 0, 0);
    const t = snapTargets([other, moving], [], { catalog, ignore: ['m'] });
    const ob = itemBox(other, catalog);
    const { w } = half(moving);
    // its left edge 0.08 m right of the other's left edge
    const e = snapDrag(moving, { x: ob.x0 + w + 0.08, z: 0 }, t);
    expect(e.x).toBeCloseTo(ob.x0 + w, 3);
    expect(e.snapped.x).toBe('edge');
    expect(e.guides[0]).toMatchObject({ ax: ob.x0, kind: 'edge' });
    // the guide runs from one to the other
    expect(Math.min(e.guides[0].az, e.guides[0].bz)).toBeLessThanOrEqual(itemBox({ ...moving, x: e.x }, catalog).z0 + 1e-6);
    expect(Math.max(e.guides[0].az, e.guides[0].bz)).toBeCloseTo(ob.z1, 6);
    // its middle level with the other's (a narrower item: no edge is as near)
    const plant = { id: 'p', assetType: 'PLANT_LARGE', floor: 0, x: 0, y: 0, z: 0, rotationY: 0 };
    const c = snapDrag(plant, { x: 1.06, z: -1 }, t);
    expect(c.x).toBeCloseTo(1, 6);
    expect(c.snapped.x).toBe('centre');
    expect(snapText(c.snapped)).toBe('Centred on an item');
  });

  it('a turned item uses its turned outline', () => {
    const moving = desk('m', 0, 0, Math.PI / 2);
    const t = snapTargets([], wallPieces([room]), { catalog });
    const { w, d } = half(moving);
    expect(w).toBeLessThan(d); // turned: narrow along X
    const s = snapDrag(moving, { x: 4.925 - w - 0.05, z: 0 }, t);
    expect(s.x).toBeCloseTo(4.925 - w, 3);
  });

  it('Alt: no snapping at all, not even the grid', () => {
    const t = snapTargets([], wallPieces([room]), { catalog });
    const { w } = half(desk('m', 0, 0));
    const s = snapDrag(desk('m', 0, 0), { x: -4.925 + w + 0.033, z: 0.123 }, t, { grid: 0.5, free: true });
    expect(s).toEqual({ x: Math.round((-4.925 + w + 0.033) * 100) / 100, z: 0.12, guides: [], snapped: { x: null, z: null } });
  });

  it('nothing near: the grid step', () => {
    const t = snapTargets([], [], { catalog });
    expect(snapDrag(desk('m', 0, 0), { x: 1.3, z: 2.2 }, t, { grid: 0.5 })).toMatchObject({ x: 1.5, z: 2, guides: [] });
  });

  it('Meridian: the targets of a floor and a drag across it stay fast', () => {
    const layout = meridianLike();
    const objects = layout.objects.filter((o) => (o.floor ?? 0) === 1);
    const rooms = layout.rooms.filter((r) => (r.floor ?? 0) === 1);
    expect(objects.length).toBeGreaterThan(200);
    const moving = objects.find((o) => o.assetType.startsWith('DESK'));
    let t0 = performance.now();
    const t = snapTargets(objects, wallPieces(rooms, objects), { catalog, ignore: [moving.id] });
    const build = performance.now() - t0;
    t0 = performance.now();
    for (let i = 0; i < 200; i++) snapDrag(moving, { x: moving.x + i * 0.05, z: moving.z + i * 0.03 }, t, { grid: 0.5 });
    const perMove = (performance.now() - t0) / 200;
    expect(build).toBeLessThan(200); // ~10 ms on a laptop
    expect(perMove).toBeLessThan(4); // ~0.1 ms: far under a frame
  });
});

describe('snapping: a wall in reach wins', () => {
  it('over a nearer item edge (a desk in the next room)', () => {
    const moving = desk('m', 0, 0);
    const { w } = half(moving);
    // another desk whose left edge is 0.05 m nearer than the wall
    const other = desk('o', -4.925 + 0.03 + w, -3);
    const t = snapTargets([moving, other], wallPieces([room]), { catalog, ignore: ['m'] });
    const s = snapDrag(moving, { x: -4.925 + w + 0.08, z: 0 }, t);
    expect(s.snapped.x).toBe('wall');
    expect(s.x).toBeCloseTo(-4.925 + w, 3);
  });
});
