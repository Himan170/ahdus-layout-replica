import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { checkLayout, checkLayoutSteps, walkingProblems } from '../play/navigation/checkLayout';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { studioWalkMaps } from './studioWalkMaps';
import { livePosition } from '../utils/livePosition';

/**
 * v0.18.11: the idle check runs this long per task (ms), then gives the page a frame (as navigation.warm() runs the
 * tour's plan): on 72 rooms / 864 items one whole check right after opening was a 640 ms task.
 */
export const CHECK_SLICE_MS = 8;

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A new task (MessageChannel: no 4 ms clamp, after the browser could draw a frame); else setTimeout. */
function soon(fn) {
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); fn(); };
    ch.port2.postMessage(null);
  } else setTimeout(fn, 0);
}

/** Delayed idle checks, in slices; no layout writes, and no checking during a drag or Preview. */
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
    setResult(checkLayout(useWorkspaceStore.getState(), { catalog: ASSET_TYPES, maps: studioWalkMaps }));
    return true;
  }, [busy]);
  useEffect(() => {
    if (playing) return undefined;
    let idle;
    let timer;
    let cancelled = false;
    let job = null; // { steps, token, work }
    // v0.18.11: checkLayoutSteps a slice at a time (CHECK_SLICE_MS), each slice in its own task; a drag pauses it
    const slice = () => {
      if (cancelled) return;
      if (busy()) { timer = setTimeout(schedule, 400); return; }
      if (!job) {
        job = {
          steps: checkLayoutSteps(useWorkspaceStore.getState(), { catalog: ASSET_TYPES, maps: studioWalkMaps }),
          token: checkToken.current,
          work: 0,
        };
      }
      if (job.token !== checkToken.current) return; // a whole check ran meanwhile: its result is the newer one
      const t0 = clock();
      for (;;) {
        const r = job.steps.next();
        if (r.done) {
          // its `ms` = the working time, not the time between the slices
          setResult({ ...r.value, ms: job.work + (clock() - t0) });
          return;
        }
        if (clock() - t0 >= CHECK_SLICE_MS) break;
      }
      job.work += clock() - t0;
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
