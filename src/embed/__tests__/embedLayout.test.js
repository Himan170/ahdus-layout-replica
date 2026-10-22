import { describe, expect, it, vi } from 'vitest';

import { readLayout, toLayout, modeProblem, actionMatcher, filterAnchors, EDIT_REFUSED, NOT_A_LAYOUT } from '../embedLayout';
import { migrateV1toV2 } from '../../engine/model/migrate';
import { toV1 } from '../../engine/model/toV1';
import { createWorkspaceStore } from '../../store/workspaceStore';
import { layoutBridge } from '../../integration/layoutBridge';
import { anchorsFromStore } from '../../integration/anchorsFromStore';

const SAVE = {
  layoutName: 'Test office',
  layoutVersion: 1,
  floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } },
  rooms: [
    { id: 'room_training', type: 'PRODUCTION', name: 'Training room', floor: 0, x: 0, z: 0, width: 8, depth: 6, wallHeight: 3.2,
      doors: [{ wall: 'south', offset: 0, width: 1.4, height: 2.1 }], windows: [] },
    { id: 'room_office', type: 'OFFICE', name: 'Office', floor: 1, x: 0, z: 0, width: 8, depth: 6, wallHeight: 3.2, doors: [], windows: [] },
  ],
  objects: [
    { id: 'obj_cnc', assetType: 'CNC_MACHINE', floor: 0, roomId: 'room_training', x: 1, y: 0, z: -1, rotationY: 0 },
    { id: 'obj_desk', assetType: 'DESK_STANDARD', floor: 1, roomId: 'room_office', x: -1, y: 0, z: 1, rotationY: 0 },
  ],
  anchorData: {},
};
const V2 = migrateV1toV2(SAVE);
const FILE = { format: 'ahdus-layout', formatVersion: 1, exportedAt: '2026-10-22T00:00:00.000Z', layout: SAVE };

/** A fetch that answers once, and remembers what it was asked. */
function fakeFetch(answer) {
  return vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => {
        if (answer.body === undefined) throw new SyntaxError('Unexpected token < in JSON');
        return answer.body;
      },
    };
  });
}

describe('modeProblem', () => {
  it('shows view and walkthrough, refuses edit and anything else', () => {
    expect(modeProblem('view')).toBeNull();
    expect(modeProblem('walkthrough')).toBeNull();
    expect(modeProblem('edit')).toBe(EDIT_REFUSED);
    expect(modeProblem('walk')).toMatch(/Unknown mode "walk"/);
    expect(modeProblem(undefined)).toMatch(/Unknown mode/);
  });
});

describe('toLayout', () => {
  it('takes v2 JSON and an exported .ahdus.json file', () => {
    expect(toLayout(V2).rooms.map((r) => r.id)).toEqual(['room_training', 'room_office']);
    const fromFile = toLayout(FILE);
    expect(fromFile.building.name).toBe('Test office');
    expect(fromFile.objects.map((o) => o.id)).toEqual(['obj_cnc', 'obj_desk']);
  });

  it('refuses a bare save and other JSON (an API error must not show an empty workplace)', () => {
    expect(() => toLayout(SAVE)).toThrow(NOT_A_LAYOUT);
    expect(() => toLayout({ detail: 'Not authenticated' })).toThrow(NOT_A_LAYOUT);
    expect(() => toLayout([])).toThrow(NOT_A_LAYOUT);
    expect(() => toLayout('{"schemaVersion":2}')).toThrow(NOT_A_LAYOUT);
    expect(() => toLayout(null)).toThrow(NOT_A_LAYOUT);
  });

  it('says which field of a damaged layout is wrong', () => {
    const damaged = structuredClone(V2);
    damaged.rooms[0].width = 'wide';
    expect(() => toLayout(damaged)).toThrow(/^This AHDUS layout is damaged: rooms\.0\.width: /);
  });
});

