import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

vi.mock('./materialLibrary', () => ({
  TILE_SIZE: { wood: 1, carpet: 1, tile: 1, smallTile: 1, concrete: 1, raised: 1 },
  FLOOR_BY_ROOM_TYPE: {},
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
}));

const { buildRoomMesh, setRoomSelected, roomGeometryKey } = await import('./roomBuilder');
const { roomsToRebuild } = await import('../play/geometry');
const { wallTargetOf } = await import('./pickHelpers');

let scene;
afterEach(() => {
  scene?.dispose();
  scene = null;
});

function build(room, rooms = [room], options = {}) {
  scene = new Scene(new NullEngine());
  return buildRoomMesh(room, scene, { rooms, ...options });
}

function wallMeshes(root, wallName) {
  return root.getChildMeshes(false).filter((mesh) =>
    mesh.name.startsWith('wall_') &&
    mesh.metadata?.part === 'wall' && mesh.metadata.wallName === wallName);
}

// The pieces of one wall (or one door / window frame) are merged into one mesh
// with their positions baked in, so measure world bounds and cast rays.
const bounds = (mesh) => mesh.getBoundingInfo().boundingBox;
const size = (mesh, axis) => bounds(mesh).maximumWorld[axis] - bounds(mesh).minimumWorld[axis];
const centre = (mesh) => bounds(mesh).centerWorld;
/** Where a ray going +X from x = 2 at (y, z) first hits `mesh`, or null. */
function hitX(mesh, y, z) {
  const hit = new Ray(new Vector3(2, y, z), new Vector3(1, 0, 0), 10).intersectsMesh(mesh);
  return hit.hit ? hit.pickedPoint.x : null;
}

