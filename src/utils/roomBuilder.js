/**
 * roomBuilder.js
 *
 * Builds a realistic room from room data:
 *   - floor with a real-world-scaled texture chosen by room type
 *     (wood office, carpet meeting room, tiled reception, concrete shop floor...)
 *   - painted plaster walls, split into solid pieces around doors and windows
 *     (no CSG: faster, and skirting/frames line up with the openings)
 *   - skirting boards, wooden door frames, aluminium window frames with glass
 *
 * Everything for one room hangs under one TransformNode so it can be moved,
 * selected or disposed as a unit. Materials are SHARED (materialLibrary.js),
 * so disposing a room never disposes a material.
 *
 * Multi-storey: the room is built at its floor's elevation. Rooms on upper
 * floors get a floor SLAB under them (building.SLAB thick; it sits on the walls
 * of the storey below and is the facade band you see from outside). Every room
 * has a ROOF (shown when nothing is built above it) and an indoor CEILING with
 * light panels (shown when you are inside). Stairwell openings are cut out of
 * floors, ceilings and roofs.
 * Which parts are visible is decided by WorkplaceEditor (applyLevelVisibility).
 *
 * Mesh metadata (used for picking in the planner and in Play mode):
 *   { roomId, floorId, part: 'floor' | 'wall' | 'door' | 'window' | 'slab' | 'roof' | 'ceiling' | 'band',
 *     wallName?, openingKind?, openingIndex? }
 * Each door/window also has an invisible pickable pane filling its opening.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { getMaterials, TILE_SIZE, FLOOR_BY_ROOM_TYPE } from './materialLibrary';
import { roomWalls, roomOpenings, splitWall, WALL_THICKNESS } from '../play/geometry';
import { subtractRects, SLAB } from '../play/building';

const FLOOR_Y = 0.02;          // just above the site ground, avoids z-fighting
const SKIRTING_H = 0.1;
const FRAME_W = 0.07;          // door/window frame profile width
const FRAME_DEPTH_EXTRA = 0.04; // frames stick out slightly from the wall
const ROOF_T = 0.2;            // roof slab thickness
const PARAPET_H = 0.25;        // low wall around the roof edge
const PARAPET_T = 0.15;
const LIGHT_SPACING = 2.4;     // ceiling light panels every 2.4 m
const LIGHT_SIZE = 0.6;

/** Texture repeats by WORLD position, so floor pieces around an opening line up seamlessly. */
function worldUVs(mesh, worldX0, worldZ0, tile) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!pos || !uvs) return;
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    uvs[j] = (worldX0 + pos[i]) / tile;
    uvs[j + 1] = (worldZ0 + pos[i + 2]) / tile;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}

/** World-space opening rects → rects relative to the room centre. */
function toLocal(rects, room) {
  return (rects ?? []).map((r) => ({ x0: r.x0 - room.x, x1: r.x1 - room.x, z0: r.z0 - room.z, z1: r.z1 - room.z }));
}

/**
 * Build the 3D meshes for a room.
 *
 * @param {Object} roomData  room from the store
 * @param {Scene} scene
 * @param {{
 *   shadowGenerator?: ShadowGenerator,
 *   elevation?: number,      world height of the room's floor (its storey)
 *   hasSlab?: boolean,       true on upper floors: build the slab under the floor
 *   storeyTop?: number,      where the slab of the floor above starts (floor height − SLAB);
 *                            a lower room gets a wall band up to it
 *   floorHoles?: object[],   world rects {x0,x1,z0,z1} to cut out of the floor (stairs coming up)
 *   ceilingHoles?: object[], world rects to cut out of the ceiling and roof (stairs going up)
 * }} [options]
 * @returns {TransformNode} root node containing all room meshes
 */
