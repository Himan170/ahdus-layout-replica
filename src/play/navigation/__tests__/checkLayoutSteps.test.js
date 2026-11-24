// v0.18.11: checkLayoutSteps = checkLayout in pieces (Studio runs it in idle slices after a layout opens). The same
// problems, messages, keys and Fix it moves as one whole check, on every kind of layout the Check tests use.
import { describe, expect, it } from 'vitest';
import { checkLayout, checkLayoutSteps } from '../checkLayout';
import { meridianLike } from './meridianLike';
import { randomLayout } from './randomLayouts';
import { createWalkMapCache } from '../walkMap';
import { openingCentre } from '../../geometry';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { LAYOUT_TEMPLATES } from '../../../templates';
import { normaliseLayout } from '../../../store/layoutData';

/** Runs the steps to the end: the result and how many steps there were. */
function stepped(layout, options) {
  const steps = checkLayoutSteps(layout, options);
  let count = 0;
  for (;;) {
    const r = steps.next();
    if (r.done) return { result: r.value, count };
    count++;
  }
}

/** Everything but the time. */
const same = (layout) => {
  const whole = checkLayout(layout, { catalog: ASSET_TYPES, maps: createWalkMapCache({ catalog: ASSET_TYPES }) });
  const { result, count } = stepped(layout, { catalog: ASSET_TYPES, maps: createWalkMapCache({ catalog: ASSET_TYPES }) });
  expect(result.problems).toEqual(whole.problems);
  expect(typeof result.ms).toBe('number');
  return { problems: whole.problems, count };
};

/** Meridian with its stairs pushed into a wall and a desk in a doorway: Fix it moves and re-checks. */
function meridianWithFixes() {
  const layout = meridianLike();
  const objects = Object.values(layout.objects ?? {});
  const rooms = Object.values(layout.rooms ?? {});
  const stairs = objects.find((o) => o.assetType === 'STAIRCASE');
  const desk = objects.find((o) => /^DESK/.test(o.assetType) && (o.floor ?? 0) === 0);
  const withDoor = rooms.find((r) => (r.floor ?? 0) === 0 && r.doors?.length);
  const c = openingCentre(withDoor, withDoor.doors[0].wall, withDoor.doors[0].offset);
  const moved = objects.map((o) => {
    if (o === stairs) return { ...o, x: o.x + 1.5 };
    if (o === desk) return { ...o, x: c.x, z: c.z };
    return o;
  });
  return { ...layout, objects: Array.isArray(layout.objects) ? moved : Object.fromEntries(moved.map((o) => [o.id, o])) };
}

describe('checkLayoutSteps (v0.18.11)', () => {
  it('gives what checkLayout gives on the Meridian-shaped layout, in many small steps', () => {
    const { count } = same(meridianLike());
    expect(count).toBeGreaterThan(50);
  });

  it('gives the same Fix it moves (re-checks included) as checkLayout', () => {
    const { problems } = same(meridianWithFixes());
    expect(problems.some((p) => p.fix)).toBe(true);
  });

  it('gives what checkLayout gives on every template', () => {
    for (const t of LAYOUT_TEMPLATES) same(normaliseLayout(t.layout));
  });

  it('gives what checkLayout gives on 40 random layouts', () => {
    for (let seed = 1; seed <= 40; seed++) same(randomLayout(seed));
  });

  it('with the fixes off and on an empty layout', () => {
    const layout = meridianWithFixes();
    expect(stepped(layout, { catalog: ASSET_TYPES, fixes: false }).result.problems)
      .toEqual(checkLayout(layout, { catalog: ASSET_TYPES, fixes: false }).problems);
    expect(stepped({ rooms: [], objects: [], floors: {} }).result.problems).toEqual([]);
  });
});
