/**
 * useAhdusSeats.js
 *
 * Workplace Studio inside AHDUS (with `enabled` false it does nothing): who sits
 * at which desk, the rules in ui/seatFlow.js.
 * - Asks AHDUS what the signed-in person may do (GET /me): Admin and HR
 *   ('manage') seat people, appointed editors ('view') see names only.
 * - The seats (GET …/seats) are drawn at their desks in Studio, with the
 *   characters of AHDUS's manifest (a manifest that can't be read = simple figures).
 * - Seating, moving, replacing and removing are saved at once (PUT / DELETE
 *   …/seats/{desk}): not in the draft, not in undo, no publish needed. Moving
 *   someone or replacing someone asks first (`confirm`, a dialog in WorkplaceEditor).
 * - "Assign a desk" for someone whose desk is gone: the next desk selected is theirs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useWorkspaceStore } from '../store/workspaceStore';
import {
  AHDUS_CHARACTERS, getMe, listSeats, setSeat, removeSeat, findPeople,
} from '../services/ahdusBackend';
import { readManifest } from '../embed/characterManifest';
import { ASSET_TYPES } from '../utils/assetCatalog';
import {
  seatAccess, isDesk, assignPlan, withSeat, withoutSeat, seatedPeople, seatsWithoutDesk, seatsLosingDesk,
  deskLabel,
} from '../ui/seatFlow';
import { sentence } from '../ui/publishFlow';

const typeLabel = (t) => ASSET_TYPES[t]?.label ?? t;
const nameOf = (p) => (p?.name && String(p.name).trim()) || 'Someone';

export function useAhdusSeats({ enabled, objects, toast, phone }) {
  const site = useWorkspaceStore((s) => s.layoutId);
  const selectedObjectId = useWorkspaceStore((s) => s.selectedObjectId);
  const [me, setMe] = useState(null);
  const [seats, setSeats] = useState([]);
  const [characters, setCharacters] = useState(() => new Map());
  const [confirm, setConfirm] = useState(null); // { plan, deskId, person } waiting for Move here / Replace
  const [busy, setBusy] = useState(false);
  const [pickFor, setPickFor] = useState(null); // a seat whose person gets the next desk selected
  const access = enabled ? seatAccess(me) : 'none';
  const live = useRef({});
  live.current = { site, seats, objects, toast };

  const refresh = useCallback(async () => {
    const at = live.current.site;
    if (!at) return;
    const res = await listSeats(at);
    if (res.ok && live.current.site === at) setSeats(res.seats);
    else if (!res.ok) console.warn('[AHDUS] could not read who sits where:', res.error);
  }, []);

  // When Studio opens: what may I do, who sits where, and the characters' files
  useEffect(() => {
    if (!enabled || !site) return undefined;
    let cancelled = false;
    getMe().then((res) => {
      if (cancelled) return;
      if (!res.ok) { console.warn('[AHDUS] could not read your rights:', res.error); return; }
      setMe(res.me);
      if (seatAccess(res.me) !== 'none') refresh();
    });
    readManifest({ manifestUrl: AHDUS_CHARACTERS }, { pageUrl: window.location.href })
      .then((m) => { if (!cancelled) setCharacters(m); }) // the whole manifest (v2: clip sets, the neutral set)
      .catch((err) => console.warn(`[AHDUS] ${err.message}: everyone is a simple figure`));
    return () => { cancelled = true; };
  }, [enabled, site, refresh]);

  const label = useCallback((deskId) => deskLabel(deskId, live.current.objects, typeLabel), []);

  const save = useCallback(async (deskId, person) => {
    setBusy(true);
    try {
      const res = await setSeat(live.current.site, deskId, person.id);
      if (!res.ok) {
        live.current.toast?.('bad', `${nameOf(person)} was not seated: ${sentence(res.error)}`);
        return false;
      }
      setSeats((list) => withSeat(list, { ...res.seat, name: res.seat.name || person.name }));
      live.current.toast?.('ok', `${nameOf(person)} now sits at ${label(deskId)}.`);
      refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }, [label, refresh]);

  /** Seat `person` ({ id, name }) at a desk: at once, or after the Move here / Replace question. */
  const assign = useCallback((deskId, person) => {
    const plan = assignPlan({ seats: live.current.seats, deskId, person, objects: live.current.objects, typeLabel });
    if (plan.kind === 'same') return;
    if (plan.question) setConfirm({ plan, deskId, person });
    else save(deskId, person);
  }, [save]);
  const confirmAssign = useCallback(async () => {
    if (!confirm) return;
    await save(confirm.deskId, confirm.person);
    setConfirm(null);
  }, [confirm, save]);
  const cancelAssign = useCallback(() => { if (!busy) setConfirm(null); }, [busy]);

  const remove = useCallback(async (deskId) => {
    const seat = live.current.seats.find((s) => String(s.deskId) === String(deskId));
    setBusy(true);
    try {
      const res = await removeSeat(live.current.site, deskId);
      if (!res.ok) {
        live.current.toast?.('bad', `Not removed: ${sentence(res.error)}`);
        return;
      }
      setSeats((list) => withoutSeat(list, deskId));
      live.current.toast?.('ok', `${nameOf(seat)} no longer has a desk here.`);
    } finally {
      setBusy(false);
    }
  }, []);

  const search = useCallback((q, signal) => findPeople(q, { signal }), []);

  // "Assign a desk": the next desk selected is theirs; Esc cancels
  useEffect(() => {
    if (!pickFor) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPickFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickFor]);
  useEffect(() => {
    if (!pickFor || !selectedObjectId) return;
    const desk = live.current.objects.find((o) => o.id === selectedObjectId);
    if (!desk || !isDesk(desk.assetType)) return;
    const person = { id: pickFor.userId, name: pickFor.name };
    setPickFor(null);
    assign(desk.id, person);
  }, [pickFor, selectedObjectId, assign]);

  const people = useMemo(() => seatedPeople(seats, objects, characters), [seats, objects, characters]);
  const withoutDesk = useMemo(() => seatsWithoutDesk(seats, objects), [seats, objects]);
  const losing = useMemo(() => seatsLosingDesk(seats, objects), [seats, objects]);
  const pickHint = pickFor
    ? `${phone ? 'Tap' : 'Click'} the desk where ${nameOf(pickFor)} sits · Esc cancels`
    : null;

  return {
    access, seats, people, withoutDesk, losing, busy, confirm, pickHint, pickingFor: pickFor?.userId ?? null, label,
    assign, confirmAssign, cancelAssign, remove, search, refresh,
    startPickDesk: (seat) => { useWorkspaceStore.getState().selectObject(null); setPickFor(seat); },
    cancelPickDesk: () => setPickFor(null),
  };
}
