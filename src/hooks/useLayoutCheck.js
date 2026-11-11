import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { checkLayout } from '../play/navigation/checkLayout';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { studioWalkMaps } from './studioWalkMaps';
import { livePosition } from '../utils/livePosition';

/** Delayed idle checks; no layout writes, and no checking during a drag or Preview. */
export function useLayoutCheck({ playing, plannerToolsRef, gizmoControllerRef }) {
  const rooms = useWorkspaceStore((s) => s.rooms);
  const objects = useWorkspaceStore((s) => s.objects);
  const floors = useWorkspaceStore((s) => s.floors);
  const ignored = useWorkspaceStore((s) => s.ignoredChecks);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState({ problems: [], ms: 0 });
  const run = useCallback(() => {
    if (playing || plannerToolsRef.current?.isDragging() || livePosition.get() || gizmoControllerRef.current?.isDragging?.()) return false;
    setResult(checkLayout(useWorkspaceStore.getState(), { catalog: ASSET_TYPES, maps: studioWalkMaps }));
    return true;
  }, [playing, plannerToolsRef, gizmoControllerRef]);
  useEffect(() => {
    if (playing) return undefined;
    let idle;
    let timer;
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      if (!run()) timer = setTimeout(schedule, 400);
    };
    const schedule = () => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(attempt, { timeout: 1000 });
      else timer = setTimeout(attempt, 0);
    };
    timer = setTimeout(schedule, 1500);
    return () => { cancelled = true; clearTimeout(timer); if (idle) window.cancelIdleCallback?.(idle); };
  }, [rooms, objects, floors, playing, run]);
  const visible = result.problems.filter((p) => !ignored.includes(p.key));
  return { open, setOpen, run, ...result, ignored, visible, count: visible.filter((p) => p.severity !== 'info').length };
}
