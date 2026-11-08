// @vitest-environment jsdom
// What you see is what you walk on (v0.14.5): staircases placed in Studio, turned, resized in an old save, on any
// floor, with any y. The REAL mesh (ObjectSystem + the catalogue), measured with a ray from above, against
// the surface walking uses; and the REAL controller (play/playController.js) climbing it. e2e/stairs-smoke.mjs does it in Chrome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Collisions/collisionCoordinator';

import { ObjectSystem } from '../../engine/systems/ObjectSystem';
import { createPlayController } from '../playController';
import {
  elevationOf, stairDimsFor, stairDrawn, stairHeightAt, stairOpening, stairPatch, stairPushOut, stairSize, stairTop, supportHeight,
  stairProblems, STAIRS_LEAD_NOWHERE,
} from '../building';
import { stairBottom, floorLinks, findRoute } from '../navigation/route';
import { createFollower } from '../navigation/follow';
import { createWalkMapCache, STAIRS, BLOCKED } from '../navigation/walkMap';

vi.mock('../../utils/materialLibrary', async (orig) => ({ ...(await orig()), getAssetMaterial: () => null }));

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 }, 2: { id: 2, name: 'Floor 2', height: 3.5 } };
const DEG = Math.PI / 180;
const ANGLES = [0, 90, 180, 270];

const stair = (over = {}) => ({
  id: 's', assetType: 'STAIRCASE', floor: 0, x: 0, y: 0, z: 0,
  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...over,
});
// one big room per floor, so every flight has a floor around it and a room where it arrives
const rooms = (below = 3) => Array.from({ length: below }, (_, f) => (
  { id: `r${f}`, type: 'OFFICE', name: `Hall ${f}`, floor: f, x: 0, z: 0, width: 30, depth: 30, wallHeight: 3.2, wallThickness: 0.15,
    doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [] }));

let engine = null;
afterEach(() => { engine?.dispose(); engine = null; });

/** The real flight, drawn. */
function drawn(s) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const objects = new ObjectSystem(scene);
  objects.sync({ objects: { [s.id]: s }, floors });
  const root = objects.getObjectMesh(s.id);
  root.computeWorldMatrix(true);
  scene.meshes.forEach((m) => m.computeWorldMatrix(true));
  const meshes = root.getChildMeshes();
  /** The height of what is drawn at (x, z): a ray from above; null: nothing there. */
  const top = (x, z) => {
    const ray = new Ray(new Vector3(x, 40, z), new Vector3(0, -1, 0), 80);
    const hit = scene.pickWithRay(ray, (m) => meshes.includes(m) && !m.name.includes('rail'));
    return hit?.hit ? hit.pickedPoint.y : null;
  };
  return { scene, root, top };
}

/** World point at (across, along) in a flight's own coordinates (across + = its local +X; along: 0 = middle, + = up). */
const at = (s, across, along) => {
  const r = s.rotationY;
  return { x: s.x + across * Math.cos(r) + along * Math.sin(r), z: s.z - across * Math.sin(r) + along * Math.cos(r) };
};

const CASES = [
  ...ANGLES.map((a) => ({ name: `turned ${a}°`, s: { rotationY: a * DEG, x: 4, z: -2 } })),
  { name: 'turned −90° (the Inspector\'s slider)', s: { rotationY: -90 * DEG, x: 1, z: 2 } },
  { name: 'turned 45°', s: { rotationY: 45 * DEG, x: 1, z: 2 } },
  { name: 'on Floor 1, turned 90°', s: { floor: 1, rotationY: 90 * DEG, x: -3, z: 1 } },
  { name: 'on Floor 1, turned 180°', s: { floor: 1, rotationY: 180 * DEG, x: 2, z: 3 } },
  { name: 'y 0.02 (Studio puts it on the room\'s floor)', s: { y: 0.02, rotationY: 90 * DEG } },
  { name: 'y 0.6 (the Inspector\'s Height, before)', s: { y: 0.6, rotationY: 270 * DEG } },
  { name: 'on Floor 1, y 0.75 (placed on a table top, before)', s: { floor: 1, y: 0.75 } },
  { name: 'wider and longer (an old scale)', s: { scaleX: 1.5, scaleZ: 2, rotationY: 90 * DEG } },
  { name: 'scaled up evenly by 1.5 (old "Keep proportions")', s: { scaleX: 1.5, scaleY: 1.5, scaleZ: 1.5, rotationY: 180 * DEG } },
  { name: 'scaled down, height only', s: { scaleY: 0.5, rotationY: 270 * DEG } },
  { name: 'a negative scale (dragged through zero)', s: { scaleZ: -1, rotationY: 90 * DEG } },
  { name: 'tilted (the rotation gizmo\'s other rings, before)', s: { rotationX: 0.3, rotationZ: -0.2, rotationY: 90 * DEG } },
];

