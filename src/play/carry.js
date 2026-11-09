/**
 * play/carry.js: PURE (no Babylon). What an item takes along when it moves or
 * turns (v0.15.1): a desk carries its chair (people.deskSeat, the same pairing
 * as the people at desks) and what stands on it (the monitor, a plant: found by
 * the caller from the meshes, `riders`). The carried items keep their place
 * relative to it: they move by the same amount and turn around its centre.
 * (Not in building.js: people.js imports building.js.)
 */

import { deskSeat, isDesk } from './people';

const list = (objects) => (Array.isArray(objects) ? objects : Object.values(objects ?? {}));
const floorOf = (o) => o?.floor ?? 0;

/**
 * The items `obj` takes along: its chair (a desk) and `riders` (what stands on it).
 * Locked items, items on another floor and `obj` itself are left out; no item twice.
 * @param {object} obj
 * @param {object[] | Record<string, object>} objects  every item
 * @param {object[]} [riders]  items standing on it
 * @returns {{ item: object, onTop: boolean }[]}  onTop: stands on it (its height follows)
 */
export function carriedBy(obj, objects, riders = []) {
  if (!obj) return [];
  const out = [];
  const seen = new Set([obj.id]);
  const add = (item, onTop) => {
    if (!item || seen.has(item.id) || item.isLocked || floorOf(item) !== floorOf(obj)) return;
    seen.add(item.id);
    out.push({ item, onTop });
  };
  for (const r of riders) add(r, true);
  if (isDesk(obj.assetType)) add(deskSeat(obj, list(objects)), false);
  return out;
}

/**
 * Where `main` and the items it carries end up when `main` goes to `target`.
 * A turn (rotationY) swings the carried items around main's centre and turns
 * them by the same angle (Babylon's rotationY: local +Z faces (sin θ, cos θ)).
 * @param {object} main  the item moved (its current x, z, rotationY)
 * @param {{ item: object }[] | object[]} carried  carriedBy's list (or plain items)
 * @param {{ x?: number, z?: number, rotationY?: number }} target
 * @returns {[string, { x: number, z: number, rotationY?: number }][]}  main first
 */
export function carryMoves(main, carried, target) {
  const x0 = main.x ?? 0;
  const z0 = main.z ?? 0;
  const yaw0 = main.rotationY ?? 0;
  const x1 = target.x ?? x0;
  const z1 = target.z ?? z0;
  const turn = 'rotationY' in target && Number.isFinite(target.rotationY) ? target.rotationY - yaw0 : 0;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const mainPatch = { x: r3(x1), z: r3(z1) };
  if (turn !== 0) mainPatch.rotationY = target.rotationY;
  const moves = [[main.id, mainPatch]];
  for (const entry of carried) {
    const it = entry.item ?? entry;
    const ox = (it.x ?? 0) - x0;
    const oz = (it.z ?? 0) - z0;
    const patch = { x: r3(x1 + ox * cos + oz * sin), z: r3(z1 - ox * sin + oz * cos) };
    if (turn !== 0) patch.rotationY = (it.rotationY ?? 0) + turn;
    moves.push([it.id, patch]);
  }
  return moves;
}

/** R turns an item a quarter turn (Studio and Walk through, v0.15.1); Shift+R a fine 15° step. */
export const TURN_STEP = Math.PI / 2;
export const FINE_TURN_STEP = Math.PI / 12;
/** The turn of one R press: Shift (fine) = 15°, else 90°. */
export const turnStep = (fine = false) => (fine ? FINE_TURN_STEP : TURN_STEP);
/** "90°" / "15°" for messages. */
export const turnText = (fine = false) => `${Math.round((turnStep(fine) * 180) / Math.PI)}°`;
