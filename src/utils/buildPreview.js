/**
 * buildPreview.js
 *
 * The translucent previews shown while building, shared by Build mode
 * (play/playController.js) and the planner's mouse tools (planner/plannerTools.js),
 * so both modes look and behave the same:
 *   blue = you can build here, red = you can't.
 *
 *   room(rect, elevation, wallHeight, ok)       floor + four walls of a room being drawn or stretched
 *   wall(a, b, elevation, ok)                   free-standing wall from a to b (b null = start marker)
 *   wallHighlight(room, wallName, elevation, ok) slab over a whole room wall (grab / drag it)
 *   wallTop(room, wallName, elevation, ok)      strip along the top of a wall (grab it: wall height)
 *   opening(room, wallName, offset, defaults, elevation, ok)  door / window in a wall
 *   box({x, y, z, sx, sy, sz}, ok)              any box (e.g. over an existing door to remove)
 *   hide(...names) / hideAll()                  names: 'room' | 'wall' | 'box'
 *
 * Meshes are created once and reused (never per mouse move). None are pickable.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { wallLine, wallThicknessOf } from '../play/geometry';

const FLOOR_Y = 0.02;

export function createBuildPreview(scene, name = 'build') {
  const ghostMat = (suffix, hex) => {
    const m = new StandardMaterial(`${name}Ghost${suffix}`, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.emissiveColor = Color3.FromHexString(hex).scale(0.35);
    m.alpha = 0.42;
    m.backFaceCulling = false;
    return m;
  };
  const OK = ghostMat('Ok', '#4d9bff');
  const BAD = ghostMat('Bad', '#ff4d4d');
  const mat = (ok) => (ok ? OK : BAD);

  const all = [];
  const track = (m) => {
    m.isPickable = false;
    m.checkCollisions = false;
    m.material = OK;
    m.setEnabled(false);
    all.push(m);
    return m;
  };

  let roomParts = null;
  let wallBox = null;
  let boxMesh = null;

  function roomMeshes() {
    if (!roomParts) {
      roomParts = {
        floor: track(MeshBuilder.CreateGround(`${name}_pv_floor`, { width: 1, height: 1 }, scene)),
        walls: ['n', 's', 'e', 'w'].map((n) => track(MeshBuilder.CreateBox(`${name}_pv_wall_${n}`, { size: 1 }, scene))),
      };
    }
    return roomParts;
  }

  function room(rect, elevation, wallHeight, ok = true) {
    const { floor, walls } = roomMeshes();
    floor.position.set(rect.x, elevation + FLOOR_Y + 0.01, rect.z);
    floor.scaling.set(rect.width, 1, rect.depth);
    const T = wallThicknessOf(rect);
    const defs = [
      [rect.x, rect.z + rect.depth / 2, rect.width + T, T],
      [rect.x, rect.z - rect.depth / 2, rect.width + T, T],
      [rect.x + rect.width / 2, rect.z, T, rect.depth],
      [rect.x - rect.width / 2, rect.z, T, rect.depth],
    ];
    walls.forEach((w, i) => {
      const [x, z, sx, sz] = defs[i];
      w.position.set(x, elevation + wallHeight / 2, z);
      w.scaling.set(sx, wallHeight, sz);
    });
    for (const m of [floor, ...walls]) {
      m.material = mat(ok);
      m.setEnabled(true);
    }
  }

  function wall(a, b, elevation, ok = true) {
    if (!wallBox) wallBox = track(MeshBuilder.CreateBox(`${name}_pv_segment`, { width: 1, height: 2.8, depth: 0.2 }, scene));
    wallBox.setEnabled(true);
    wallBox.material = mat(ok);
    if (!b) {
      wallBox.position.set(a.x, elevation + 1.4, a.z);
      wallBox.scaling.set(0.3, 1, 1.5);
      wallBox.rotation.y = 0;
      return;
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    wallBox.position.set((a.x + b.x) / 2, elevation + 1.4, (a.z + b.z) / 2);
    wallBox.scaling.set(Math.max(Math.hypot(dx, dz), 0.05), 1, 1);
    wallBox.rotation.y = Math.atan2(-dz, dx);
  }

  function box({ x, y, z, sx, sy, sz }, ok = true) {
    if (!boxMesh) boxMesh = track(MeshBuilder.CreateBox(`${name}_pv_box`, { size: 1 }, scene));
    boxMesh.setEnabled(true);
    boxMesh.position.set(x, y, z);
    boxMesh.scaling.set(sx, sy, sz);
    boxMesh.material = mat(ok);
  }

  function wallHighlight(roomData, wallName, elevation, ok = true) {
    const line = wallLine(roomData, wallName);
    const WALL_THICKNESS = wallThicknessOf(roomData);
    const h = roomData.wallHeight ?? 3;
    const len = line.to - line.from + WALL_THICKNESS;
    const mid = (line.from + line.to) / 2;
    const alongX = line.axis === 'z';
    box({
      x: alongX ? mid : line.value,
      y: elevation + h / 2,
      z: alongX ? line.value : mid,
      sx: alongX ? len : WALL_THICKNESS + 0.12,
      sy: h + 0.06,
      sz: alongX ? WALL_THICKNESS + 0.12 : len,
    }, ok);
  }

  /** A thin strip along the top of a room wall: grab it to change the height of the walls. */
  function wallTop(roomData, wallName, elevation, ok = true) {
    const line = wallLine(roomData, wallName);
    const WALL_THICKNESS = wallThicknessOf(roomData);
    const h = roomData.wallHeight ?? 3;
    const len = line.to - line.from + WALL_THICKNESS;
    const mid = (line.from + line.to) / 2;
    const alongX = line.axis === 'z';
    box({
      x: alongX ? mid : line.value,
      y: elevation + h,
      z: alongX ? line.value : mid,
      sx: alongX ? len + 0.06 : WALL_THICKNESS + 0.16,
      sy: 0.12,
      sz: alongX ? WALL_THICKNESS + 0.16 : len + 0.06,
    }, ok);
  }

  function opening(roomData, wallName, offset, defaults, elevation, ok = true) {
    const line = wallLine(roomData, wallName);
    const WALL_THICKNESS = wallThicknessOf(roomData);
    const alongX = line.axis === 'z';
    box({
      x: alongX ? roomData.x + offset : line.value,
      y: elevation + defaults.sill + defaults.height / 2,
      z: alongX ? line.value : roomData.z + offset,
      sx: alongX ? defaults.width : WALL_THICKNESS + 0.12,
      sy: defaults.height,
      sz: alongX ? WALL_THICKNESS + 0.12 : defaults.width,
    }, ok);
  }

  function hide(...names) {
    for (const n of names) {
      if (n === 'room' && roomParts) [roomParts.floor, ...roomParts.walls].forEach((m) => m.setEnabled(false));
      if (n === 'wall') wallBox?.setEnabled(false);
      if (n === 'box') boxMesh?.setEnabled(false);
    }
  }

  return {
    room,
    wall,
    box,
    wallHighlight,
    wallTop,
    opening,
    hide,
    hideAll: () => hide('room', 'wall', 'box'),
    owns: (mesh) => all.includes(mesh),
    materials: { ok: OK, bad: BAD },
    dispose() {
      all.forEach((m) => m.dispose());
      all.length = 0;
      roomParts = null;
      wallBox = null;
      boxMesh = null;
      OK.dispose();
      BAD.dispose();
    },
  };
}