describe('what is drawn is what is walked on', () => {
  it.each(CASES)('$name', ({ s: over }) => {
    const s = stair(over);
    const { top } = drawn(s);
    const dims = stairDimsFor(floors, s);
    const elev = elevationOf(floors, s.floor);
    const step = dims.rise / dims.steps;
    const L = dims.length / 2;
    const W = dims.width / 2;
    // on the flight: as far along and across as it goes, the walked surface is the drawn tread
    for (const across of [-0.8 * W, 0, 0.8 * W]) {
      for (let along = -L + 0.05; along < L; along += 0.31) {
        const p = at(s, across, along);
        const seen = top(p.x, p.z);
        const walked = stairHeightAt(s, p.x, p.z, dims);
        expect(seen, `drawn at ${along.toFixed(2)}`).not.toBeNull();
        expect(walked, `walked at ${along.toFixed(2)}`).not.toBeNull();
        expect(Math.abs(seen - (elev + walked)), `at ${along.toFixed(2)}, ${across.toFixed(2)}`).toBeLessThanOrEqual(step + 0.031);
      }
    }
    // just beside it: nothing drawn and nothing walked
    for (const p of [at(s, W + 0.06, 0), at(s, -W - 0.06, 0), at(s, 0, -L - 0.06)]) {
      expect(top(p.x, p.z)).toBeNull();
      expect(stairHeightAt(s, p.x, p.z, dims)).toBeNull();
    }
    // the bottom and the top are where the ends of the link say, and its top reaches the floor above
    const low = stairBottom(s, dims);
    const high = stairTop(s, dims);
    expect(Math.hypot(low.x - at(s, 0, -L - 0.6).x, low.z - at(s, 0, -L - 0.6).z)).toBeLessThan(1e-6);
    expect(Math.hypot(high.x - at(s, 0, L + 0.6).x, high.z - at(s, 0, L + 0.6).z)).toBeLessThan(1e-6);
    const near = at(s, 0, L - 0.03);
    expect(top(near.x, near.z)).toBeCloseTo(elev + dims.rise, 2);
    // the opening above covers the whole drawn flight
    const hole = stairOpening(s, dims);
    for (const [a, b] of [[W, L], [-W, L], [W, -L], [-W, -L]]) {
      const p = at(s, a, b);
      expect(p.x).toBeGreaterThan(hole.x0);
      expect(p.x).toBeLessThan(hole.x1);
      expect(p.z).toBeGreaterThan(hole.z0);
      expect(p.z).toBeLessThan(hole.z1);
    }
  });

  it('the mesh is rebuilt and stands level at the floor\'s own height, whatever the save says', () => {
    const { root } = drawn(stair({ floor: 1, y: 0.75, rotationX: 0.3, rotationZ: -0.2, scaleY: 2 }));
    expect(root.position.y).toBe(3.5);
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.z).toBe(0);
    expect(root.scaling.y).toBe(1);
    expect(root.metadata.rise).toBe(3.5);
  });
});

// ── The real controller ──────────────────────────────────────────────────