describe('roomBuilder shared-wall meshes', () => {
  const west = { id: 'a', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3, doors: [], windows: [] };
  const east = { id: 'b', floor: 0, x: 5.15, z: 0, width: 4, depth: 4, wallHeight: 3.5, doors: [], windows: [] };

  it('builds one 0.15 m physical wall at the shared boundary', () => {
    const westRoot = build(west, [west, east]);
    const eastRoot = buildRoomMesh(east, scene, { rooms: [west, east] });
    const shared = wallMeshes(westRoot, 'east');

    expect(shared).toHaveLength(1);
    expect(centre(shared[0]).x).toBeCloseTo(3.075);
    expect(size(shared[0], 'x')).toBeCloseTo(0.15);
    expect(size(shared[0], 'z')).toBeCloseTo(3.85);
    expect(size(shared[0], 'y')).toBeCloseTo(3.5);
    expect(wallMeshes(eastRoot, 'west')).toHaveLength(0);
  });

  describe('nested room floor and ceiling geometry', () => {
    // The floor / ceiling pieces around a hole are merged into one mesh (the
    // ceiling with its light panels): add up its flat triangles at height `y`
    // facing `facing` (+1 up, -1 down) instead of the pieces' boxes.
    const flatArea = (mesh, y, facing) => {
      const pos = mesh.getVerticesData('position');
      const nor = mesh.getVerticesData('normal');
      const idx = mesh.getIndices();
      let sum = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const tri = [idx[t], idx[t + 1], idx[t + 2]];
        if (!tri.every((i) => Math.abs(pos[i * 3 + 1] - y) < 1e-4 && nor[i * 3 + 1] * facing > 0.5)) continue;
        const [a, b, c] = tri.map((i) => [pos[i * 3], pos[i * 3 + 2]]);
        sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      }
      return sum;
    };
    const down = (mesh, x, z) => new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0), 20).intersectsMesh(mesh).hit;

    it('cuts contained-room floor and coplanar ceiling areas without cutting the storey slab', () => {
      const office = { id: 'outer', floor: 1, x: 0, z: 0, width: 12, depth: 10, wallHeight: 3.2, doors: [], windows: [] };
      const meeting = { id: 'inner', floor: 1, x: 0, z: 0, width: 4, depth: 3, wallHeight: 3.2, doors: [], windows: [] };
      const clearance = 0.075;
      const cutout = {
        x0: meeting.x - meeting.width / 2 - clearance,
        x1: meeting.x + meeting.width / 2 + clearance,
        z0: meeting.z - meeting.depth / 2 - clearance,
        z1: meeting.z + meeting.depth / 2 + clearance,
      };
      const root = build(office, [office, meeting], {
        hasSlab: true,
        floorSurfaceHoles: [cutout],
        ceilingSurfaceHoles: [cutout],
      });
      const part = (name) => root.getChildMeshes(false).filter((mesh) => mesh.metadata.part === name);
      const [floor] = part('floor');
      const ceiling = part('ceiling').find((mesh) => mesh.name.startsWith('ceiling_outer_'));
      const [slab] = part('slab');

      expect(flatArea(floor, 0.02, 1)).toBeCloseTo(12 * 10 - 4.15 * 3.15);
      expect(flatArea(ceiling, 3.2 - 0.005, -1)).toBeCloseTo(12 * 10 - 4.15 * 3.15);
      expect(down(floor, 0, 0)).toBe(false);   // the hole under the inner room
      expect(down(floor, 5, 4)).toBe(true);
      // the slab is not cut: whole footprint, solid in the middle
      expect(size(slab, 'x') * size(slab, 'z')).toBeCloseTo(12.15 * 10.15);
      expect(down(slab, 0, 0)).toBe(true);
    });
  });

  it('builds the shared portion of a partial wall and leaves the outer section', () => {
    const shortEast = { ...east, z: -1, depth: 2 };
    const root = build(west, [west, shortEast]);
    const eastWalls = wallMeshes(root, 'east');

    // one mesh for the room's own part of the wall, one for the shared piece
    expect(eastWalls).toHaveLength(2);
    expect(eastWalls.filter((m) => m.metadata.sharedWith === 'b')).toHaveLength(1);
    const hit = (y, z) => Math.min(...eastWalls.map((m) => hitX(m, y, z) ?? Infinity));
    // shared portion (z -1.925 .. -0.075): the 0.15 m wall at x 3.0 .. 3.15
    expect(hit(1, -1.9)).toBeCloseTo(3.0);
    expect(hit(1, -0.1)).toBeCloseTo(3.0);
    // the rest stays this room's own wall at x 2.925 .. 3.075
    expect(hit(1, 0.1)).toBeCloseTo(2.925);
    expect(hit(1, 1.9)).toBeCloseTo(2.925);
  });

  it('builds one passable door and one correctly tagged pane for paired references', () => {
    const a = { ...west, doors: [{ wall: 'east', offset: 0.25, width: 1, height: 2.1 }] };
    const b = { ...east, doors: [{ wall: 'west', offset: 0.25, width: 1, height: 2.1 }] };
    const root = build(a, [a, b]);
    const doorMeshes = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.part === 'door');
    const pane = doorMeshes.find((mesh) => mesh.metadata.pickPane);
    const [wall] = wallMeshes(root, 'east');

    expect(pane).toBeTruthy();
    expect(centre(pane).x).toBeCloseTo(3.075);
    expect(centre(pane).z).toBeCloseTo(0.25);
    expect(doorMeshes).toHaveLength(2); // one frame + one pane, not one of each per room
    expect(pane.checkCollisions).toBe(false);
    expect(hitX(wall, 1, 0.25)).toBeNull();      // a hole where the door is
    expect(hitX(wall, 1, -1.5)).toBeCloseTo(3.0); // solid beside it
  });

  it('builds a partner-only window at its world position and sill height', () => {
    const a = { ...west, windows: [] };
    const b = { ...east, windows: [{ wall: 'west', offset: 0.5, width: 1.4, height: 1.2, sill: 0.9 }] };
    const root = build(a, [a, b]);
    const windowMeshes = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.part === 'window');
    const pane = windowMeshes.find((mesh) => mesh.metadata.pickPane);

    expect(windowMeshes).toHaveLength(2); // frame + glass in one mesh, and the pane
    expect(centre(pane).x).toBeCloseTo(3.075);
    expect(centre(pane).z).toBeCloseTo(0.5);
    expect(centre(pane).y).toBeCloseTo(1.5);
    expect(pane.metadata).toMatchObject({ roomId: 'b', wallName: 'west', openingIndex: 0 });
  });
});

