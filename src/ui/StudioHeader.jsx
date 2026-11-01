/**
 * ui/StudioHeader.jsx
 *
 * Top bar of Workplace Studio: AHDUS (back to all layouts), the breadcrumb
 * with the layout name (click to rename), save status, Undo, Redo, Settings.
 * Inside AHDUS (VITE_LAYOUT_BACKEND=ahdus) the brand is "Back to AHDUS", the name is
 * the site's (renamed on the server), and the Publish button (Publish / Publish changes /
 * Published ✓, ui/publishFlow.js) opens WorkplaceEditor's Publish dialog.
 */

import { useEffect, useRef, useState } from 'react';
import { Building2, Undo2, Redo2, SlidersHorizontal, Pencil, Download, Upload, Camera, Send } from 'lucide-react';
import { usePopover } from './usePopover';
import VersionHistory from './VersionHistory';
import { publishButton, publishStatusText } from './publishFlow';
import { MAX_SITE_NAME } from '../services/ahdusBackend';
import './overlays.css';

const ICON = { size: 18, strokeWidth: 1.75 };

const LIGHTING = [
  { env: 'day', label: 'Day' },
  { env: 'office', label: 'Evening' },
  { env: 'night', label: 'Night' },
];
const SNAP_STEPS = [0.25, 0.5, 1];

/**
 * The layout name: click (or Enter) → a text field; Enter or clicking away saves, Escape
 * cancels. Inside AHDUS (site) it is the workplace's name: onRename gets every changed
 * value (also an empty one: AHDUS says why it can't be used).
 */