function walker(objects, roomList = rooms()) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  engine.getDeltaTime = () => 50;
  const world = { rooms: roomList, objects, floors, anchorData: {}, currentFloor: 0, hud: null };
  const play = createPlayController(scene, document.createElement('canvas'), {
    getState: () => world, actions: {}, readOnly: true, isEngaged: () => true, look: 'drag',
    onLevelChange: (id) => { world.currentFloor = id; },
    onHud: (info) => { world.hud = info; },
  });
  play.activate();
  return { scene, play, world };
}
const press = (code, type) => {
  const e = new KeyboardEvent(type, { code, bubbles: true });
  document.dispatchEvent(e);
  window.dispatchEvent(e);
};
/** Hold W: the feet's height against the flight drawn under them, every frame. */
function walkForward(scene, play, frames, each) {
  press('KeyW', 'keydown');
  for (let i = 0; i < frames; i++) {
    scene.render();
    each?.(play.getPosition());
  }
  press('KeyW', 'keyup');
  scene.render();
}
const yawOf = (s, dir = 1) => Math.atan2(Math.sin(s.rotationY) * dir, Math.cos(s.rotationY) * dir);

describe('walking on them with the real controller', () => {
  it.each(CASES)('climbs it from the bottom: $name', ({ s: over }) => {
    const s = stair(over);
    const { scene, play } = walker([s]);
    const dims = stairDimsFor(floors, s);
    const elev = elevationOf(floors, s.floor);
    const start = at(s, 0, -dims.length / 2 - 0.6);
    play.setPose({ x: start.x, z: start.z, yaw: yawOf(s), pitch: 0, floor: s.floor, y: elev + 0.02 });
    let lowest = Infinity;
    walkForward(scene, play, Math.ceil((dims.length + 2) / 2.2 / 0.05) + 40, (p) => {
      const h = stairHeightAt(s, p.x, p.z, dims);
      // never under the steps: the eye never goes through a tread
      if (h !== null && h < dims.rise - 0.5) lowest = Math.min(lowest, p.y - (elev + h));
    });
    expect(lowest).toBeGreaterThan(-dims.rise / dims.steps);
    expect(play.getPosition().y).toBeCloseTo(elev + dims.rise + 0.02, 1);
    expect(play.getLevel()).toBe(s.floor + 1);
  });

  it.each([0, 90, 180, 270])('from the side it stops you: it does not walk you into the block (%d°)', (a) => {
    const s = stair({ rotationY: a * DEG, x: 2, z: -3 });
    const { scene, play } = walker([s]);
    const start = at(s, 3, 0.8); // beside the tall part
    play.setPose({ x: start.x, z: start.z, yaw: Math.atan2(s.x - start.x, s.z - start.z), pitch: 0, floor: 0 });
    walkForward(scene, play, 80, (p) => {
      expect(stairHeightAt(s, p.x, p.z, stairDimsFor(floors, s)), 'on the flight at floor level').toBeNull();
    });
    expect(play.getPosition().y).toBeLessThan(0.1);
  });

  it('from behind it stops you too, under the top of the flight', () => {
    const s = stair({ rotationY: 90 * DEG, x: 2, z: 0 });
    const { scene, play } = walker([s]);
    const start = at(s, 0, 2 + 3);
    play.setPose({ x: start.x, z: start.z, yaw: yawOf(s, -1), pitch: 0, floor: 0 });
    walkForward(scene, play, 80, (p) => {
      expect(stairHeightAt(s, p.x, p.z, stairDimsFor(floors, s))).toBeNull();
    });
  });

  it('walking along its side you slide past, still walking', () => {
    const s = stair({ rotationY: 180 * DEG, x: 0, z: 0 });
    const { scene, play } = walker([s]);
    play.setPose({ x: 0.7, z: 6, yaw: Math.PI, pitch: 0, floor: 0 }); // heading along it, nudged in
    walkForward(scene, play, 200);
    expect(play.getPosition().z).toBeLessThan(-3); // got past it
    expect(play.getPosition().y).toBeLessThan(0.1);
    expect(Math.abs(play.getPosition().x)).toBeGreaterThanOrEqual(0.6 + 0.3);
  });

  it('standing inside the block (a pose, an old pose): the next step takes you out, not up', () => {
    const s = stair({ rotationY: 90 * DEG });
    const { scene, play } = walker([s]);
    play.setPose({ x: 0.5, z: 0.1, yaw: 0, pitch: 0, floor: 0, y: 0, exact: true });
    walkForward(scene, play, 8);
    expect(stairHeightAt(s, play.getPosition().x, play.getPosition().z, stairDimsFor(floors, s))).toBeNull();
    expect(play.getPosition().y).toBeLessThan(0.1);
  });

  it('under a flight on the floor above nothing stops you', () => {
    const s = stair({ floor: 1 });
    const { scene, play } = walker([s]);
    play.setPose({ x: 0, z: -6, yaw: 0, pitch: 0, floor: 0 });
    walkForward(scene, play, 100);
    expect(play.getPosition().z).toBeGreaterThan(3);
    expect(play.getPosition().y).toBeLessThan(0.1);
  });

  it('down again: from the top of a turned flight back to the floor', () => {
    const s = stair({ rotationY: 270 * DEG, x: 3, z: 1 });
    const { scene, play } = walker([s]);
    const top = stairTop(s, stairDimsFor(floors, s));
    play.setPose({ x: top.x, z: top.z, yaw: yawOf(s, -1), pitch: 0, floor: 1 });
    walkForward(scene, play, 130);
    expect(play.getPosition().y).toBeLessThan(0.1);
    expect(play.getLevel()).toBe(0);
  });
});

