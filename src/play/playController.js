/**
 * play/playController.js
 *
 * PLAY MODE: you are a character in the company building and you build it
 * Minecraft-style, with whatever tool is in your hand (hotbar).
 *
 *   Move          W A S D (Shift = run), Space = jump
 *   Look          mouse (click the view to capture the mouse, Esc to release)
 *   Fly           F toggles flying; Space = up, C = down
 *   Camera        V switches third-person / first-person
 *   Use tool      Left-click
 *   Remove        Right-click (cancels a half-drawn room/wall first)
 *   Rotate        R (furniture)
 *   Interact      E on what you look at (other modules decide what happens)
 *   Hotbar        1-9 or mouse wheel, B = open catalog
 *   New floor     N adds a floor above (asks: copy the rooms below, or empty) and takes you there
 *   Floors        Page Up / Page Down: the floor above / below, at the same spot
 *                 (standing if there is a room there, else flying)
 *   Planner       Tab
 *
 * Tools (the item in your hand):
 *   { kind: 'room', roomType }  click two opposite corners on the ground
 *   { kind: 'wall' }            click start and end of a free-standing wall
 *   { kind: 'door' | 'window' } aim at a room wall and click
 *   { kind: 'stretch' }         click a room's wall to grab it, aim where it
 *                               should go, click again (grow / shrink the room).
 *                               The TOP edge of a wall (or + / −) changes the
 *                               height of the room's walls instead
 *   { kind: 'object', assetType } aim at the floor (or a desk top) and click
 *   { kind: 'edit' }            the planner's move / rotate / scale on what you
 *                               look at: click picks an item up (click again to
 *                               put it down), R turns it, + / − resizes it,
 *                               0 = normal size, L locks / unlocks it
 *
 * Build mode and the planner decide WHAT to build with the same pure functions
 * (geometry.js / building.js) and show the same previews (utils/buildPreview.js).
 *
 * The controller never edits the store itself: it calls `actions.*`
 * (WorkplaceEditor passes editorHistory functions), so every build is undoable.
 * Room/object meshes are still drawn by WorkplaceEditor's sync effects.
 */

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Ray } from '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Rendering/outlineRenderer';

import { buildAssetMesh, ASSET_TYPES } from '../utils/assetCatalog';
import { disposeMaterialIfOwned } from '../utils/materialLibrary';
import { createBuildPreview } from '../utils/buildPreview';
import { itemOverFloorPoint } from '../utils/pickHelpers';
import { ROOM_TYPES } from '../utils/roomStore';
import { createCharacter } from './character';
import { moveWithSteps } from './movement';
import {
  snap, wallSegmentTransform, findRoomAt, formatRoomSize,
  planRoom, planOpening, planRemoveOpening, wallSegmentData, resizeItem,
  stretchRoom, openingData, openingPartner, resizeOpening, resetOpeningSize, formatOpeningSize, OPENING_STEP,
  wallLine, OVERHANG_WARNING,
} from './geometry';
import {
  levelForY, elevationOf, supportHeight, stairHeightAt, floorAbove, floorBelow, placementHeight,
  floorHeight, floorPosition, stairDimsFor, stairNeedsRoomAbove, arrivalOnFloor, planWallHeight,
  HEIGHT_STEP, MIN_WALL_HEIGHT, MAX_WALL_HEIGHT, wallHeightText,
} from './building';

// ── Feel ──
const WALK = 4.2;
const RUN = 7.5;
const FLY = 9;
const JUMP_SPEED = 5.2;
const GRAVITY = -18;
const MOUSE_SENS = 0.0022;
const BODY_RADIUS = 0.32;
const BODY_HEIGHT = 1.8;
const EYE = 1.62;
const CAM_DISTANCE = 3.8;
const SHOULDER = 0.85;
const REACH = 9;          // furniture / doors: how far you can build
const FLOOR_REACH = 45;   // rooms / walls: corners can be far away
const ROOM_FLOOR_Y = 0.02;
const INTERACT_REACH = 3.5; // E works on things within this distance of the character
const ROOM_STICKY = 0.25;   // stay "in" a room this far past its edge (no flicker in doorways)

// Tools you place on the ground: show the build grid while holding them
const GROUND_BUILD_KINDS = new Set(['room', 'wall', 'stretch']);
const WALL_LABEL = { north: 'north', south: 'south', east: 'east', west: 'west' };
const STAIRS_NEED_ROOM = 'Build a room above to use these stairs';
const TOP_EDGE = 0.35; // aiming this close to the top of a wall grabs its top (wall height)

