/**
 * ui/StudioHeader.jsx
 *
 * Top bar of Workplace Studio: AHDUS (back to all layouts), the breadcrumb
 * with the layout name (click to rename), save status, Undo, Redo, Settings.
 */

import { useRef, useState } from 'react';
import { Building2, Undo2, Redo2, SlidersHorizontal, Pencil, Download, Upload } from 'lucide-react';
import { usePopover } from './usePopover';

const ICON = { size: 18, strokeWidth: 1.75 };

const LIGHTING = [
  { env: 'day', label: 'Day' },
  { env: 'office', label: 'Evening' },
  { env: 'night', label: 'Night' },
];
const SNAP_STEPS = [0.25, 0.5, 1];

function LayoutName({ name, onRename }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;

  const save = () => {
    const next = draft?.trim();
    if (next && next !== name) onRename(next);
    setDraft(null);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="ui-input studio-header__name-input"
        aria-label="Layout name"
        value={draft}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); }
        }}
      />
    );
  }
  return (
    <button
      className="studio-header__name"
      onClick={() => setDraft(name)}
      title="Rename this layout"
    >
      <span>{name}</span>
      <Pencil size={14} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function Settings({
  snapEnabled, onSnapToggle, snapStep, onSnapStepChange,
  showGrid, onShowGridToggle, environment, onEnvironmentChange, fpsRef,
  onExportLayout, onImportLayout,   // backup: download this layout / add one from a file
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const fileRef = useRef(null);
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
          <div className="settings-pop__row">
            <span>Units</span>
            <span className="ui-muted" title="Only metres for now">Metres (m)</span>
          </div>
          {onExportLayout && (
            <div className="settings-pop__row settings-pop__backup">
              <button className="ui-btn" aria-label="Export layout" title="Download this layout as a file (a backup)"
                onClick={() => { onExportLayout(); setOpen(false); }}>
                <Download size={16} strokeWidth={1.75} aria-hidden /> Export layout
              </button>
              <button className="ui-btn" aria-label="Import layout" title="Add a layout from a file to your layouts"
                onClick={() => fileRef.current?.click()}>
                <Upload size={16} strokeWidth={1.75} aria-hidden /> Import layoutâ€¦
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Import layout file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) { onImportLayout(file); setOpen(false); }
                }} />
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
  viewMode = '3d',
  onViewModeChange = () => {},
  saveStatus,          // 'saved' | 'saving' | 'unsaved'
  saveError,           // why it is not saved (shown next to "Not saved")
  undoState,
  onUndo,
  onRedo,
  settings,            // props for <Settings>
}) {
  const statusText = { saved: 'Saved', saving: 'Savingâ€¦', unsaved: 'Not saved' }[saveStatus] ?? '';
  return (
    <header className="studio-header">
      <div className="studio-header__left">
        <button
          className="studio-header__brand"
          aria-label="All layouts"
          title="All layouts"
          onClick={onAllLayouts}
          disabled={!onAllLayouts}
        >
          <Building2 size={20} strokeWidth={1.75} aria-hidden />
          <span>AHDUS</span>
        </button>
        <span className="studio-header__crumb ui-muted" aria-hidden>/</span>
        <span className="studio-header__crumb ui-muted">Workplace Studio</span>
        <span className="studio-header__crumb ui-muted" aria-hidden>/</span>
        <LayoutName name={layoutName || 'Untitled layout'} onRename={onRenameLayout} />
      </div>

      <div className="studio-header__right">

        <div className="ui-segmented" role="group" aria-label="Studio view mode">
          <button
            type="button"
            aria-pressed={viewMode === '2d'}
            onClick={() => onViewModeChange('2d')}
          >
            2D Plan
          </button>
          <button
            type="button"
            aria-pressed={viewMode === '3d'}
            onClick={() => onViewModeChange('3d')}
          >
            3D View
          </button>
        </div>

        <span
          className={`studio-header__status ${saveStatus === 'unsaved' ? 'is-bad' : 'ui-muted'}`}
          role="status"
          data-status={saveStatus}
          title={saveStatus === 'unsaved' && saveError ? saveError : undefined}
        >
          {statusText}{saveStatus === 'unsaved' && saveError ? `: ${saveError}` : ''}
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
        <Settings {...settings} />
      </div>
    </header>
  );
}