describe('the walk map and Take me there use the same flight', () => {
  const cache = () => createWalkMapCache({});
  it.each(CASES)('the flight on the map is where it is drawn: $name', ({ s: over }) => {
    const s = stair(over);
    const layout = { rooms: rooms(), objects: [s], floors };
    const map = cache().get(layout, s.floor);
    const dims = stairDimsFor(floors, s);
    expect(map.at(at(s, 0, 0).x, at(s, 0, 0).z)).toBe(STAIRS);
    expect(map.at(at(s, 0, dims.length / 2 - 0.1).x, at(s, 0, dims.length / 2 - 0.1).z)).toBe(STAIRS);
    // beside it the body can't stand: the map keeps it off the block
    const side = at(s, dims.width / 2 + 0.15, 0);
    expect(map.isFree(side.x, side.z)).toBe(false);
    const links = floorLinks(layout, { maps: cache() });
    expect(links).toHaveLength(1);
    const low = stairBottom(s, dims);
    expect(Math.hypot(links[0].from.x - low.x, links[0].from.z - low.z)).toBeLessThan(0.15);
    const high = stairTop(s, dims);
    // (a flight turned 45° has a square opening: the free spot is just past its corner)
    expect(Math.hypot(links[0].to.x - high.x, links[0].to.z - high.z)).toBeLessThan(s.rotationY % (Math.PI / 2) ? 0.3 : 0.15);
  });

  /** Take me there's follower driving the real controller, from one floor to the next. */
  function takeMeThere(layout, from, to) {
    const { scene, play } = walker(layout.objects, layout.rooms);
    const maps = cache();
    const route = findRoute(layout, from, to, { maps });
    expect(route.problem, route.message).toBeUndefined();
    const follower = createFollower(route, { mapFor: (f) => maps.get(layout, f) });
    let done = false;
    play.setPose({ x: from.x, z: from.z, yaw: 0, pitch: 0, floor: from.floor });
    play.setAutopilot({
      drive: (dt, me) => {
        const step = follower.step(me, dt);
        if (step.arrived) { done = true; return null; }
        return { dirX: step.dirX, dirZ: step.dirZ, speed: step.speed, yaw: step.yaw };
      },
      key: () => false,
    });
    const flight = layout.objects.find((o) => o.assetType === 'STAIRCASE');
    const dims = stairDimsFor(floors, flight);
    let inside = 0;
    for (let i = 0; i < 1500 && !done; i++) {
      scene.render();
      const p = play.getPosition();
      const h = stairHeightAt(flight, p.x, p.z, dims);
      if (h !== null && p.y < elevationOf(floors, flight.floor) + h - 0.45) inside++;
    }
    return { done, inside, p: play.getPosition(), level: play.getLevel() };
  }

  it.each(ANGLES)('Take me there climbs a flight turned %d°', (a) => {
    const s = stair({ rotationY: a * DEG, x: 2, z: 1 });
    const layout = { rooms: rooms(), objects: [s], floors };
    const r = takeMeThere(layout, { x: -8, z: -8, floor: 0 }, { x: -8, z: 8, floor: 1 });
    expect(r.done).toBe(true);
    expect(r.inside).toBe(0);
    expect(r.level).toBe(1);
    expect(r.p.y).toBeCloseTo(3.52, 1);
  });

  it('a landing that had to move aside (a wall right in front of the flight): up its own line, not through its side', () => {
    const s = stair({ rotationY: 90 * DEG, x: -11.5, z: 0 }); // its bottom step 1.5 m... at x = −13.5, 1.5 m from the hall's wall
    const wall = { id: 'w', assetType: 'WALL_SEGMENT', floor: 0, x: -14.1, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 3, scaleY: 1, scaleZ: 1 };
    const layout = { rooms: rooms(), objects: [s, wall], floors };
    const map = cache().get(layout, 0);
    const links = floorLinks(layout, { maps: cache() });
    expect(links).toHaveLength(1);
    expect(links[0].via).toHaveLength(2);
    expect(map.isFree(links[0].from.x, links[0].from.z)).toBe(true);
    const r = takeMeThere(layout, { x: 3, z: -8, floor: 0 }, { x: 3, z: 8, floor: 1 });
    expect(r.done).toBe(true);
    expect(r.inside).toBe(0);
    expect(r.level).toBe(1);
  });

  it('the height is the same one at every point of a climb: supportHeight agrees on all 4 turns', () => {
    for (const a of ANGLES) {
      const s = stair({ rotationY: a * DEG, x: 5, z: -4 });
      const dims = stairDimsFor(floors, s);
      let y = 0.02;
      for (let along = -dims.length / 2; along <= dims.length / 2; along += 0.1) {
        const p = at(s, 0, along);
        y = supportHeight({ ...p, y, floors, rooms: rooms(), stairs: [s] });
      }
      expect(y).toBeCloseTo(3.5, 1);
    }
  });
});