describe('readLayout', () => {
  it('uses `layout` when given, without fetching', async () => {
    const fetch = fakeFetch({ status: 200, body: V2 });
    const layout = await readLayout({ layout: FILE, layoutUrl: '/never' }, { fetch });
    expect(layout.building.name).toBe('Test office');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches layoutUrl with the page\'s cookies and the given headers', async () => {
    const fetch = fakeFetch({ status: 200, body: V2 });
    const signal = new AbortController().signal;
    const layout = await readLayout({ layoutUrl: '/api/v1/workplace/layouts/1', headers: { Authorization: 'Bearer t' } }, { fetch, signal });
    expect(layout.rooms).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith('/api/v1/workplace/layouts/1', { credentials: 'include', headers: { Authorization: 'Bearer t' }, signal });
  });

  it('turns HTTP errors, network errors and non-JSON into short messages', async () => {
    const notFound = readLayout({ layoutUrl: '/x.json' }, { fetch: fakeFetch({ status: 404 }) });
    await expect(notFound).rejects.toThrow('Could not load the layout from /x.json (HTTP 404)');
    await expect(notFound).rejects.toMatchObject({ status: 404 });
    await expect(readLayout({ layoutUrl: '/x.json' }, { fetch: fakeFetch(new TypeError('Failed to fetch')) }))
      .rejects.toThrow('Could not load the layout from /x.json: Failed to fetch');
    await expect(readLayout({ layoutUrl: '/x.json' }, { fetch: fakeFetch({ status: 200 }) }))
      .rejects.toThrow('/x.json did not send JSON');
    await expect(readLayout({ layoutUrl: '/x.json' }, { fetch: fakeFetch({ status: 200, body: { error: 'nope' } }) }))
      .rejects.toThrow(NOT_A_LAYOUT);
  });

  it('lets an abort through as it is (destroy() while fetching is no error)', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    await expect(readLayout({ layoutUrl: '/x.json' }, { fetch: fakeFetch(abort) })).rejects.toBe(abort);
  });

  it('needs a layout or a layoutUrl', async () => {
    await expect(readLayout({})).rejects.toThrow('No layout given: pass layout or layoutUrl');
  });
});

describe('actionMatcher (registerAction\'s first argument)', () => {
  const store = createWorkspaceStore();
  store.getState().loadWorkspace(toV1(V2));
  const context = { store };
  const cnc = layoutBridge._describeTarget({ objectId: 'obj_cnc' }, context);
  const desk = layoutBridge._describeTarget({ objectId: 'obj_desk' }, context);
  const door = layoutBridge._describeTarget({ roomId: 'room_training', part: 'door' }, context);

  it('matches an asset type, a hook-point kind, an item id or a hook-point id', () => {
    expect(actionMatcher('CNC_MACHINE')(cnc)).toBe(true);
    expect(actionMatcher('CNC_MACHINE')(desk)).toBe(false);
    expect(actionMatcher('machine')(cnc)).toBe(true);
    expect(actionMatcher('workstation')(desk)).toBe(true);
    expect(actionMatcher('obj_desk')(desk)).toBe(true);
    expect(actionMatcher(cnc.anchorId)(cnc)).toBe(true);
    expect(actionMatcher(cnc.anchorId)(desk)).toBe(false);
  });

  it('matches doors and windows by kind, a list by any entry, and takes a function as it is', () => {
    expect(actionMatcher('door')(door)).toBe(true);
    expect(actionMatcher('window')(door)).toBe(false);
    expect(actionMatcher('CNC_MACHINE')(door)).toBe(false);
    expect(actionMatcher(['LATHE', 'CNC_MACHINE'])(cnc)).toBe(true);
    const fn = (t) => t.room?.name === 'Training room';
    expect(actionMatcher(fn)).toBe(fn);
  });

  it('refuses anything else', () => {
    for (const bad of [undefined, '', 42, [], ['CNC_MACHINE', 3]]) {
      expect(() => actionMatcher(bad)).toThrow(TypeError);
    }
  });
});

describe('filterAnchors', () => {
  const store = createWorkspaceStore();
  store.getState().loadWorkspace(toV1(V2));
  const s = store.getState();
  const all = anchorsFromStore(s.objects, s.anchorData, s.floors);

  it('filters by kind, room, floor (1 or "1") and item', () => {
    expect(filterAnchors(all)).toHaveLength(all.length);
    expect(filterAnchors(all, { kind: 'machine' }).map((a) => a.objectId)).toEqual(['obj_cnc']);
    expect(filterAnchors(all, { roomId: 'room_office' }).every((a) => a.objectId === 'obj_desk')).toBe(true);
    expect(filterAnchors(all, { floorId: 1 })).toEqual(filterAnchors(all, { floorId: '1' }));
    expect(filterAnchors(all, { floorId: 1 }).every((a) => a.objectId === 'obj_desk')).toBe(true);
    expect(filterAnchors(all, { objectId: 'obj_cnc', kind: 'workstation' })).toEqual([]);
  });
});
