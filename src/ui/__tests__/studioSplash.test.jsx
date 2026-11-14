// @vitest-environment jsdom
// The loading screen: it waits for the first frame drawn after the floor you are on is
// built (ui/firstFrame.js), then fades out (ui/StudioSplash.jsx), at once with
// prefers-reduced-motion; a failure shows the error card with "Try again".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { watchFirstFrame, meshesDrawable, MAX_WAIT_MS } from '../firstFrame';
import StudioSplash, { FADE_MS } from '../StudioSplash';
import { splashSteps, splashStatus, createdFromUrl, withoutNewParam, splashTheme, STEP_LABELS } from '../splashSteps';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A scene whose frames we draw by hand (Babylon's Observable: add / remove / notify). */
function fakeScene() {
  const observers = new Set();
  return {
    onAfterRenderObservable: {
      add: (fn) => { const o = { fn }; observers.add(o); return o; },
      remove: (o) => observers.delete(o),
    },
    frame() { for (const o of [...observers]) o.fn(); },
    get watching() { return observers.size; },
  };
}

describe('watchFirstFrame', () => {
  it('frames drawn before the floor is built do not count', () => {
    const scene = fakeScene();
    let floorBuilt = false;
    const onReady = vi.fn();
    watchFirstFrame(scene, () => floorBuilt, onReady);
    scene.frame();
    scene.frame();
    expect(onReady).not.toHaveBeenCalled();
    floorBuilt = true;
    expect(onReady).not.toHaveBeenCalled(); // built, but not drawn yet
    scene.frame();
    expect(onReady).toHaveBeenCalledTimes(1);
    scene.frame();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(scene.watching).toBe(0);
  });

  it('stopping (the scene goes) means it never fires', () => {
    const scene = fakeScene();
    const onReady = vi.fn();
    const stop = watchFirstFrame(scene, () => true, onReady);
    stop();
    scene.frame();
    expect(onReady).not.toHaveBeenCalled();
    expect(scene.watching).toBe(0);
  });

  it('waits while built meshes still compile their shaders, at most MAX_WAIT_MS', () => {
    const scene = fakeScene();
    let compiled = false;
    let t = 0;
    const onReady = vi.fn();
    watchFirstFrame(scene, () => true, onReady, { drawable: () => compiled, now: () => t });
    scene.frame();
    expect(onReady).not.toHaveBeenCalled(); // built, but nothing of it drawn yet
    compiled = true;
    scene.frame();
    expect(onReady).toHaveBeenCalledTimes(1);

    const stuck = vi.fn();
    t = 0;
    watchFirstFrame(scene, () => true, stuck, { drawable: () => false, now: () => t });
    scene.frame();
    t = MAX_WAIT_MS - 1;
    scene.frame();
    expect(stuck).not.toHaveBeenCalled();
    t = MAX_WAIT_MS;
    scene.frame();
    expect(stuck).toHaveBeenCalledTimes(1); // never an endless spinner
  });

  it('meshesDrawable: only enabled, visible meshes with something to draw count', () => {
    const mesh = (ready, extra = {}) => ({ subMeshes: [{}], isVisible: true, isEnabled: () => true, isReady: () => ready, ...extra });
    expect(meshesDrawable({ meshes: [mesh(true), mesh(true)] })).toBe(true);
    expect(meshesDrawable({ meshes: [mesh(true), mesh(false)] })).toBe(false);
    expect(meshesDrawable({ meshes: [mesh(false, { isEnabled: () => false }), mesh(false, { isVisible: false }), mesh(false, { subMeshes: [] })] })).toBe(true);
    expect(meshesDrawable({ meshes: [] })).toBe(true);
  });

  it('no scene: nothing happens', () => {
    expect(() => watchFirstFrame(null, () => true, () => {})()).not.toThrow();
  });
});

describe('StudioSplash', () => {
  let container;
  let root;
  let reducedMotion;

  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = false;
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce') && reducedMotion, media: q }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    delete window.matchMedia;
  });

  const splash = () => container.querySelector('[data-splash]');

  const stepStates = () => [...container.querySelectorAll('[data-step]')].map((li) => `${li.dataset.step}:${li.dataset.stepState}`);

  it('shows the name and the steps "Loading Studio…" → "Ready" while loading (v0.17.2)', () => {
    act(() => root.render(<StudioSplash phase="loading" />));
    expect(splash().dataset.splash).toBe('loading');
    expect(container.textContent).toContain('Workplace Studio');
    expect(container.textContent).toContain('Loading Studio…');
    expect(container.textContent).not.toContain('AHDUS');
    expect(stepStates()).toEqual(['load:active', 'ready:todo']);
    expect(splash().getAttribute('aria-label')).toBe('Loading Studio…');
    expect(splash().dataset.splashTheme).toBe('light');
  });

  it('after "Create a workplace": "Creating your workplace" done, then the name and how to rename it', () => {
    act(() => root.render(<StudioSplash phase="loading" ahdus created newName="Untitled workplace 2" />));
    expect(stepStates()).toEqual(['create:done', 'load:active', 'ready:todo']);
    expect(container.querySelector('[data-splash-hint]').textContent).toContain('Untitled workplace 2 is ready');
    act(() => root.render(<StudioSplash phase="done" ahdus created newName="Untitled workplace 2" />));
    expect(stepStates()).toEqual(['create:done', 'load:done', 'ready:done']);
    expect(splash().getAttribute('aria-label')).toBe('Ready');
  });

  it('dark only when asked (AHDUS in dark mode); the login text replaces the steps', () => {
    act(() => root.render(<StudioSplash phase="loading" ahdus theme="dark" text="Taking you to the AHDUS login…" />));
    expect(splash().dataset.splashTheme).toBe('dark');
    expect(stepStates()).toEqual(['login:active']);
    expect(container.textContent).toContain('Taking you to the AHDUS login…');
  });

  it('inside AHDUS the brand says AHDUS, as in the top bar', () => {
    act(() => root.render(<StudioSplash phase="loading" ahdus />));
    expect(container.querySelector('.studio-splash__ahdus').textContent).toBe('AHDUS');
  });

  it('after the first frame it fades out over FADE_MS, then is gone', () => {
    act(() => root.render(<StudioSplash phase="loading" />));
    act(() => vi.advanceTimersByTime(60_000));
    expect(splash().dataset.splash).toBe('loading'); // no first frame: still there
    act(() => root.render(<StudioSplash phase="done" />));
    expect(splash().dataset.splash).toBe('leaving');
    expect(splash().classList.contains('is-leaving')).toBe(true);
    act(() => vi.advanceTimersByTime(FADE_MS - 1));
    expect(splash()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(splash()).toBeNull();
  });

  it('with prefers-reduced-motion it goes at once (no fade)', () => {
    reducedMotion = true;
    act(() => root.render(<StudioSplash phase="loading" />));
    act(() => root.render(<StudioSplash phase="done" />));
    expect(splash()).toBeNull();
  });

  it('a failure becomes the error card with "Try again"', () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    act(() => root.render(
      <StudioSplash phase="error" ahdus errorTitle="This workplace could not be opened" error="AHDUS could not be reached"
        onRetry={onRetry} onBack={onBack} backLabel="Back to AHDUS" />,
    ));
    expect(splash().dataset.splash).toBe('error');
    expect(container.querySelector('[data-step]')).toBeNull();
    expect(container.textContent).toContain('AHDUS could not be reached');
    const [retry, back] = container.querySelectorAll('button');
    expect(retry.textContent).toContain('Try again');
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalled();
    expect(back.textContent).toContain('Back to AHDUS');
  });
});

