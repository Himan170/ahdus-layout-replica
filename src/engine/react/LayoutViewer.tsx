/**
 * react/LayoutViewer.tsx
 *
 * <LayoutViewer />: a company layout to look at (mode "view": orbit and zoom)
 * or walk through (mode "walkthrough": Preview's character, W A S D, mouse,
 * E). Nothing can change the layout. No Workplace Studio code is loaded.
 *
 *   <LayoutViewer layout={json} mode="walkthrough"
 *     onReady={(engine) => …} onEnterRoom={(e) => …} onInteract={(e) => …} />
 *
 * The layout: `layout` (JSON the app shell fetched: a save, an exported file
 * or v2), else `companyId` + `layoutId` (a layout saved in this browser; for
 * our test page). The viewer is connected to layoutBridge (connectEngine),
 * so teammates' modules and their "Press E" actions work in it.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { LayoutEngine } from '../LayoutEngine';
import type { EngineMode, QualityLevel, InteractEvent, EnterRoomEvent, ExitRoomEvent } from '../LayoutEngine';
import { connectEngine } from '../../integration/layoutBridge';
import { readSavedLayout } from '../../services/apiService';

export interface LayoutViewerProps {
  /** The layout: a save, an exported layout file or v2 JSON. */
  layout?: unknown;
  /** Or a layout saved in this browser (used when `layout` is not given). */
  companyId?: string;
  layoutId?: string;
  /** 'view' (orbit, default) or 'walkthrough'. */
  mode?: Exclude<EngineMode, 'edit'>;
  /** 'low' is accepted but changes nothing yet (TEAM_TASKS H7). */
  quality?: QualityLevel;
  /** The engine is ready and the layout is drawn (focusOn, highlight, getAnchors, …). */
  onReady?: (engine: LayoutEngine) => void;
  onInteract?: (event: InteractEvent) => void;
  onEnterRoom?: (event: EnterRoomEvent) => void;
  onExitRoom?: (event: ExitRoomEvent) => void;
  /** The layout could not be loaded (not found, or not a layout). */
  onError?: (error: Error) => void;
  /** A card was shown (the default card of E, layoutBridge.showCard): to show it in your own panel too. */
  onCard?: (card: { title: string; body?: string; text?: string; duration?: number }) => void;
  className?: string;
  style?: CSSProperties;
}

interface Card { title: string; body?: string; text?: string; duration?: number }
interface Hud {
  locked?: boolean;
  hint?: { title?: string; detail?: string };
  message?: string | null;
  roomName?: string;
  /** "Floor 1 of 3" (building.floorPosition) */
  floor?: { index: number; count: number };
  prompt?: { label: string; name: string } | null;
}

/** The layout to show, from the props (throws if it can't be found). */
function layoutFrom({ layout, companyId, layoutId }: LayoutViewerProps): unknown {
  if (layout !== undefined && layout !== null) return layout;
  if (companyId && layoutId) {
    const saved = readSavedLayout(companyId, layoutId);
    if (!saved) throw new Error('This layout no longer exists');
    return saved;
  }
  throw new Error('No layout given: pass layout, or companyId and layoutId');
}

