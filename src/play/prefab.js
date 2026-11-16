/**
 * play/prefab.js: PURE (v0.18.0). Prefabs: a workstation cluster, a desk row, a manager workstation, a
 * private cabin (catalog/workstations.json `prefabs`). Placing one makes ORDINARY items (desks, chairs,
 * visitor chairs) that share `metadata.group` = { id, prefab, slot, role, params }, so seats, people at
 * desks, Find, routes, the walk map and Check work on them as on any desk. A cabin also makes its room.
 *
 * Local frame: the prefab's middle at (0, 0), facing +Z (a desk's person sits at its local +Z side,
 * people.DESK_WORK_SIDE). A cluster is two rows back to back along a partition spine at z = 0.
 * Members are keyed by role + slot (`memberKey`): changing a cluster's options rebuilds it with the SAME
 * ids, so "Who sits here" (kept by AHDUS against the desk's id) keeps its people.
 */

export const CHAIR_TYPE = 'CHAIR_OFFICE';
export const VISITOR_TYPE = 'CHAIR_VISITOR';
/** A desk's chair stands this far out from its edge (m, its middle): partly under the desk. */
export const CHAIR_OUT = 0.3;
/** Room behind a chair (its back, pushed out a little): the prefab's outline ends there. */
export const CHAIR_BACK = 0.35;
export const DESK_WIDTH_MIN = 0.8;
export const DESK_WIDTH_MAX = 2.4;
export const DESK_DEPTH_MIN = 0.5;
export const DESK_DEPTH_MAX = 1.2;
/** The door of a cabin (m). */
export const CABIN_DOOR = { width: 0.9, height: 2.1 };

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The prefab's options, cleaned: desk width / depth within limits, a partition kind, its height. */
export function prefabParams(prefab, params = {}) {
  const p = { ...prefab.params, ...params };
  return {
    deskWidth: r3(clamp(Number(p.deskWidth) || prefab.params.deskWidth, DESK_WIDTH_MIN, DESK_WIDTH_MAX)),
    deskDepth: r3(clamp(Number(p.deskDepth) || prefab.params.deskDepth, DESK_DEPTH_MIN, DESK_DEPTH_MAX)),
    partition: ['none', 'fabric', 'glass'].includes(p.partition) ? p.partition : 'none',
    partitionHeight: r3(clamp(Number(p.partitionHeight) || 0.45, 0.2, 0.9)),
  };
}

/** "desk:3" */
export const memberKey = (m) => `${m.role}:${m.slot}`;

/**
 * The prefab's members in its own frame: [{ role: 'desk' | 'chair' | 'visitor', slot, assetType, x, z,
 * rotationY, scaleX, scaleZ, ws }] (ws: the desk's metadata.ws), its outline { width, depth } and, for
 * a cabin, its room { width, depth, type, name }.
 * @param {object} prefab  manifest prefab
 * @param {object} catalog ASSET_TYPES (the desk's catalogue size)
 */