describe('splashSteps (v0.17.2)', () => {
  it('the steps: create only after Create a workplace, one in progress, then all done', () => {
    expect(splashSteps({ phase: 'loading' }).map((s) => s.label)).toEqual(['Loading Studio…', 'Ready']);
    expect(splashSteps({ created: true, phase: 'loading' }).map((s) => [s.key, s.state]))
      .toEqual([['create', 'done'], ['load', 'active'], ['ready', 'todo']]);
    expect(splashSteps({ created: true, phase: 'done' }).every((s) => s.state === 'done')).toBe(true);
    expect(splashStatus(splashSteps({ phase: 'loading' }))).toBe('Loading Studio…');
    expect(splashStatus(splashSteps({ phase: 'done' }))).toBe('Ready');
  });

  it('?new=1: read once, then taken out of the address', () => {
    expect(createdFromUrl('?site=4&new=1')).toBe(true);
    expect(createdFromUrl('?site=4')).toBe(false);
    expect(withoutNewParam('https://a.test/workplace-studio/?site=4&new=1#x')).toBe('/workplace-studio/?site=4#x');
    expect(withoutNewParam('https://a.test/workplace-studio/?site=4')).toBeNull();
  });

  it('dark only in AHDUS with its theme "dark"; storage blocked = light', () => {
    const store = (v) => ({ getItem: () => v });
    expect(splashTheme(true, store('dark'))).toBe('dark');
    expect(splashTheme(true, store('light'))).toBe('light');
    expect(splashTheme(false, store('dark'))).toBe('light');
    expect(splashTheme(true, { getItem: () => { throw new Error('blocked'); } })).toBe('light');
  });

  it("index.html's own copy says the same words, with the same classes, and has the splash.css marker", () => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    for (const label of Object.values(STEP_LABELS)) expect(html).toContain(label);
    expect(html).toContain('Loading Studio…');
    for (const cls of ['studio-splash__brand', 'studio-splash__logo', 'studio-splash__steps', 'studio-splash__step',
      'studio-splash__mark', 'studio-splash__ahdus']) expect(html).toContain(cls);
    expect(html).toContain('/* splash.css */');
    expect(html).toContain('id="boot-splash"');
    expect(html).not.toContain('data-splash='); // e2e waits for [data-splash] (React's) to go
  });
});
