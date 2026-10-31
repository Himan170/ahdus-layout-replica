// VITE_LAYOUT_BACKEND=ahdus: Workplace Studio inside AHDUS loads and saves a site's draft
// through the AHDUS API (ahdusBackend.js), with the AHDUS login token. fetch is mocked:
// a tiny fake server keeps the draft, its revision and the versions.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadWorkspace,
  saveNow,
  reloadLayout,
  saveAsCopy,
  createVersion,
  listVersions,
  restoreVersion,
  publishLayout,
  _getRevision,
} from '../apiService';
import { AHDUS_COMPANY, AHDUS_CHANGED, AHDUS_NOT_ALLOWED, AHDUS_LOGIN_EXPIRED, siteFromUrl } from '../ahdusBackend';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';
import { loadLayout } from '../../engine/model';

const SITE = 'site-1';
const TOKEN = 'token-abc';

function v2Layout(rooms, extra = {}) {
  const v2 = loadLayout({
    layoutName: 'HQ',
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
    rooms,
    objects: [],
  });
  return { ...v2, building: { ...v2.building, ...extra } };
}

const OFFICE = { id: 'room_office', type: 'OFFICE', name: 'Office', floor: 0, x: 0, z: 0, width: 4, depth: 4 };
const STORE = { id: 'room_store', type: 'STORAGE', name: 'Store', floor: 0, x: 10, z: 0, width: 3, depth: 3 };

/** The fake AHDUS server: the draft, its revision, versions; `answer` overrides a route's status. */
function fakeServer() {
  const server = {
    draft: v2Layout([OFFICE], { address: 'Main Street 1' }),
    revision: 7,
    versions: [],
    published: null,
    answer: {},  // 'PUT /layout' → status
    calls: [],
  };
  server.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    server.calls.push({ method, url, headers: init.headers ?? {}, body });
    const route = `${method} ${url.replace(`/api/workplace/sites/${SITE}`, '').replace(/\?.*/, '')}`;
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
    const forced = Object.entries(server.answer).find(([r]) => route === r);
    if (forced) return reply(forced[1], { detail: 'nope' });

    if (route === 'GET /layout') return reply(200, { layout: server.draft, revision: server.revision });
    if (route === 'PUT /layout') {
      if (body.expectedRevision !== server.revision) return reply(409, { detail: 'conflict' });
      server.draft = body.layout;
      server.revision += 1;
      return reply(200, { revision: server.revision });
    }
    if (route === 'GET /versions') return reply(200, server.versions.map(({ snapshot: _s, ...v }) => v));
    if (route === 'POST /versions') {
      const v = { id: `v${server.versions.length + 1}`, revision: body.revision, name: body.name, kind: body.kind,
        createdAt: '2026-10-31T10:00:00Z', snapshot: body.layout };
      server.versions.unshift(v);
      const { snapshot: _s, ...shown } = v;
      return reply(201, shown);
    }
    const restore = route.match(/^POST \/versions\/(.+)\/restore$/);
    if (restore) {
      const v = server.versions.find((x) => x.id === decodeURIComponent(restore[1]));
      if (!v) return reply(404, { detail: 'Not found' });
      server.draft = v.snapshot;
      server.revision += 1;
      return reply(200, { layout: v.snapshot, revision: server.revision });
    }
    if (route === 'POST /publish') {
      if (body.expectedRevision !== server.revision) return reply(409, { detail: 'conflict' });
      server.published = server.draft;
      return reply(200, { publishedRevision: server.revision });
    }
    return reply(404, { detail: 'Not found' });
  });
  return server;
}