function LayoutName({ name, onRename, site = false }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const finished = useRef(false); // Enter / Escape ended it: the blur that follows does nothing
  const refocus = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    if (!editing && refocus.current) { refocus.current = false; buttonRef.current?.focus(); }
  }, [editing]);

  const end = (keepFocus) => {
    finished.current = true;
    refocus.current = keepFocus;
    setDraft(null);
  };
  const save = (keepFocus = false) => {
    if (finished.current) return;
    const next = draft?.trim();
    if (site ? draft !== null && next !== name : next && next !== name) onRename(site ? draft : next);
    end(keepFocus);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="ui-input studio-header__name-input"
        aria-label={site ? 'Workplace name' : 'Layout name'}
        value={draft}
        maxLength={site ? MAX_SITE_NAME : undefined}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(true); }
          if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); end(true); }
        }}
      />
    );
  }
  return (
    <button
      ref={buttonRef}
      className="studio-header__name"
      onClick={() => { finished.current = false; setDraft(name); }}
      title={site ? 'Rename this workplace' : 'Rename this layout'}
      aria-label={site ? `Rename workplace: ${name}` : undefined}
    >
      <span>{name}</span>
      <Pencil size={14} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/** Publish (AHDUS): opens the Publish dialog; "Published ✓" (disabled) when employees see this draft. */
function PublishButton({ state, busy, onPublish }) {
  const { label, disabled, dot } = publishButton(state);
  const published = state === 'published';
  return (
    <button
      className={`ui-btn publish-btn${published ? ' is-published' : ' is-primary'}`}
      aria-label={busy ? 'Publishing' : published ? 'Published' : label}
      data-publish={state}
      title={published
        ? 'Employees see this version of the workplace'
        : 'Save and publish: employees see this version of the workplace'}
      disabled={busy || disabled}
      onClick={onPublish}
    >
      {!published && <Send size={16} strokeWidth={1.75} aria-hidden />}
      {busy ? 'Publishing…' : label}
      {dot && !busy && <span className="publish-btn__dot" aria-hidden title="The draft is newer than what employees see" />}
    </button>
  );
}

function Settings({
  snapEnabled, onSnapToggle, snapStep, onSnapStepChange,
  showGrid, onShowGridToggle, environment, onEnvironmentChange, fpsRef,
  realisticLook, onRealisticLookToggle, // real models, photo textures, sky (off: simple look for slow PCs)
  roomLabels, onRoomLabelsChange, // 'names' | 'off': the room names on the canvas
  onExportLayout, onImportLayout, onPhotoReconstruct, // backup & photo reconstruction
  importTitle = 'Add a layout from a file to your layouts',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const close = () => setOpen(false);
  usePopover(open, close, [wrapRef]);

  return (
    <div className="studio-header__settings" ref={wrapRef}>
      <button
        className="ui-icon-btn"
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal {...ICON} />
      </button>
      {open && (
        <div className="ui-pop settings-pop" role="dialog" aria-label="Settings">
          <div className="settings-pop__row">
            <span>Snap to grid</span>
            <button
              className="ui-switch"
              role="switch"
              aria-checked={snapEnabled}
              aria-label="Snap to grid"
              onClick={onSnapToggle}
            />
          </div>
          <div className="settings-pop__row">
            <span className={snapEnabled ? '' : 'ui-muted'}>Grid step</span>
            <div className="ui-segmented" role="group" aria-label="Grid step">
              {SNAP_STEPS.map((s) => (
                <button
                  key={s}
                  aria-pressed={snapStep === s}
                  disabled={!snapEnabled}
                  title={snapEnabled ? `${s} m` : 'Turn on snap to choose a step'}
                  onClick={() => onSnapStepChange(s)}
                >
                  {s} m
                </button>
              ))}
            </div>
          </div>
          <div className="settings-pop__row">
            <span>Show grid</span>
            <button
              className="ui-switch"
              role="switch"
              aria-checked={showGrid}
              aria-label="Show grid"
              title="Off: the grid shows only while you build"
              onClick={onShowGridToggle}
            />
          </div>
          <div className="settings-pop__row">
            <span>Lighting</span>
            <div className="ui-segmented" role="group" aria-label="Lighting">
              {LIGHTING.map((l) => (
                <button
                  key={l.env}
                  aria-pressed={environment === l.env}
                  onClick={() => onEnvironmentChange(l.env)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          {onRealisticLookToggle && (
            <div className="settings-pop__row">
              <span>Realistic look</span>
              <button
                className="ui-switch"
                role="switch"
                aria-checked={realisticLook}
                aria-label="Realistic look"
                title="Real furniture models, photo textures and sky. Off: a simpler look for slow computers"
                onClick={onRealisticLookToggle}
              />
            </div>
          )}
          {onRoomLabelsChange && (
            <div className="settings-pop__row">
              <span>Room labels</span>
              <div className="ui-segmented" role="group" aria-label="Room labels">
                <button aria-pressed={roomLabels !== 'off'} title="Show each room's name on the canvas"
                  onClick={() => onRoomLabelsChange('names')}>Names</button>
                <button aria-pressed={roomLabels === 'off'} title="No names (hover a room to see its details)"
                  onClick={() => onRoomLabelsChange('off')}>Off</button>
              </div>
            </div>
          )}
          <div className="settings-pop__row">
            <span>Units</span>
            <span className="ui-muted" title="Only metres for now">Metres (m)</span>
          </div>
          {(onExportLayout || onImportLayout) && (
            <div className="settings-pop__row settings-pop__backup">
              {onExportLayout && (
                <button className="ui-btn" aria-label="Export layout" title="Download this layout as a file (a backup)"
                  onClick={() => { onExportLayout(); setOpen(false); }}>
                  <Download size={16} strokeWidth={1.75} aria-hidden /> Export layout
                </button>
              )}
              {onImportLayout && (
                <button className="ui-btn" aria-label="Import layout" title={importTitle}
                  onClick={() => fileRef.current?.click()}>
                  <Upload size={16} strokeWidth={1.75} aria-hidden /> Import layout…
                </button>
              )}
              {onImportLayout && (
                <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Import layout file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) { onImportLayout(file); setOpen(false); }
                  }} />
              )}
            </div>
          )}
          {onPhotoReconstruct && (
            <div className="settings-pop__row settings-pop__reconstruct">
              <button
                className="ui-btn"
                aria-label="Reconstruct from photo"
                title="Upload a workplace photo to generate a proposed layout"
                onClick={() => photoRef.current?.click()}
              >
                <Camera size={16} strokeWidth={1.75} aria-hidden /> Reconstruct from photo…
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                aria-label="Upload workplace photo"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) { onPhotoReconstruct(file); setOpen(false); }
                }}
              />
            </div>
          )}
          {import.meta.env.DEV && (
            <div className="settings-pop__fps ui-muted" ref={fpsRef}>0 FPS</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StudioHeader({
  layoutName,
  onRenameLayout,
  onAllLayouts,
  allLayoutsLabel = 'All layouts', // inside AHDUS: 'Back to AHDUS'
  onPublish,           // inside AHDUS only: shows the Publish button (opens the dialog)
  publishState,        // inside AHDUS: 'unknown' | 'never' | 'changes' | 'published' (ui/publishFlow.js)
  publishing = false,  // a publish is running
  siteName = false,    // inside AHDUS: the name is the site's (renamed on the server)
  saveStatus,          // 'saved' | 'saving' | 'unsaved' | 'offline' | 'syncing'
  saveError,           // why it is not saved (shown next to "Not saved")
  undoState,
  onUndo,
  onRedo,
  editor,              // R4: Editor instance for undoable version restore
  onMessage,           // Toast notification callback
  settings,            // props for <Settings>
}) {
  const statusText = {
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Not saved',
    offline: 'Offline (changes queued)',
    syncing: 'Syncing…',
  }[saveStatus] ?? '';
  return (
    <header className="studio-header">
      <div className="studio-header__left">
        <button
          className="studio-header__brand"
          aria-label={allLayoutsLabel}
          title={allLayoutsLabel}
          onClick={onAllLayouts}
          disabled={!onAllLayouts}
        >
          <Building2 size={20} strokeWidth={1.75} aria-hidden />
          <span>AHDUS</span>
        </button>
        <span className="studio-header__crumb ui-muted" aria-hidden>/</span>
        <span className="studio-header__crumb ui-muted">Workplace Studio</span>
        <span className="studio-header__crumb ui-muted" aria-hidden>/</span>
        <LayoutName name={layoutName || 'Untitled layout'} onRename={onRenameLayout} site={siteName} />
      </div>

      <div className="studio-header__right">
        <span
          className={`studio-header__status ${
            saveStatus === 'unsaved'
              ? 'is-bad'
              : saveStatus === 'offline'
                ? 'is-warning'
                : saveStatus === 'syncing'
                  ? 'is-syncing'
                  : 'ui-muted'
          }`}
          role="status"
          data-status={saveStatus}
          title={saveStatus === 'unsaved' && saveError ? saveError : undefined}
        >
          {statusText}{saveStatus === 'unsaved' && saveError ? `: ${saveError}` : ''}
          {onPublish && saveStatus !== 'unsaved' && publishStatusText(publishState) && (
            <span className="studio-header__publish-state" data-publish-state={publishState}>
              {' '}{publishStatusText(publishState)}
            </span>
          )}
        </span>
        <button
          className="ui-icon-btn"
          aria-label="Undo"
          title={undoState.canUndo ? `Undo: ${undoState.undoLabel ?? 'last change'} (Ctrl+Z)` : 'Nothing to undo'}
          aria-disabled={!undoState.canUndo}
          onClick={() => undoState.canUndo && onUndo()}
        >
          <Undo2 {...ICON} />
        </button>
        <button
          className="ui-icon-btn"
          aria-label="Redo"
          title={undoState.canRedo ? `Redo: ${undoState.redoLabel ?? 'last change'} (Ctrl+Y)` : 'Nothing to redo'}
          aria-disabled={!undoState.canRedo}
          onClick={() => undoState.canRedo && onRedo()}
        >
          <Redo2 {...ICON} />
        </button>
        <VersionHistory editor={editor} onMessage={onMessage} />
        <Settings {...settings} />
        {onPublish && <PublishButton state={publishState} busy={publishing} onPublish={onPublish} />}
      </div>
    </header>
  );
}
