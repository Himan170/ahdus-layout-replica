/**
 * ui/selectionLabel.js (v0.18.9)
 *
 * PURE: what the selection bar says first: the selected thing's name and, when its name is not already that, its
 * type ("Office Chair"; "Asha's chair" · Office Chair; "Team office" · Office; "Wall"). User text is returned
 * as plain text: the bar shows it with textContent (React text), never as HTML.
 * Tests: ui/__tests__/selectionLabel.test.js.
 */

/** Types whose catalogue label is not what people call them. */
const TYPE_NAMES = { WALL_SEGMENT: 'Wall', GLASS_PARTITION: 'Glass wall' };
const MAX_NAME = 60;

const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s;
};

/**
 * @param {{ object?: object | null, room?: object | null, catalog?: object, roomTypes?: object }} sel
 * @returns {{ name: string, type: string | null }}
 */
export function selectionLabel({ object = null, room = null, catalog = {}, roomTypes = {} } = {}) {
  if (object) {
    const type = TYPE_NAMES[object.assetType] ?? catalog[object.assetType]?.label ?? 'Item';
    const name = clean(object.label);
    return name && name.toLowerCase() !== type.toLowerCase() ? { name, type } : { name: type, type: null };
  }
  if (room) {
    const type = roomTypes[room.type]?.label ?? 'Room';
    const name = clean(room.name);
    return name && name.toLowerCase() !== type.toLowerCase() ? { name, type } : { name: type, type: null };
  }
  return { name: '', type: null };
}
