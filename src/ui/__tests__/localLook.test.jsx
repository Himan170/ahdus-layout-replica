// @vitest-environment jsdom
// v0.10.1: the AHDUS look is Studio's only look, in local mode too (theme.css tokens, the top
// bar, the tool rail). AHDUS-only parts stay AHDUS-only: the "AHDUS" brand text, Publish, the
// site rename. Local mode keeps "All layouts" and renaming the layout. And the phone's
// "Drag to turn…" hint hides under a bottom sheet and after the first touch (tools.phoneIdleHint).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import StudioHeader from '../StudioHeader';
import BuildPanel from '../BuildPanel';
import { PHONE_HINT, phoneIdleHint } from '../tools';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const UI = join(process.cwd(), 'src', 'ui', '/'); // jsdom's URL is not Node's: no import.meta.url here

const settings = {
  snapEnabled: true, onSnapToggle() {}, snapStep: 0.5, onSnapStepChange() {}, showGrid: false,
  onShowGridToggle() {}, environment: 'day', onEnvironmentChange() {}, fpsRef: { current: null },
  realisticLook: true, onRealisticLookToggle() {}, roomLabels: 'names', onRoomLabelsChange() {},
};
const headerProps = {
  layoutName: 'HQ North', onRenameLayout() {}, onAllLayouts() {}, publishState: 'unknown',
  saveStatus: 'saved', saveError: null, undoState: { canUndo: false, canRedo: false },
  onUndo() {}, onRedo() {}, editor: null, onMessage() {}, onPreview() {}, settings,
};

describe('the AHDUS look in local mode', () => {
  let container;
  let root;
  const render = (el) => act(() => root.render(el));
  const labels = () => [...container.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('local mode: the top bar has All layouts (no AHDUS brand text, no Publish) and renames the layout', () => {
    render(<StudioHeader {...headerProps} allLayoutsLabel="All layouts" siteName={false} onPublish={null} />);
    const header = container.querySelector('header.ahdus-header');
    expect(header).not.toBeNull();
    expect(container.querySelector('.ahdus-header__brand-text').textContent).toBe('All layouts');
    expect(header.textContent).not.toMatch(/AHDUS/);
    expect(labels()).toEqual(expect.arrayContaining(['All layouts', 'Undo', 'Redo', 'Versions', 'Settings']));
    expect(container.querySelector('.ahdus-header__walk').textContent).toMatch('Walk through');
    expect(container.querySelector('[data-publish]')).toBeNull();
    expect(container.querySelector('[role="status"]').textContent).toBe('Saved');
    expect(container.querySelector('.studio-header__name').title).toBe('Rename this layout');
  });

  it('inside AHDUS: the AHDUS brand, Publish and the site rename', () => {
    render(<StudioHeader {...headerProps} allLayoutsLabel="Back to AHDUS" siteName onPublish={() => {}} publishState="never" />);
    expect(container.querySelector('.ahdus-header__brand-text').textContent).toBe('AHDUS');
    expect(labels()).toEqual(expect.arrayContaining(['Back to AHDUS', 'Publish', 'Rename workplace: HQ North']));
  });

  it('the tool rail (with Shortcuts) is the only Build panel; a tile opens its library, not a tray', () => {
    let open = null;
    const panel = (openTray) => (
      <BuildPanel active={{ id: 'select' }} openTray={openTray} onOpenTray={(id) => { open = id; }}
        onSelectTool={() => {}} layersOpen={false} onToggleLayers={() => {}}
        library={{ onTilePointerDown() {}, onPlaceTile() {}, onPickOption() {} }} />
    );
    render(panel(null));
    expect(container.querySelector('.build-panel.tool-rail')).not.toBeNull();
    expect(labels()).toEqual(expect.arrayContaining(['Select', 'Rooms', 'Walls', 'Doors & Windows', 'Stairs', 'Furniture', 'Layers', 'Shortcuts']));
    act(() => container.querySelector('[aria-label="Rooms"]').click());
    expect(open).toBe('rooms');
    render(panel('rooms'));
    expect(container.querySelector('[aria-label="Rooms library"]')).not.toBeNull();
    expect(container.querySelector('.tray')).toBeNull();
  });

  it('the old dark look is gone: no data-look switch, :root has the AHDUS palette', () => {
    const css = readdirSync(UI).filter((f) => f.endsWith('.css')).map((f) => readFileSync(`${UI}${f}`, 'utf8')).join('\n');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/data-look/); // no selector needs it (comments aside)
    const theme = readFileSync(`${UI}theme.css`, 'utf8');
    expect(theme.match(/:root\s*\{/g)).toHaveLength(1);
    expect(theme).toMatch(/--bg-app: #f6f7f3;/);
    expect(theme).not.toMatch(/#121726|#1c2335/); // the dark page and panels
  });
});

describe('phoneIdleHint (the phone\'s "Drag to turn…" hint)', () => {
  it('shows while nothing covers the view and the canvas was not touched yet', () => {
    expect(phoneIdleHint()).toBe(PHONE_HINT);
    expect(phoneIdleHint({ sheetOpen: false, touched: false })).toBe(PHONE_HINT);
    expect(PHONE_HINT).toMatch(/^Drag to turn · pinch to zoom/);
  });

  it('hides while a bottom sheet is open (library or Inspector)', () => {
    expect(phoneIdleHint({ sheetOpen: true })).toBe('');
  });

  it('hides for good after the first touch on the canvas, even with the sheet closed again', () => {
    expect(phoneIdleHint({ touched: true })).toBe('');
    expect(phoneIdleHint({ sheetOpen: false, touched: true })).toBe('');
  });
});
