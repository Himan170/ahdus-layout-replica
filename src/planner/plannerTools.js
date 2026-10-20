/**
 * planner/plannerTools.js
 *
 * The planner's mouse tools: what Build mode does with the crosshair, done
 * with the mouse.
 *
 *   select          click to select. Drag a room floor to move it, a wall to
 *                   resize it; drag a blue handle on top of its walls (3D) to
 *                   raise or lower them.
 *   room            drag on the floor from one corner to the opposite corner
 *   wall            drag from where a free-standing wall starts to where it ends
 *   door / window   click a room wall to add one; click an existing one to remove it
 *
 * Furniture is placed from the Objects panel (utils/placementManager.js),
 * which stacks items on table tops the same way Build mode does.
 *
 * Same pure maths as Build mode (play/geometry.js), same previews
 * (utils/buildPreview.js). Every change goes through `actions`
 * (editorHistory), so it can be undone, and it acts on the floor being edited.
 * On an upper floor, new rooms line up with the walls of the floor below.
 */

import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { createBuildPreview } from '../utils/buildPreview';
import { wallTargetOf } from '../utils/pickHelpers';
import { ROOM_TYPES } from '../utils/roomStore';
import { ASSET_TYPES } from '../utils/assetCatalog';
import {
  snap, formatRoomSize, wallSegmentTransform, openingAt, roomOpenings,
  planRoom, planRoomMove, planOpening, planRemoveOpening, wallSegmentData, stretchRoom,
  openingData, wallLine, formatOpeningSize, resizeOpening, OPENING_STEP, WALL_THICKNESS, OVERHANG_WARNING,
} from '../play/geometry';
import {
  elevationOf, floorBelow, planWallHeight, wallHeightText, HEIGHT_STEP, MIN_WALL_HEIGHT, MAX_WALL_HEIGHT,
} from '../play/building';

const FLOOR_Y = 0.02;
const WALL_LABEL = { north: 'north', south: 'south', east: 'east', west: 'west' };
const VIEW_KEYS = [['Right-drag', 'Move the view'], ['Wheel', 'Zoom'], ['Esc', 'Stop']];

