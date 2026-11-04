// Seats in Workplace Studio inside AHDUS (ahdusBackend.js: getMe, listSeats, setSeat, removeSeat, findPeople).
// fetch is mocked: each test answers the calls it expects.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getMe, listSeats, setSeat, removeSeat, findPeople, AHDUS_NOT_ALLOWED } from '../ahdusBackend';

const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
let calls;

function answer(fn) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers };
    calls.push(call);
    return fn(call);
  }));
}

beforeEach(() => {
  const storage = new Map([['authToken', 'token-abc']]);
  vi.stubGlobal('localStorage', { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('getMe', () => {
  it('says whether I may edit and appoint (Admin and HR), with the login token', async () => {
    answer(() => json(200, { canEdit: true, canAppoint: false }));
    expect(await getMe()).toEqual({ ok: true, me: { canEdit: true, canAppoint: false } });
    expect(calls[0].url).toBe('/api/workplace/me');
    expect(calls[0].headers.Authorization).toBe('Bearer token-abc');
  });
});

describe('listSeats', () => {
  it('keeps only what Studio shows (never email)', async () => {
    answer(() => json(200, [
      { deskId: 'obj_1', userId: 3, name: 'Asha', department: 'Design', assetReference: 'mixamo:aj-v1', hasDesk: true, email: 'a@x' },
      { deskId: 'obj_9', userId: 4, name: 'Ravi', department: null, assetReference: null, hasDesk: false },
      { deskId: null, userId: 5 },
    ]));
    const res = await listSeats('site 1');
    expect(calls[0].url).toBe('/api/workplace/sites/site%201/seats');
    expect(res.seats).toEqual([
      { deskId: 'obj_1', userId: 3, name: 'Asha', department: 'Design', assetReference: 'mixamo:aj-v1', hasDesk: true },
      { deskId: 'obj_9', userId: 4, name: 'Ravi', department: '', assetReference: null, hasDesk: false },
    ]);
    expect(JSON.stringify(res)).not.toContain('a@x');
  });
});

describe('setSeat / removeSeat', () => {
  it('PUTs the person to the desk and returns the seat', async () => {
    answer(() => json(200, { deskId: 'obj_1', userId: 3, name: 'Asha', department: 'Design', assetReference: null, hasDesk: false }));
    const res = await setSeat('1', 'obj_1', 3);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/workplace/sites/1/seats/obj_1', body: { userId: 3 } });
    expect(res).toEqual({ ok: true, seat: { deskId: 'obj_1', userId: 3, name: 'Asha', department: 'Design', assetReference: null, hasDesk: false } });
  });
  it('says why it was refused', async () => {
    answer(() => json(403, { detail: 'Only Admin and HR' }));
    expect(await setSeat('1', 'obj_1', 3)).toMatchObject({ ok: false, forbidden: true, error: AHDUS_NOT_ALLOWED });
    answer(() => json(404, { detail: 'There is no desk with this id in this workplace' }));
    expect(await setSeat('1', 'obj_1', 3)).toMatchObject({ ok: false, error: 'This desk or person was not found' });
  });
  it('DELETE: nobody sits there any more (already nobody = fine)', async () => {
    answer(() => json(204, null));
    expect(await removeSeat('1', 'obj_1')).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: '/api/workplace/sites/1/seats/obj_1' });
    answer(() => json(404, { detail: 'Nobody sits at this desk' }));
    expect(await removeSeat('1', 'obj_1')).toEqual({ ok: true });
    answer(() => json(500, null));
    expect((await removeSeat('1', 'obj_1')).ok).toBe(false);
  });
});

describe('findPeople', () => {
  it('asks only for a non-empty search, encoded', async () => {
    answer(() => json(200, [{ id: 3, name: 'Asha', email: 'asha@x', department: 'Design' }]));
    expect(await findPeople('  ')).toEqual({ ok: true, people: [] });
    expect(calls).toHaveLength(0);
    const res = await findPeople(' as&ha ');
    expect(calls[0].url).toBe('/api/workplace/people?q=as%26ha');
    expect(res.people).toEqual([{ id: 3, name: 'Asha', department: 'Design', email: 'asha@x' }]);
  });
  it('a cancelled search is not a connection problem', async () => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }));
    expect(await findPeople('as')).toMatchObject({ ok: false, aborted: true });
  });
});
