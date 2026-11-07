/**
 * react/TouchControls.tsx
 *
 * The touch joystick of a viewer's walkthrough (v0.14.1, private-docs/EXPERIENCE_PLAN.md 3.2,
 * the Touch row): a ring at the bottom left; put a thumb on it and push the way to walk
 * (up = forward), further = faster (dragLook.stickVector: a small dead zone in the middle);
 * let go = stop. Moving it pauses a route (Take me there) and ends a walk you tapped, as the keys do.
 *
 * The rest of the view is the canvas: a finger dragging there looks around, a tap walks to
 * the floor, opens a person's card or uses a machine (playController's look 'drag').
 * Only shown on touch screens (LayoutViewer decides: the last press was a finger, or the
 * device's main pointer is coarse). Its pointer is captured, so a thumb sliding off the ring
 * keeps walking; a second finger on the canvas looks around at the same time.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import type { LayoutEngine } from '../LayoutEngine';
import { stickVector } from '../../play/dragLook';

/** The ring's size (px) and how far from the box's bottom left corner it sits. */
export const STICK_SIZE = 128;
export const STICK_MARGIN = 16;
const KNOB = 56;

export interface TouchControlsProps {
  engine: LayoutEngine;
}

export function TouchControls({ engine }: TouchControlsProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  const send = (x: number, y: number) => engine.walkthrough?.setStick(x, y);

  const at = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = ringRef.current?.getBoundingClientRect();
    if (!r) return;
    const v = stickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2);
    setKnob({ x: v.knobX, y: v.knobY });
    send(v.x, v.y);
  };

  const letGo = () => {
    pointerRef.current = null;
    setKnob(null);
    send(0, 0);
  };

  // Let go when it goes away (walking ends) or the page is hidden mid-push
  useEffect(() => {
    const onHide = () => { if (document.hidden && pointerRef.current !== null) letGo(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      engine.walkthrough?.setStick(0, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  return (
    <div
      ref={ringRef}
      data-touch-joystick={knob ? 'held' : 'idle'}
      // a thumb control: the keys walk for a keyboard, and screen readers have Find + Take me there
      aria-hidden
      style={styles.ring}
      onPointerDown={(e) => {
        if (pointerRef.current !== null) return; // one thumb at a time
        e.preventDefault();
        e.stopPropagation();
        pointerRef.current = e.pointerId;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a thumb sliding off stops it */ }
        at(e);
      }}
      onPointerMove={(e) => { if (e.pointerId === pointerRef.current) at(e); }}
      onPointerUp={(e) => { if (e.pointerId === pointerRef.current) letGo(); }}
      onPointerCancel={(e) => { if (e.pointerId === pointerRef.current) letGo(); }}
      onLostPointerCapture={(e) => { if (e.pointerId === pointerRef.current) letGo(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        data-touch-knob
        style={{ ...styles.knob, transform: `translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)`, opacity: knob ? 0.95 : 0.75 }}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  ring: {
    position: 'absolute', left: STICK_MARGIN, bottom: STICK_MARGIN, width: STICK_SIZE, height: STICK_SIZE,
    borderRadius: '50%', background: 'rgba(15, 23, 42, 0.35)', border: '2px solid rgba(255, 255, 255, 0.55)',
    boxSizing: 'border-box', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
    WebkitTapHighlightColor: 'transparent',
  },
  knob: {
    width: KNOB, height: KNOB, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.9)',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)', pointerEvents: 'none',
  },
};

export default TouchControls;
