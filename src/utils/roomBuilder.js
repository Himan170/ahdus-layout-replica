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
 *   { roomId, floorId, part: 'floor' | 'wall' | 'door' | 'window' | 'slab' | 'roof' | 'ceiling' | 'band' | 'skirting',
 *     wallName?, openingKind?, openingIndex?, sharedWith?, sharedWall?, sharedAt? }
 * Each door/window also has an invisible pickable pane filling its opening.
 * A wall shared with a neighbour is built once, by one of the two rooms, as its
 * own mesh: `sharedWith` / `sharedWall` name the other room and its wall,
 * `sharedAt` the world coordinate of the wall's centre line. A pick on it
 * means the room on the side it was hit from (pickHelpers.wallTargetOf).
 *
 * Big buildings: parts with the same metadata are merged into one mesh with one
 * sub-mesh per material (one mesh per wall, per door / window frame, one floor,
 * roof, ceiling, skirting), and their world matrices are frozen (a room that
 * changes is rebuilt, see roomGeometryKey).
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { getMaterials, TILE_SIZE, FLOOR_BY_ROOM_TYPE } from './materialLibrary';
import {
  roomWalls, roomWallSegments, wallSegmentOpenings, splitWall, WALL_THICKNESS, OPPOSITE, roomBuildInput,
} from '../play/geometry';
import { subtractRects, SLAB } from '../play/building';
import { mergeByMaterial } from './assetInstances';

