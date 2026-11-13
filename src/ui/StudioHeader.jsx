/**
 * ui/StudioHeader.jsx
 *
 * Top bar of Workplace Studio: "All layouts", the breadcrumb with the layout name (click to
 * rename), the status pill, Undo, Redo, Versions, Settings (a word under each), Walk through.
 * Inside AHDUS (VITE_LAYOUT_BACKEND=ahdus) the brand is AHDUS ("Back to AHDUS"), the name is
 * the site's (renamed on the server), and the Publish button (Publish / Publish changes /
 * Published ✓, ui/publishFlow.js) opens WorkplaceEditor's Publish dialog.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Building2, Undo2, Redo2, SlidersHorizontal, Pencil, Download, Upload, Camera, Send, Play, ChevronLeft, MoreHorizontal,
} from 'lucide-react';
import { usePopover } from './usePopover';
import VersionHistory from './VersionHistory';
import { CheckButton } from './LayoutCheckPanel';
import { publishButton, statusPill } from './publishFlow';
import { usePhone } from './look';
import { MAX_SITE_NAME } from '../services/ahdusBackend';
import './overlays.css';
import { isCommitEnter, isComposing } from '../utils/keys';

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
          if (isCommitEnter(e)) { e.preventDefault(); save(true); }
          if (e.key === 'Escape' && !isComposing(e)) { e.stopPropagation(); e.preventDefault(); end(true); }
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
function PublishButton({ state, busy, onPublish, short = false }) {
  const { label, disabled, dot } = publishButton(state);
  const text = short && state === 'changes' ? 'Publish' : label; // a phone: the dot says "changes"
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
      {busy ? 'Publishing…' : text}
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
  label = null, // a word under the icon (the AHDUS look)
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
        className={`ui-icon-btn${label ? ' ui-labeled-btn' : ''}`}
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal {...ICON} />
        {label && <span className="ui-labeled-btn__label">{label}</span>}
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

/** An icon with a small word under it (Undo / Redo). */
function LabeledButton({ label, title, icon: Icon, disabled, onClick }) {
  return (
    <button className="ui-icon-btn ui-labeled-btn" aria-label={label} title={title}
      aria-disabled={disabled || undefined} onClick={() => { if (!disabled) onClick(); }}>
      <Icon {...ICON} aria-hidden />
      <span className="ui-labeled-btn__label">{label}</span>
    </button>
  );
}

/** Saved / Unpublished changes / Not published yet (the top bar; a phone: the row under it). Local mode: Saved. */
export function StatusPill({ saveStatus, saveError, publishState, onPublish, short = false }) {
  const pill = statusPill(saveStatus, onPublish ? publishState : 'unknown', saveError);
  return (
    <span className={`status-pill is-${pill.tone}`} role="status" data-status={saveStatus}
      data-publish-state={onPublish ? publishState : undefined} title={pill.text}>
      <span className="status-pill__dot" aria-hidden />
      <span className="status-pill__text">{short ? pill.short : pill.text}</span>
    </span>
  );
}

