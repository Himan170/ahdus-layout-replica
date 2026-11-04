/**
 * ui/SeatsBanner.jsx
 *
 * Workplace Studio inside AHDUS, Admin and HR only: "People without a desk (N)",
 * the people whose desk is not in this layout any more (deleted, or replaced by
 * a new one). Each gets "Assign a desk" (the next desk selected is theirs) or
 * "Remove" (they no longer have a seat here). Names are text only.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, UserX } from 'lucide-react';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

export default function SeatsBanner({ seats, busy, picking, onAssignDesk, onRemove }) {
  const [open, setOpen] = useState(false);
  if (!seats?.length) return null;
  return (
    <aside className="seats-banner" aria-label="People without a desk" data-seats-banner={seats.length}>
      <div className="seats-banner__bar">
        <UserX {...ICON} />
        <button className="seats-banner__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          People without a desk ({seats.length})
          {open ? <ChevronUp {...ICON} /> : <ChevronDown {...ICON} />}
        </button>
        {!open && <span className="ui-muted seats-banner__why">Their desk is not in this layout any more.</span>}
      </div>
      {open && (
        <ul className="seats-banner__list">
          {seats.map((s) => (
            <li key={s.userId} data-seat-without-desk={s.userId}>
              <span className="seats-banner__name">
                <strong>{s.name || 'Someone'}</strong>
                {s.department && <span className="ui-muted"> · {s.department}</span>}
              </span>
              <button className="ui-btn insp-small" disabled={busy} aria-pressed={picking === s.userId}
                onClick={() => onAssignDesk(s)}>
                Assign a desk
              </button>
              <button className="ui-btn is-ghost insp-small" disabled={busy} onClick={() => onRemove(s.deskId)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
