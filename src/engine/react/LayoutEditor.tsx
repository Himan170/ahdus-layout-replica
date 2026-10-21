/**
 * react/LayoutEditor.tsx
 *
 * <LayoutEditor />: the company layout for people who may change it.
 *   mode "edit"                 Workplace Studio as it is today (its Preview
 *                               included), on the app's store. For now this
 *                               wraps Studio; rebuilding Studio on
 *                               LayoutEngine is a later task.
 *   mode "view" / "walkthrough" a <LayoutViewer /> of the same layout (the
 *                               app shell picks the mode from the user's role).
 *
 *   <LayoutEditor layout={json} mode="edit"
 *     onChange={(layoutV2) => save(layoutV2)} onSelect={(e) => …} />
 *
 * The layout: `layout` (JSON the app shell fetched: a save, an exported file
 * or v2), else `companyId` + `layoutId` (a layout saved in this browser:
 * Studio then also auto-saves it there, as the app does).
 * `layout` is read when it changes; giving back the object onChange gave you
 * doesn't reload Studio (its undo history stays).
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { LayoutViewer } from './LayoutViewer';
import type { LayoutViewerProps } from './LayoutViewer';
import type { EngineMode, SelectEvent } from '../LayoutEngine';
import type { Layout } from '../model/schema';
import { loadLayout as parseLayout } from '../model/migrate';
import { toV1, mergeV2Extras } from '../model/toV1';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { loadWorkspace } from '../../services/apiService';

// Studio's code (and look) loads only when an editor is shown
const StudioPanel = lazy(() => import('./StudioPanel'));

/** What onReady gives in edit mode (Studio has no LayoutEngine of its own yet). */
export interface StudioHandle {
  mode: 'edit';
  /** The layout as Studio has it now, as v2. */
  getLayout(): Layout;
}

export interface LayoutEditorProps extends Omit<LayoutViewerProps, 'mode' | 'onReady'> {
  /** 'edit' (Workplace Studio, default), 'view' or 'walkthrough' (a viewer). */
  mode?: EngineMode;
  /** Edit mode: Studio's handle; view / walkthrough: the viewer's LayoutEngine. */
  onReady?: (handle: StudioHandle | Parameters<NonNullable<LayoutViewerProps['onReady']>>[0]) => void;
  /** Edit mode: the layout changed (as v2; at most every 300 ms, and when the editor closes). */
  onChange?: (layout: Layout) => void;
  /** Edit mode: a room or an item was selected. */
  onSelect?: (event: SelectEvent) => void;
  /** Edit mode: Studio's "All layouts" (AHDUS) was clicked, or "Back to layouts" after an error. */
  onExit?: () => void;
}

const CHANGE_DELAY = 300; // ms

export function LayoutEditor(props: LayoutEditorProps) {
  const { mode = 'edit' } = props;
  if (mode !== 'edit') return <LayoutViewer {...props} mode={mode} />;
  return <StudioEditor {...props} />;
}

const fill: CSSProperties = { position: 'relative', width: '100%', height: '100%' };

function StudioEditor(props: LayoutEditorProps) {
  const { layout, companyId, layoutId, className, style } = props;
  const [loadCount, setLoadCount] = useState(0); // a fresh Studio (and undo history) per layout
  const [error, setError] = useState<string | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const loadedRef = useRef<Layout | null>(null);    // the layout as loaded (for what only v2 has)
  const emittedRef = useRef<unknown>(null);         // the last layout onChange gave
  const loadingRef = useRef(false);                 // loading is not a change

  const getLayout = () => {
    const now = parseLayout(useWorkspaceStore.getState().exportWorkspace());
    return loadedRef.current ? mergeV2Extras(now, loadedRef.current) : now;
  };

  // Load the layout into the app's store, where Studio edits it
  useEffect(() => {
    if (layout !== undefined && layout !== null && layout === emittedRef.current) return; // our own change coming back
    let cancelled = false;
    (async () => {
      loadingRef.current = true;
      try {
        const store = useWorkspaceStore.getState();
        if (layout !== undefined && layout !== null) {
          const v2 = parseLayout(layout);
          const v1 = toV1(v2);
          store.resetWorkspace();
          store.loadWorkspace(v1);
          store.setTenant(null, null, v1.layoutName, v1.layoutVersion); // no place here: the app shell saves (onChange)
          loadedRef.current = v2;
        } else if (companyId && layoutId) {
          if (!(await loadWorkspace(companyId, layoutId))) throw new Error('This layout no longer exists');
          loadedRef.current = null;
        } else {
          throw new Error('No layout given: pass layout, or companyId and layoutId');
        }
        if (cancelled) return;
        setError(null);
        setLoadCount((n) => n + 1);
        propsRef.current.onReady?.({ mode: 'edit', getLayout });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (cancelled) return;
        setError(e.name === 'ZodError' ? 'This is not an AHDUS layout' : e.message);
        propsRef.current.onError?.(e);
      } finally {
        loadingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
    // getLayout reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, companyId, layoutId]);

  // onChange (debounced) and onSelect, from the app's store
  useEffect(() => {
    if (loadCount === 0) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const emitChange = () => {
      timer = undefined;
      const v2 = getLayout();
      emittedRef.current = v2;
      propsRef.current.onChange?.(v2);
    };
    const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
      if (loadingRef.current) return;
      if (s.rooms !== prev.rooms || s.objects !== prev.objects || s.floors !== prev.floors || s.anchorData !== prev.anchorData) {
        clearTimeout(timer);
        timer = setTimeout(emitChange, CHANGE_DELAY);
      }
      if (s.selectedObjectId && s.selectedObjectId !== prev.selectedObjectId) {
        propsRef.current.onSelect?.({ entityId: s.selectedObjectId, entityType: 'object' });
      } else if (s.selectedRoomId && s.selectedRoomId !== prev.selectedRoomId) {
        propsRef.current.onSelect?.({ entityId: s.selectedRoomId, entityType: 'room' });
      }
    });
    return () => {
      unsubscribe();
      if (timer) { // a change still waiting: give it now
        clearTimeout(timer);
        emitChange();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCount]);

  return (
    <div className={className} style={{ ...fill, ...style }} data-layout-editor="edit">
      {error && <div role="alert" style={{ padding: 16, font: '14px Inter, system-ui, sans-serif' }}>{error}</div>}
      {!error && loadCount > 0 && (
        <Suspense fallback={null}>
          <StudioPanel key={loadCount} onExit={() => propsRef.current.onExit?.()} />
        </Suspense>
      )}
    </div>
  );
}

export default LayoutEditor;
