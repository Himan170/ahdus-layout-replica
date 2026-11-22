/**
 * ui/seatFlow.js
 *
 * PURE: "Who sits here" in Workplace Studio inside AHDUS (tested in
 * ui/__tests__/seatFlow.test.js). Seats are not in the layout: the AHDUS server
 * keeps them (workplace_seats: one person per desk, one desk per person in a
 * site), Admin and HR set them, everyone who sees the workplace reads them.
 * A seat = { deskId, userId, name, department, assetReference, hasDesk }
 * (hasDesk: the server found the desk in the published layout).
 * v0.18.9: a seat is a desk or a chair on its own (`deskId` is then the chair's id); a desk's own chair is no
 * seat of its own: it shows its desk's person (play/people.js seatedAt, the same rule as the viewer).
 */

import { charactersOf, fileOf, neutralFor } from '../embed/characterManifest';
import { cleanClothing } from '../play/outfit';
import { deskSeats, isSeatChair } from '../play/people';

/** Desks people sit at: DESK* and RECEPTION_DESK (the same rule as play/people.js and the AHDUS server). */
export function isDesk(assetType) {
  return typeof assetType === 'string' && (assetType.startsWith('DESK') || assetType === 'RECEPTION_DESK');
}

/**
 * What the signed-in person may do with seats: 'manage' (Admin and HR), 'view'
 * (appointed editors: names only), 'none' (not known yet, or not inside AHDUS).
 * @param {{ canEdit?: boolean, canAppoint?: boolean } | null} me
 */
export function seatAccess(me) {
  if (!me) return 'none';
  if (me.canAppoint) return 'manage';
  return me.canEdit ? 'view' : 'none';
}

/** The desks of a layout's objects, in layout order. */
export function desksOf(objects) {
  return (objects ?? []).filter((o) => o && isDesk(o.assetType));
}

/** v0.18.9: the chair a desk pairs with (play/people.js deskSeats) → that desk's id. */
function ownChairs(objects) {
  return new Map([...deskSeats(objects ?? [])].map(([deskId, chair]) => [chair.id, deskId]));
}

/**
 * v0.18.9: what kind of seat an item is: 'desk', 'chair' (a chair on its own: someone can sit there),
 * 'desk-chair' (a desk's own chair: its desk's person, read only), or null (no seat).
 */
export function seatKindOf(obj, objects) {
  if (!obj) return null;
  if (isDesk(obj.assetType)) return 'desk';
  if (!isSeatChair(obj.assetType)) return null;
  return ownChairs(objects).has(obj.id) ? 'desk-chair' : 'chair';
}

/** v0.18.9: the desk whose own chair this is (null: not a desk's chair). */
export function deskOfChair(chairId, objects) {
  return ownChairs(objects).get(chairId) ?? null;
}

/** v0.18.9: the seats of a layout's objects (desks and chairs on their own), in layout order. */
export function seatsOf(objects) {
  const own = ownChairs(objects);
  return (objects ?? []).filter((o) => o && (isDesk(o.assetType) || (isSeatChair(o.assetType) && !own.has(o.id))));
}

/**
 * What a desk is called in messages: its own name, else its type and number
 * among the desks of that type ("Desk 4"); a desk not in the layout is "a desk
 * that was removed".
 * @param {string} deskId
 * @param {object[]} objects  the layout's objects
 * @param {(assetType: string) => string} [typeLabel]
 */
export function deskLabel(deskId, objects, typeLabel = (t) => t) {
  const desks = seatsOf(objects); // v0.18.9: a chair on its own too ("Office Chair 2")
  const desk = desks.find((o) => String(o.id) === String(deskId));
  if (!desk) return 'a desk that was removed';
  const own = typeof desk.label === 'string' ? desk.label.trim() : '';
  if (own) return own;
  const sameType = desks.filter((o) => o.assetType === desk.assetType);
  return `${typeLabel(desk.assetType)} ${sameType.indexOf(desk) + 1}`;
}

export function seatAtDesk(seats, deskId) {
  return (seats ?? []).find((s) => String(s.deskId) === String(deskId)) ?? null;
}

export function seatOfPerson(seats, userId) {
  return (seats ?? []).find((s) => s.userId === userId) ?? null;
}

const nameOf = (p) => (p?.name && String(p.name).trim()) || 'Someone';

