// The Find box's browse menu (v0.14.2): what each list of the menu shows (PlaceSearch.browseScreen, pure),
// from engine.navigation.browse() on the Meridian-shaped layout. e2e/viewer-smoke.mjs clicks through it.
import { describe, expect, it } from 'vitest';

import { NavigationSystem } from '../systems/NavigationSystem';
import { browseScreen, chipLabel } from '../react/PlaceSearch';
import { meridianLike } from '../../play/navigation/__tests__/meridianLike';

function navigation() {
  const layout: any = { ...meridianLike(), currentFloor: 0 };
  const dept: Record<string, string> = { room_f0_05: 'Sales', room_f1_05: 'Engineering', room_f1_09: 'Engineering' };
  for (const r of layout.rooms) if (dept[r.id]) r.departmentRef = dept[r.id];
  const nav = new NavigationSystem({
    getLayout: () => layout, getWalker: () => null, focusOn: () => true, highlight: () => {}, clearHighlights: () => {},
    getMe: () => 'u2',
  });
  const desks = layout.objects.filter((o: any) => o.assetType === 'DESK_STANDARD' && o.roomId === 'room_f1_05');
  nav.setPeople([
    { personId: 'u1', deskId: desks[0].id, name: 'Zoya Khan', department: 'Engineering' },
    { personId: 'u2', deskId: desks[1].id, name: 'Arjun Rao', department: 'Engineering' },
  ]);
  nav.setDepartments([{ name: 'Engineering', description: 'Builds the product' }]);
  return nav;
}

const titles = (screen: ReturnType<typeof browseScreen>) => screen.sections.map((s) => s.title ?? `(${s.key})`);
const names = (screen: ReturnType<typeof browseScreen>) => screen.sections.flatMap((s) => s.entries)
  .map((e) => (e.type === 'back' ? '‹ All' : e.type === 'place' ? (e.name ?? e.place.name) : e.name));

describe('browseScreen', () => {
  const nav = navigation();
  const menu = nav.browse({ recent: ['room:room_f0_07'] });

  it('the start: quick picks, My desk, recent, departments, places, by floor', () => {
    const home = browseScreen(menu, { type: 'home' });
    expect(titles(home)).toEqual(['Quick picks', '(mine)', 'Recent', 'Departments', 'Places', 'By floor']);
    expect(names(home).slice(0, 7)).toEqual(['Washroom', 'Meeting room', 'Reception', 'Stairs', 'My desk', 'Restrooms', 'Engineering']);
    const eng = home.sections.find((s) => s.key === 'departments')!.entries[0];
    expect(eng).toMatchObject({ type: 'open', name: 'Engineering', detail: '2 rooms · Floor 1 · 2 people', description: 'Builds the product' });
    expect(home.status).toMatch(/^Type to search, or choose from \d+ items below$/);
    expect(home.head).toBeNull();
  });

  it('a department: back, all of it, its rooms, its people', () => {
    const s = browseScreen(menu, { type: 'department', id: 'department:engineering' });
    expect(names(s)).toEqual(['‹ All', 'All of Engineering', 'Engineering 1', 'Engineering 2', 'Arjun Rao', 'Zoya Khan']);
    expect(titles(s)).toEqual(['(back)', '(all)', 'Rooms', 'People (2)']);
    expect(s.head).toEqual({ name: 'Engineering', detail: '2 rooms · Floor 1 · 2 people', description: 'Builds the product' });
  });

  it('a kind of place: its places by floor', () => {
    const s = browseScreen(menu, { type: 'kind', id: 'kind:MEETING' });
    expect(titles(s)).toEqual(['(back)', 'Ground Floor', 'Floor 1']);
    expect(names(s)).toEqual(['‹ All', 'Meeting Room 0.1', 'Meeting Room 0.2', 'Meeting Room 1.3']);
    expect(s.head?.detail).toBe('3 · Ground Floor, Floor 1');
  });

  it('a floor: its rooms; something that is gone: the start', () => {
    const s = browseScreen(menu, { type: 'floor', id: 'floor:1' });
    expect(s.head).toMatchObject({ name: 'Floor 1', detail: '11 rooms' });
    expect(names(s)).toHaveLength(12);
    expect(browseScreen(menu, { type: 'kind', id: 'kind:NOPE' }).view).toEqual({ type: 'home' });
  });

  it('chips: walking, the nearest and how far; else the kind', () => {
    const chip = { ...menu.chips[0], nearest: { place: { ...menu.chips[0].place!, name: 'Nearest washroom' }, length: 7.6, seconds: 2 } };
    expect(chipLabel(chip, true)).toBe('Nearest washroom · 8 m');
    expect(chipLabel(chip, false)).toBe('Washroom');
    expect(chipLabel({ ...chip, nearest: null }, true)).toBe('Washroom');
    expect(titles(browseScreen(menu, { type: 'home' }, { walking: true }))[0]).toBe('Nearest');
  });
});