/** A phone's "⋯": Redo, Versions, Settings and Walk through. */
function MoreMenu({ undoState, onRedo, editor, onMessage, settings, onPreview, checks, onCheck }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  usePopover(open, () => setOpen(false), [ref]);
  return (
    <div className="ahdus-more" ref={ref}>
      <button className="ui-icon-btn ahdus-header__icon" aria-label="More" title="More" aria-haspopup="menu"
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={22} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div className="ui-pop ahdus-more__pop" role="menu" aria-label="More actions">
          <LabeledButton label="Redo" icon={Redo2} disabled={!undoState.canRedo} onClick={onRedo}
            title={undoState.canRedo ? `Redo: ${undoState.redoLabel ?? 'last change'}` : 'Nothing to redo'} />
          <VersionHistory editor={editor} onMessage={onMessage} label="Versions" />
          <CheckButton checks={checks} onClick={() => { setOpen(false); onCheck(); }} />
          <Settings {...settings} label="Settings" />
          {onPreview && (
            <button className="ui-labeled-btn ahdus-more__walk" aria-label="Walk through"
              onClick={() => { setOpen(false); onPreview(); }}>
              <Play size={20} strokeWidth={1.75} aria-hidden />
              <span className="ui-labeled-btn__label">Walk through</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A phone: back, the name, Undo, ⋯, Publish (the status and the views are in PhoneBar under it). */
function AhdusPhoneHeader({
  layoutName, onRenameLayout, onAllLayouts, allLayoutsLabel, onPublish, publishState, publishing, siteName,
  undoState, onUndo, ...more
}) {
  return (
    <header className="studio-header ahdus-header is-phone">
      <button className="ui-icon-btn ahdus-header__icon ahdus-header__back" aria-label={allLayoutsLabel} title={allLayoutsLabel}
        onClick={onAllLayouts} disabled={!onAllLayouts}>
        <ChevronLeft size={24} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="ahdus-header__name">
        <LayoutName name={layoutName || 'Untitled layout'} onRename={onRenameLayout} site={siteName} />
      </div>
      <button className="ui-icon-btn ahdus-header__icon" aria-label="Undo" aria-disabled={!undoState.canUndo}
        title={undoState.canUndo ? `Undo: ${undoState.undoLabel ?? 'last change'}` : 'Nothing to undo'}
        onClick={() => undoState.canUndo && onUndo()}>
        <Undo2 size={22} strokeWidth={1.75} aria-hidden />
      </button>
      <MoreMenu undoState={undoState} {...more} />
      {onPublish && <PublishButton state={publishState} busy={publishing} onPublish={onPublish} short />}
    </header>
  );
}

/**
 * The top bar: logo square + AHDUS (local mode: All layouts) / Workplace Studio / name ✎,
 * the status pill (saving + publishing, ui/publishFlow.statusPill), Undo / Redo / Versions /
 * Settings with a word under each, Walk through (Preview), Publish (AHDUS only).
 */
export default function StudioHeader(props) {
  const phone = usePhone();
  if (phone) return <AhdusPhoneHeader {...props} />;
  const {
    layoutName, onRenameLayout, onAllLayouts, allLayoutsLabel, onPublish, publishState, publishing, siteName,
    saveStatus, saveError, undoState, onUndo, onRedo, editor, onMessage, settings, onPreview, checks, onCheck,
  } = props;
  return (
    <header className="studio-header ahdus-header">
      <div className="studio-header__left">
        <button className="studio-header__brand" aria-label={allLayoutsLabel} title={allLayoutsLabel}
          onClick={onAllLayouts} disabled={!onAllLayouts}>
          <span className="ahdus-logo" aria-hidden><Building2 size={18} strokeWidth={1.75} /></span>
          <span className="ahdus-header__brand-text">{siteName ? 'AHDUS' : allLayoutsLabel}</span>
        </button>
        <span className="studio-header__crumb ahdus-header__crumb" aria-hidden>/</span>
        <span className="studio-header__crumb ahdus-header__crumb">Workplace Studio</span>
        <span className="studio-header__crumb ahdus-header__crumb" aria-hidden>/</span>
        <LayoutName name={layoutName || 'Untitled layout'} onRename={onRenameLayout} site={siteName} />
      </div>

      <div className="studio-header__right">
        <StatusPill saveStatus={saveStatus} saveError={saveError} publishState={publishState} onPublish={onPublish} />
        <div className="ahdus-header__tools">
          <LabeledButton label="Undo" icon={Undo2} disabled={!undoState.canUndo} onClick={onUndo}
            title={undoState.canUndo ? `Undo: ${undoState.undoLabel ?? 'last change'} (Ctrl+Z)` : 'Nothing to undo'} />
          <LabeledButton label="Redo" icon={Redo2} disabled={!undoState.canRedo} onClick={onRedo}
            title={undoState.canRedo ? `Redo: ${undoState.redoLabel ?? 'last change'} (Ctrl+Y)` : 'Nothing to redo'} />
          <VersionHistory editor={editor} onMessage={onMessage} label="Versions" />
          <CheckButton checks={checks} onClick={onCheck} />
          <Settings {...settings} label="Settings" />
        </div>
        {onPreview && (
          <button className="ui-btn ahdus-header__walk" aria-label="Walk through" title="Walk through your workplace (Tab)" onClick={onPreview}>
            <Play size={16} strokeWidth={1.75} aria-hidden /> Walk through
          </button>
        )}
        {onPublish && <PublishButton state={publishState} busy={publishing} onPublish={onPublish} />}
      </div>
    </header>
  );
}
