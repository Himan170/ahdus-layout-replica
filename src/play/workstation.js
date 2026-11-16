/**
 * play/workstation.js: PURE (v0.18.0). The options of a parametric workstation desk (a manifest item
 * with `builder: 'workstation'`, catalog/workstations.json) and the key of its drawn shape.
 *
 * What is saved is ordinary: the size is the catalogue size × scaleX / Y / Z (as for every item, so
 * footprints, the walk map, seats and the Inspector's metres need nothing new), the rest is the item's
 * `metadata.ws` = { partition: 'none' | 'fabric' | 'glass', partitionHeight (m above the desk top),
 * sides: 'none' | 'left' | 'right' | 'both', pedestal, screen, modesty } (missing: the catalogue's
 * `params`). A desk is DRAWN at its real size (utils/workstationMesh.js), never stretched: legs and
 * panels keep their thickness. Desks with the same options share one template (`wsKey`).
 */

export const PARTITION_HEIGHT_MIN = 0.2;
export const PARTITION_HEIGHT_MAX = 0.9;
export const SIDES = Object.freeze(['none', 'left', 'right', 'both']);
export const PARTITIONS = Object.freeze(['none', 'fabric', 'glass']);

const cm = (v) => Math.round(v * 100) / 100;

/** Is this catalogue entry a parametric workstation? */
export function isWorkstation(def) {
  return def?.builder === 'workstation';
}

/**
 * The options of a workstation item: sizes in metres from its scale, the rest from `metadata.ws`.
 * @param {object} obj  a store item (scaleX / Y / Z, metadata), or null for the catalogue's own
 * @param {object} def  its catalogue entry
 */
export function wsParams(obj, def) {
  const base = def?.params ?? {};
  const own = obj?.metadata?.ws ?? {};
  const pick = (k) => (own[k] !== undefined ? own[k] : base[k]);
  const ph = Number(pick('partitionHeight'));
  const partition = pick('partition');
  const sides = pick('sides');
  return {
    width: cm((def?.defaultWidth ?? 1.4) * Math.abs(obj?.scaleX ?? 1)),
    depth: cm((def?.defaultDepth ?? 0.7) * Math.abs(obj?.scaleZ ?? 1)),
    height: cm((def?.defaultHeight ?? 0.75) * Math.abs(obj?.scaleY ?? 1)),
    partition: PARTITIONS.includes(partition) ? partition : 'none',
    partitionHeight: cm(Number.isFinite(ph) ? Math.min(PARTITION_HEIGHT_MAX, Math.max(PARTITION_HEIGHT_MIN, ph)) : 0.45),
    sides: SIDES.includes(sides) ? sides : 'none',
    pedestal: pick('pedestal') !== false,
    screen: pick('screen') !== false,
    modesty: pick('modesty') === true,
  };
}

/** The template key of a desk's drawn shape: desks with the same key share one template. */
export function wsKey(p) {
  return [p.width, p.depth, p.height, p.partition, p.partition === 'none' ? 0 : p.partitionHeight,
    p.partition === 'none' ? 'none' : p.sides, p.pedestal ? 1 : 0, p.screen ? 1 : 0, p.modesty ? 1 : 0].join('|');
}

/** Does this desk's person type at it (its own screen and keyboard, people.workClip)? */
export function hasOwnScreen(obj, def) {
  return isWorkstation(def) && wsParams(obj, def).screen;
}

/**
 * A patch of `metadata.ws` for an item (the Inspector's Partition, Sides…): the item's metadata with
 * those options changed. `null` values go back to the catalogue's.
 */
export function wsPatch(obj, changes) {
  const ws = { ...(obj?.metadata?.ws ?? {}) };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined) delete ws[k];
    else ws[k] = k === 'partitionHeight' ? cm(Math.min(PARTITION_HEIGHT_MAX, Math.max(PARTITION_HEIGHT_MIN, v))) : v;
  }
  const metadata = { ...(obj?.metadata ?? {}) };
  if (Object.keys(ws).length) metadata.ws = ws;
  else delete metadata.ws;
  return { metadata };
}