export function LayoutViewer(props: LayoutViewerProps) {
  const { mode = 'view', quality = 'high', className, style } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<LayoutEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  // the latest callbacks, so the engine's handlers never call stale ones
  const propsRef = useRef(props);
  propsRef.current = props;
  const readyFor = useRef<LayoutEngine | null>(null); // onReady once per engine

  // The engine lives as long as the component (React StrictMode mounts twice)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    let created: LayoutEngine | null = null;
    let disconnect: (() => void) | null = null;
    let cardTimer: ReturnType<typeof setTimeout> | undefined;
    const offs: (() => void)[] = [];

    LayoutEngine.create(canvas, { mode, quality }).then((e) => {
      if (disposed) {
        e.dispose();
        return;
      }
      created = e;
      disconnect = connectEngine(e, {
        showCard: (c: Card) => {
          propsRef.current.onCard?.(c);
          clearTimeout(cardTimer);
          setCard(c);
          cardTimer = setTimeout(() => setCard(null), c.duration ?? 6000);
        },
      });
      offs.push(
        e.on('interact', (ev) => propsRef.current.onInteract?.(ev)),
        e.on('enterRoom', (ev) => propsRef.current.onEnterRoom?.(ev)),
        e.on('exitRoom', (ev) => propsRef.current.onExitRoom?.(ev)),
        e.on('hud', (info) => setHud(info as Hud)),
      );
      setEngine(e);
    });

    return () => {
      disposed = true;
      clearTimeout(cardTimer);
      offs.forEach((off) => off());
      disconnect?.();
      created?.dispose();
      setEngine(null);
    };
    // mode and quality are applied below / fixed at creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load (or reload) the layout when it changes
  const { layout, companyId, layoutId } = props;
  useEffect(() => {
    if (!engine) return;
    try {
      engine.loadLayout(layoutFrom({ layout, companyId, layoutId }));
      engine.fitView({ animate: false });
      setError(null);
      if (readyFor.current !== engine) {
        readyFor.current = engine;
        propsRef.current.onReady?.(engine);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      // a ZodError's message is the list of bad fields: too much for this card
      setError(e.name === 'ZodError' ? 'This is not an AHDUS layout' : e.message);
      propsRef.current.onError?.(e);
    }
  }, [engine, layout, companyId, layoutId]);

  useEffect(() => {
    engine?.setMode(mode);
  }, [engine, mode]);

  const walking = mode === 'walkthrough';
  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', ...style }} data-layout-viewer={mode}>
      <canvas
        ref={canvasRef}
        aria-label={walking ? 'Layout walkthrough' : 'Layout view'}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' }}
      />
      {error && <div role="alert" style={styles.center}>{error}</div>}
      {walking && !error && hud && (
        <>
          {hud.locked && <div aria-hidden style={styles.crosshair}>+</div>}
          <div style={styles.hud} aria-live="polite">
            <span data-hud="room"><strong>{hud.roomName}</strong></span>
            {hud.floor && hud.floor.count > 1 && <span data-hud="floor"> · Floor {hud.floor.index} of {hud.floor.count}</span>}
            <div data-hud="hint">{hud.locked ? (hud.message ?? hud.hint?.detail) : 'Click to look around (Esc releases the mouse)'}</div>
            {hud.locked && hud.prompt && (
              <div data-hud="prompt"><kbd style={styles.key}>E</kbd> {hud.prompt.label}{hud.prompt.name ? `: ${hud.prompt.name}` : ''}</div>
            )}
          </div>
        </>
      )}
      {card && (
        <div role="status" data-viewer-card style={styles.card}>
          <strong>{card.title}</strong>
          <div style={{ whiteSpace: 'pre-line' }}>{card.body ?? card.text}</div>
        </div>
      )}
    </div>
  );
}

// Inline styles: the viewer brings no stylesheet of its own (the app shell has its own look)
const panel: CSSProperties = {
  position: 'absolute', background: 'rgba(15, 23, 42, 0.78)', color: '#fff',
  font: '14px/1.4 Inter, system-ui, sans-serif', borderRadius: 8, padding: '8px 12px', pointerEvents: 'none',
};
const styles: Record<string, CSSProperties> = {
  center: { ...panel, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
  crosshair: {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    color: '#fff', font: '22px/1 system-ui, sans-serif', textShadow: '0 0 3px #000', pointerEvents: 'none',
  },
  hud: { ...panel, left: 12, bottom: 12, maxWidth: 'calc(100% - 24px)' },
  card: { ...panel, top: 12, right: 12, maxWidth: 320 },
  key: { border: '1px solid #fff8', borderRadius: 4, padding: '0 5px', marginRight: 4 },
};

export default LayoutViewer;
