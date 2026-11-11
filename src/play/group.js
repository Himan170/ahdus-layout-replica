/**
 * play/group.js (v0.15.5): PURE (no Babylon). Several items at once in Studio: move, turn, copy and
 * paste a group. What each item takes along stays as for one item (carry.carriedBy: a desk's chair,
 * what stands on it), found by the caller and passed in as `carried(obj)`. Locked items are never
 * moved, turned or deleted with a group: they are counted, so Studio can say so.
 */

const r3 = (v) => Math.round(v * 1000) / 1000;
const byId = (objects) => (Array.isArray(objects) ? Object.fromEntries(objects.map((o) => [o.id, o])) : objects ?? {});

/**
 * The items a group action works on: the unlocked selected items and what they take along (once
 * each), and how many selected items are locked.
 * @param {object[] | Record<string, object>} objects
 * @param {string[]} ids  the selection
 * @param {(obj: object) => ({ item: object, onTop?: boolean } | object)[]} [carried]
 * @returns {{ items: { item: object, onTop: boolean, selected: boolean }[], locked: object[] }}
 */
export function groupMembers(objects, ids, carried = () => []) {
  const all = byId(objects);
  const seen = new Set();
  const items = [];
  const locked = [];
  const selected = ids.map((id) => all[id]).filter(Boolean);
  for (const o of selected) {
    if (o.isLocked) locked.push(o);
    else { seen.add(o.id); items.push({ item: o, onTop: true, selected: true }); }
  }
  for (const o of selected) {
    if (o.isLocked) continue;
    for (const entry of carried(o)) {
      const it = entry.item ?? entry;
      if (!it || seen.has(it.id) || it.isLocked) continue;
      seen.add(it.id);
      items.push({ item: it, onTop: !!entry.onTop, selected: false });
    }
  }
  return { items, locked };
}

/** The middle of the items' positions (the point a group turns about). */
export function groupCentre(items) {
  const xs = items.map((o) => Number(o.x) || 0);
  const zs = items.map((o) => Number(o.z) || 0);
  if (!xs.length) return { x: 0, z: 0 };
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
}

/**
 * Moving a group by (dx, dz): [id, { x, z }] for every member (moveObjects).
 * @param {{ item: object }[]} members  groupMembers().items
 */
export function groupMoves(members, dx, dz) {
  return members.map(({ item: o }) => [o.id, { x: r3((Number(o.x) || 0) + dx), z: r3((Number(o.z) || 0) + dz) }]);
}

/**
 * Turning a group by `angle` (radians, Babylon's rotationY) about the middle of the selected items:
 * each member swings round it and turns by as much (as carry.carryMoves does for one item).
 */
export function groupTurn(members, angle, centre = groupCentre(members.filter((m) => m.selected).map((m) => m.item))) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return members.map(({ item: o }) => {
    const ox = (Number(o.x) || 0) - centre.x;
    const oz = (Number(o.z) || 0) - centre.z;
    return [o.id, {
      x: r3(centre.x + ox * cos + oz * sin),
      z: r3(centre.z - ox * sin + oz * cos),
      rotationY: (Number(o.rotationY) || 0) + angle,
    }];
  });
}

// ── Copy and paste ────────────────────────────────────────────────────────

/** Fields never copied: the id (a paste gets new ones), UI state, the room (found again where it lands). */
const NOT_COPIED = new Set(['id', 'name', 'isSelected', 'roomId']);

/**
 * The clipboard for some items (Ctrl+C): every selected item (locked ones too: copying moves nothing)
 * and what it takes along (a desk's chair and monitor), as data with no ids, around their middle.
 * Who sits at a desk is not in the layout, so it is never copied: pasted desks are empty.
 * @returns {{ floor: number, centre: { x: number, z: number }, items: object[] } | null}
 */
export function copyItems(objects, ids, carried = () => []) {
  const all = byId(objects);
  const seen = new Set();
  const picked = [];
  const add = (o) => { if (o && !seen.has(o.id)) { seen.add(o.id); picked.push(o); } };
  const selected = ids.map((id) => all[id]).filter(Boolean);
  selected.forEach(add);
  for (const o of selected) for (const e of carried(o)) add(e.item ?? e);
  if (!picked.length) return null;
  const centre = groupCentre(selected);
  return {
    floor: selected[0].floor ?? 0,
    centre,
    items: picked.map((o) => {
      const data = {};
      for (const [k, v] of Object.entries(o)) if (!NOT_COPIED.has(k)) data[k] = v;
      data.metadata = { ...(o.metadata ?? {}) };
      return data;
    }),
  };
}

/**
 * Where a paste lands. `at` (the mouse) puts the clipboard's middle there; `same` keeps every item's
 * own x / z (Ctrl+Shift+V: one floor's furniture onto the floor above); else it goes `aside` metres
 * (0.5) right and down from where it was copied, so it is seen beside the original.
 * @returns {{ x: number, z: number }} how far every item moves
 */
export function pasteOffset(clip, { at = null, same = false, aside = 0.5, times = 1 } = {}) {
  if (same) return { x: 0, z: 0 };
  if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) return { x: at.x - clip.centre.x, z: at.z - clip.centre.z };
  return { x: aside * times, z: aside * times };
}

/**
 * The items to add for a paste: new ids (`newId()`), on `floor`, moved by `offset`, each in the room
 * it lands in (`roomAt(x, z)` → id or null). One undo step for all of them (editor.replaceObjects).
 */
export function pasteItems(clip, { floor, offset = { x: 0, z: 0 }, newId, roomAt = () => null }) {
  if (!clip?.items?.length) return [];
  return clip.items.map((data) => {
    const x = r3((Number(data.x) || 0) + offset.x);
    const z = r3((Number(data.z) || 0) + offset.z);
    return { ...data, id: newId(), floor, x, z, roomId: roomAt(x, z) ?? null, metadata: { ...(data.metadata ?? {}) } };
  });
}

/** "2 locked items were not moved" (null when none). */
export function lockedNote(count, verb = 'moved') {
  if (!count) return null;
  return `${count} locked item${count === 1 ? ' was' : 's were'} not ${verb}`;
}

