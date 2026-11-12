/**
 * ui/seatFlow.js
 *
 * PURE: "Who sits here" in Workplace Studio inside AHDUS (tested in
 * ui/__tests__/seatFlow.test.js). Seats are not in the layout: the AHDUS server
 * keeps them (workplace_seats: one person per desk, one desk per person in a
 * site), Admin and HR set them, everyone who sees the workplace reads them.
 * A seat = { deskId, userId, name, department, assetReference, hasDesk }
 * (hasDesk: the server found the desk in the published layout).
 */

import { charactersOf, neutralFor } from '../embed/characterManifest';
import { cleanClothing } from '../play/outfit';

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

/**
 * What a desk is called in messages: its own name, else its type and number
 * among the desks of that type ("Desk 4"); a desk not in the layout is "a desk
 * that was removed".
 * @param {string} deskId
 * @param {object[]} objects  the layout's objects
 * @param {(assetType: string) => string} [typeLabel]
 */
export function deskLabel(deskId, objects, typeLabel = (t) => t) {
  const desks = desksOf(objects);
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
  const mine = had && desksOf(objects).some((o) => String(o.id) === String(had.deskId)) ? had : null;
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
  const desks = new Set(desksOf(objects).map((o) => String(o.id)));
  return (seats ?? []).filter((s) => !desks.has(String(s.deskId)));
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
  const desks = new Set(desksOf(objects).map((o) => String(o.id)));
  return (seats ?? []).filter((s) => desks.has(String(s.deskId))).map((s) => ({
    personId: String(s.userId),
    deskId: String(s.deskId),
    name: s.name ?? '',
    department: s.department ?? '',
    character: (s.assetReference && characters.get(s.assetReference))
      || characters.get(neutralFor(String(s.userId), manifest)) || null, // none: their neutral one (v0.16.0)
    characterChosen: !!s.assetReference,
    ...(cleanClothing(s.clothing) ? { clothing: cleanClothing(s.clothing) } : {}),
  }));
}