describe('a shared wall belongs to both rooms, whichever builds it', () => {
  const room = (id, x, width) => ({ id, floor: 0, x, z: 0, width, depth: 4, wallHeight: 3, doors: [], windows: [] });
  // The room whose id sorts first builds the shared wall: try both ways round
  const orders = [
    ['the west room builds it', room('a', 0, 6), room('b', 5.15, 4)],
    ['the east room builds it', room('z', 0, 6), room('b', 5.15, 4)],
  ];

  function buildBoth(west, east) {
    scene = new Scene(new NullEngine());
    const roots = [west, east].map((r) => buildRoomMesh(r, scene, { rooms: [west, east] }));
    const all = roots.flatMap((root) => root.getChildMeshes(false));
    const wall = all.find((m) => m.name.startsWith('wall_') && m.metadata.sharedWith);
    return { roots, all, wall };
  }
  const hitFrom = (mesh, x, dirX) => new Ray(new Vector3(x, 1, 0), new Vector3(dirX, 0, 0), 10).intersectsMesh(mesh);

  it.each(orders)('picking it from a side means the room on that side (%s)', (_, west, east) => {
    const { wall } = buildBoth(west, east);
    expect(wall.metadata.roomId).toBe(west.id < east.id ? west.id : east.id);
    const fromWest = hitFrom(wall, 1, 1);
    const fromEast = hitFrom(wall, 6, -1);
    expect(fromWest.hit && fromEast.hit).toBe(true);
    expect(wallTargetOf(fromWest)).toEqual({ roomId: west.id, wallName: 'east' });
    expect(wallTargetOf(fromEast)).toEqual({ roomId: east.id, wallName: 'west' });
    // on its top the eye decides (in the 2D view: which half was hit)
    const top = new Ray(new Vector3(3.1, 5, 0), new Vector3(0, -1, 0), 10).intersectsMesh(wall);
    expect(wallTargetOf(top, { x: 6, z: 0 }).roomId).toBe(east.id);
    expect(wallTargetOf(top).roomId).toBe(east.id);
  });

  it.each(orders)("either room's selection outline includes it (%s)", (_, west, east) => {
    const { roots, all, wall } = buildBoth(west, east);
    const outlined = (selectedId) => {
      for (const root of roots) setRoomSelected(root, selectedId);
      return all.filter((m) => m.renderOutline);
    };
    for (const selected of [west, east]) {
      const lit = outlined(selected.id);
      expect(lit).toContain(wall);
      // and nothing of the other room except the shared wall (and its skirting)
      const other = selected === west ? east : west;
      expect(lit.filter((m) => !m.metadata.sharedWith && m.parent.metadata.roomId === other.id)).toEqual([]);
    }
    expect(outlined(null)).toEqual([]);
  });
});

describe('roomGeometryKey', () => {
  it('changes for exactly the rooms roomsToRebuild names (the room and the rooms touching it)', () => {
    const row = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, floor: 0, x: i * 6.15, z: 0, width: 6, depth: 5, wallHeight: 3.2 }));
    const after = row.map((r) => (r.id === 'r1' ? { ...r, width: 5.5 } : r));
    const keys = (rooms) => new Map(rooms.map((r) => [r.id, roomGeometryKey(r, { rooms })]));
    const [k0, k1] = [keys(row), keys(after)];
    const changed = new Set(after.filter((r) => k0.get(r.id) !== k1.get(r.id)).map((r) => r.id));
    expect(changed).toEqual(roomsToRebuild(row, after));
    expect([...changed].sort()).toEqual(['r0', 'r1', 'r2']);
  });
});

describe('a room inside a room never has a wall face in the same place as the enclosing room', () => {
  // office x -6..6 (its east wall's inner face at 5.925); meeting room as close as allowed (0.15 m): x 2.85..5.85
  const office = { id: 'office', floor: 0, x: 0, z: 0, width: 12, depth: 10, wallHeight: 3.2, doors: [], windows: [] };
  const meeting = { id: 'meeting', floor: 0, x: 4.35, z: 0, width: 3, depth: 3, wallHeight: 3.2, doors: [], windows: [] };

  it('its walls are drawn 1 cm in on the outside (inside size unchanged), and it has no roof of its own', () => {
    const root = build(meeting, [office, meeting], { nested: true, roofCovered: true });
    const [east] = wallMeshes(root, 'east');
    const [north] = wallMeshes(root, 'north');
    const officeInnerFace = office.width / 2 - 0.075;
    expect(bounds(east).maximumWorld.x).toBeCloseTo(officeInnerFace - 0.01);   // 1 cm gap, not touching
    expect(bounds(east).minimumWorld.x).toBeCloseTo(5.85 - 0.075);             // inside face where it always was
    expect(bounds(north).maximumWorld.x).toBeCloseTo(officeInnerFace - 0.01);  // the corner end too
    expect(bounds(north).maximumWorld.z).toBeCloseTo(1.5 + 0.075 - 0.01);
    expect(bounds(north).minimumWorld.z).toBeCloseTo(1.5 - 0.075);
    expect(root.getChildMeshes(false).filter((m) => m.metadata.part === 'roof')).toEqual([]);
  });

  it('a room on its own keeps full walls and its roof', () => {
    const root = build(meeting);
    expect(bounds(wallMeshes(root, 'east')[0]).maximumWorld.x).toBeCloseTo(5.85 + 0.075);
    expect(root.getChildMeshes(false).some((m) => m.metadata.part === 'roof')).toBe(true);
  });
});

