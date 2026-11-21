// @vitest-environment jsdom
// v0.18.7 (Astra audit, the welcome card): opening Find tells the viewer in the SAME render, so the welcome card
// goes as Find's box appears. onOpenChange came from an effect after Find's render, so for one frame the box and the
// welcome card were both on screen (and the card's effect closed it one render later still).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, Profiler, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlaceSearch, SEARCH_LABEL } from '../react/PlaceSearch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeEngine = {
  on: () => () => {},
  tour: { running: false, visitedNow: () => [] },
  navigation: {
    tourPlanReady: null,
    browse: () => ({ chips: [], myDesk: null, recent: [], departments: [], kinds: [], floors: [] }),
    search: (q: string) => ({ query: q, groups: { people: [], rooms: [], facilities: [] }, more: { people: 0, rooms: 0, facilities: 0 }, total: 0, order: [] }),
    clear: () => {},
  },
};

describe('Find tells the viewer it opened in the same render (v0.18.7)', () => {
  let container: HTMLDivElement;
  let root: Root;
  /** every commit: [what the viewer believes, whether Find's box is on screen] */
  const commits: Array<[boolean, boolean]> = [];
  function Viewer() {
    const [findOpen, setFindOpen] = useState(false);
    // each commit of Find's subtree: what the viewer drew last time (this closure is that render's) and the box
    const onRender = () => commits.push([findOpen, !!container.querySelector(`input[aria-label="${SEARCH_LABEL}"]`)]);
    return (
      <Profiler id="find" onRender={onRender}>
        <PlaceSearch engine={fakeEngine as never} walking={false} onOpenChange={setFindOpen} />
      </Profiler>
    );
  }

  beforeEach(() => {
    commits.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Viewer />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('never a render with the box shown while the viewer still thinks Find is shut, opening or closing', () => {
    act(() => { (container.querySelector('[data-place-search-button]') as HTMLButtonElement).click(); });
    expect(container.querySelector(`input[aria-label="${SEARCH_LABEL}"]`)).not.toBeNull();
    expect(commits.some(([viewer, box]) => box && !viewer)).toBe(false);
    expect(commits.at(-1)).toEqual([true, true]);
    act(() => { (container.querySelector('[data-place-search-button]') as HTMLButtonElement).click(); });
    expect(commits.some(([viewer, box]) => !box && viewer)).toBe(false);
    expect(commits.at(-1)).toEqual([false, false]);
  });
});