export function layoutPrefab(prefab, params, catalog) {
  const p = prefabParams(prefab, params);
  const def = catalog[prefab.desk] ?? {};
  const W = p.deskWidth;
  const D = p.deskDepth;
  const scaleX = r3(W / (def.defaultWidth || W));
  const scaleZ = r3(D / (def.defaultDepth || D));
  const out = [];
  const desk = (slot, x, z, rotationY, sides, extra = {}) => {
    out.push({
      role: 'desk', slot, assetType: prefab.desk, x: r3(x), z: r3(z), rotationY, scaleX, scaleZ,
      ws: { partition: p.partition, partitionHeight: p.partitionHeight, sides, ...extra },
    });
    // its chair, in front of its work side (+Z of the desk), facing it
    const c = Math.cos(rotationY);
    const s = Math.sin(rotationY);
    const lz = D / 2 + CHAIR_OUT;
    out.push({ role: 'chair', slot, assetType: CHAIR_TYPE, x: r3(x + lz * s), z: r3(z + lz * c), rotationY: rotationY + Math.PI, scaleX: 1, scaleZ: 1 });
  };
  const reach = D / 2 + CHAIR_OUT + CHAIR_BACK; // from a desk's middle to behind its chair
  let width;
  let depth;
  let room = null;

  if (prefab.layout === 'cluster' || prefab.layout === 'row') {
    const n = prefab.layout === 'cluster' ? prefab.seats / 2 : prefab.seats;
    const two = prefab.layout === 'cluster';
    // a row facing +Z: its partition along its back; for a cluster the back is the spine at z = 0
    // one row: its outline (desk back to chair back) centred on z = 0
    const zA = two ? D / 2 : (D / 2 - reach) / 2;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * W;
      // a divider on each desk's left (local −X); the last one closes the end too (no panel twice)
      desk(i, x, zA, 0, i === n - 1 ? 'both' : 'left');
    }
    if (two) {
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * W;
        // turned 180°: its local −X is world +X, so the end at the lowest x gets 'both'
        desk(n + i, x, -D / 2, Math.PI, i === 0 ? 'both' : 'left');
      }
    }
    width = n * W;
    depth = two ? D + 2 * reach : D / 2 + reach;
  } else if (prefab.layout === 'single') {
    desk(0, 0, (D / 2 - reach) / 2, 0, 'both');
    width = W;
    depth = D / 2 + reach;
  } else {
    // manager workstation / cabin: the desk, its chair behind it, two visitor chairs in front (local −Z)
    const visitorZ = D / 2 + 0.45;
    const front = visitorZ + 0.35;
    const zDesk = (front - reach) / 2;
    desk(0, 0, zDesk, 0, 'none', { modesty: true });
    for (const [slot, sx] of [[0, -1], [1, 1]]) {
      out.push({ role: 'visitor', slot, assetType: VISITOR_TYPE, x: r3(sx * Math.min(0.45, W / 4)), z: r3(zDesk - visitorZ), rotationY: 0, scaleX: 1, scaleZ: 1 });
    }
    width = Math.max(W, 1.4);
    depth = reach + front;
    if (prefab.layout === 'cabin' && prefab.room) {
      room = { ...prefab.room, width: Math.max(prefab.room.width, width + 1.2), depth: Math.max(prefab.room.depth, depth + 0.8) };
      width = room.width;
      depth = room.depth;
    }
  }
  return { members: out.map((m) => ({ ...m, rotationY: normAngle(m.rotationY) })), width: r3(width), depth: r3(depth), room, params: p };
}

