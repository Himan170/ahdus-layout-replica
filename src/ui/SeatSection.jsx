/**
 * ui/SeatSection.jsx
 *
 * Inspector section "Who sits here" on a desk, in Workplace Studio inside AHDUS
 * (hooks/useAhdusSeats.js gives it its data; rules in ui/seatFlow.js).
 * - 'manage' (Admin and HR): the person (name, department) with Change / Remove,
 *   or "Assign someone"; both open a name search (debounced GET /people).
 * - 'view' (appointed editors): the name and department only.
 * Names, departments and e-mails are text (React escapes them). E-mail shows
 * only in the search results, which Admin and HR also see in AHDUS's Editors panel.
 */

import { useEffect, useRef, useState } from 'react';
import { UserPlus, UserMinus, Search, Repeat } from 'lucide-react';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };
export const SEARCH_DELAY_MS = 250;

/**
 * @param {{
 *   access: 'manage' | 'view',
 *   seat: { userId, name, department } | null,
 *   busy?: boolean,
 *   onAssign: (person: { id, name }) => void,
 *   onRemove: () => void,
 *   search: (q: string, signal: AbortSignal) => Promise<{ ok, people?, error? }>,
 *   whereSits?: (userId) => string | null,   // "Desk 2" when they sit somewhere else
 * }} props
 */
export default function SeatSection({ access, seat, busy, onAssign, onRemove, search, whereSits }) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ q: '', people: [], error: null, loading: false });
  const inputRef = useRef(null);

  useEffect(() => { if (searching) inputRef.current?.focus(); }, [searching]);

  useEffect(() => {
    if (!searching) return undefined;
    const text = q.trim();
    if (!text) { setFound({ q: '', people: [], error: null, loading: false }); return undefined; }
    const abort = new AbortController();
    setFound((f) => ({ ...f, loading: true }));
    const timer = setTimeout(async () => {
      const res = await search(text, abort.signal);
      if (abort.signal.aborted) return;
      setFound(res.ok
        ? { q: text, people: res.people, error: null, loading: false }
        : { q: text, people: [], error: res.error, loading: false });
    }, SEARCH_DELAY_MS);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [searching, q, search]);

  const stopSearch = () => { setSearching(false); setQ(''); };
  const pick = (person) => { stopSearch(); onAssign(person); };

  return (
    <section className="insp-section seat-section" aria-label="Who sits here" data-seat-section={access}>
      <h3 className="ui-section-title">Who sits here</h3>
      {seat ? (
        <div className="seat-person" data-seat-person={seat.userId}>
          <strong>{seat.name || 'Someone'}</strong>
          {seat.department && <span className="ui-muted">{seat.department}</span>}
        </div>
      ) : (
        <p className="insp-note">Nobody sits here yet.</p>
      )}

      {access === 'manage' && !searching && (
        <div className="insp-row seat-actions">
          {seat ? (
            <>
              <button className="ui-btn insp-small" onClick={() => setSearching(true)} disabled={busy}>
                <Repeat {...ICON} /> Change
              </button>
              <button className="ui-btn is-danger insp-small" onClick={onRemove} disabled={busy}>
                <UserMinus {...ICON} /> Remove
              </button>
            </>
          ) : (
            <button className="ui-btn is-primary insp-small" onClick={() => setSearching(true)} disabled={busy}>
              <UserPlus {...ICON} /> Assign someone
            </button>
          )}
        </div>
      )}

      {access === 'manage' && searching && (
        <div className="seat-search">
          <label className="seat-search__field">
            <Search {...ICON} />
            <input
              ref={inputRef}
              type="search"
              className="ui-input"
              aria-label="Search people"
              placeholder="Type a name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation(); // Studio's shortcuts (Delete, 1–6, W / E / R) stay out of typing
                if (e.key === 'Escape') stopSearch();
              }}
            />
          </label>
          <ul className="seat-results" aria-label="People found" aria-busy={found.loading || undefined}>
            {found.error && <li className="insp-note is-bad">{found.error}</li>}
            {!found.error && found.q && !found.loading && found.people.length === 0 && (
              <li className="insp-note">Nobody found for “{found.q}”.</li>
            )}
            {found.people.map((p) => {
              const elsewhere = seat?.userId === p.id ? 'Sits here' : whereSits?.(p.id);
              return (
                <li key={p.id}>
                  <button className="seat-result" onClick={() => pick(p)} disabled={busy || seat?.userId === p.id}>
                    <strong>{p.name || 'Someone'}</strong>
                    <span className="ui-muted">{[p.department, p.email].filter(Boolean).join(' · ')}</span>
                    {elsewhere && <span className="seat-result__where">{elsewhere}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <button className="ui-btn is-ghost insp-small" onClick={stopSearch}>Cancel</button>
        </div>
      )}
    </section>
  );
}