const FLOOR_Y = 0.02;          // just above the site ground, avoids z-fighting
const SKIRTING_H = 0.1;
const FRAME_W = 0.07;          // door/window frame profile width
const FRAME_DEPTH_EXTRA = 0.04; // frames stick out slightly from the wall
const ROOF_T = 0.2;            // roof slab thickness
const PARAPET_H = 0.25;        // low wall around the roof edge
const PARAPET_T = 0.15;
const LIGHT_SPACING = 2.4;     // ceiling light panels every 2.4 m
const LIGHT_SIZE = 0.6;
const NESTED_INSET = 0.01;     // a nested room's walls are drawn this much in on the outside

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
 *   rooms?: object[],      rooms on this floor, used to derive shared walls
 *   floorSurfaceHoles?, ceilingSurfaceHoles?: object[]  world rects cut out under / over rooms inside this one
 *   nested?: boolean,       this room is inside another: its walls are drawn 1 cm in on the outside
 *   roofCovered?: boolean,  ...and that room is at least as tall: no roof of its own
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
  root.metadata = { roomId: id, floorId, label: roomData.name };

  // Parts are built around the room centre, then merged (see the end)
  const parts = [];
  const addPart = (mesh, meta, material, { castShadow = true, pickable = true } = {}) => {
    mesh.material = material;
    parts.push({ mesh, meta, castShadow, pickable });
    return mesh;
  };

  const T = WALL_THICKNESS;
  const inner = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const outer = { x0: -width / 2 - T / 2, x1: width / 2 + T / 2, z0: -depth / 2 - T / 2, z1: depth / 2 + T / 2 };
  const floorHoles = toLocal(options.floorHoles, roomData);
  const ceilingHoles = toLocal(options.ceilingHoles, roomData);
  const floorSurfaceHoles = toLocal(options.floorSurfaceHoles, roomData);
  const ceilingSurfaceHoles = toLocal(options.ceilingSurfaceHoles, roomData);

  // ── Floor (in pieces around any stairwell opening) ──
  const floorKind = FLOOR_BY_ROOM_TYPE[type] ?? 'wood';
  subtractRects(inner, [...floorHoles, ...floorSurfaceHoles]).forEach((p, i) => {
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
  for (const wall of roomWalls(roomData)) {
    for (const [i, segment] of roomWallSegments(roomData, wall.name, options.rooms ?? [roomData]).entries()) {
      const segmentBase = segment.shared
        ? Math.max(wallHeight, segment.partnerRoom.wallHeight ?? wallHeight)
        : wallHeight;
      if (storeyTop <= segmentBase + 0.01) continue;
      const h = storeyTop - segmentBase;
      const midpoint = (segment.u0 + segment.u1) / 2;
      const length = segment.u1 - segment.u0;
      const band = MeshBuilder.CreateBox(`band_${id}_${wall.name}_${i}`, {
        width: wall.alongX ? length : T,
        depth: wall.alongX ? T : length,
        height: h,
      }, scene);
      band.position.set(
        wall.alongX ? wall.cx + midpoint : wall.cx + segment.crossOffset,
        segmentBase + h / 2,
        wall.alongX ? wall.cz + segment.crossOffset : wall.cz + midpoint,
      );
      addPart(band, { part: 'band' }, mats.plaster(), { pickable: false });
    }
  }

  // ── Roof: slab + membrane + parapet (shown when nothing is built above) ──
  // Stairs going up need a hole in it too: with no room above, looking up the
  // stairwell must show the sky, not the underside of the roof.
  // A room inside an at-least-as-tall room has none: its roof would lie in that room's.
  if (!options.roofCovered) {
    subtractRects(outer, ceilingHoles).forEach((p, i) => {
      const roof = MeshBuilder.CreateBox(`roof_${id}_${i}`, {
        width: p.x1 - p.x0, depth: p.z1 - p.z0, height: ROOF_T,
      }, scene);
      roof.position.set((p.x0 + p.x1) / 2, wallHeight + ROOF_T / 2, (p.z0 + p.z1) / 2);
      addPart(roof, { part: 'roof' }, mats.plaster(), { pickable: false });
    });

    // (casts with the roof under it: one roof mesh)
    const top = { x0: outer.x0 + PARAPET_T, x1: outer.x1 - PARAPET_T, z0: outer.z0 + PARAPET_T, z1: outer.z1 - PARAPET_T };
    subtractRects(top, ceilingHoles).forEach((p, i) => {
      const membrane = MeshBuilder.CreateGround(`roofTop_${id}_${i}`, { width: p.x1 - p.x0, height: p.z1 - p.z0 }, scene);
      membrane.position.set((p.x0 + p.x1) / 2, wallHeight + ROOF_T + 0.005, (p.z0 + p.z1) / 2);
      addPart(membrane, { part: 'roof' }, mats.roofTop(), { pickable: false });
    });

    const py = wallHeight + ROOF_T + PARAPET_H / 2;
    for (const wall of roomWalls(roomData)) {
      for (const [i, segment] of roomWallSegments(roomData, wall.name, options.rooms ?? [roomData]).entries()) {
        const midpoint = (segment.u0 + segment.u1) / 2;
        const length = segment.u1 - segment.u0;
        const parapet = MeshBuilder.CreateBox(`parapet_${id}_${wall.name}_${i}`, {
          width: wall.alongX ? length : PARAPET_T,
          depth: wall.alongX ? PARAPET_T : length,
          height: PARAPET_H,
        }, scene);
        parapet.position.set(
          wall.alongX ? wall.cx + midpoint : wall.cx + segment.crossOffset,
          py,
          wall.alongX ? wall.cz + segment.crossOffset : wall.cz + midpoint,
        );
        addPart(parapet, { part: 'roof' }, mats.plaster(), { pickable: false });
      }
    }
  }

  // ── Indoor ceiling + light panels (shown when you are inside) ──
  subtractRects(inner, [...ceilingHoles, ...ceilingSurfaceHoles]).forEach((p, i) => {
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
      if ([...ceilingHoles, ...ceilingSurfaceHoles].some((r) =>
        lx > r.x0 - h && lx < r.x1 + h && lz > r.z0 - h && lz < r.z1 + h)) continue;
      const panel = MeshBuilder.CreateBox(`light_${id}_${i}_${j}`, { width: LIGHT_SIZE, depth: LIGHT_SIZE, height: 0.03 }, scene);
      panel.position.set(lx, wallHeight - 0.02, lz);
      addPart(panel, { part: 'ceiling' }, mats.lightPanel(), { castShadow: false, pickable: false });
    }
  }

  // ── Walls ──
  const sameFloorRooms = options.rooms ?? [roomData];
  const inset = options.nested ? NESTED_INSET : 0;
  for (const wall of roomWalls(roomData)) {
    for (const [segmentIndex, segment] of roomWallSegments(roomData, wall.name, sameFloorRooms).entries()) {
      // A room inside a room: its own walls are drawn NESTED_INSET thinner on
      // the outside (and their corner ends that much shorter), so their outer
      // faces never lie in the enclosing room's wall faces (they would flicker).
      // The room's inside stays exactly its size.
      const trim = inset > 0 && !segment.shared;
      const su0 = trim && wall.alongX ? Math.max(segment.u0, -wall.length / 2 + inset) : segment.u0;
      const su1 = trim && wall.alongX ? Math.min(segment.u1, wall.length / 2 - inset) : segment.u1;
      const segmentCentre = (su0 + su1) / 2;
      const segmentLength = su1 - su0;
      const inward = trim ? -Math.sign(wall.alongX ? wall.cz : wall.cx) * inset / 2 : 0;
      const wallT = trim ? T - inset : T;
      const segmentHeight = segment.shared
        ? Math.max(wallHeight, segment.partnerRoom.wallHeight ?? wallHeight)
        : wallHeight;
      const onWall = wallSegmentOpenings(roomData, wall.name, segment);
      const pieces = splitWall(segmentLength, segmentHeight, onWall.map((o) => ({
        ...o,
        offset: o.offset - segmentCentre,
      })));
      const wallCx = wall.cx + (wall.alongX ? 0 : segment.crossOffset + inward);
      const wallCz = wall.cz + (wall.alongX ? segment.crossOffset + inward : 0);

      // Place a box that spans [u0,u1] along this wall piece.
      const placeBox = (name, u0, u1, y0, y1, thickness, material, meta, opts) => {
        const len = u1 - u0;
        const box = MeshBuilder.CreateBox(name, {
          width: wall.alongX ? len : thickness,
          depth: wall.alongX ? thickness : len,
          height: y1 - y0,
        }, scene);
        const mid = (u0 + u1) / 2;
        box.position.set(
          wall.alongX ? wallCx + mid : wallCx,
          (y0 + y1) / 2,
          wall.alongX ? wallCz : wallCz + mid,
        );
        return addPart(box, meta, material, opts);
      };

      // A shared piece is a mesh of its own: picking it and outlining it depend on both rooms.
      // (`roomId` is whose wall the part is: this room's, or the partner's for its doors and windows.)
      const partner = segment.shared ? segment.partnerRoom.id : null;
      const shared = (roomId) => (!partner ? {} : {
        sharedWith: roomId === id ? partner : id,
        sharedWall: roomId === id ? segment.partnerWall ?? OPPOSITE[wall.name] : wall.name,
        sharedAt: segment.worldValue,
        // standing on the outer room's wall: from inside it is this room's, from outside the outer room's
        ...(segment.sameSide ? { sameSide: true, innerRoom: id, outerRoom: partner } : {}),
      });
      const wallMeta = { part: 'wall', wallName: wall.name, ...shared(id) };
      pieces.forEach((p, i) => {
        const u0 = p.u0 + segmentCentre;
        const u1 = p.u1 + segmentCentre;
        placeBox(`wall_${id}_${wall.name}_${segmentIndex}_${i}`, u0, u1, p.y0, p.y1, wallT, mats.plaster(), wallMeta);
        // Skirting: not pickable, a click on it goes through to the wall behind it.
        if (p.y0 === 0) {
          placeBox(`skirt_${id}_${wall.name}_${segmentIndex}_${i}`, u0, u1, 0, SKIRTING_H, T + 0.03,
            mats.skirting(), wallMeta, { castShadow: false });
        }
      });

      // ── Door and window frames ──
      for (const o of onWall) {
        const localCentre = o.offset - segmentCentre;
        const u0 = localCentre - o.width / 2 + segmentCentre;
        const u1 = localCentre + o.width / 2 + segmentCentre;
        const meta = {
          part: o.kind, wallName: o.sourceWall, openingKind: o.kind, openingIndex: o.index,
          roomId: o.roomId, ...shared(o.roomId),
        };
        const frameMat = o.kind === 'door' ? mats.doorFrame() : mats.windowFrame();
        const D = T + FRAME_DEPTH_EXTRA;
        const tag = `${o.kind}_${id}_${wall.name}_${segmentIndex}_${o.roomId}_${o.index}`;

        // The invisible pane is pickable, but does not block movement through doors.
        const pane = placeBox(`${tag}_pick`, u0, u1, o.bottom, o.top, T, null, { ...meta, pickPane: true }, { castShadow: false });
        pane.visibility = 0;

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
  }

  // ── Merge parts that behave the same: one mesh per wall, one floor, one roof,
  // one ceiling, one skirting, one per door / window frame (+ its pick pane).
  // Each mesh has one sub-mesh (draw call) per material; a big building has
  // a few thousand meshes instead of tens of thousands.
  const groups = new Map();
  for (const p of parts) {
    p.hidden = p.mesh.visibility === 0; // the pick panes
    const key = JSON.stringify([p.meta, p.castShadow, p.pickable, p.hidden]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const list of groups.values()) {
    const { meta, castShadow, pickable, hidden } = list[0];
    const mesh = mergeByMaterial(list.map((p) => p.mesh), list[0].mesh.name);
    mesh.parent = root;
    mesh.metadata = { roomId: id, floorId, ...meta };
    mesh.isPickable = pickable;
    mesh.receiveShadows = true;
    mesh.checkCollisions = meta.part === 'wall' || meta.part === 'window';
    if (hidden) mesh.visibility = 0;
    if (castShadow && shadows) shadows.addShadowCaster(mesh, false);
  }

  // Rooms never move: a change rebuilds them (roomGeometryKey), so freeze
  root.position = new Vector3(x, elevation, z);
  root.computeWorldMatrix(true);
  for (const child of root.getChildMeshes(false)) {
    child.computeWorldMatrix(true);
    child.freezeWorldMatrix();
  }

  setRoomSelected(root, roomData.isSelected ? id : null, roomData.color);
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
 * Show/hide the selection outline (walls + floor edge) on the parts of a room's
 * mesh that belong to the selected room: all of them if it is this room, its
 * shared walls if it is the neighbour they are shared with.
 * @param {string|null} selectedRoomId
 * @param {string} [color]  the selected room's colour
 */
export function setRoomSelected(rootNode, selectedRoomId, color = '#6c8cff') {
  if (!rootNode) return;
  const outline = Color3.FromHexString(color);
  const own = selectedRoomId != null && rootNode.metadata?.roomId === selectedRoomId;
  for (const child of rootNode.getChildMeshes(false)) {
    const { part, sharedWith } = child.metadata ?? {};
    if (part === 'wall' || part === 'floor') {
      child.renderOutline = own || (selectedRoomId != null && sharedWith === selectedRoomId);
      child.outlineColor = outline;
      child.outlineWidth = 0.04;
    }
  }
}

/**
 * A string that changes whenever the room needs to be rebuilt: its size, type,
 * doors, windows, storey, stair holes, and the rooms touching it (shared walls;
 * geometry.roomBuildInput / roomsToRebuild). A change to a room further away on
 * the floor, or to the selection, doesn't need a rebuild.
 */
export function roomGeometryKey(room, options = {}) {
  return JSON.stringify([
    roomBuildInput(room, options.rooms ?? []),
    options.elevation ?? 0, !!options.hasSlab, options.storeyTop ?? null,
    options.floorHoles ?? [], options.ceilingHoles ?? [],
    options.floorSurfaceHoles ?? [], options.ceilingSurfaceHoles ?? [],
    !!options.nested, !!options.roofCovered,
  ]);
}
