/**
 * ui/PublishDialogs.jsx
 *
 * Workplace Studio inside AHDUS (hooks/useAhdusPublish.js opens them):
 * - PublishDialog: "Publish <site>?", who will see it, when it was last published
 *   (the newest 'published' entry of the versions list), Cancel / Publish.
 * - LeaveDialog: leaving while employees still see an older version: Stay / Publish now / Leave.
 */

import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import Dialog from './Dialog';
import { lastPublishedAt, lastPublishedText } from './publishFlow';

/** loadVersions: () => Promise<versions[]> (newest first; may reject). */
export function PublishDialog({ siteName, state, busy, loadVersions, onCancel, onConfirm }) {
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
          <button className="ui-btn is-primary" onClick={onConfirm} disabled={busy} data-autofocus>
            <Send size={16} strokeWidth={1.75} aria-hidden /> {busy ? 'Publishing…' : 'Publish'}
          </button>
        </>
      )}
    >
      <p>Everyone in your company will see this version.</p>
      {lastLine && <p className="ui-muted" data-last-published>{lastLine}</p>}
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