describe('a room inside a room standing on its wall: one wall, built by the inner room', () => {
  // office x -8..8, z -5..5; B stands on its east wall (x = 8) and north wall (z = 5)
  const office = { id: 'office', floor: 0, x: 0, z: 0, width: 16, depth: 10, wallHeight: 3.2, doors: [], windows: [] };
  const b = { id: 'b', floor: 0, x: 6.075, z: 2, width: 3.85, depth: 6, wallHeight: 3.2, doors: [], windows: [] };
  const rooms = [office, b];
  const T = 0.15;
  const rayHits = (root, from, dir) => root.getChildMeshes(false)
    .filter((m) => m.metadata?.part === 'wall' && m.isPickable)
    .map((m) => ({ m, hit: new Ray(from, dir, 10).intersectsMesh(m) }))
    .filter((r) => r.hit.hit);

  it('the office builds no wall where B stands on it; B builds it on the office\'s line, full thickness', () => {
    const officeRoot = build(office, rooms);
    expect(rayHits(officeRoot, new Vector3(7, 1, 2), new Vector3(1, 0, 0))).toEqual([]);   // across B's stretch: nothing
    expect(rayHits(officeRoot, new Vector3(7, 1, -3), new Vector3(1, 0, 0))).toHaveLength(1); // south of B: the office's wall
    const bRoot = build(b, rooms, { nested: true, roofCovered: true });
    const [east] = wallMeshes(bRoot, 'east');
    expect(bounds(east).minimumWorld.x).toBeCloseTo(8 - T / 2);
    expect(bounds(east).maximumWorld.x).toBeCloseTo(8 + T / 2);
    expect(east.metadata).toMatchObject({ sharedWith: 'office', sharedWall: 'east', sameSide: true, innerRoom: 'b', outerRoom: 'office' });
  });

  it('picking it from inside means B, from outside the office', () => {
    const bRoot = build(b, rooms, { nested: true, roofCovered: true });
    const [inside] = rayHits(bRoot, new Vector3(7, 1, 2), new Vector3(1, 0, 0));
    const [outside] = rayHits(bRoot, new Vector3(9.5, 1, 2), new Vector3(-1, 0, 0));
    expect(wallTargetOf(inside.hit)).toEqual({ roomId: 'b', wallName: 'east' });
    expect(wallTargetOf(outside.hit)).toEqual({ roomId: 'office', wallName: 'east' });
  });

  it('B\'s south wall stops at the office wall\'s inside face (nothing in the same place)', () => {
    const bRoot = build(b, rooms, { nested: true, roofCovered: true });
    const [south] = wallMeshes(bRoot, 'south');
    expect(bounds(south).maximumWorld.x).toBeCloseTo(8 - T / 2);
  });

  it('a door stored on both rooms is drawn once, in B\'s piece', () => {
    const door = { wall: 'east', width: 1, height: 2.1 };
    const withDoor = [{ ...office, doors: [{ ...door, offset: 2 }] }, { ...b, doors: [{ ...door, offset: 0 }] }];
    const frames = (root) => root.getChildMeshes(false).filter((m) => m.metadata?.part === 'door' && !m.metadata.pickPane);
    expect(frames(build(withDoor[0], withDoor))).toEqual([]);
    expect(frames(build(withDoor[1], withDoor, { nested: true })).length).toBeGreaterThan(0);
  });
});