export function buildRoomMesh(roomData, scene, options = {}) {
  const { id, x, z, width, depth, wallHeight = 3, type } = roomData;
  const floorId = roomData.floor ?? 0;
  const mats = getMaterials(scene);
  const shadows = options.shadowGenerator ?? null;
  const elevation = options.elevation ?? 0;

  const root = new TransformNode(`room_${id}`, scene);
  root.position = new Vector3(x, elevation, z);
  root.metadata = { roomId: id, floorId, label: roomData.name };

  const addPart = (mesh, meta, material, { castShadow = true, pickable = true } = {}) => {
    mesh.parent = root;
    mesh.material = material;
    mesh.metadata = { roomId: id, floorId, ...meta };
    mesh.isPickable = pickable;
    mesh.receiveShadows = true;
    mesh.checkCollisions = meta.part === 'wall' || meta.part === 'window';
    if (castShadow && shadows) shadows.addShadowCaster(mesh, false);
    return mesh;
  };

  const T = WALL_THICKNESS;
  const inner = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const outer = { x0: -width / 2 - T / 2, x1: width / 2 + T / 2, z0: -depth / 2 - T / 2, z1: depth / 2 + T / 2 };
  const floorHoles = toLocal(options.floorHoles, roomData);
  const ceilingHoles = toLocal(options.ceilingHoles, roomData);

  // ── Floor (in pieces around any stairwell opening) ──
  const floorKind = FLOOR_BY_ROOM_TYPE[type] ?? 'wood';
  subtractRects(inner, floorHoles).forEach((p, i) => {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const piece = MeshBuilder.CreateGround(`floor_${id}_${i}`, { width: w, height: d }, scene);
    piece.position.set((p.x0 + p.x1) / 2, FLOOR_Y, (p.z0 + p.z1) / 2);
    worldUVs(piece, x + piece.position.x, z + piece.position.z, TILE_SIZE[floorKind]);
    addPart(piece, { part: 'floor' }, mats.floor(floorKind), { castShadow: false });
  });

  // ── Floor slab (upper floors): sits on the walls of the storey below ──
  if (options.hasSlab) {
    const slabT = SLAB;
    subtractRects(outer, floorHoles).forEach((p, i) => {
      const slab = MeshBuilder.CreateBox(`slab_${id}_${i}`, {
        width: p.x1 - p.x0, depth: p.z1 - p.z0, height: slabT,
      }, scene);
      slab.position.set((p.x0 + p.x1) / 2, -slabT / 2, (p.z0 + p.z1) / 2);
      addPart(slab, { part: 'slab' }, mats.plaster(), { pickable: false });
    });
  }

  // ── Wall band: a room made lower than its floor still closes the storey ──
  // From outside, the walls continue up to the slab of the floor above, so no
  // gap shows between storeys (inside, the ceiling stays at wallHeight).
  // Shown only when rooms above cover it (WorkplaceEditor.applyLevelVisibility).
  const storeyTop = options.storeyTop ?? wallHeight;
  if (storeyTop > wallHeight + 0.01) {
    const h = storeyTop - wallHeight;
    const W = outer.x1 - outer.x0;
    const D = outer.z1 - outer.z0;
    [
      [0, D / 2 - T / 2, W, T],
      [0, -D / 2 + T / 2, W, T],
      [W / 2 - T / 2, 0, T, D - 2 * T],
      [-W / 2 + T / 2, 0, T, D - 2 * T],
    ].forEach(([bx, bz, w, d], i) => {
      const band = MeshBuilder.CreateBox(`band_${id}_${i}`, { width: w, depth: d, height: h }, scene);
      band.position.set(bx, wallHeight + h / 2, bz);
      addPart(band, { part: 'band' }, mats.plaster(), { pickable: false });
    });
  }

  // ── Roof: slab + membrane + parapet (shown when nothing is built above) ──
  // Stairs going up need a hole in it too: with no room above, looking up the
  // stairwell must show the sky, not the underside of the roof.
  {
    subtractRects(outer, ceilingHoles).forEach((p, i) => {
      const roof = MeshBuilder.CreateBox(`roof_${id}_${i}`, {
        width: p.x1 - p.x0, depth: p.z1 - p.z0, height: ROOF_T,
      }, scene);
      roof.position.set((p.x0 + p.x1) / 2, wallHeight + ROOF_T / 2, (p.z0 + p.z1) / 2);
      addPart(roof, { part: 'roof' }, mats.plaster(), { pickable: false });
    });

    const top = { x0: outer.x0 + PARAPET_T, x1: outer.x1 - PARAPET_T, z0: outer.z0 + PARAPET_T, z1: outer.z1 - PARAPET_T };
    subtractRects(top, ceilingHoles).forEach((p, i) => {
      const membrane = MeshBuilder.CreateGround(`roofTop_${id}_${i}`, { width: p.x1 - p.x0, height: p.z1 - p.z0 }, scene);
      membrane.position.set((p.x0 + p.x1) / 2, wallHeight + ROOF_T + 0.005, (p.z0 + p.z1) / 2);
      addPart(membrane, { part: 'roof' }, mats.roofTop(), { castShadow: false, pickable: false });
    });

    const W = outer.x1 - outer.x0;
    const D = outer.z1 - outer.z0;
    const py = wallHeight + ROOF_T + PARAPET_H / 2;
    [
      [0, D / 2 - PARAPET_T / 2, W, PARAPET_T],
      [0, -D / 2 + PARAPET_T / 2, W, PARAPET_T],
      [W / 2 - PARAPET_T / 2, 0, PARAPET_T, D - 2 * PARAPET_T],
      [-W / 2 + PARAPET_T / 2, 0, PARAPET_T, D - 2 * PARAPET_T],
    ].forEach(([px, pz, w, d], i) => {
      const parapet = MeshBuilder.CreateBox(`parapet_${id}_${i}`, { width: w, depth: d, height: PARAPET_H }, scene);
      parapet.position.set(px, py, pz);
      addPart(parapet, { part: 'roof' }, mats.plaster(), { pickable: false });
    });
  }

  // ── Indoor ceiling + light panels (shown when you are inside) ──
  subtractRects(inner, ceilingHoles).forEach((p, i) => {
    const ceiling = MeshBuilder.CreateGround(`ceiling_${id}_${i}`, { width: p.x1 - p.x0, height: p.z1 - p.z0 }, scene);
    ceiling.rotation.x = Math.PI; // face down
    ceiling.position.set((p.x0 + p.x1) / 2, wallHeight - 0.005, (p.z0 + p.z1) / 2);
    addPart(ceiling, { part: 'ceiling' }, mats.ceiling(), { castShadow: false, pickable: false });
  });
  const nx = Math.max(1, Math.round(width / LIGHT_SPACING));
  const nz = Math.max(1, Math.round(depth / LIGHT_SPACING));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const lx = -width / 2 + (i + 0.5) * (width / nx);
      const lz = -depth / 2 + (j + 0.5) * (depth / nz);
      const h = LIGHT_SIZE / 2 + 0.1;
      if (ceilingHoles.some((r) => lx > r.x0 - h && lx < r.x1 + h && lz > r.z0 - h && lz < r.z1 + h)) continue;
      const panel = MeshBuilder.CreateBox(`light_${id}_${i}_${j}`, { width: LIGHT_SIZE, depth: LIGHT_SIZE, height: 0.03 }, scene);
      panel.position.set(lx, wallHeight - 0.02, lz);
      addPart(panel, { part: 'ceiling' }, mats.lightPanel(), { castShadow: false, pickable: false });
    }
  }

  // ── Walls ──
  const openings = roomOpenings(roomData);

  for (const wall of roomWalls(roomData)) {
    const onWall = openings.filter((o) => o.wall === wall.name);
    const pieces = splitWall(wall.length, wallHeight, onWall);

    // Place a box that spans [u0,u1] along the wall and [y0,y1] vertically
    const placeBox = (name, u0, u1, y0, y1, thickness, material, meta, opts) => {
      const len = u1 - u0;
      const box = MeshBuilder.CreateBox(name, {
        width: wall.alongX ? len : thickness,
        depth: wall.alongX ? thickness : len,
        height: y1 - y0,
      }, scene);
      const mid = (u0 + u1) / 2;
      box.position.set(
        wall.alongX ? wall.cx + mid : wall.cx,
        (y0 + y1) / 2,
        wall.alongX ? wall.cz : wall.cz + mid,
      );
      return addPart(box, meta, material, opts);
    };

    const wallMeta = { part: 'wall', wallName: wall.name };
    pieces.forEach((p, i) => {
      placeBox(`wall_${id}_${wall.name}_${i}`, p.u0, p.u1, p.y0, p.y1, T, mats.plaster(), wallMeta);
      if (p.y0 === 0) {
        placeBox(`skirt_${id}_${wall.name}_${i}`, p.u0, p.u1, 0, SKIRTING_H, T + 0.03,
          mats.skirting(), wallMeta, { castShadow: false });
      }
    });

    // ── Door and window frames ──
    for (const o of onWall) {
      const u0 = o.offset - o.width / 2;
      const u1 = o.offset + o.width / 2;
      const meta = { part: o.kind, wallName: wall.name, openingKind: o.kind, openingIndex: o.index };
      const frameMat = o.kind === 'door' ? mats.doorFrame() : mats.windowFrame();
      const D = T + FRAME_DEPTH_EXTRA;
      const tag = `${o.kind}_${id}_${wall.name}_${o.index}`;

      // An invisible pane filling the opening: aiming through a doorway (Preview's
      // Edit item, E, right-click) or clicking it in Studio picks the door, not
      // only its thin frame. Not drawn (visibility 0) and you walk through doors.
      // Marked pickPane: Preview's aiming looks through it unless it asks for doors.
      const pane = placeBox(`${tag}_pick`, u0, u1, o.bottom, o.top, T, null, { ...meta, pickPane: true }, { castShadow: false });
      pane.visibility = 0;

      // jambs (sides) and head (top)
      placeBox(`${tag}_jl`, u0, u0 + FRAME_W, o.bottom, o.top, D, frameMat, meta, { castShadow: false });
      placeBox(`${tag}_jr`, u1 - FRAME_W, u1, o.bottom, o.top, D, frameMat, meta, { castShadow: false });
      placeBox(`${tag}_hd`, u0, u1, o.top - FRAME_W, o.top, D, frameMat, meta, { castShadow: false });

      if (o.kind === 'window') {
        placeBox(`${tag}_sl`, u0, u1, o.bottom, o.bottom + FRAME_W, D + 0.06, frameMat, meta, { castShadow: false });
        placeBox(`${tag}_mu`, o.offset - 0.025, o.offset + 0.025, o.bottom, o.top, D * 0.6, frameMat, meta, { castShadow: false });
        placeBox(`${tag}_gl`, u0 + FRAME_W, u1 - FRAME_W, o.bottom + FRAME_W, o.top - FRAME_W, 0.02,
          mats.glass(), meta, { castShadow: false });
      }
    }
  }

  setRoomSelected(root, !!roomData.isSelected, roomData.color);
  return root;
}

/**
 * Dispose all meshes of a room. Materials are shared and are NOT disposed.
 */
export function disposeRoomMesh(rootNode) {
  if (!rootNode) return;
  rootNode.dispose(false, false); // dispose children, keep shared materials
}

/**
 * Show/hide the selection outline on a room (walls + floor edge).
 */
export function setRoomSelected(rootNode, selected, color = '#6c8cff') {
  if (!rootNode) return;
  const outline = Color3.FromHexString(color);
  for (const child of rootNode.getChildMeshes(false)) {
    const part = child.metadata?.part;
    if (part === 'wall' || part === 'floor') {
      child.renderOutline = selected;
      child.outlineColor = outline;
      child.outlineWidth = 0.04;
    }
  }
}

/**
 * A string that changes whenever the room needs to be rebuilt
 * (size, type, doors, windows). Position/selection changes don't need a rebuild.
 */
export function roomGeometryKey(room, options = {}) {
  return JSON.stringify([
    room.x, room.z, room.width, room.depth, room.wallHeight, room.type, room.color,
    room.doors ?? [], room.windows ?? [],
    options.elevation ?? 0, !!options.hasSlab, options.storeyTop ?? null, options.floorHoles ?? [], options.ceilingHoles ?? [],
  ]);
}
