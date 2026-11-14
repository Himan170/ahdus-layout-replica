/**
 * play/roomNames.js — PURE (v0.17.2): show a room's type next to its name only when it says something new.
 * "Corridor · Corridor", "Stairs · Staircase", "Meeting Room 2 · Meeting room" are repeats; "Washroom · Restroom",
 * "Board Room · Meeting room" are not. Used by Find's results and menus (navigation/places.js), Studio's room card
 * (ui/RoomLabels.jsx) and hover card (ui/RoomHoverCard.jsx); AHDUS-FRONTEND's 3D Company room list has the same
 * rule (workplace-page.js). Tests: play/__tests__/roomNames.test.js.
 *
 * The type repeats the name when each of its words (leaving out "room", "area", "space", "and" …) is in the name,
 * where two words match when one starts the other and the shorter has at least 4 letters ("stair" / "staircase",
 * "office" / "offices"), or they are the same.
 */

const FILLER = new Set(['room', 'rooms', 'area', 'areas', 'space', 'spaces', 'the', 'and', 'of', 's']);

/** A label's own words: lower case, letters and digits, no filler, a plural's "s" off. */
function wordsOf(text) {
  return String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function sameWord(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** True when `typeLabel` adds nothing to `name` (an empty type, or one of filler words only, too). */
export function typeRepeatsName(name, typeLabel) {
  const type = wordsOf(typeLabel);
  if (!type.length) return true;
  const own = wordsOf(name);
  return type.every((t) => own.some((n) => sameWord(t, n)));
}

/** The type label to show beside the name: '' when it would repeat it. */
export function roomTypeShown(name, typeLabel) {
  return typeRepeatsName(name, typeLabel) ? '' : String(typeLabel ?? '');
}
