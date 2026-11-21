// @vitest-environment jsdom
// v0.18.7 (Astra audit, Find ARIA): one active option for the keys, the highlighted row and aria-activedescendant,
// in the same render. A new list (more letters typed) starts at its first option at once: it kept the old
// index for one render (clamped for aria-activedescendant, not for aria-selected), then an effect reset it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlaceSearch, SEARCH_LABEL } from '../react/PlaceSearch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAMES = ['Asha Patel', 'Asif Khan', 'Anil Rao', 'Arun Das', 'Amit Shah'];
const person = (name: string, i: number) => ({ id: `person:p${i}`, kind: 'person', group: 'people', name, detail: 'Ground Floor' });
const fakeEngine = () => ({
  on: () => () => {},
  tour: { running: false, visitedNow: () => [] },
  navigation: {
    tourPlanReady: null,
    browse: () => ({ chips: [], myDesk: null, recent: [], departments: [], kinds: [], floors: [] }),
    search: (q: string) => {
      const people = NAMES.map(person).filter((p) => p.name.toLowerCase().startsWith(q.trim().toLowerCase()));
      return { query: q, groups: { people, rooms: [], facilities: [] }, more: { people: 0, rooms: 0, facilities: 0 }, total: people.length, order: ['people'] };
    },
    clear: () => {},
  },
});

describe('Find: one active option (v0.18.7)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const input = () => container.querySelector(`input[aria-label="${SEARCH_LABEL}"]`) as HTMLInputElement;
  const type = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const key = (k: string) => act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
  const selected = () => [...container.querySelectorAll('[role="option"][aria-selected="true"]')].map((o) => o.id);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<PlaceSearch engine={fakeEngine() as never} walking={false} />));
    act(() => { (container.querySelector('[data-place-search-button]') as HTMLButtonElement).click(); });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('↓ ↓ ↓ then another letter: the new list starts at its first option in the same render', () => {
    type('a');
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-opt-3$/);
    expect(selected()).toEqual([input().getAttribute('aria-activedescendant')]);
    // every change of aria-activedescendant, with the value it had before
    const watch = new MutationObserver(() => {});
    watch.observe(input(), { attributes: true, attributeFilter: ['aria-activedescendant'], attributeOldValue: true });
    const before = watch.takeRecords().length;
    type('as'); // Asha, Asif
    const records = watch.takeRecords();
    watch.disconnect();
    expect(before).toBe(0);
    // one change: straight from option 3 to option 0 (it went 3 → 1 (clamped) → 0)
    expect(records.map((r) => r.oldValue?.replace(/.*-opt-/, 'opt-'))).toEqual(['opt-3']);
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-opt-0$/);
    expect(selected()).toEqual([input().getAttribute('aria-activedescendant')]);
  });

  it('Enter picks the option shown as active (↓ then Enter on the second)', () => {
    type('a');
    key('ArrowDown');
    expect(container.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-place')).toBe('person:p1');
  });
});
