/**
 * ui/PublishDialogs.jsx
 *
 * Workplace Studio inside AHDUS (hooks/useAhdusPublish.js opens them):
 * - PublishDialog: "Publish <site>?", who will see it, when it was last published
 *   (the newest 'published' entry of the versions list), Cancel / Publish; and who loses
 *   their desk when the draft has removed desks people sit at (seatWarning, ui/seatFlow.js).
 * - LeaveDialog: leaving while employees still see an older version: Stay / Publish now / Leave.
 */

import { useEffect, useState } from 'react';
import { Send, AlertTriangle } from 'lucide-react';
import Dialog from './Dialog';
import { lastPublishedAt, lastPublishedText } from './publishFlow';
import { sharedFixes } from '../play/navigation/checkLayout';

/** loadVersions: () => Promise<versions[]> (newest first; may reject). */
export function PublishDialog({ siteName, state, busy, loadVersions, seatWarning = null, checkCount = 0, walking = [], onFix, onShowChecks, onCancel, onConfirm }) {
  // v0.17.4: what stops people walking somewhere is listed even when ignored, with Fix it; then "Publish anyway"
  const blocked = walking.length > 0;
  // v0.18.0: several of them from one item (the stairs): one "Fix all" for them
  const shared = blocked ? sharedFixes(walking) : [];
  const never = state === 'never';
  const [last, setLast] = useState(never ? null : undefined); // undefined: still asking

  useEffect(() => {
    if (never) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(loadVersions)
      .then((versions) => { if (!cancelled) setLast(lastPublishedAt(versions)); })
      .catch(() => { if (!cancelled) setLast(null); });
    return () => { cancelled = true; };
  }, [never, loadVersions]);

  const lastLine = never
    ? 'Not published yet'
    : last === undefined ? 'Last published: …' : last ? lastPublishedText(last) : null;

  return (
    <Dialog
      title={`Publish ${siteName}?`}
      label="Publish workplace"
      onCancel={onCancel}
      actions={(
        <>
          <button className="ui-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`ui-btn ${blocked ? 'is-danger' : 'is-primary'}`} onClick={onConfirm} disabled={busy} data-autofocus={blocked ? undefined : true}
            data-publish-anyway={blocked ? '' : undefined}>
            <Send size={16} strokeWidth={1.75} aria-hidden /> {busy ? 'Publishing…' : blocked ? 'Publish anyway' : 'Publish'}
          </button>
        </>
      )}
    >
      <p>Everyone in your company will see this version.</p>
      {lastLine && <p className="ui-muted" data-last-published>{lastLine}</p>}
      {blocked && (
        <div className="dialog-warning" data-publish-walking={walking.length}>
          <p><AlertTriangle size={16} strokeWidth={1.75} aria-hidden /> {walking.length === 1 ? 'One thing stops' : `${walking.length} things stop`} people walking where they need to:</p>
          <ul className="publish-walking">
            {walking.map((p) => (
              <li key={p.key} data-publish-problem={p.key}>
                <span>{p.message}{p.ignored && <span className="is-ignored"> (ignored)</span>}</span>
                {p.fix && onFix && <button className="ui-btn is-primary" data-publish-fix onClick={() => onFix(p)} disabled={busy}>Fix it</button>}
              </li>
            ))}
          </ul>
          {onFix && shared.map((s) => (
            <p key={s.key} className="publish-fix-all" data-publish-fix-all={s.count}>
              <span>{s.count} of these come from one item. {s.fix.label} fixes them all.</span>
              <button className="ui-btn is-primary" onClick={() => onFix({ key: s.key, fix: s.fix, floorId: walking.find((p) => p.key === s.keys[0])?.floorId })}
                disabled={busy}>Fix all</button>
            </p>
          ))}
        </div>
      )}
      {checkCount > 0 && <p data-layout-check-warning>Check found {checkCount} {checkCount === 1 ? 'problem' : 'problems'} in this layout. <button className="ui-btn" onClick={onShowChecks}>Show</button></p>}
      {seatWarning && (
        <p className="dialog-warning" data-seat-warning>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden /> {seatWarning} They stay under People without a desk.
        </p>
      )}
    </Dialog>
  );
}

export function LeaveDialog({ state, busy, onStay, onPublish, onLeave }) {
  return (
    <Dialog
      title="Leave without publishing?"
      label="Unpublished changes"
      onCancel={onStay}
      actions={(
        <>
          <button className="ui-btn" onClick={onStay} disabled={busy} data-autofocus>Stay</button>
          <button className="ui-btn is-primary" onClick={onPublish} disabled={busy}>
            <Send size={16} strokeWidth={1.75} aria-hidden /> {busy ? 'Publishing…' : 'Publish now'}
          </button>
          <button className="ui-btn is-danger" onClick={onLeave} disabled={busy}>Leave</button>
        </>
      )}
    >
      <p>
        Your changes are saved but not published.{' '}
        {state === 'never' ? "Employees don't see this workplace yet." : 'Employees still see the older version.'}
      </p>
    </Dialog>
  );
}