describe('apiService with VITE_LAYOUT_BACKEND=ahdus', () => {
  let server;
  let storage;

  beforeEach(() => {
    storage = new Map([['authToken', TOKEN]]);
    globalThis.localStorage = {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => storage.clear(),
      key: (i) => [...storage.keys()][i] ?? null,
      get length() { return storage.size; },
    };
    useWorkspaceStore.getState().resetWorkspace();
    vi.stubEnv('VITE_LAYOUT_BACKEND', 'ahdus');
    server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the site\'s draft (v2) into the store, with its revision', async () => {
    expect(await loadWorkspace(AHDUS_COMPANY, SITE)).toBe(true);
    expect(server.calls[0]).toMatchObject({ method: 'GET', url: `/api/workplace/sites/${SITE}/layout?state=draft` });
    const s = useWorkspaceStore.getState();
    expect(Object.values(s.rooms).map((r) => r.name)).toEqual(['Office']);
    expect(s.companyId).toBe(AHDUS_COMPANY);
    expect(s.layoutId).toBe(SITE);
    expect(s.layoutName).toBe('HQ');
    expect(s.isDirty).toBe(false);
    expect(_getRevision()).toBe(7);
  });

  it('sends the AHDUS token as a Bearer header on every call', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    createEditorHistory().addRoom(STORE);
    await saveNow();
    await createVersion('Named');
    await listVersions(AHDUS_COMPANY, SITE);
    await publishLayout();
    expect(server.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of server.calls) expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('sends no Authorization header without a token', async () => {
    storage.delete('authToken');
    await loadWorkspace(AHDUS_COMPANY, SITE);
    expect(server.calls[0].headers.Authorization).toBeUndefined();
  });

  it('saves the draft as v2 with the expected revision, and keeps what only v2 has', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    createEditorHistory().addRoom(STORE);
    expect(await saveNow()).toEqual({ ok: true });

    const put = server.calls.find((c) => c.method === 'PUT');
    expect(put.url).toBe(`/api/workplace/sites/${SITE}/layout`);
    expect(put.headers['Content-Type']).toBe('application/json');
    expect(put.body.expectedRevision).toBe(7);
    expect(put.body.layout.schemaVersion).toBe(2);
    expect(put.body.layout.rooms.map((r) => r.name).sort()).toEqual(['Office', 'Store']);
    expect(put.body.layout.building.address).toBe('Main Street 1');
    expect(_getRevision()).toBe(8);
    expect(useWorkspaceStore.getState().isDirty).toBe(false);

    // The next save continues from the new revision; nothing changed = no request
    expect((await saveNow()).skipped).toBe(true);
    createEditorHistory().deleteRoom('room_store');
    await saveNow();
    expect(server.calls.filter((c) => c.method === 'PUT').at(-1).body.expectedRevision).toBe(8);
    // Nothing about the layout is kept in localStorage
    expect([...storage.keys()]).toEqual(['authToken']);
  });

  it('409: "This workplace was changed by someone else", saving stops until Reload', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    server.revision = 9; // someone else saved
    createEditorHistory().addRoom(STORE);
    const res = await saveNow();
    expect(res).toMatchObject({ ok: false, conflict: true, error: AHDUS_CHANGED });
    expect(useWorkspaceStore.getState()).toMatchObject({ saveConflict: true, saveError: AHDUS_CHANGED });

    const before = server.calls.length;
    expect((await saveNow()).conflict).toBe(true);
    expect(server.calls.length).toBe(before); // no second try over their save

    // No copy to save to in AHDUS: Reload only
    expect((await saveAsCopy()).ok).toBe(false);
    expect(await reloadLayout()).toBe(true);
    expect(useWorkspaceStore.getState().saveConflict).toBe(false);
    expect(Object.values(useWorkspaceStore.getState().rooms).map((r) => r.name)).toEqual(['Office']);
    expect(_getRevision()).toBe(9);
  });

  it.each([
    [403, AHDUS_NOT_ALLOWED],     // "Not saved: you are not allowed to edit this workplace"
    [401, AHDUS_LOGIN_EXPIRED],   // "Not saved: Your AHDUS login has expired. Log in again."
  ])('%i on save: "Not saved: %s"', async (status, reason) => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    server.answer['PUT /layout'] = status;
    createEditorHistory().addRoom(STORE);
    expect(await saveNow()).toEqual({ ok: false, error: reason });
    const s = useWorkspaceStore.getState();
    expect(s.saveError).toBe(reason);
    expect(s.saveConflict).toBe(false);
    expect(s.isDirty).toBe(true); // the next change retries
  });

  it('opening a site the user may not edit fails with a short reason', async () => {
    server.answer['GET /layout'] = 403;
    await expect(loadWorkspace(AHDUS_COMPANY, SITE)).rejects.toThrow('You are not allowed to edit this workplace');
  });

  it('opening a site with an expired login says to log in again', async () => {
    server.answer['GET /layout'] = 401;
    await expect(loadWorkspace(AHDUS_COMPANY, SITE)).rejects.toThrow('Your AHDUS login has expired. Log in again.');
  });

  it('publish with an expired login says to log in again', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    server.answer['POST /publish'] = 401;
    expect(await publishLayout()).toMatchObject({ ok: false, error: AHDUS_LOGIN_EXPIRED });
  });

  it('a site without a draft yet opens empty, at revision 0', async () => {
    server.draft = null;
    server.revision = 0;
    expect(await loadWorkspace(AHDUS_COMPANY, SITE)).toBe(true);
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(0);
    createEditorHistory().addRoom(OFFICE);
    await saveNow();
    expect(server.calls.at(-1).body.expectedRevision).toBe(0);
  });

  it('a network failure says so and keeps the change for the next save', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    server.fetch.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    createEditorHistory().addRoom(STORE);
    expect((await saveNow()).ok).toBe(false);
    expect(useWorkspaceStore.getState().saveError).toBe('AHDUS could not be reached');
    expect((await saveNow()).ok).toBe(true);
    expect(useWorkspaceStore.getState().saveError).toBe(null);
  });

  it('versions live on the server: create, list, restore (one undo step)', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    const editor = createEditorHistory();

    const created = await createVersion('Before the store');
    expect(created.ok).toBe(true);
    expect(created.version).toMatchObject({ id: 'v1', name: 'Before the store', auto: false });
    const post = server.calls.find((c) => c.method === 'POST' && c.url.endsWith('/versions'));
    expect(post.body).toMatchObject({ name: 'Before the store', kind: 'named', revision: 7 });
    expect(post.body.layout.rooms).toHaveLength(1);

    editor.addRoom(STORE);
    await saveNow();
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(2);

    const list = await listVersions(AHDUS_COMPANY, SITE);
    expect(list).toEqual([expect.objectContaining({ id: 'v1', name: 'Before the store', version: 7, created_at: '2026-10-31T10:00:00Z' })]);

    const restored = await restoreVersion(AHDUS_COMPANY, SITE, 'v1', editor);
    expect(restored.ok).toBe(true);
    expect(server.calls.at(-1)).toMatchObject({ method: 'POST', url: `/api/workplace/sites/${SITE}/versions/v1/restore` });
    expect(_getRevision()).toBe(server.revision);
    expect(Object.values(useWorkspaceStore.getState().rooms).map((r) => r.name)).toEqual(['Office']);

    editor.undo();
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(2);
    // Undo is a change like any other: saved over the restored draft without a conflict
    expect((await saveNow()).ok).toBe(true);
    expect(server.draft.rooms).toHaveLength(2);
  });

  it('restoring a missing version says so', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    expect(await restoreVersion(AHDUS_COMPANY, SITE, 'nope', createEditorHistory())).toEqual({ ok: false, error: 'Version not found' });
  });

  it('publish saves pending changes first, then publishes that revision', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    createEditorHistory().addRoom(STORE);
    expect(await publishLayout()).toEqual({ ok: true });
    const [put, pub] = server.calls.slice(-2);
    expect(put.method).toBe('PUT');
    expect(pub).toMatchObject({ method: 'POST', url: `/api/workplace/sites/${SITE}/publish`, body: { expectedRevision: 8 } });
    expect(server.published.rooms).toHaveLength(2);
  });

  it('publish refused by the server: the reason comes back', async () => {
    await loadWorkspace(AHDUS_COMPANY, SITE);
    server.answer['POST /publish'] = 403;
    expect(await publishLayout()).toMatchObject({ ok: false, error: AHDUS_NOT_ALLOWED });
  });

  it('the site comes from ?site= in the address', () => {
    expect(siteFromUrl('?site=hq-2')).toBe('hq-2');
    expect(siteFromUrl('?other=1')).toBe(null);
    expect(siteFromUrl('?site=')).toBe(null);
  });
});

describe('publishLayout without VITE_LAYOUT_BACKEND=ahdus', () => {
  it('is refused and makes no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await publishLayout()).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