function normAngle(a) {
  const t = Math.PI * 2;
  let v = ((a % t) + t) % t;
  if (v > Math.PI + 1e-9) v -= t;
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/** A local point of a prefab placed at { x, z, rotationY } in world space (anchors.ts' rotation). */
export function toWorld(at, lx, lz) {
  const c = Math.cos(at.rotationY ?? 0);
  const s = Math.sin(at.rotationY ?? 0);
  return { x: r3(at.x + lx * c + lz * s), z: r3(at.z - lx * s + lz * c) };
}

/**
 * The items of a prefab placed at `at` = { x, z, rotationY, floor }: store data with ids (`idFor(member)`:
 * an old id to keep, else a new one) and metadata.group. Visitor chairs carry `visitor: true` (people at
 * desks never seat the desk's person there).
 * @returns {object[]}
 */
export function prefabItems(prefab, params, catalog, at, { groupId, idFor, keep = () => null }) {
  const { members, params: p } = layoutPrefab(prefab, params, catalog);
  return members.map((m) => {
    const w = toWorld(at, m.x, m.z);
    const old = keep(m) ?? {};
    const metadata = { ...(old.metadata ?? {}) };
    delete metadata.ws;
    if (m.ws) metadata.ws = m.ws;
    if (m.role === 'visitor') metadata.visitor = true;
    metadata.group = { id: groupId, prefab: prefab.id, slot: m.slot, role: m.role, params: p };
    return {
      ...(old.label ? { label: old.label } : {}),
      ...(old.department ? { department: old.department } : {}),
      ...(old.isLocked ? { isLocked: true } : {}),
      id: idFor(m),
      assetType: m.assetType,
      floor: at.floor ?? 0,
      x: w.x,
      y: 0,
      z: w.z,
      rotationX: 0,
      rotationY: normAngle((at.rotationY ?? 0) + m.rotationY),
      rotationZ: 0,
      scaleX: m.scaleX,
      scaleY: 1,
      scaleZ: m.scaleZ,
      metadata,
    };
  });
}

/** The saved group of an item: { id, prefab, slot, role, params } or null. */
export function groupOf(obj) {
  const g = obj?.metadata?.group;
  return g && typeof g.id === 'string' ? g : null;
}

/** The items of a saved group, desks first then by slot. */
export function groupItems(objects, groupId) {
  const all = Array.isArray(objects) ? objects : Object.values(objects ?? {});
  const order = { desk: 0, chair: 1, visitor: 2 };
  return all.filter((o) => groupOf(o)?.id === groupId)
    .sort((a, b) => (order[groupOf(a).role] ?? 3) - (order[groupOf(b).role] ?? 3) || groupOf(a).slot - groupOf(b).slot);
}

/** The ids a click on `obj` selects: its whole saved group (2+ items), else just it. */
export function selectionFor(objects, obj, { alone = false } = {}) {
  const g = groupOf(obj);
  if (!g || alone) return [obj.id];
  const ids = groupItems(objects, g.id).map((o) => o.id);
  return ids.length > 1 ? ids : [obj.id];
}

/** Is `ids` exactly one saved group? → its id, else null. */
export function selectedGroup(objects, ids) {
  if (!ids?.length) return null;
  const all = Array.isArray(objects) ? Object.fromEntries(objects.map((o) => [o.id, o])) : objects ?? {};
  const g = groupOf(all[ids[0]]);
  if (!g) return null;
  const members = groupItems(all, g.id);
  if (members.length !== ids.length || !members.every((m) => ids.includes(m.id))) return null;
  return g.id;
}

/**
 * Where a placed prefab is now, from its first desk (the group may have been moved or turned as a
 * whole): { x, z, rotationY, floor } such that layoutPrefab's slot-0 desk lands on it.
 */
export function groupOrigin(prefab, members, catalog) {
  const desk = members.find((o) => groupOf(o)?.role === 'desk' && groupOf(o).slot === 0)
    ?? members.find((o) => groupOf(o)?.role === 'desk');
  if (!desk) return null;
  const g = groupOf(desk);
  const local = layoutPrefab(prefab, g.params, catalog).members.find((m) => m.role === 'desk' && m.slot === g.slot);
  if (!local) return null;
  const rotationY = (desk.rotationY ?? 0) - local.rotationY;
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return {
    x: r3(desk.x - (local.x * c + local.z * s)),
    z: r3(desk.z - (-local.x * s + local.z * c)),
    rotationY: normAngle(rotationY),
    floor: desk.floor ?? 0,
  };
}

/**
 * A placed prefab with new options: the items to remove and to add (ONE editor.replaceObjects step).
 * Members keep their ids by role + slot (a desk keeps its people); new slots get `newId()`.
 */
export function rebuildGroup(prefab, members, params, catalog, newId) {
  const at = groupOrigin(prefab, members, catalog);
  if (!at) return null;
  const byKey = new Map(members.map((o) => [memberKey(groupOf(o)), o]));
  const groupId = groupOf(members[0]).id;
  const add = prefabItems(prefab, params, catalog, at, {
    groupId,
    idFor: (m) => byKey.get(memberKey(m))?.id ?? newId(),
    keep: (m) => byKey.get(memberKey(m)) ?? null,
  });
  return { removeIds: members.map((o) => o.id), add };
}

/** Ungrouping: a patch per member that drops metadata.group (its desk options stay). */
export function ungroupMoves(members) {
  return members.map((o) => {
    const metadata = { ...(o.metadata ?? {}) };
    delete metadata.group;
    return [o.id, { metadata }];
  });
}

/**
 * Copies of grouped items (paste, duplicate): each copied group gets a new id (`newGroupId()`); a group
 * left with one item is no group. Who sits at a desk is never copied (new desk ids = empty seats).
 */
export function regroupCopies(items, newGroupId) {
  const counts = new Map();
  for (const o of items) { const g = groupOf(o); if (g) counts.set(g.id, (counts.get(g.id) ?? 0) + 1); }
  const ids = new Map();
  return items.map((o) => {
    const g = groupOf(o);
    if (!g) return o;
    const metadata = { ...o.metadata };
    if (counts.get(g.id) < 2) delete metadata.group;
    else {
      if (!ids.has(g.id)) ids.set(g.id, newGroupId());
      metadata.group = { ...g, id: ids.get(g.id) };
    }
    return { ...o, metadata };
  });
}

/** The seats of a group, Seat 1…N: [{ n, desk, chair }] (the chair of the same slot, or null). */
export function groupSeats(members) {
  const desks = members.filter((o) => groupOf(o)?.role === 'desk').sort((a, b) => groupOf(a).slot - groupOf(b).slot);
  return desks.map((desk, i) => ({
    n: i + 1,
    desk,
    chair: members.find((o) => groupOf(o)?.role === 'chair' && groupOf(o).slot === groupOf(desk).slot) ?? null,
  }));
}

/** The world outline of a prefab placed at `at` (a turned rectangle: { x, z, hw, hd, rot }). */
export function prefabOutline(prefab, params, catalog, at) {
  const { width, depth } = layoutPrefab(prefab, params, catalog);
  return { x: at.x, z: at.z, hw: width / 2, hd: depth / 2, rot: at.rotationY ?? 0 };
}

/** "6-person cluster" or the prefab's label. */
export function prefabName(prefab) {
  return prefab?.label ?? 'Group';
}
