/**
 * ui/VersionHistory.jsx
 *
 * Task R4: Version history popover in StudioHeader.
 * Allows viewing snapshots, creating named versions, and restoring past versions.
 * Restoring a version is undoable via Ctrl+Z (CommandHistory).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { History, Save, RotateCcw, Clock, Sparkles } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { listVersions, createVersion, restoreVersion } from '../services/apiService';
import { usePopover } from './usePopover';

const ICON = { size: 18, strokeWidth: 1.75 };

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export default function VersionHistory({ editor, onMessage }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versionNote, setVersionNote] = useState('');
  const [restoringId, setRestoringId] = useState(null);

  const wrapRef = useRef(null);
  const close = () => setOpen(false);
  usePopover(open, close, [wrapRef]);

  const companyId = useWorkspaceStore((s) => s.companyId);
  const layoutId = useWorkspaceStore((s) => s.layoutId);

  const fetchVersions = useCallback(async () => {
    if (!companyId || !layoutId) return;
    setLoading(true);
    try {
      const list = await listVersions(companyId, layoutId);
      setVersions(list);
    } catch (err) {
      console.warn('[VersionHistory] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, layoutId]);

  useEffect(() => {
    if (open) {
      fetchVersions();
    }
  }, [open, fetchVersions]);

  const handleSaveVersion = async (e) => {
    e.preventDefault();
    if (!companyId || !layoutId || saving) return;
    setSaving(true);
    try {
      const res = await createVersion(versionNote);
      if (res.ok) {
        setVersionNote('');
        await fetchVersions();
        onMessage?.(`Saved snapshot "${res.version?.name}"`);
      } else {
        onMessage?.(res.error || 'Could not save version', true);
      }
    } catch (err) {
      onMessage?.(err?.message || 'Failed to create version', true);
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (version) => {
    if (!companyId || !layoutId || restoringId) return;
    setRestoringId(version.id);
    try {
      const res = await restoreVersion(companyId, layoutId, version.id, editor);
      if (res.ok) {
        onMessage?.(`Restored "${version.name || `Version ${version.version}`}". Press Ctrl+Z to undo.`);
        setOpen(false);
      } else {
        onMessage?.(res.error || 'Could not restore version', true);
      }
    } catch (err) {
      onMessage?.(err?.message || 'Restore failed', true);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="studio-header__version-history" ref={wrapRef}>
      <button
        className="ui-icon-btn"
        aria-label="Version history"
        title="Version history"
        aria-expanded={open}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        <History {...ICON} />
      </button>

      {open && (
        <div className="ui-pop version-history-pop" role="dialog" aria-label="Version history">
          <div className="version-history-pop__header">
            <span>Version History</span>
            <span className="ui-muted" style={{ fontSize: 12 }}>
              {versions.length} {versions.length === 1 ? 'version' : 'versions'}
            </span>
          </div>

          <form className="version-history-pop__save" onSubmit={handleSaveVersion}>
            <input
              type="text"
              className="ui-input"
              placeholder="Name this version (optional)"
              value={versionNote}
              onChange={(e) => setVersionNote(e.target.value)}
              disabled={saving}
              aria-label="Version note"
            />
            <button
              type="submit"
              className="ui-btn ui-btn--primary"
              disabled={saving}
              title="Save a snapshot of the current workplace layout"
            >
              <Save size={14} aria-hidden />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>

          <div className="version-history-pop__list" role="list">
            {loading && versions.length === 0 ? (
              <div className="version-history-pop__empty ui-muted">Loading versions…</div>
            ) : versions.length === 0 ? (
              <div className="version-history-pop__empty ui-muted">
                No versions saved yet. Versions are created automatically as you save, or you can save one above.
              </div>
            ) : (
              versions.map((ver) => {
                const roomCount = Array.isArray(ver.snapshot?.rooms)
                  ? ver.snapshot.rooms.length
                  : typeof ver.snapshot?.rooms === 'object' && ver.snapshot.rooms !== null
                    ? Object.keys(ver.snapshot.rooms).length
                    : 0;
                const objectCount = Array.isArray(ver.snapshot?.objects)
                  ? ver.snapshot.objects.length
                  : typeof ver.snapshot?.objects === 'object' && ver.snapshot.objects !== null
                    ? Object.keys(ver.snapshot.objects).length
                    : 0;

                const isAuto = ver.name?.toLowerCase().includes('auto-save');

                return (
                  <div key={ver.id || ver.version} className="version-history-pop__item" role="listitem">
                    <div className="version-history-pop__item-meta">
                      <div className="version-history-pop__item-title">
                        <span className="version-history-pop__badge">v{ver.version}</span>
                        {isAuto ? <Sparkles size={12} className="ui-muted" style={{ display: 'inline', margin: '0 4px' }} /> : null}
                        <span>{ver.name}</span>
                      </div>
                      <div className="version-history-pop__item-sub">
                        <Clock size={11} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
                        <span>{formatDate(ver.created_at)}</span>
                        {(roomCount > 0 || objectCount > 0) && (
                          <span> • {roomCount} {roomCount === 1 ? 'room' : 'rooms'}, {objectCount} {objectCount === 1 ? 'item' : 'items'}</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="ui-btn ui-btn--ghost ui-btn--sm"
                      onClick={() => handleRestore(ver)}
                      disabled={restoringId === ver.id}
                      title="Restore this version (undoable with Ctrl+Z)"
                    >
                      <RotateCcw size={13} aria-hidden />
                      {restoringId === ver.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