export function createPlannerTools(scene, canvas, {
  getCamera,             // () => the planner camera (detached while dragging, so the view doesn't spin)
  getState,              // () => store state: rooms, objects, floors, currentFloor, selectedRoomId
  actions,               // { addRoom, updateRoom, setWallHeight, addObject, addOpenings, removeOpenings, resizeOpening }
  getSnapStep = () => 0.5, // () => grid step in metres, 0 when snap is off
  onHint = () => {},     // (hint | null) => void   same shape as Build mode's HUD hint
  onMessage = () => {},  // (text) => void          short feedback after a change
}) {
  let tool = { kind: 'select' };
  let drag = null;   // { kind: 'stretch' | 'room' | 'wall', start?, roomId?, wallName?, plan? }
  let hover = null;  // what a click would do right now
  let enabled = true;
  let lastHint = '';
  const pv = createBuildPreview(scene, 'planner');

  // ── Helpers ──
  const st = () => getState();
  const floorRooms = () => Object.values(st().rooms).filter((r) => r.floor === st().currentFloor);
  const elev = () => elevationOf(st().floors, st().currentFloor);
  /** Rooms on the floor below the one being edited (null on the lowest floor). */
  const belowRooms = () => {
    const below = floorBelow(st().floors, st().currentFloor);
    return below ? Object.values(st().rooms).filter((r) => r.floor === below.id) : null;
  };
  const floorName = (id) => st().floors[id]?.name ?? 'The floor';
  const onLevel = (m) => (m.metadata?.floorId ?? m.parent?.metadata?.floorId) === st().currentFloor;
  const snapV = (v) => {
    const step = getSnapStep();
    return step > 0 ? snap(v, step) : Math.round(v * 20) / 20;
  };
  const nameOf = (o) => o.label || ASSET_TYPES[o.assetType]?.label || 'An item';
  const roomLabel = () => ROOM_TYPES[tool.roomType]?.label ?? 'New';

  function hint(h) {
    const key = JSON.stringify(h);
    if (key === lastHint) return;
    lastHint = key;
    onHint(h);
  }

  function setCursor(c) {
    canvas.style.cursor = c;
  }

  /** Point on the floor being edited under the mouse, or null (looking at the sky). */
  function groundPoint() {
    const camera = getCamera();
    if (!camera) return null;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (elev() + FLOOR_Y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  const snappedGround = () => {
    const p = groundPoint();
    return p && { x: snapV(p.x), z: snapV(p.z) };
  };

  /** The first thing under the mouse, if it passes `predicate` (furniture in front of a wall hides the wall). */
  function pickAtPointer(predicate) {
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) =>
      m.isPickable && m.isEnabled() && !pv.owns(m));
    return hit?.hit && predicate(hit.pickedMesh) ? hit : null;
  }

  /** Room and wall a wall pick means: a shared wall is the wall of the room on the side you look from. */
  const wallTarget = (hit) => wallTargetOf(hit, st().is3D ? getCamera()?.position ?? null : null);

  // ─────────────────────────────────────────────────────────────────────
  //  Hover: preview + hint for what a click / drag would do
  // ─────────────────────────────────────────────────────────────────────

  // ── Size handles of the selected door / window ──
  // Three small boxes on its sides and top, drawn over the walls. Dragging one
  // resizes the opening (the opposite side stays put); one undo step per drag.
  let handles = null;
  let handleMat = null;
  function handleMeshes() {
    if (!handles) {
      const mat = handleMat = new StandardMaterial('plannerHandleMat', scene);
      mat.diffuseColor = Color3.FromHexString('#6b7cff');
      mat.emissiveColor = Color3.FromHexString('#6b7cff').scale(0.6);
      handles = ['start', 'end', 'top'].map((name) => {
        const m = MeshBuilder.CreateBox(`planner_handle_${name}`, { size: 1 }, scene);
        m.material = mat;
        m.metadata = { openingHandle: name };
        m.renderingGroupId = 1; // drawn over the wall and its frame
        m.checkCollisions = false;
        m.setEnabled(false);
        return m;
      });
    }
    return handles;
  }
  function hideHandles() {
    handles?.forEach((m) => m.setEnabled(false));
    heightHandles?.forEach((m) => m.setEnabled(false));
  }

  // ── Height handles of the selected room (3D) ──
  // A small box on top of each wall. Dragging one up or down changes the
  // height of the room's walls (raising past the floor raises the floor).
  let heightHandles = null;
  function showHeightHandles(room) {
    if (!heightHandles) {
      handleMeshes(); // shares the handle material
      heightHandles = ['north', 'south', 'east', 'west'].map((wallName) => {
        const m = MeshBuilder.CreateBox(`planner_height_${wallName}`, { size: 1 }, scene);
        m.material = handleMat;
        m.metadata = { heightHandle: wallName };
        m.renderingGroupId = 1;
        m.checkCollisions = false;
        m.setEnabled(false);
        return m;
      });
    }
    const top = elev() + (room.wallHeight ?? 3) + 0.08;
    for (const m of heightHandles) {
      const line = wallLine(room, m.metadata.heightHandle);
      const alongX = line.axis === 'z';
      const mid = (line.from + line.to) / 2;
      m.position.set(alongX ? mid : line.value, top, alongX ? line.value : mid);
      m.scaling.set(alongX ? 0.7 : 0.32, 0.16, alongX ? 0.32 : 0.7);
      m.setEnabled(true);
    }
  }

  /** The selected door/window if it is on the floor being edited: { room, kind, index, data, line }. */
  function selectedOpeningTarget() {
    const sel = st().selectedOpening;
    if (!sel) return null;
    const room = floorRooms().find((r) => r.id === sel.roomId);
    const data = room && openingData(room, sel.kind, sel.index);
    return data ? { room, kind: sel.kind, index: sel.index, data, line: wallLine(room, data.wall) } : null;
  }

  /** World position along the wall of an opening's two sides. */
  function openingEdges(t) {
    const centre = (t.line.axis === 'z' ? t.room.x : t.room.z) + t.data.offset;
    return { start: centre - t.data.width / 2, end: centre + t.data.width / 2, centre };
  }

  function showHandles(t) {
    const [hs, he, ht] = handleMeshes();
    const { start, end, centre } = openingEdges(t);
    const e = elev();
    const S = 0.16;
    const D = WALL_THICKNESS + 0.2;
    const place = (m, along, y, alongSize, ySize) => {
      const alongX = t.line.axis === 'z';
      m.position.set(alongX ? along : t.line.value, y, alongX ? t.line.value : along);
      m.scaling.set(alongX ? alongSize : D, ySize, alongX ? D : alongSize);
      m.setEnabled(true);
    };
    const midY = e + t.data.sill + t.data.height / 2;
    place(hs, start, midY, S, Math.min(0.6, t.data.height * 0.5));
    place(he, end, midY, S, Math.min(0.6, t.data.height * 0.5));
    place(ht, centre, e + t.data.sill + t.data.height, Math.min(0.6, t.data.width * 0.5), S);
  }

  /** Where the mouse meets the vertical plane of a wall: { along, y }, or null. */
  function wallPlanePoint(line) {
    const camera = getCamera();
    if (!camera) return null;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera);
    const alongX = line.axis === 'z';
    const dn = alongX ? ray.direction.z : ray.direction.x;
    if (Math.abs(dn) > 0.05) {
      const t = (line.value - (alongX ? ray.origin.z : ray.origin.x)) / dn;
      if (t > 0) {
        return {
          along: alongX ? ray.origin.x + ray.direction.x * t : ray.origin.z + ray.direction.z * t,
          y: ray.origin.y + ray.direction.y * t,
        };
      }
    }
    // Looking straight down (2D view): use the point on the floor
    const g = groundPoint();
    return g ? { along: alongX ? g.x : g.z, y: null } : null;
  }

  function updateSelectedOpening(t) {
    showHandles(t);
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => handles.includes(m) && m.isEnabled());
    const handle = hit?.hit ? hit.pickedMesh.metadata.openingHandle : null;
    const size = formatOpeningSize(t.kind, t.data.width, t.data.height);
    if (!handle) {
      setCursor('');
      hover = null;
      return {
        title: size,
        detail: `On ${t.room.name} · drag a blue handle to resize`,
        keys: [['Drag a handle', 'Resize'], ['Delete', `Remove ${t.kind}`], ['Esc', 'Deselect']],
      };
    }
    setCursor(handle === 'top' ? 'ns-resize' : t.line.axis === 'z' ? 'ew-resize' : 'ns-resize');
    hover = { type: 'grabHandle', handle };
    return { title: size, detail: handle === 'top' ? 'Drag to change the height' : 'Drag to change the width', keys: [['Drag', 'Resize']] };
  }

  /** Dragging a handle: the new size follows the mouse, in 0.1 m steps. */
  function updateOpeningDrag() {
    const t = selectedOpeningTarget();
    if (!t) { cancelDrag(); return null; }
    const p = wallPlanePoint(t.line);
    if (!p) return lastDragHint();
    const { start, end } = openingEdges(t);
    const step = (v) => Math.round(v / OPENING_STEP) * OPENING_STEP;
    let change;
    if (drag.handle === 'top') {
      if (p.y === null) return lastDragHint();
      change = { height: step(p.y - elev() - t.data.sill) };
    } else if (drag.handle === 'end') {
      change = { width: step(p.along - start), keep: 'start' };
    } else {
      change = { width: step(end - p.along), keep: 'end' };
    }
    const rooms = floorRooms();
    const result = resizeOpening(rooms, t.room, t.kind, t.index, change, {
      stairs: Object.values(st().objects).filter((o) => o.assetType === 'STAIRCASE'),
    });
    // Preview the size asked for (red if it can't be done)
    const w = change.width ?? t.data.width;
    const h = change.height ?? t.data.height;
    const offset = change.keep === 'start' ? t.data.offset - t.data.width / 2 + w / 2
      : change.keep === 'end' ? t.data.offset + t.data.width / 2 - w / 2 : t.data.offset;
    pv.opening(t.room, t.data.wall, offset, { width: Math.max(w, 0.05), height: Math.max(h, 0.05), sill: t.data.sill }, elev(), !result.problem);
    drag.plan = result.problem ? null : { target: t, result };
    const size = formatOpeningSize(t.kind, Math.max(w, 0), Math.max(h, 0));
    return saveDragHint(result.problem
      ? { title: size, detail: result.problem, bad: true, keys: [['Esc', 'Cancel']] }
      : { title: size, detail: `On ${t.room.name}`, keys: [['Release', 'Set this size'], ['Esc', 'Cancel']] });
  }

  function updateSelect() {
    const opening = selectedOpeningTarget();
    if (opening) {
      pv.hide('box');
      return updateSelectedOpening(opening);
    }
    hideHandles();
    const { selectedRoomId, selectedObjectId } = st();
    // An item is selected: its gizmo is the tool, not the room's walls
    const room = selectedObjectId ? null : floorRooms().find((r) => r.id === selectedRoomId);
    if (!room) {
      pv.hide('box');
      setCursor('');
      hover = null;
      return null;
    }
    // From above (2D) the walls' height can't be dragged; in 3D their top handles can
    if (st().is3D) {
      showHeightHandles(room);
      const top = scene.pick(scene.pointerX, scene.pointerY, (m) => heightHandles.includes(m) && m.isEnabled());
      if (top?.hit) {
        const wallName = top.pickedMesh.metadata.heightHandle;
        pv.wallTop(room, wallName, elev(), true);
        setCursor('ns-resize');
        hover = { type: 'grabHeight', roomId: room.id, wallName };
        return {
          title: 'Room height',
          detail: `${room.name} · walls ${(room.wallHeight ?? 3).toFixed(1)} m`,
          keys: [['Drag', 'Raise or lower the walls']],
        };
      }
    }
    const floorHit = scene.pick(scene.pointerX, scene.pointerY, (m) =>
      m.isPickable && m.isEnabled() && !pv.owns(m));
    if (floorHit?.hit && floorHit.pickedMesh.metadata?.roomId === room.id &&
      floorHit.pickedMesh.metadata?.part === 'floor') {
      setCursor('move');
      hover = { type: 'grabRoom', roomId: room.id };
      return {
        title: room.name,
        detail: `${formatRoomSize(room.width, room.depth)} · drag the floor to move`,
        keys: [['Drag', 'Move the room']],
      };
    }
    // Doors and windows are not grab points: clicking one selects it. In 2D
    // the wall over a door is what you see of the door, so it counts as the door.
    const hit = pickAtPointer((m) => m.metadata?.part === 'wall');
    let target = hit && wallTarget(hit);
    if (target?.roomId !== room.id) target = null; // another room's wall (or a shared one seen from the other side)
    if (target && !st().is3D && openingAt(room, target.wallName, hit.pickedPoint)) target = null;
    if (!target) {
      pv.hide('box');
      setCursor('');
      hover = null;
      return {
        title: room.name,
        detail: `${formatRoomSize(room.width, room.depth)} · walls ${(room.wallHeight ?? 3).toFixed(1)} m`,
        keys: [['Drag a wall', 'Resize the room'], ...(st().is3D ? [['Drag a top handle', 'Wall height']] : []), ['Delete', 'Remove room']],
      };
    }
    const { wallName } = target;
    pv.wallHighlight(room, wallName, elev(), true);
    setCursor(wallName === 'north' || wallName === 'south' ? 'ns-resize' : 'ew-resize');
    hover = { type: 'grabWall', roomId: room.id, wallName };
    return {
      title: `Resize ${room.name}`,
      detail: `${WALL_LABEL[wallName]} wall · ${formatRoomSize(room.width, room.depth)}`,
      keys: [['Drag', 'Move this wall'], ...VIEW_KEYS.slice(0, 2)],
    };
  }

  function updateDrawStart() {
    const p = snappedGround();
    setCursor('crosshair');
    hover = null;
    if (tool.kind === 'room') {
      if (p) pv.room({ x: p.x, z: p.z, width: 0.3, depth: 0.3 }, elev(), 0.3, true);
      else pv.hide('room');
      return {
        title: `Draw room: ${roomLabel()}`,
        detail: 'Drag on the floor from one corner to the opposite corner',
        keys: [['Drag', 'Draw'], ...VIEW_KEYS],
      };
    }
    if (p) pv.wall(p, null, elev(), true);
    else pv.hide('wall');
    return {
      title: 'Wall',
      detail: 'Drag from where the wall starts to where it ends',
      keys: [['Drag', 'Draw'], ...VIEW_KEYS],
    };
  }

  function updateOpening() {
    const kind = tool.kind;
    const label = kind === 'door' ? 'Door' : 'Window';
    const hit = pickAtPointer((m) => onLevel(m) && (m.metadata?.part === 'wall' || m.metadata?.part === kind));
    let meta = hit?.pickedMesh.metadata;
    if (meta?.part === 'wall') meta = { ...meta, ...wallTarget(hit) };
    const room = meta && floorRooms().find((r) => r.id === meta.roomId);
    if (!room) {
      pv.hide('box');
      setCursor('');
      hover = null;
      return { title: label, detail: 'Point at a room wall', keys: [['Click', `Add ${kind}`], ...VIEW_KEYS] };
    }
    const rooms = floorRooms();
    const point = hit.pickedPoint;

    // An existing door/window of this kind under the mouse (its frame, or the wall above a door): remove it
    const existing = meta.part === kind
      ? roomOpenings(room).find((o) => o.kind === kind && o.index === meta.openingIndex && o.wall === meta.wallName)
      : (() => { const o = openingAt(room, meta.wallName, point); return o?.kind === kind ? o : null; })();
    if (existing) {
      pv.opening(room, existing.wall, existing.offset,
        { width: existing.width + 0.1, height: existing.top - existing.bottom + 0.1, sill: existing.bottom - 0.05 },
        elev(), false);
      setCursor('pointer');
      hover = { type: 'removeOpening', kind, room, list: planRemoveOpening(rooms, room, existing.wall, point, kind, existing.index) };
      return { title: `Remove ${kind}`, detail: `On ${room.name}`, keys: [['Click', `Remove this ${kind}`]] };
    }

    if (meta.part !== 'wall') {
      pv.hide('box');
      hover = null;
      return { title: label, detail: 'Point at a room wall' };
    }
    const plan = planOpening(rooms, room, meta.wallName, point, kind);
    pv.opening(room, meta.wallName, plan.offset ?? 0, plan.defaults, elev(), !plan.problem);
    setCursor(plan.problem ? 'not-allowed' : 'pointer');
    if (plan.problem) {
      hover = null;
      return { title: label, detail: plan.problem, bad: true };
    }
    hover = { type: 'addOpening', kind, room, list: plan.list, partner: plan.partner };
    return {
      title: label,
      detail: plan.partner ? `Between ${room.name} and ${plan.partner.room.name}` : `On ${room.name}`,
      keys: [['Click', `Add ${kind}`], ...VIEW_KEYS],
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Dragging
  // ─────────────────────────────────────────────────────────────────────

  /** Dragging a height handle: the top of the walls follows the mouse, in 0.1 m steps. */
  function updateHeightDrag() {
    const room = floorRooms().find((r) => r.id === drag.roomId);
    if (!room) { cancelDrag(); return null; }
    const p = wallPlanePoint(wallLine(room, drag.wallName));
    if (!p || p.y === null) return lastDragHint();
    const wallHeight = Math.min(MAX_WALL_HEIGHT, Math.max(MIN_WALL_HEIGHT, Math.round((p.y - elev()) / HEIGHT_STEP) * HEIGHT_STEP));
    const plan = planWallHeight(st().floors, Object.values(st().rooms), room, wallHeight);
    pv.room(room, elev(), wallHeight, !plan.problem);
    drag.plan = plan.problem ? null : { room, wallHeight, result: plan };
    return saveDragHint(plan.problem
      ? { title: 'Room height', detail: plan.problem, bad: true, keys: [['Esc', 'Cancel']] }
      : { title: 'Room height', detail: wallHeightText(room, plan, floorName(plan.floorId)), keys: [['Release', 'Set this height'], ['Esc', 'Cancel']] });
  }

  function updateDrag() {
    if (drag.kind === 'opening') return updateOpeningDrag();
    if (drag.kind === 'height') return updateHeightDrag();
    const p = snappedGround();
    if (drag.kind === 'stretch') {
      const room = floorRooms().find((r) => r.id === drag.roomId);
      if (!room) { cancelDrag(); return null; }
      if (!p) return lastDragHint();
      const alongZ = drag.wallName === 'north' || drag.wallName === 'south';
      const result = stretchRoom(room, drag.wallName, alongZ ? p.z : p.x, {
        rooms: floorRooms(), objects: Object.values(st().objects), below: belowRooms(), nameOf,
      });
      pv.room(result.rect, elev(), room.wallHeight ?? 3, !result.problem);
      drag.plan = result.problem ? null : { room, result };
      if (result.problem) return saveDragHint({ title: `Resize ${room.name}`, detail: result.problem, bad: true, keys: [['Esc', 'Cancel']] });
      const change = Math.abs(result.delta) < 0.01 ? 'no change'
        : `${result.delta > 0 ? '+' : '−'}${Math.abs(result.delta).toFixed(1)} m`;
      const size = `${formatRoomSize(result.rect.width, result.rect.depth)} (${change})`;
      return saveDragHint({
        title: `Resize ${room.name}`,
        detail: result.overhang ? `${size} · ${OVERHANG_WARNING}` : size,
        keys: [['Release', 'Put the wall here'], ['Esc', 'Cancel']],
      });
    }
    if (drag.kind === 'move') {
      const room = floorRooms().find((r) => r.id === drag.roomId);
      if (!room) { cancelDrag(); return null; }
      if (!p) return lastDragHint();
      const result = planRoomMove(room, drag.origin.x + p.x - drag.start.x, drag.origin.z + p.z - drag.start.z, floorRooms());
      pv.room(result.rect, elev(), room.wallHeight ?? 3, !result.blocker);
      drag.plan = result.blocker ? null : { room, result };
      return saveDragHint(result.blocker
        ? { title: `Move ${room.name}`, detail: `Overlaps ${result.blocker.name}. Move the room.`, bad: true, keys: [['Esc', 'Cancel']] }
        : { title: `Move ${room.name}`, detail: `${formatRoomSize(room.width, room.depth)} · inside ${result.rect.x.toFixed(1)}, ${result.rect.z.toFixed(1)}`, keys: [['Release', 'Move the room'], ['Esc', 'Cancel']] });
    }

    if (!p) return lastDragHint();
    drag.end = p;
    const moved = Math.abs(p.x - drag.start.x) > 1e-6 || Math.abs(p.z - drag.start.z) > 1e-6;

    if (drag.kind === 'room') {
      if (!moved) {
        pv.room({ x: p.x, z: p.z, width: 0.3, depth: 0.3 }, elev(), 0.3, true);
        drag.plan = null;
        return saveDragHint({ title: `Draw room: ${roomLabel()}`, detail: 'Keep dragging to the opposite corner', keys: [['Esc', 'Cancel']] });
      }
      const { rect, blocker, overhang } = planRoom(drag.start, p, floorRooms(), belowRooms());
      pv.room(rect, elev(), 1.2, !blocker);
      drag.plan = blocker ? null : { rect };
      const size = formatRoomSize(rect.width, rect.depth);
      return saveDragHint(blocker
        ? { title: `Draw room: ${roomLabel()}`, detail: `Overlaps ${blocker.name}. Move the corner.`, bad: true, keys: [['Esc', 'Cancel']] }
        : { title: `Draw room: ${roomLabel()}`, detail: overhang ? `${size} · ${OVERHANG_WARNING}` : size, keys: [['Release', 'Build it'], ['Esc', 'Cancel']] });
    }

    // wall
    const t = wallSegmentTransform(drag.start, p);
    const ok = t.length >= 0.5;
    pv.wall(drag.start, p, elev(), ok);
    drag.plan = ok ? { a: drag.start, b: p } : null;
    return saveDragHint(ok
      ? { title: 'Wall', detail: `${t.length.toFixed(1)} m long`, keys: [['Release', 'Build it'], ['Esc', 'Cancel']] }
      : { title: 'Wall', detail: 'Too short', bad: true, keys: [['Esc', 'Cancel']] });
  }

  const saveDragHint = (h) => { drag.hint = h; return h; };
  const lastDragHint = () => drag.hint ?? null;

  function commitDrag() {
    const d = drag;
    endDrag();
    if (!d.plan) {
      // Say why nothing was built (a plain click, an overlap, too short)
      if (d.hint?.bad) onMessage(d.hint.detail, true);
      else if (d.kind === 'room') onMessage('Drag from one corner to the opposite corner');
      return;
    }
    const { currentFloor } = st();
    if (d.kind === 'height') {
      const { room, wallHeight } = d.plan;
      if (Math.abs(wallHeight - (room.wallHeight ?? 3)) < 1e-6) return;
      const plan = actions.setWallHeight(room.id, wallHeight, { label: `Wall height of ${room.name}` });
      if (plan?.problem) onMessage(plan.problem, true);
      else if (plan) onMessage(`${wallHeightText(room, plan, floorName(plan.floorId))}. Ctrl+Z to undo.`);
    } else if (d.kind === 'opening') {
      const { target, result } = d.plan;
      if (Math.abs(result.width - target.data.width) < 1e-6 && Math.abs(result.height - target.data.height) < 1e-6) return;
      actions.resizeOpening(result.list, { label: `Resize ${target.kind}` });
      onMessage(`${formatOpeningSize(target.kind, result.width, result.height)}. Ctrl+Z to undo.`);
    } else if (d.kind === 'stretch') {
      const { room, result } = d.plan;
      if (Math.abs(result.delta) < 0.01) return;
      actions.updateRoom(room.id, result.patch, { label: `Resize ${room.name}` });
      onMessage(`${room.name} is now ${formatRoomSize(result.rect.width, result.rect.depth)}. Ctrl+Z to undo.`);
    } else if (d.kind === 'move') {
      const { room, result } = d.plan;
      if (Math.abs(result.rect.x - room.x) < 0.01 && Math.abs(result.rect.z - room.z) < 0.01) return;
      actions.updateRoom(room.id, { x: result.rect.x, z: result.rect.z }, { label: `Move ${room.name}` });
      onMessage(`Moved ${room.name}. Ctrl+Z to undo.`);
    } else if (d.kind === 'room') {
      const { rect } = d.plan;
      actions.addRoom({ type: tool.roomType, ...rect, floor: currentFloor });
      onMessage(`Built ${roomLabel()} room, ${formatRoomSize(rect.width, rect.depth)}`);
    } else {
      const { data, length } = wallSegmentData(d.plan.a, d.plan.b, floorRooms());
      actions.addObject({ ...data, category: ASSET_TYPES.WALL_SEGMENT?.category, floor: currentFloor });
      onMessage(`Built a ${length.toFixed(1)} m wall`);
    }
  }

  function startDrag(d) {
    drag = d;
    pv.hide('box');
    hideHandles();
    getCamera()?.detachControl();
    window.addEventListener('pointerup', onWindowPointerUp);
  }

  function endDrag() {
    drag = null;
    pv.hideAll();
    window.removeEventListener('pointerup', onWindowPointerUp);
    const camera = getCamera();
    if (camera && scene.activeCamera === camera) camera.attachControl(canvas, true);
  }

  function cancelDrag() {
    if (!drag) return;
    endDrag();
    refresh();
  }

  // Releasing the mouse outside the canvas still finishes the drag
  function onWindowPointerUp(e) {
    if (drag && e.button === 0) {
      commitDrag();
      refresh();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Public API (WorkplaceEditor forwards the scene's pointer events)
  // ─────────────────────────────────────────────────────────────────────

  function refresh() {
    if (!enabled) { hideHandles(); hint(null); return; }
    let h;
    if (drag) h = updateDrag();
    else if (tool.kind === 'select') h = updateSelect();
    else if (tool.kind === 'room' || tool.kind === 'wall') h = updateDrawStart();
    else h = updateOpening();
    if (!drag && tool.kind !== 'select') hideHandles();
    hint(h);
  }

  /** @returns {boolean} true if the tool used the click (no selection / camera drag) */
  function pointerDown(evt) {
    if (!enabled) return false;
    if (evt.button !== 0) {
      if (drag) { cancelDrag(); return true; }
      return false;
    }
    refresh(); // make sure `hover` matches where the mouse is now
    if (tool.kind === 'select') {
      if (hover?.type === 'grabHandle') {
        startDrag({ kind: 'opening', handle: hover.handle });
      } else if (hover?.type === 'grabHeight') {
        startDrag({ kind: 'height', roomId: hover.roomId, wallName: hover.wallName });
      } else if (hover?.type === 'grabWall') {
        startDrag({ kind: 'stretch', roomId: hover.roomId, wallName: hover.wallName });
      } else if (hover?.type === 'grabRoom') {
        const p = snappedGround();
        const room = floorRooms().find((r) => r.id === hover.roomId);
        if (p && room) startDrag({ kind: 'move', roomId: room.id, start: p, origin: { x: room.x, z: room.z } });
      } else {
        return false;
      }
    } else if (tool.kind === 'room' || tool.kind === 'wall') {
      const p = snappedGround();
      if (!p) return false;
      startDrag({ kind: tool.kind, start: p });
    } else {
      if (!hover) return false;
      const { type, kind, room, list, partner } = hover;
      if (type === 'addOpening') {
        actions.addOpenings(list);
        onMessage(partner ? `Added ${kind} between ${room.name} and ${partner.room.name}` : `Added ${kind} to ${room.name}`);
      } else {
        actions.removeOpenings(list);
        onMessage(`Removed ${kind}. Ctrl+Z to undo.`);
      }
      return true;
    }
    hint(updateDrag());
    return true;
  }

  return {
    pointerMove: refresh,
    pointerDown,
    refresh,

    /** tool: { kind: 'select' } | { kind: 'room', roomType } | { kind: 'wall' | 'door' | 'window' } */
    setTool(next) {
      cancelDrag();
      tool = { ...next };
      pv.hideAll();
      hover = null;
      setCursor('');
      refresh();
    },
    getTool: () => tool,
    isDragging: () => !!drag,
    cancel: cancelDrag,

    /** Off in Build mode (it has its own tools). */
    setEnabled(on) {
      enabled = on;
      if (!on) {
        cancelDrag();
        pv.hideAll();
        hover = null;
        setCursor('');
      }
      refresh();
    },

    dispose() {
      cancelDrag();
      pv.dispose();
      handles?.forEach((m) => m.dispose());
      heightHandles?.forEach((m) => m.dispose());
      handleMat?.dispose();
      handles = null;
      heightHandles = null;
    },
  };
}
