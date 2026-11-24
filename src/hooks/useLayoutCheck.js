import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { checkLayout, checkLayoutSteps, walkingProblems } from '../play/navigation/checkLayout';
import { createSlicedCheck, layoutCopy } from '../play/navigation/checkRunner';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { studioWalkMaps } from './studioWalkMaps';
import { livePosition } from '../utils/livePosition';

export { CHECK_SLICE_MS } from '../play/navigation/checkRunner';

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A new task (MessageChannel: no 4 ms clamp, after the browser could draw a frame); else setTimeout. */
function soon(fn) {
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); fn(); };
    ch.port2.postMessage(null);
  } else setTimeout(fn, 0);
}

/** Dev only: the same steps, each timed; `top` keeps the 6 longest as { ms, step: 'after → before' }. */
function* timedSteps(steps, top) {
  let prev = 'start';
  for (;;) {
    const t0 = clock();
    const r = steps.next();
    const ms = clock() - t0;
    const step = `${prev} → ${r.done ? 'end' : r.value}`;
    if (top.length < 6 || ms > top[top.length - 1].ms) {
      top.push({ ms: Math.round(ms), step });
      top.sort((a, b) => b.ms - a.ms);
      top.length = Math.min(top.length, 6);
    }
    if (r.done) return r.value;
    prev = r.value;
    yield r.value;
  }
}

/**
 * Delayed idle checks, in slices (v0.18.11, play/navigation/checkRunner.js: one fixed copy of the layout, started
 * over when the layout changes under it); no layout writes, and no checking during a drag or Preview.
 */
export function useLayoutCheck({ playing, plannerToolsRef, gizmoControllerRef }) {
  const rooms = useWorkspaceStore((s) => s.rooms);
  const objects = useWorkspaceStore((s) => s.objects);
  const floors = useWorkspaceStore((s) => s.floors);
  const ignored = useWorkspaceStore((s) => s.ignoredChecks);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState({ problems: [], ms: 0 });
  const pointerDown = useRef(false);
  /** Bumped by every whole check (run()): a sliced check started before it is dropped. */
  const checkToken = useRef(0);
  useEffect(() => {
    // Includes SVG Plan view drags, which do not go through plannerTools or the gizmo.
    const down = () => { pointerDown.current = true; };
    const up = () => { pointerDown.current = false; };
    window.addEventListener('pointerdown', down, true);
    for (const event of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(event, up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      for (const event of ['pointerup', 'pointercancel', 'blur']) window.removeEventListener(event, up, true);
    };
  }, []);
  const busy = useCallback(() => playing || pointerDown.current || plannerToolsRef.current?.isDragging() || !!livePosition.get()
    || gizmoControllerRef.current?.isDragging?.(), [playing, plannerToolsRef, gizmoControllerRef]);
  /** The whole check now (the Check button, Fix it, Publish): false while busy. */
  const run = useCallback(() => {
    if (busy()) return false;
    checkToken.current += 1;
    setResult(checkLayout(layoutCopy(useWorkspaceStore.getState()), { catalog: ASSET_TYPES, maps: studioWalkMaps }));
    return true;
  }, [busy]);
  useEffect(() => {
    if (playing) return undefined;
    let idle;
    let timer;
    let cancelled = false;
    let token = null;
    // dev only: what the slices did, and the longest steps (e2e:check-open)
    const stats = import.meta.env.DEV ? { state: 'waiting', slices: 0, longest: 0, restarts: 0, steps: [] } : null;
    if (stats) window.__ahdusCheck = stats;
    const check = createSlicedCheck({
      getLayout: () => useWorkspaceStore.getState(),
      makeSteps: (copy) => {
        const steps = checkLayoutSteps(copy, { catalog: ASSET_TYPES, maps: studioWalkMaps });
        return stats ? timedSteps(steps, stats.steps) : steps;
      },
    });
    // v0.18.11: one slice per task (CHECK_SLICE_MS of work); a drag pauses it
    const slice = () => {
      if (cancelled) return;
      if (busy()) { timer = setTimeout(schedule, 400); return; }
      if (token === null) token = checkToken.current;
      if (token !== checkToken.current) return; // a whole check ran meanwhile: its result is the newer one
      const t0 = clock();
      const r = check.slice();
      if (stats) {
        Object.assign(stats, { state: r.done ? 'done' : 'running', slices: stats.slices + 1, restarts: check.restarts });
        stats.longest = Math.max(stats.longest, clock() - t0);
        stats.start ??= t0;
        if (r.done) Object.assign(stats, { end: clock(), ms: r.result.ms, problems: r.result.problems.length });
      }
      if (r.done) { setResult(r.result); return; }
      soon(slice);
    };
    const schedule = () => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(slice, { timeout: 1000 });
      else timer = setTimeout(slice, 0);
    };
    timer = setTimeout(schedule, 1500);
    return () => { cancelled = true; clearTimeout(timer); if (idle) window.cancelIdleCallback?.(idle); };
  }, [rooms, objects, floors, playing, busy]);
  const visible = result.problems.filter((p) => !ignored.includes(p.key));
  const ignoredCount = result.problems.length - visible.length;
  // v0.17.4: what stops people walking somewhere, ignored or not (the Publish dialog lists them)
  const walking = walkingProblems(result.problems, ignored);
  return { open, setOpen, run, ...result, ignored, visible, ignoredCount, walking, count: visible.filter((p) => p.severity !== 'info').length };
}