export function createPlayController(scene, canvas, {
  getState,              // () => ({ rooms: Room[], objects: Obj[], currentFloor })
  actions,               // { addObject, updateObject, deleteObject, toggleLock, addRoom, deleteRoom, updateRoom, addOpenings, removeOpenings }
  getObjectMesh = () => null, // (objectId) => root mesh of a placed item (Edit tool)
  onHud = () => {},      // (info) => void
  onSlotKey = () => {},  // (index 0-8) => void
  onSlotScroll = () => {}, // (+1 | -1) => void
  onCatalog = () => {},  // () => void
  onExit = () => {},     // () => void   (Tab → planner)
  onInteract = () => {}, // (target) => void  (E — hook for teammates' modules)
  describeInteraction = () => null, // (target) => { label, name } | null  (what E would do, for the prompt)
  onRoomChange = () => {}, // (fromRoom | null, toRoom | null) => void
  onLevelChange = () => {}, // (floorId) => void   the floor your character is on changed
  onViewChange = () => {},  // ({ inside, level }) => void   for showing/hiding storeys
  onBuildToolChange = () => {}, // (isBuildTool) => void
  onAskNewFloor = () => {}, // () => void   N on the top floor: ask "copy rooms or empty", then call goToFloor
  shadowGenerator = null,
}) {
  // ── Camera ──
  const camera = new FreeCamera('playCamera', new Vector3(0, 3, -10), scene);
  camera.minZ = 0.05;
  camera.fov = 1.0;
  camera.inputs.clear(); // we drive it ourselves

  // ── Player collider (invisible) + character ──
  const collider = MeshBuilder.CreateBox('playerCollider', { size: 0.2 }, scene);
  collider.isVisible = false;
  collider.isPickable = false;
  collider.checkCollisions = false;
  collider.ellipsoid = new Vector3(BODY_RADIUS, BODY_HEIGHT / 2, BODY_RADIUS);
  collider.ellipsoidOffset = new Vector3(0, BODY_HEIGHT / 2, 0);
  collider.setEnabled(false);

  const character = createCharacter(scene, { shadowGenerator });
  character.root.parent = collider;
  character.setVisible(false);

  // ── Previews (same look as the planner's): blue = OK, red = can't ──
  const pv = createBuildPreview(scene, 'play');
  const GHOST_OK = pv.materials.ok;
  const GHOST_BAD = pv.materials.bad;
  const OUTLINE_OK = Color3.FromHexString('#4d9bff');
  const OUTLINE_LOCKED = Color3.FromHexString('#f5a623');

  // ── State ──
  let active = false;
  let locked = false;
  let yaw = 0;
  let pitch = -0.3;
  let vy = 0;
  let grounded = true;
  let flying = false;
  let firstPerson = false;
  let tool = null;
  let ghost = null;          // furniture preview (a translucent copy of the item)
  let ghostRotation = 0;
  let cornerA = null;        // first click of a room / wall
  let grab = null;           // Stretch tool: { roomId, wallName } of the wall being moved
  let carry = null;          // Edit tool: the item being moved { id, mesh, rotationY, collisions }
  let outlined = null;       // Edit tool: { id, meshes } of the item outlined under the crosshair
  let message = null;        // short feedback text (e.g. "Removed Desk")
  let messageUntil = 0;
  let lastHud = '';
  let savedCamera = null;
  let aim = null;            // what the current click would do
  let currentRoomId;         // room the character is in (undefined = not checked yet)
  let currentLevel = 0;      // floor (id) the character is on, from its height
  let lastView = null;       // { inside, level } last sent to onViewChange
  let promptTarget = null;   // what E would interact with right now
  const keys = new Set();

  // ─────────────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────────────

  const feet = () => collider.position;
  const lookDir = () => new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  const state = () => getState();
  // Rooms on the floor the character is on (not the planner's floor)
  const floorRooms = () => state().rooms.filter((r) => r.floor === currentLevel);
  const levelElev = () => elevationOf(state().floors, currentLevel);
  const stairsList = () => state().objects.filter((o) => o.assetType === 'STAIRCASE');
  /** Rooms on the floor below the one you're on (null on the lowest floor). */
  const belowRooms = () => {
    const below = floorBelow(state().floors, currentLevel);
    return below ? state().rooms.filter((r) => r.floor === below.id) : null;
  };
  const floorName = (id) => Object.values(state().floors).find((f) => f.id === id)?.name ?? 'This floor';
  const onThisLevel = (m) =>
    (m.metadata?.floorId ?? m.parent?.metadata?.floorId ?? currentLevel) === currentLevel;
  const say = (text, ms = 3000) => {
    message = text;
    messageUntil = performance.now() + ms;
  };
  const isPlayerMesh = (m) => m === collider || m.isDescendantOf?.(character.root);
  const isGhostMesh = (m) =>
    (ghost && (m === ghost || m.isDescendantOf?.(ghost))) ||
    (carry && (m === carry.mesh || m.isDescendantOf?.(carry.mesh))) ||
    pv.owns(m);
  const itemName = (o) => o?.label || ASSET_TYPES[o?.assetType]?.label || 'Item';

  function setGhostMaterial(node, material) {
    const meshes = node.getChildMeshes ? [node, ...node.getChildMeshes(false)] : [node];
    for (const m of meshes) {
      if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
      if (m.material === material) continue;
      if (m.material && m.material !== GHOST_OK && m.material !== GHOST_BAD) disposeMaterialIfOwned(m.material);
      m.material = material;
      m.isPickable = false;
      m.checkCollisions = false;
    }
  }

  function clearGhost() {
    ghost?.dispose(false, false);
    ghost = null;
    pv.hide('box');
    setOutline(null);
    endCarry(true);
  }

  function clearPreview() {
    pv.hide('room', 'wall');
    cornerA = null;
    grab = null;
  }

  /** Outline the item under the crosshair (Edit tool); null clears it. */
  function setOutline(objectId, color) {
    if (outlined && (outlined.id !== objectId || !color)) {
      outlined.meshes.forEach((m) => { m.renderOutline = false; });
      outlined = null;
    }
    if (!objectId || !color) return;
    if (!outlined) {
      const root = getObjectMesh(objectId);
      if (!root) return;
      outlined = { id: objectId, meshes: [root, ...root.getChildMeshes(false)].filter((m) => m.getTotalVertices?.() > 0) };
    }
    for (const m of outlined.meshes) {
      m.renderOutline = true;
      m.outlineColor = color;
      m.outlineWidth = 0.025;
    }
  }

  /** Edit tool: pick an item up. Its real mesh follows the crosshair until it is put down. */
  function startCarry(obj) {
    const mesh = getObjectMesh(obj.id);
    if (!mesh) return false;
    setOutline(null);
    const meshes = [mesh, ...mesh.getChildMeshes(false)];
    carry = {
      id: obj.id,
      mesh,
      rotationY: obj.rotationY ?? 0,
      // don't bump into the item you are carrying
      collisions: meshes.map((m) => [m, m.checkCollisions]),
    };
    meshes.forEach((m) => { m.checkCollisions = false; });
    return true;
  }

  /** Stop carrying; `restore` puts the mesh back where the store says it is. */
  function endCarry(restore) {
    if (!carry) return;
    carry.collisions.forEach(([m, c]) => { m.checkCollisions = c; });
    const o = state().objects.find((x) => x.id === carry.id);
    if (restore && o && !carry.mesh.isDisposed()) {
      carry.mesh.position.set(o.x, elevationOf(state().floors, o.floor ?? 0) + (o.y ?? 0), o.z);
      carry.mesh.rotation.y = o.rotationY ?? 0;
    }
    carry = null;
  }

  /** Point on the ground plane the crosshair is aiming at */
  function aimGround(maxDist) {
    const origin = camera.position;
    const dir = lookDir();
    if (dir.y > -0.01) return null;
    const t = (levelElev() + ROOM_FLOOR_Y - origin.y) / dir.y;
    if (t < 0) return null;
    const p = origin.add(dir.scale(t));
    if (Vector3.Distance(p, feet()) > maxDist) return null;
    return p;
  }

  /**
   * First mesh under the crosshair that passes `predicate`. The invisible panes
   * in doorways/windows (roomBuilder) are looked through unless `panes` is set:
   * aiming through a door at a desk targets the desk.
   */
  function aimPick(predicate, maxDist = REACH + CAM_DISTANCE, { panes = false } = {}) {
    const ray = new Ray(camera.position, lookDir(), maxDist);
    const hit = scene.pickWithRay(ray, (m) =>
      m.isPickable && m.isEnabled() && m.isVisible !== false && !isPlayerMesh(m) && !isGhostMesh(m) &&
      (panes || !m.metadata?.pickPane) && predicate(m));
    return hit?.hit ? hit : null;
  }

  const objectIdOf = (m) => m.metadata?.objectId ?? m.parent?.metadata?.objectId ?? null;
  const roomPartOf = (m) => (m.metadata?.roomId ? m.metadata : null);

  // ─────────────────────────────────────────────────────────────────────
  //  Tools: preview every frame
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Where an item would go under the crosshair: the floor you are on, or the
   * top of furniture (a monitor on a desk). Not the ground under an upper
   * floor, not the storey below. Returns {x, z, worldY, y} or {problem, bad}.
   */
  function aimSurface() {
    const hit = aimPick((m) =>
      (m.name === 'ground' && levelElev() === 0) ||
      ((m.metadata?.part === 'floor' || !!objectIdOf(m)) && onThisLevel(m)));
    if (!hit || Vector3.Distance(hit.pickedPoint, feet()) > REACH) {
      return { problem: 'Aim at the floor to place it' };
    }
    const p = hit.pickedPoint;
    const surface = objectIdOf(hit.pickedMesh) ? 'object' : hit.pickedMesh.name === 'ground' ? 'ground' : 'floor';
    const h = placementHeight({ surface, normalY: hit.getNormal(true)?.y ?? 0, pointY: p.y, elevation: levelElev() });
    if (!h) return { problem: 'Aim at the floor or the top of a table', bad: true };
    return { x: snap(p.x, 0.25), z: snap(p.z, 0.25), worldY: h.worldY, y: h.y };
  }

  function updateObjectTool() {
    const s = aimSurface();
    if (s.problem) {
      ghost?.setEnabled(false);
      aim = null;
      return { title: tool.label, detail: s.problem, bad: s.bad };
    }
    const { x, z, worldY, y } = s;

    if (!ghost) {
      // A staircase climbs the height of the floor it stands on
      ghost = buildAssetMesh(tool.assetType, scene, 'play_ghost', { rise: floorHeight(state().floors, currentLevel) });
      setGhostMaterial(ghost, GHOST_OK);
    }
    ghost.setEnabled(true);
    ghost.position.set(x, worldY, z);
    ghost.rotation.y = ghostRotation;

    aim = { type: 'placeObject', x, y, z };
    const keys = [['Left-click', 'Place'], ['R', 'Rotate'], ['Right-click', 'Remove']];
    if (tool.assetType === 'STAIRCASE' &&
        stairNeedsRoomAbove({ x, z, rotationY: ghostRotation, floor: currentLevel }, state().floors, state().rooms)) {
      return { title: tool.label, detail: STAIRS_NEED_ROOM, keys };
    }
    return { title: tool.label, keys };
  }

  function updateRoomTool() {
    const p = aimGround(FLOOR_REACH);
    if (!p) {
      pv.hide('room');
      aim = null;
      return { title: `${ROOM_TYPES[tool.roomType]?.label ?? 'New'} room`, detail: cornerA ? 'Look down at the ground for the opposite corner' : 'Look at the ground to start the room' };
    }
    const point = { x: snap(p.x, 0.5), z: snap(p.z, 0.5) };
    const label = ROOM_TYPES[tool.roomType]?.label ?? 'room';

    if (!cornerA) {
      // show a small marker at the first-corner position
      pv.room({ x: point.x, z: point.z, width: 0.3, depth: 0.3 }, levelElev(), 0.3, true);
      aim = { type: 'roomCorner', point };
      return { title: `${label} room`, detail: 'Click where the first corner goes', keys: [['Left-click', 'First corner'], ['Right-click', 'Remove']] };
    }

    const { rect, blocker, overhang } = planRoom(cornerA, point, floorRooms(), belowRooms());
    const ok = !blocker;
    pv.room(rect, levelElev(), 1.2, ok);
    aim = ok ? { type: 'roomFinish', rect } : null;
    const size = formatRoomSize(rect.width, rect.depth);
    return ok
      ? { title: `${label} room`, detail: overhang ? `${size} · ${OVERHANG_WARNING}` : size, keys: [['Left-click', 'Opposite corner'], ['Right-click', 'Cancel']] }
      : { title: `${label} room`, detail: `Overlaps ${blocker.name}. Move the corner.`, bad: true, keys: [['Right-click', 'Cancel']] };
  }

  function updateWallTool() {
    const p = aimGround(FLOOR_REACH);
    if (!p) {
      pv.hide('wall');
      aim = null;
      return { title: 'Wall', detail: 'Look at the ground to place the wall' };
    }
    const point = { x: snap(p.x, 0.5), z: snap(p.z, 0.5) };

    if (!cornerA) {
      pv.wall(point, null, levelElev(), true);
      aim = { type: 'wallStart', point };
      return { title: 'Wall', detail: 'Click where the wall starts', keys: [['Left-click', 'Start'], ['Right-click', 'Remove']] };
    }
    const t = wallSegmentTransform(cornerA, point);
    const ok = t.length >= 0.5;
    pv.wall(cornerA, point, levelElev(), ok);
    aim = ok ? { type: 'wallFinish', a: cornerA, b: point } : null;
    return ok
      ? { title: 'Wall', detail: `${t.length.toFixed(1)} m long`, keys: [['Left-click', 'End here'], ['Right-click', 'Stop']] }
      : { title: 'Wall', detail: 'Too short', bad: true, keys: [['Right-click', 'Stop']] };
  }

  function updateOpeningTool() {
    const kind = tool.kind; // 'door' | 'window'
    const kindLabel = kind === 'door' ? 'Door' : 'Window';
    const hit = aimPick((m) => m.metadata?.part === 'wall' && onThisLevel(m));
    if (!hit || Vector3.Distance(hit.pickedPoint, feet()) > REACH) {
      pv.hide('box');
      aim = null;
      return { title: kindLabel, detail: `Aim at a room wall` };
    }
    const { roomId, wallName } = hit.pickedMesh.metadata;
    const room = floorRooms().find((r) => r.id === roomId);
    if (!room) { pv.hide('box'); aim = null; return { title: kindLabel }; }

    const plan = planOpening(floorRooms(), room, wallName, hit.pickedPoint, kind);
    // Ghost box sitting in the wall
    pv.opening(room, wallName, plan.offset ?? 0, plan.defaults, levelElev(), !plan.problem);

    if (plan.problem) {
      aim = null;
      return { title: kindLabel, detail: plan.problem, bad: true };
    }
    aim = { type: 'opening', kind, room, list: plan.list, partner: plan.partner };
    return {
      title: kindLabel,
      detail: plan.partner ? `Between ${room.name} and ${plan.partner.room.name}` : `On ${room.name}`,
      keys: [['Left-click', `Add ${kind}`], ['Right-click', 'Remove']],
    };
  }

  /** "Office · walls 3.4 m · Ground Floor is now 3.7 m high" */
  const heightText = (room, plan) => wallHeightText(room, plan, floorName(plan.floorId));

  // Last wall-height change that was blocked: its reason stays in the hint for a moment
  let heightBlocked = null; // { text, until }

  /** Stretch tool, top of a wall grabbed: the top follows where you look on the wall. */
  function updateWallTopDrag(room) {
    const line = wallLine(room, grab.wallName);
    const alongX = line.axis === 'z';
    const origin = camera.position;
    const dir = lookDir();
    const dn = alongX ? dir.z : dir.x;
    const t = Math.abs(dn) > 0.02 ? (line.value - (alongX ? origin.z : origin.x)) / dn : -1;
    if (t <= 0) {
      pv.hide('room');
      aim = null;
      return { title: 'Room height', detail: 'Look at the wall to set its height', keys: [['Right-click', 'Cancel']] };
    }
    const raw = origin.y + dir.y * t - levelElev();
    const wallHeight = Math.min(MAX_WALL_HEIGHT, Math.max(MIN_WALL_HEIGHT, Math.round(raw / HEIGHT_STEP) * HEIGHT_STEP));
    const plan = planWallHeight(state().floors, state().rooms, room, wallHeight);
    pv.room(room, levelElev(), wallHeight, !plan.problem);
    if (plan.problem) {
      aim = null;
      return { title: 'Room height', detail: plan.problem, bad: true, keys: [['Right-click', 'Cancel']] };
    }
    aim = { type: 'dropTop', room, wallHeight };
    return {
      title: 'Room height',
      detail: heightText(room, plan),
      keys: [['Left-click', 'Set this height'], ['+ / −', '0.1 m'], ['Right-click', 'Cancel']],
    };
  }

  /** Stretch tool + / −: raise or lower the walls of the room you aim at (or have grabbed). */
  function stretchKey(code) {
    if (tool?.kind !== 'stretch') return false;
    const bigger = code === 'Equal' || code === 'NumpadAdd';
    const smaller = code === 'Minus' || code === 'NumpadSubtract';
    if (!bigger && !smaller) return false;
    const roomId = grab?.roomId ?? (aim?.type === 'grabWall' || aim?.type === 'grabTop' ? aim.roomId : null);
    const room = roomId && state().rooms.find((r) => r.id === roomId);
    if (!room) {
      say('Aim at a wall of a room first', 1500);
      return true;
    }
    const wallHeight = Math.round(((room.wallHeight ?? 3) + (bigger ? HEIGHT_STEP : -HEIGHT_STEP)) * 10) / 10;
    // A burst of presses is one undo step
    const plan = actions.setWallHeight?.(room.id, wallHeight, { label: `Wall height of ${room.name}`, mergeKey: 'play-wall-height' });
    if (plan?.problem) {
      heightBlocked = { text: plan.problem, until: performance.now() + 3000 };
    } else if (plan) {
      heightBlocked = null;
      say(heightText(room, plan), 2500);
    }
    return true;
  }

  function updateStretchTool() {
    const rooms = floorRooms();
    const blocked = heightBlocked && performance.now() < heightBlocked.until ? heightBlocked.text : null;

    // ── Step 1: aim at a wall to grab (its side moves the wall, its top changes the height) ──
    if (!grab) {
      const hit = aimPick((m) => !!m.metadata?.roomId && !!m.metadata?.wallName && onThisLevel(m));
      const room = hit && rooms.find((r) => r.id === hit.pickedMesh.metadata.roomId);
      if (!hit || !room || Vector3.Distance(hit.pickedPoint, feet()) > REACH + 4) {
        pv.hide('box');
        aim = null;
        return { title: 'Stretch room', detail: 'Aim at a wall of a room to move it, or at its top to change the height' };
      }
      const { wallName } = hit.pickedMesh.metadata;
      const wallHeight = room.wallHeight ?? 3;
      const nearTop = levelElev() + wallHeight - hit.pickedPoint.y < TOP_EDGE || (hit.getNormal(true)?.y ?? 0) > 0.7;
      if (nearTop) {
        pv.wallTop(room, wallName, levelElev(), true);
        aim = { type: 'grabTop', roomId: room.id, wallName };
        return {
          title: 'Room height',
          detail: blocked ?? `${room.name} · walls ${wallHeight.toFixed(1)} m`,
          bad: !!blocked,
          keys: [['Left-click', 'Grab the top'], ['+ / −', 'Higher / lower']],
        };
      }
      pv.wallHighlight(room, wallName, levelElev(), true);
      aim = { type: 'grabWall', roomId: room.id, wallName };
      return {
        title: 'Stretch room',
        detail: blocked ?? `${room.name}, ${WALL_LABEL[wallName]} wall · ${formatRoomSize(room.width, room.depth)}`,
        bad: !!blocked,
        keys: [['Left-click', 'Grab this wall'], ['+ / −', 'Wall height']],
      };
    }

    // ── Step 2: the wall follows where you look on the ground (or its top, up and down) ──
    pv.hide('box');
    const room = rooms.find((r) => r.id === grab.roomId);
    if (!room) { clearPreview(); aim = null; return { title: 'Stretch room' }; }
    if (grab.top) return updateWallTopDrag(room);
    const p = aimGround(FLOOR_REACH);
    if (!p) {
      pv.hide('room');
      aim = null;
      return { title: 'Stretch room', detail: 'Look at the ground where the wall should go', keys: [['Right-click', 'Cancel']] };
    }
    const alongZ = grab.wallName === 'north' || grab.wallName === 'south';
    const target = snap(alongZ ? p.z : p.x, 0.5);
    const result = stretchRoom(room, grab.wallName, target, {
      rooms,
      objects: state().objects,
      below: belowRooms(),
      nameOf: (o) => o.label || ASSET_TYPES[o.assetType]?.label || 'An item',
    });
    pv.room(result.rect, levelElev(), room.wallHeight ?? 3, !result.problem);

    if (result.problem) {
      aim = null;
      return { title: `Stretch ${room.name}`, detail: result.problem, bad: true, keys: [['Right-click', 'Cancel']] };
    }
    const change = Math.abs(result.delta) < 0.01 ? 'no change'
      : `${result.delta > 0 ? '+' : '−'}${Math.abs(result.delta).toFixed(1)} m`;
    aim = { type: 'dropWall', room, result };
    const size = `${formatRoomSize(result.rect.width, result.rect.depth)} (${change})`;
    return {
      title: `Stretch ${room.name}`,
      detail: blocked ?? (result.overhang ? `${size} · ${OVERHANG_WARNING}` : size),
      bad: !!blocked,
      keys: [['Left-click', 'Put the wall here'], ['+ / −', 'Wall height'], ['Right-click', 'Cancel']],
    };
  }

  /** Size of a placed item in metres (its bounding box), e.g. "1.6 × 0.8 m, 0.75 m high". */
  function itemSize(mesh) {
    const { min, max } = mesh.getHierarchyBoundingVectors(true);
    const f = (v) => v.toFixed(v < 1 ? 2 : 1);
    return `${f(max.x - min.x)} × ${f(max.z - min.z)} m, ${f(max.y - min.y)} m high`;
  }

  /** The item the Edit tool would act on: carried, or under the crosshair. */
  function editTarget() {
    if (carry) return state().objects.find((o) => o.id === carry.id) ?? null;
    const t = aimTarget();
    return t?.objectId ? state().objects.find((o) => o.id === t.objectId) ?? null : null;
  }

  /** The door/window under the crosshair (Edit tool), or null: { room, kind, index, data }. */
  function editOpeningTarget() {
    if (carry) return null;
    const part = aimTarget({ panes: true })?.part;
    if (!part || (part.part !== 'door' && part.part !== 'window')) return null;
    const room = state().rooms.find((r) => r.id === part.roomId);
    const data = room && openingData(room, part.openingKind, part.openingIndex);
    return data ? { room, kind: part.openingKind, index: part.openingIndex, data } : null;
  }

  // Last door/window resize that was blocked: its reason stays in the hint for a moment
  let openingBlocked = null; // { key, text, until }
  const openingKey = (t) => `${t.room.id}:${t.kind}:${t.index}`;

  /** Edit tool on a door/window: + / − width, Shift + / − height, 0 standard size. */
  function resizeOpeningKey(target, { bigger, smaller, reset, taller }) {
    const { room, kind, index, data } = target;
    const sameFloor = state().rooms.filter((r) => r.floor === room.floor);
    const context = { stairs: stairsList() };
    const step = bigger ? OPENING_STEP : -OPENING_STEP;
    const result = reset
      ? resetOpeningSize(sameFloor, room, kind, index, context)
      : resizeOpening(sameFloor, room, kind, index,
        taller ? { height: data.height + step } : { width: data.width + step }, context);
    if (result.problem) {
      openingBlocked = { key: openingKey(target), text: result.problem, until: performance.now() + 4000 };
      return;
    }
    openingBlocked = null;
    actions.resizeOpening?.(result.list, { label: `Resize ${kind}`, mergeKey: 'play-opening-size' });
  }

  function updateEditOpening(target) {
    const { room, kind, data } = target;
    const blocked = openingBlocked && openingBlocked.key === openingKey(target) && performance.now() < openingBlocked.until
      ? openingBlocked.text : null;
    pv.opening(room, data.wall, data.offset,
      { width: data.width + 0.1, height: data.height + 0.06, sill: data.sill - 0.03 },
      elevationOf(state().floors, room.floor), !blocked);
    const partner = openingPartner(state().rooms.filter((r) => r.floor === room.floor), room, kind, target.index);
    return {
      title: formatOpeningSize(kind, data.width, data.height),
      detail: blocked ?? (partner ? `Between ${room.name} and ${partner.room.name}` : `On ${room.name}`),
      bad: !!blocked,
      keys: [['+ / −', 'Width'], ['Shift + / −', 'Height'], ['0', 'Standard size']],
    };
  }

  function updateEditTool() {
    // ── Carrying: the item follows the crosshair across the floor and table tops ──
    if (carry) {
      setOutline(null);
      const obj = editTarget();
      if (!obj) { endCarry(false); aim = null; return { title: 'Edit item' }; }
      const s = aimSurface();
      carry.mesh.rotation.y = carry.rotationY;
      if (s.problem) {
        aim = null;
        return { title: `Moving ${itemName(obj)}`, detail: s.problem, bad: s.bad, keys: [['R', 'Turn'], ['Right-click', 'Cancel']] };
      }
      carry.mesh.position.set(s.x, s.worldY, s.z);
      aim = { type: 'dropItem', id: obj.id, x: s.x, y: s.y, z: s.z };
      return {
        title: `Moving ${itemName(obj)}`,
        keys: [['Left-click', 'Put it here'], ['R', 'Turn'], ['Right-click', 'Cancel']],
      };
    }

    // ── Looking at an item: outline it and say what the keys do ──
    const obj = editTarget();
    const mesh = obj && getObjectMesh(obj.id);
    if (!obj || !mesh) {
      setOutline(null);
      aim = null;
      // ── ...or at a door / window: show its size, + / − changes it ──
      const opening = editOpeningTarget();
      if (opening) return updateEditOpening(opening);
      pv.hide('box');
      return { title: 'Edit item', detail: 'Look at an item, a door or a window to change it' };
    }
    pv.hide('box');
    setOutline(obj.id, obj.isLocked ? OUTLINE_LOCKED : OUTLINE_OK);
    aim = { type: 'pickUp', id: obj.id };
    if (obj.isLocked) {
      return { title: itemName(obj), detail: 'Locked', bad: true, keys: [['L', 'Unlock']] };
    }
    return {
      title: itemName(obj),
      detail: itemSize(mesh),
      keys: [['Left-click', 'Move'], ['R', 'Turn'], ['+ / −', 'Resize'], ['0', 'Normal size'], ['L', 'Lock']],
    };
  }

  /**
   * Edit tool keys (the planner's gizmo actions): turn, resize, reset size, lock.
   * Returns true if the key was used.
   */
  function editKey(code, shift = false) {
    if (tool?.kind !== 'edit') return false;
    const turn = code === 'KeyR';
    const bigger = code === 'Equal' || code === 'NumpadAdd';
    const smaller = code === 'Minus' || code === 'NumpadSubtract';
    const reset = code === 'Digit0' || code === 'Numpad0';
    const lock = code === 'KeyL';
    if (!(turn || bigger || smaller || reset || lock)) return false;

    if (carry && turn) {
      carry.rotationY += Math.PI / 4;
      return true;
    }
    if (carry && lock) return true; // put it down first
    const obj = editTarget();
    if (!obj) {
      const opening = editOpeningTarget();
      if (opening && (bigger || smaller || reset)) {
        resizeOpeningKey(opening, { bigger, smaller, reset, taller: shift });
      } else if (opening) {
        say(turn ? 'Doors and windows turn with their wall' : 'Doors and windows can’t be locked', 1500);
      } else {
        say('Look at an item, a door or a window first', 1500);
      }
      return true;
    }
    if (lock) {
      actions.toggleLock?.(obj.id);
      say(obj.isLocked ? `Unlocked ${itemName(obj)}` : `Locked ${itemName(obj)}. It can't be moved or removed now.`);
      return true;
    }
    if (obj.isLocked) {
      say('This item is locked. Press L to unlock it.');
      return true;
    }
    if (obj.assetType === 'STAIRCASE' && (bigger || smaller)) {
      say('Stairs always climb exactly one floor, so they keep their size', 2000);
      return true;
    }
    // Several presses in a row on one item are one undo step
    if (turn) {
      actions.updateObject?.(obj.id, { rotationY: (obj.rotationY ?? 0) + Math.PI / 4 }, { label: `Turn ${itemName(obj)}`, mergeKey: 'play-turn' });
    } else if (reset) {
      actions.updateObject?.(obj.id, { scaleX: 1, scaleY: 1, scaleZ: 1 }, { label: `Resize ${itemName(obj)}` });
    } else {
      const next = resizeItem(obj, bigger ? 1.1 : 1 / 1.1);
      if (!next) say(bigger ? 'This is as big as it gets' : 'This is as small as it gets', 1500);
      else actions.updateObject?.(obj.id, next, { label: `Resize ${itemName(obj)}`, mergeKey: 'play-resize' });
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Clicks
  // ─────────────────────────────────────────────────────────────────────

  function primaryAction() {
    if (!tool || !aim) return;
    const { currentFloor } = state();

    switch (aim.type) {
      case 'placeObject': {
        const room = findRoomAt(floorRooms(), aim.x, aim.z);
        actions.addObject({
          assetType: tool.assetType,
          category: ASSET_TYPES[tool.assetType]?.category,
          x: aim.x, y: aim.y, z: aim.z,
          rotationY: ghostRotation,
          floor: currentFloor,
          roomId: room?.id ?? null,
        });
        if (tool.assetType === 'STAIRCASE' &&
            stairNeedsRoomAbove({ x: aim.x, z: aim.z, rotationY: ghostRotation, floor: currentFloor }, state().floors, state().rooms)) {
          say(STAIRS_NEED_ROOM, 4000);
        }
        break;
      }
      case 'roomCorner':
        cornerA = aim.point;
        break;
      case 'grabWall':
        grab = { roomId: aim.roomId, wallName: aim.wallName };
        break;
      case 'grabTop':
        grab = { roomId: aim.roomId, wallName: aim.wallName, top: true };
        break;
      case 'dropTop': {
        const { room, wallHeight } = aim;
        const plan = actions.setWallHeight?.(room.id, wallHeight, { label: `Wall height of ${room.name}` });
        if (plan?.problem) say(plan.problem);
        else if (plan) say(`${heightText(room, plan)}. Ctrl+Z to undo.`);
        clearPreview();
        break;
      }
      case 'dropWall': {
        const { room, result } = aim;
        if (Math.abs(result.delta) >= 0.01) {
          actions.updateRoom(room.id, result.patch, { label: `Stretch ${room.name}` });
          say(`${room.name} is now ${formatRoomSize(result.rect.width, result.rect.depth)}. Ctrl+Z to undo.`);
        }
        clearPreview();
        break;
      }
      case 'roomFinish': {
        actions.addRoom({ type: tool.roomType, ...aim.rect, floor: currentFloor });
        say(`Built ${ROOM_TYPES[tool.roomType]?.label ?? 'new'} room, ${formatRoomSize(aim.rect.width, aim.rect.depth)}`);
        clearPreview();
        break;
      }
      case 'wallStart':
        cornerA = aim.point;
        break;
      case 'wallFinish': {
        const { data } = wallSegmentData(aim.a, aim.b, floorRooms());
        actions.addObject({ ...data, category: ASSET_TYPES.WALL_SEGMENT?.category, floor: currentFloor });
        // Chain walls: the end of this one is the start of the next
        cornerA = aim.b;
        break;
      }
      case 'opening': {
        // Back-to-back neighbour: the list has the same opening through its wall too
        const { kind, room, list, partner } = aim;
        actions.addOpenings(list);
        say(partner ? `Added ${kind} between ${room.name} and ${partner.room.name}` : `Added ${kind} to ${room.name}`);
        break;
      }
      case 'pickUp': {
        const obj = state().objects.find((o) => o.id === aim.id);
        if (!obj) break;
        if (obj.isLocked) say('This item is locked. Press L to unlock it.');
        else startCarry(obj);
        break;
      }
      case 'dropItem': {
        const obj = state().objects.find((o) => o.id === aim.id);
        if (!obj) { endCarry(false); break; }
        const room = findRoomAt(floorRooms(), aim.x, aim.z);
        const rotationY = carry.rotationY;
        endCarry(false);
        actions.updateObject?.(obj.id, {
          x: aim.x, y: aim.y, z: aim.z, rotationY, floor: currentFloor, roomId: room?.id ?? null,
        }, { label: `Move ${itemName(obj)}` });
        say(`Moved ${itemName(obj)}. Ctrl+Z to undo.`, 2000);
        break;
      }
      default:
        break;
    }
  }

  /**
   * What the player is pointing at, for removing / interacting.
   * Forgiving: pointing at the floor under a desk (between its legs) counts as
   * pointing at the desk, because that's what a person means.
   */
  function aimTarget({ panes = false } = {}) {
    const hit = aimPick((m) =>
      !!objectIdOf(m) || !!roomPartOf(m) || m.name === 'ground', REACH + CAM_DISTANCE, { panes });
    if (!hit) return null;
    const m = hit.pickedMesh;
    if (objectIdOf(m)) return { objectId: objectIdOf(m), hit };
    const onFloor = m.name === 'ground' || m.metadata?.part === 'floor';
    if (onFloor) {
      const id = itemOverFloorPoint(scene, hit.pickedPoint, (mesh, objectId) => objectId !== 'play_ghost');
      if (id) return { objectId: id, hit };
    }
    return roomPartOf(m) ? { part: roomPartOf(m), hit } : null;
  }

  /**
   * What E would interact with: an object (or a door/window) under the
   * crosshair, within INTERACT_REACH of the character.
   */
  function interactTarget() {
    const hit = aimPick((m) =>
      !!objectIdOf(m) || m.metadata?.part === 'door' || m.metadata?.part === 'window',
    REACH + CAM_DISTANCE);
    if (!hit) return null;
    const p = hit.pickedPoint;
    const distance = Math.hypot(p.x - feet().x, p.z - feet().z);
    if (distance > INTERACT_REACH) return null;
    const m = hit.pickedMesh;
    const point = { x: p.x, y: p.y, z: p.z };
    const objectId = objectIdOf(m);
    if (objectId) return { objectId, point, distance };
    return { roomId: m.metadata.roomId, part: m.metadata.part, point, distance };
  }

  /** Room the character stands in, staying in the current room a little past its edge. */
  function roomHere() {
    const rooms = floorRooms();
    const { x, z } = collider.position;
    const current = rooms.find((r) => r.id === currentRoomId);
    if (current &&
      Math.abs(x - current.x) <= current.width / 2 + ROOM_STICKY &&
      Math.abs(z - current.z) <= current.depth / 2 + ROOM_STICKY) {
      return current;
    }
    return findRoomAt(rooms, x, z);
  }

  function secondaryAction() {
    // First: cancel a half-drawn room or wall, a grabbed wall, or a carried item
    if (cornerA || grab || carry) {
      clearPreview();
      endCarry(true);
      say('Cancelled');
      return;
    }
    const target = aimTarget();
    if (!target) return;
    const { hit } = target;

    const objectId = target.objectId;
    if (objectId) {
      const obj = state().objects.find((o) => o.id === objectId);
      if (!obj) return;
      if (obj.isLocked) {
        say('This item is locked. Unlock it with the Edit item tool (L).');
        return;
      }
      actions.deleteObject(objectId);
      say(`Removed ${ASSET_TYPES[obj.assetType]?.label ?? 'item'}. Press Ctrl+Z to undo.`);
      return;
    }

    const part = target.part;
    const room = floorRooms().find((r) => r.id === part.roomId);
    if (!room) return;

    if (part.part === 'door' || part.part === 'window') {
      actions.removeOpenings(planRemoveOpening(
        floorRooms(), room, part.wallName, hit.pickedPoint, part.openingKind, part.openingIndex));
      say(`Removed ${part.openingKind}. Press Ctrl+Z to undo.`);
      return;
    }

    if (tool?.kind === 'room') {
      actions.deleteRoom(room.id);
      say(`Removed ${room.name}. Press Ctrl+Z to undo.`);
    } else {
      say('To remove a whole room, hold a room item and right-click it.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Input
  // ─────────────────────────────────────────────────────────────────────

  const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

  function onKeyDown(e) {
    if (!active || typing(e)) return;
    if (e.ctrlKey || e.metaKey) return; // Ctrl+Z / Ctrl+Y handled by the editor
    keys.add(e.code);
    if (editKey(e.code, e.shiftKey) || stretchKey(e.code)) {
      e.preventDefault();
      return;
    }

    switch (e.code) {
      case 'Tab':
        e.preventDefault();
        onExit();
        break;
      case 'Space':
        e.preventDefault();
        if (!flying && grounded) {
          vy = JUMP_SPEED;
          grounded = false;
        }
        break;
      case 'KeyF':
        flying = !flying;
        vy = 0;
        say(flying ? 'Flying. Space goes up, C goes down, F lands.' : 'Walking');
        break;
      case 'KeyV':
        firstPerson = !firstPerson;
        break;
      case 'KeyR':
        ghostRotation += Math.PI / 4;
        break;
      case 'KeyB':
        onCatalog();
        break;
      case 'KeyN': {
        if (floorAbove(state().floors, currentLevel)) {
          say('There is already a floor above. Page Up takes you there.');
        } else {
          onAskNewFloor(); // "Copy rooms from below" or "Empty floor", then goToFloor(new floor)
        }
        break;
      }
      case 'PageUp':
      case 'PageDown':
        e.preventDefault();
        stepFloor(e.code === 'PageUp' ? 1 : -1);
        break;
      case 'KeyE': {
        const target = interactTarget();
        if (target) onInteract(target);
        else say('Nothing to use here. Walk up to an object and look at it.', 2000);
        break;
      }
      default:
        if (/^Digit[1-9]$/.test(e.code)) onSlotKey(Number(e.code.slice(5)) - 1);
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function lookBy(dx, dy) {
    yaw += dx * MOUSE_SENS;
    pitch -= dy * MOUSE_SENS;
    pitch = Math.max(-1.35, Math.min(1.25, pitch));
  }

  function onMouseMove(e) {
    if (!active || !locked) return;
    // Chrome sometimes reports a huge jump while the pointer is locked
    // (e.g. when the cursor is re-centred). Ignore those single spikes.
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
    lookBy(e.movementX, e.movementY);
  }

  function onMouseDown(e) {
    if (!active) return;
    if (!locked) {
      canvas.requestPointerLock?.();
      return;
    }
    if (e.button === 0) primaryAction();
    else if (e.button === 2) secondaryAction();
  }

  function onWheel(e) {
    if (!active || !locked) return;
    e.preventDefault();
    onSlotScroll(e.deltaY > 0 ? 1 : -1);
  }

  const onContextMenu = (e) => { if (active) e.preventDefault(); };

  function onPointerLockChange() {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      keys.clear();
      if (cornerA || grab) clearPreview();
      endCarry(true);
    }
  }

  function onBlur() {
    keys.clear();
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Frame update
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Height to stand on at (x, z): room floor, ground or stairs (see building.js).
   * `fromY`: current feet height; defaults to just above the current floor.
   */
  function groundHeightAt(x, z, fromY = levelElev() + 0.5) {
    const st = state();
    return supportHeight({ x, z, y: fromY, floors: st.floors, rooms: st.rooms, stairs: stairsList() });
  }

  /** Update which floor the character is on (from its height). */
  function updateLevel() {
    const level = levelForY(state().floors, collider.position.y);
    if (level === currentLevel) return;
    currentLevel = level;
    if (cornerA || grab) clearPreview(); // a half-drawn room belongs to the old floor
    clearGhost();                         // a staircase preview climbs the old floor's height
    onLevelChange(level);
  }

  /**
   * Put the character on another floor at the same x, z: standing on a room
   * there (or the ground), otherwise flying at that floor's height.
   * @returns {{ y:number, fly:boolean } | null}
   */
  function goToFloor(floorId) {
    const st = state();
    if (!Object.values(st.floors).some((f) => f.id === floorId)) return null;
    const { x, z } = collider.position;
    const arrival = arrivalOnFloor({ x, z, floorId, floors: st.floors, rooms: st.rooms, stairs: stairsList() });
    flying = arrival.fly;
    vy = 0;
    collider.position.y = arrival.y;
    collider.computeWorldMatrix(true);
    if (floorId !== currentLevel) {
      currentLevel = floorId;
      clearPreview();
      clearGhost();
      onLevelChange(floorId);
    }
    return arrival;
  }

  /** Page Up / Page Down (and the HUD arrows): the floor above (+1) or below (−1). */
  function stepFloor(dir) {
    const floors = state().floors;
    const target = dir > 0 ? floorAbove(floors, currentLevel) : floorBelow(floors, currentLevel);
    if (!target) {
      say(dir > 0 ? 'No floor above. Press N to add one.' : 'This is the lowest floor.', 2000);
      return;
    }
    const arrival = goToFloor(target.id);
    say(arrival?.fly ? `${target.name}: no room here, so you are flying (F lands)` : target.name, 2000);
  }

  function update() {
    if (!active) return;
    // Real elapsed time (capped so a frozen tab doesn't teleport you). Long
    // frames are split into small collision steps below, so walking speed is
    // the same on a slow laptop and you still can't pass through walls.
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.25);

    // ── Movement ──
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = Vector3.Zero();
    if (locked) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) move.addInPlace(forward);
      if (keys.has('KeyS') || keys.has('ArrowDown')) move.subtractInPlace(forward);
      if (keys.has('KeyD') || keys.has('ArrowRight')) move.addInPlace(right);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) move.subtractInPlace(right);
    }
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = flying ? FLY : running ? RUN : WALK;
    if (move.lengthSquared() > 0) move.normalize().scaleInPlace(speed * dt);

    const before = collider.position.clone();
    // Step up (stairs, room floors) after every small move, so climbing works at any frame rate
    const stepUp = () => {
      if (flying) return;
      const s = groundHeightAt(collider.position.x, collider.position.z, collider.position.y);
      if (s > collider.position.y) {
        collider.position.y = s;
        vy = Math.max(vy, 0);
      }
    };
    moveWithSteps(collider, move.x, move.z, stepUp);
    const steps = Math.max(1, Math.ceil(dt / 0.03)); // for gravity integration

    // ── Vertical: stand on the floor, the ground or the stairs ──
    const floorY = groundHeightAt(collider.position.x, collider.position.z, collider.position.y);
    if (!flying && floorY > collider.position.y) {
      // stepping up (a stair step, or onto a room floor): no jump needed
      collider.position.y = floorY;
      vy = Math.max(vy, 0);
    }
    if (flying) {
      let up = 0;
      if (locked && keys.has('Space')) up += 1;
      if (locked && keys.has('KeyC')) up -= 1;
      collider.position.y = Math.max(floorY, collider.position.y + up * FLY * 0.8 * dt);
      grounded = collider.position.y <= floorY + 0.001;
    } else {
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        vy += GRAVITY * h;
        collider.position.y += vy * h;
        if (collider.position.y <= floorY) {
          collider.position.y = floorY;
          vy = 0;
          grounded = true;
        }
      }
    }

    updateLevel();

    const moved = Math.hypot(collider.position.x - before.x, collider.position.z - before.z);
    character.root.rotation.y = yaw;
    character.update(dt, moved / Math.max(dt, 1e-4), flying && !grounded);

    // ── Camera ──
    const dir = lookDir();
    const eye = collider.position.add(new Vector3(0, EYE, 0));
    let showCharacter = !firstPerson;
    if (firstPerson) {
      camera.position.copyFrom(eye.add(forward.scale(0.12)));
    } else {
      const desired = eye
        .add(dir.scale(-CAM_DISTANCE))
        .add(right.scale(SHOULDER))
        .add(new Vector3(0, 0.45, 0));
      // Pull the camera in front of walls instead of looking through them
      const toCam = desired.subtract(eye);
      const dist = toCam.length();
      const ray = new Ray(eye, toCam.normalize(), dist);
      const hit = scene.pickWithRay(ray, (m) =>
        m.isPickable && m.isEnabled() && !isPlayerMesh(m) && !isGhostMesh(m) && !m.metadata?.pickPane &&
        (m.metadata?.part === 'wall' || m.metadata?.part === 'window' || !!objectIdOf(m)));
      const d = hit?.hit ? Math.max(0.3, hit.distance - 0.25) : dist;
      // In a tight spot the camera is pulled right up to the character: hide
      // the body so you don't look through the inside of its head
      if (d < 1.1) showCharacter = false;
      camera.position.copyFrom(eye.add(toCam.normalize().scale(d)));
      // Indoors the camera stays under the ceiling (except on the stairs,
      // where you look up through the stairwell)
      const roomNow = roomHere();
      const onStairs = stairsList().some((s) =>
        stairHeightAt(s, collider.position.x, collider.position.z, stairDimsFor(state().floors, s)) !== null);
      if (roomNow && !onStairs) {
        const ceiling = levelElev() + (roomNow.wallHeight ?? 3) - 0.12;
        camera.position.y = Math.min(camera.position.y, ceiling);
      }
      // Never let the camera sink below the floor when looking up
      camera.position.y = Math.max(camera.position.y, collider.position.y + 0.3);
    }
    camera.setTarget(camera.position.add(dir));
    character.setVisible(showCharacter);

    // ── Tool preview ──
    let hint;
    if (!tool) hint = { title: 'Empty hand', detail: 'Pick an item with 1–9, or press B for the catalog' };
    else if (tool.kind === 'object') hint = updateObjectTool();
    else if (tool.kind === 'room') hint = updateRoomTool();
    else if (tool.kind === 'wall') hint = updateWallTool();
    else if (tool.kind === 'stretch') hint = updateStretchTool();
    else if (tool.kind === 'edit') hint = updateEditTool();
    else hint = updateOpeningTool();

    // ── Which room am I in? (events for other modules) ──
    const here = roomHere();
    const hereId = here?.id ?? null;
    if (hereId !== currentRoomId) {
      const from = currentRoomId ? floorRooms().find((r) => r.id === currentRoomId) ?? null : null;
      currentRoomId = hereId;
      if (from || here) onRoomChange(from, here);
    }

    // ── Inside or outside, and on which floor? (decides which storeys are shown) ──
    const inside = !!here;
    if (!lastView || lastView.inside !== inside || lastView.level !== currentLevel) {
      lastView = { inside, level: currentLevel };
      onViewChange(lastView);
    }

    // ── What would E do? ──
    promptTarget = locked && !cornerA && !grab && !carry ? interactTarget() : null;
    const prompt = promptTarget ? describeInteraction(promptTarget) : null;

    // ── HUD ──
    const now = performance.now();
    const info = {
      locked,
      flying,
      firstPerson,
      hint,
      message: now < messageUntil ? message : null,
      roomName: here?.name ?? 'Outside',
      floor: floorPosition(state().floors, currentLevel), // "Floor 1 of 3"
      prompt,
    };
    const key = JSON.stringify(info);
    if (key !== lastHud) {
      lastHud = key;
      onHud(info);
    }
  }

  const observer = scene.onBeforeRenderObservable.add(update);

  // ─────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────

  function spawnPoint() {
    const spawn = state().objects.find((o) => o.assetType === 'SPAWN_POINT' && o.floor === state().currentFloor);
    if (spawn) return { x: spawn.x, z: spawn.z, yaw: spawn.rotationY ?? 0 };
    const rooms = floorRooms();
    if (rooms.length) {
      // stand just outside the south side of the first room, looking at it
      const r = rooms[0];
      return { x: r.x, z: r.z - r.depth / 2 - 4, yaw: 0 };
    }
    return { x: 0, z: -8, yaw: 0 };
  }

  let hasSpawned = false;

  return {
    activate() {
      if (active) return;
      active = true;
      savedCamera = scene.activeCamera;
      savedCamera?.detachControl();
      scene.activeCamera = camera;
      scene.collisionsEnabled = true;

      // Start on the floor the planner was showing
      currentLevel = state().currentFloor ?? 0;
      lastView = null;
      if (!hasSpawned) {
        const s = spawnPoint();
        collider.position.set(s.x, groundHeightAt(s.x, s.z), s.z);
        yaw = s.yaw;
        hasSpawned = true;
      }
      collider.setEnabled(true);
      character.setVisible(!firstPerson);
      currentRoomId = undefined; // first frame announces the room you start in

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('pointerlockchange', onPointerLockChange);
      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('contextmenu', onContextMenu);
      canvas.requestPointerLock?.();
      lastHud = '';
    },

    deactivate() {
      if (!active) return;
      active = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      locked = false;
      // Leaving Build mode = leaving the room you were in
      if (currentRoomId) {
        const from = floorRooms().find((r) => r.id === currentRoomId) ?? null;
        currentRoomId = undefined;
        if (from) onRoomChange(from, null);
      }
      keys.clear();
      clearGhost();
      clearPreview();
      collider.setEnabled(false);
      character.setVisible(false);

      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);

      if (savedCamera) {
        scene.activeCamera = savedCamera;
        savedCamera.attachControl(canvas, true);
      }
    },

    /** Put an item in the player's hand */
    setTool(next) {
      const same = tool && next && JSON.stringify(tool) === JSON.stringify(next);
      if (same) return;
      tool = next;
      clearGhost();
      clearPreview();
      onBuildToolChange(!!next && GROUND_BUILD_KINDS.has(next.kind));
    },

    /** Respawn on the current floor (e.g. after switching floors) */
    respawn() {
      const s = spawnPoint();
      collider.position.set(s.x, groundHeightAt(s.x, s.z), s.z);
      yaw = s.yaw;
    },

    /** Turn the view by a mouse-movement amount (used by tests and touch controls) */
    lookBy,

    /** Go to a floor at the same spot (standing on a room there, or flying). */
    goToFloor,

    /** The floor above (+1) or below (−1): Page Up / Page Down. */
    stepFloor,

    /**
     * Put the character at an exact spot and view angle.
     * Used by tests, and later by "go to" features (e.g. jump to a desk).
     * @param {{x:number, z:number, yaw?:number, pitch?:number}} pose
     */
    setPose({ x, z, yaw: newYaw, pitch: newPitch, floor, y, fly }) {
      if (floor !== undefined && floor !== currentLevel) {
        currentLevel = floor;
        onLevelChange(floor);
      }
      if (fly !== undefined) flying = !!fly;
      // y given (e.g. hovering over an empty upper floor while flying), else stand on what's there
      collider.position.set(x, y ?? groundHeightAt(x, z), z);
      collider.computeWorldMatrix(true);
      vy = 0;
      if (newYaw !== undefined) yaw = newYaw;
      if (newPitch !== undefined) pitch = newPitch;
      hasSpawned = true;
    },

    isActive: () => active,
    getRoomId: () => currentRoomId ?? null,
    getLevel: () => currentLevel,
    isFlying: () => flying,
    getPosition: () => collider.position.clone(),
    getYaw: () => yaw,

    dispose() {
      this.deactivate();
      scene.onBeforeRenderObservable.remove(observer);
      character.dispose();
      collider.dispose();
      camera.dispose();
      pv.dispose();
    },
  };
}
