// @vitest-environment jsdom
// v0.18.2: one Esc closes one level (the phone's More → Settings closed both menus at once).
import { describe, it, expect, afterEach } from 'vitest';
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePopover, openPopovers } from '../usePopover';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Menu({ name, children, log, start = true }) {
  const [open, setOpen] = useState(start);
  if (name === 'settings') openSettings = () => setOpen(true);
  const ref = useRef(null);
  usePopover(open, () => { log.push(name); setOpen(false); }, [ref]);
  return open ? <div ref={ref} data-menu={name}>{children}</div> : null;
}

let openSettings = null;
let root = null;
let host = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; });
const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

describe('usePopover: Esc closes the popover opened last only', () => {
  it('More with Settings open in it: Esc closes Settings, the next Esc More', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const log = [];
    act(() => root.render(<Menu name="more" log={log}><Menu name="settings" log={log} start={false} /></Menu>));
    expect(openPopovers()).toBe(1);
    act(() => openSettings()); // Settings is opened from inside More, after it
    expect(openPopovers()).toBe(2);
    esc();
    expect(log).toEqual(['settings']);
    expect(host.querySelector('[data-menu="more"]')).not.toBeNull();
    expect(host.querySelector('[data-menu="settings"]')).toBeNull();
    esc();
    expect(log).toEqual(['settings', 'more']);
    expect(openPopovers()).toBe(0);
  });
});