describe('Studio can\'t make a staircase walking can\'t follow', () => {
  it('stairPatch: position and turn pass; y, tilt and resizing don\'t; only "Normal size" changes the scale', () => {
    expect(stairPatch({ x: 1, z: 2, rotationY: 3 })).toEqual({ x: 1, z: 2, rotationY: 3 });
    expect(stairPatch({ y: 1, rotationX: 0.2, rotationZ: 0.1 })).toEqual({});
    expect(stairPatch({ scaleX: 2 })).toEqual({});
    expect(stairPatch({ scaleX: 2, scaleY: 2, scaleZ: 2 })).toEqual({});
    expect(stairPatch({ scaleX: 1, scaleY: 1, scaleZ: 1 })).toEqual({ scaleX: 1, scaleY: 1, scaleZ: 1 });
    expect(stairPatch({ label: 'Main stairs', locked: true })).toEqual({ label: 'Main stairs', locked: true });
  });

  it('stairDrawn: always on its floor, level, its floor\'s height; an old save\'s scale stays', () => {
    const d = stairDrawn(floors, stair({ floor: 1, y: 0.75, rotationX: 0.3, rotationZ: 0.2, scaleX: -1.5, scaleY: 3, scaleZ: 2 }));
    expect(d).toEqual({ y: 3.5, rotationX: 0, rotationZ: 0, scaleX: 1.5, scaleY: 1, scaleZ: 2, rise: 3.5 });
    expect(stairSize(stair({ scaleX: 1.5, scaleZ: 2 })).width).toBeCloseTo(1.8);
    expect(stairSize(stair({ scaleX: 1.5, scaleZ: 2 })).length).toBeCloseTo(8);
    expect(stairSize(stair({ scaleX: 0, scaleZ: NaN }))).toEqual({ width: 1.2, length: 4 });
  });
});

