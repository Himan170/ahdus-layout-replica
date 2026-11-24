// @vitest-environment jsdom
// v0.18.10: the performance tip's card and the weak-device note with the tip in it (one note, not two).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PerfTipCard } from '../react/PerfTipCard';
import { WeakDeviceNote } from '../react/WelcomeCard';
import { PERF_TIP_TEXT } from '../perfTip';
import { weakNote, weakReason } from '../startMode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the performance tip in the viewer (v0.18.10)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
  const click = (sel: string) => act(() => { q(sel)!.click(); });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('the card: its text, Got it, Don\'t show again; not a dialog', () => {
    const ok = vi.fn();
    const off = vi.fn();
    act(() => root.render(<PerfTipCard onGotIt={ok} onOff={off} />));
    expect(q('[data-perf-tip="card"]')?.getAttribute('role')).toBe('note');
    expect(q('[role="dialog"]')).toBeNull();
    expect(q('[data-perf-tip-text]')?.textContent).toBe(PERF_TIP_TEXT);
    expect(q('[data-perf-tip-action="ok"]')?.textContent?.trim()).toBe('Got it');
    expect(q('[data-perf-tip-action="off"]')?.textContent?.trim()).toBe('Don\'t show again');
    click('[data-perf-tip-action="ok"]');
    click('[data-perf-tip-action="off"]');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('the weak note with the tip: why, the tip, Walk anyway · Stay above, Don\'t show again', () => {
    const tipOff = vi.fn();
    act(() => root.render(<WeakDeviceNote kind="software" onWalk={() => {}} onStay={() => {}} tip onTipOff={tipOff} />));
    expect(q('[data-weak-note-text]')?.textContent).toBe(weakReason('software'));
    expect(q('[data-perf-tip-text]')?.textContent).toBe(PERF_TIP_TEXT);
    expect(container.querySelectorAll('[data-perf-tip="card"]').length).toBe(0); // no second card
    expect([...container.querySelectorAll('[data-weak-note-action]')].map((b) => b.textContent?.trim()))
      .toEqual(['Walk anyway', 'Stay above']);
    click('[data-perf-tip-action="off"]');
    expect(tipOff).toHaveBeenCalledTimes(1);
  });

  it('the weak note without the tip: as before (v0.14.8)', () => {
    act(() => root.render(<WeakDeviceNote kind="software" onWalk={() => {}} onStay={() => {}} />));
    expect(q('[data-weak-note-text]')?.textContent).toBe(weakNote('software'));
    expect(q('[data-perf-tip-text]')).toBeNull();
    expect(q('[data-perf-tip-action]')).toBeNull();
  });
});