/**
 * Seating `person` at `deskId`: what happens and what to ask first.
 *   'same'          they already sit there (nothing to do)
 *   'assign'        an empty desk, a person with no desk here: no question
 *   'move'          "Asha already sits at Desk 4. Move them here?" (a desk of this layout)
 *   'replace'       "This replaces Ravi."
 *   'move-replace'  both sentences
 * @returns {{ kind: string, question: string | null, title: string | null, confirmLabel: string | null }}
 */
export function assignPlan({ seats, deskId, person, objects, typeLabel }) {
  const here = seatAtDesk(seats, deskId);
  const had = seatOfPerson(seats, person.id);
  // a desk that is no longer in the layout is no desk to move them from (People without a desk)
  const mine = had && seatsOf(objects).some((o) => String(o.id) === String(had.deskId)) ? had : null;
  if (here && here.userId === person.id) return { kind: 'same', question: null, title: null, confirmLabel: null };
  const parts = [];
  if (mine) parts.push(`${nameOf(person)} already sits at ${deskLabel(mine.deskId, objects, typeLabel)}. Move them here?`);
  if (here) parts.push(`This replaces ${nameOf(here)}.`);
  if (!parts.length) return { kind: 'assign', question: null, title: null, confirmLabel: null };
  const kind = mine && here ? 'move-replace' : mine ? 'move' : 'replace';
  return {
    kind,
    question: parts.join(' '),
    title: mine ? `Move ${nameOf(person)} here?` : `Replace ${nameOf(here)}?`,
    confirmLabel: mine ? 'Move here' : 'Replace',
  };
}

/** The seats after the server seated `seat` (one person per desk, one desk per person). */
export function withSeat(seats, seat) {
  const rest = (seats ?? []).filter((s) => String(s.deskId) !== String(seat.deskId) && s.userId !== seat.userId);
  return [...rest, seat];
}

/** The seats after nobody sits at `deskId` any more. */
export function withoutSeat(seats, deskId) {
  return (seats ?? []).filter((s) => String(s.deskId) !== String(deskId));
}

/**
 * People without a desk: seats whose desk is not in the layout Studio shows
 * (the draft). They are listed so Admin and HR can seat them again or remove them.
 */
export function seatsWithoutDesk(seats, objects) {
  const shown = new Set(shownSeats(seats, objects));
  return (seats ?? []).filter((s) => !shown.has(s));
}

/**
 * v0.18.9: the seats Studio shows, one per seat and one seat per person (the first wins): on a desk or a chair on
 * its own of the layout. A seat on a desk's own chair is not shown (that chair shows its desk's person).
 */
export function shownSeats(seats, objects) {
  const ids = new Set(seatsOf(objects).map((o) => String(o.id)));
  const desks = new Set();
  const people = new Set();
  const out = [];
  for (const s of seats ?? []) {
    if (!s || !ids.has(String(s.deskId)) || desks.has(String(s.deskId)) || people.has(s.userId)) continue;
    desks.add(String(s.deskId));
    people.add(s.userId);
    out.push(s);
  }
  return out;
}

/**
 * Publishing would take these people's desk away: they have one employees see
 * now (hasDesk) and the draft no longer has it.
 */
export function seatsLosingDesk(seats, objects) {
  return seatsWithoutDesk(seats, objects).filter((s) => s.hasDesk !== false);
}

/** "2 people lose their desk: Asha, Ravi." (null: nobody). */
export function losingDeskText(losing) {
  if (!losing?.length) return null;
  const names = losing.map(nameOf).join(', ');
  return losing.length === 1 ? `1 person loses their desk: ${names}.` : `${losing.length} people lose their desk: ${names}.`;
}

/** The people Studio draws at their desks: seats on desks of the layout (LayoutEngine / CharacterSystem shape). */
export function seatedPeople(seats, objects, manifest = new Map()) {
  const characters = charactersOf(manifest);
  return shownSeats(seats, objects).map((s) => ({
    personId: String(s.userId),
    deskId: String(s.deskId),
    name: s.name ?? '',
    department: s.department ?? '',
    // none: their neutral one; at their desk the manifest's lighter copy when it has one (v0.16.0)
    character: fileOf((s.assetReference && characters.get(s.assetReference))
      || characters.get(neutralFor(String(s.userId), manifest)) || null, { seated: true }),
    characterChosen: !!s.assetReference,
    ...(cleanClothing(s.clothing) ? { clothing: cleanClothing(s.clothing) } : {}),
  }));
}