describe('stairPushOut: the side of a flight stops you, where it is too high to step onto', () => {
  const base = { floors, radius: 0.32 };
  const s = stair({ rotationY: 90 * DEG, x: 0, z: 0 }); // climbs towards +X, from x −2 to x 2
  it('at the bottom step: nothing, you walk onto it', () => {
    expect(stairPushOut({ ...base, stairs: [s], x: -2.1, z: 0, y: 0.02 })).toBeNull();
  });
  it('at the side, high up: pushed out sideways', () => {
    const out = stairPushOut({ ...base, stairs: [s], x: 1.5, z: 0.75, y: 0.02 });
    expect(out.dz).toBeGreaterThan(0.1);
    expect(Math.abs(out.dx)).toBeLessThan(0.01);
  });
  it('beside it, clear: nothing', () => {
    expect(stairPushOut({ ...base, stairs: [s], x: 1.5, z: 1.5, y: 0.02 })).toBeNull();
  });
  it('standing on the flight: nothing', () => {
    expect(stairPushOut({ ...base, stairs: [s], x: 1.5, z: 0, y: stairHeightAt(s, 1.5, 0, stairDimsFor(floors, s)) })).toBeNull();
  });
  it('under a flight of the floor above (it is over your head): nothing', () => {
    const up = stair({ floor: 1, rotationY: 90 * DEG });
    expect(stairPushOut({ ...base, stairs: [up], x: 0, z: 0, y: 0.02 })).toBeNull();
  });
  it('inside the block (an old spot): out by the nearest side', () => {
    const out = stairPushOut({ ...base, stairs: [s], x: 1.5, z: 0.5, y: 0.02 });
    expect(out.dz).toBeGreaterThan(0);
  });
});

// ── Stairs that lead nowhere (v0.14.6: one floor, a flight up into the roof) ──

describe('stairs that lead nowhere can not be climbed', () => {
  // only a ground floor: nothing above, so nowhere to arrive
  const oneFloor = { 0: { id: 0, name: 'Ground Floor', height: 4 } };
  const hall = [{ id: 'h', type: 'OFFICE', name: 'Hall', floor: 0, x: 0, z: 0, width: 30, depth: 30, wallHeight: 3.7,
    wallThickness: 0.15, doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [] }];

  it.each(ANGLES)('from the bottom step you stay on the floor, and it says why (%d°)', (a) => {
    const s = stair({ rotationY: a * DEG, x: 3, z: 2 });
    const { scene, play, world } = walker([s], hall);
    world.floors = oneFloor;
    const dims = stairDimsFor(oneFloor, s);
    const start = at(s, 0, -dims.length / 2 - 0.8);
    play.setPose({ x: start.x, z: start.z, yaw: yawOf(s), pitch: 0, floor: 0, y: 0.02 });
    let said = false;
    walkForward(scene, play, 120, (p) => {
      expect(p.y, 'never up the steps').toBeLessThan(0.1);
      expect(stairHeightAt(s, p.x, p.z, dims), 'never on the flight').toBeNull();
      if (world.hud?.message === STAIRS_LEAD_NOWHERE) said = true;
    });
    expect(said).toBe(true);
    expect(play.getLevel()).toBe(0);
  });

  it('with a floor above but no room where they arrive: the same (Floor 1 has a room elsewhere)', () => {
    const s = stair({ x: 0, z: 0 });
    const { scene, play } = walker([s], [hall[0], { ...hall[0], id: 'far', floor: 1, x: 40, width: 6, depth: 6 }]);
    play.setPose({ x: 0, z: -3, yaw: 0, pitch: 0, floor: 0, y: 0.02 });
    walkForward(scene, play, 120, (p) => { expect(p.y).toBeLessThan(0.1); });
  });

  it('supportHeight gives the floor, not the steps; stairPushOut stops you at the bottom step too', () => {
    const s = stair({ rotationY: 90 * DEG }); // climbs towards +X, from x −2 to x 2
    expect(supportHeight({ x: 1.5, z: 0, y: 3, floors: oneFloor, rooms: hall, stairs: [s] })).toBeCloseTo(0.02, 1);
    const out = stairPushOut({ floors: oneFloor, rooms: hall, stairs: [s], x: -2.1, z: 0, y: 0.02, radius: 0.32 });
    expect(out).toMatchObject({ nowhere: true });
    expect(out.dx).toBeLessThan(0); // back off the bottom step
    // without rooms (an old caller) it is the v0.14.5 rule: you walk onto the bottom step
    expect(stairPushOut({ floors: oneFloor, stairs: [s], x: -2.1, z: 0, y: 0.02, radius: 0.32 })).toBeNull();
    // standing on it (an old pose): out by the nearest end or side
    const inside = stairPushOut({ floors: oneFloor, rooms: hall, stairs: [s], x: -1.9, z: 0, y: 0.02, radius: 0.32 });
    expect(inside.dx).toBeLessThan(-0.3);
  });

  it('the walk map blocks the whole flight; no link, so no route up', () => {
    const s = stair({ x: 3, z: 2 });
    const layout = { rooms: hall, objects: [s], floors: oneFloor };
    const map = createWalkMapCache().get(layout, 0);
    expect(map.at(3, 2)).toBe(BLOCKED);
    expect(map.at(3, 2 - 1.9)).toBe(BLOCKED); // the bottom step
    expect(floorLinks(layout)).toEqual([]);
    // with a room above where it arrives: STAIRS again
    const two = { rooms: [...rooms(2)], objects: [s], floors };
    expect(createWalkMapCache().get(two, 0).at(3, 2)).toBe(STAIRS);
  });
});

