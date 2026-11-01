// @vitest-environment jsdom
// The loading screen: it waits for the first frame drawn after the floor you are on is
// built (ui/firstFrame.js), then fades out (ui/StudioSplash.jsx), at once with
// prefers-reduced-motion; a failure shows the error card with "Try again".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { watchFirstFrame, meshesDrawable, MAX_WAIT_MS } from '../firstFrame';
import StudioSplash, { FADE_MS } from '../StudioSplash';

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

  it('shows the name, a spinner and "Opening Workplace Studio…" while loading', () => {
    act(() => root.render(<StudioSplash phase="loading" />));
    expect(splash().dataset.splash).toBe('loading');
    expect(container.textContent).toContain('Workplace Studio');
    expect(container.textContent).toContain('Opening Workplace Studio…');
    expect(container.textContent).not.toContain('AHDUS');
    expect(container.querySelector('.studio-splash__spinner')).not.toBeNull();
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
    expect(container.querySelector('.studio-splash__spinner')).toBeNull();
    expect(container.textContent).toContain('AHDUS could not be reached');
    const [retry, back] = container.querySelectorAll('button');
    expect(retry.textContent).toContain('Try again');
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalled();
    expect(back.textContent).toContain('Back to AHDUS');
  });
});