describe('stairProblems: what Studio says about a staircase', () => {
  const oneFloor = { 0: { id: 0, name: 'Ground Floor', height: 4 } };
  // a small stair room, 2.5 × 3.5 m (x 4.75 … 7.25, z −4.75 … −1.25), a door on its west and east walls
  const stairRoom = { id: 'sr', type: 'STAIRCASE', name: 'Stair hall', floor: 0, x: 6, z: -3, width: 2.5, depth: 3.5,
    wallHeight: 3.7, wallThickness: 0.15, windows: [],
    doors: [{ wall: 'east', offset: 0, width: 1, height: 2.1 }, { wall: 'west', offset: 0.5, width: 1, height: 2.1 }] };
  const codes = (s, fl, rs) => stairProblems(s, fl, rs).map((p) => p.code);

  it('a half-size flight turned round: leads nowhere, its bottom step faces the wall, it stands in front of the west door', () => {
    // 2 m long, z −3.4 … −1.4: its bottom step (+Z end) 7.5 cm from the north wall's inside face
    const s = stair({ x: 5.4, z: -2.4, rotationY: Math.PI, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 });
    const problems = stairProblems(s, oneFloor, [stairRoom]);
    expect(problems.map((p) => p.code)).toEqual(['NOWHERE', 'NO_STEP_ON', 'BLOCKS_DOOR']);
    expect(problems[0].text).toBe(`${STAIRS_LEAD_NOWHERE}: there is no floor above. Add one, with a room where they arrive`);
    expect(problems[1].text).toBe("These stairs don't fit Stair hall: there's no room in front of the bottom step");
    expect(problems[2].text).toBe("These stairs don't fit Stair hall: they block a door");
  });

  it('a normal-size flight (4 m) sticks out of a 3.5 m stair room', () => {
    expect(codes(stair({ x: 6, z: -3 }), oneFloor, [stairRoom])).toContain('STICKS_OUT');
  });

  it('a floor above with no room where they arrive: build one there', () => {
    const s = stair({ x: 0, z: 0 });
    const [p] = stairProblems(s, floors, rooms(1));
    expect(p).toMatchObject({ code: 'NOWHERE', text: `${STAIRS_LEAD_NOWHERE}: build a room on Floor 1 where they arrive` });
  });

  it('a flight in the middle of a big room, with a room above: nothing to say', () => {
    expect(stairProblems(stair({ x: 3, z: 2, rotationY: 90 * DEG }), floors, rooms(2))).toEqual([]);
  });

  it('outside every room only "leads nowhere" counts', () => {
    expect(codes(stair({ x: 100, z: 0 }), oneFloor, [stairRoom])).toEqual(['NOWHERE']);
  });
});
