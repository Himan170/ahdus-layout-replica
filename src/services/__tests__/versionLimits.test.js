// Version history limits: caps per layout, a full storage never blocks saving the layout,
// storageUse() counts versions. No Supabase here (the prototype backend is off).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVersion,
  listVersions,
  saveNow,
  storageUse,
  capVersions,
  AUTO_VERSION_EVERY,
  MAX_AUTO_VERSIONS,
  MAX_NAMED_VERSIONS,
  _setRevisionForTesting,
  _resetAutoVersionForTesting,
} from '../apiService';
import { useWorkspaceStore } from '../../store/workspaceStore';

const COMPANY = 'company_1';
const LAYOUT = 'layout_1';
const VERSIONS = `dwtwin_${COMPANY}_${LAYOUT}_versions`;

/** A localStorage that holds at most `limit` characters (keys + values), like a browser's quota. */
function fakeStorage(limit = Infinity) {
  const map = new Map();
  const size = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    limit,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      const value = String(v);
      const next = size() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + value.length;
      if (next > this.limit) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, value);
    },
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const saved = () => JSON.parse(localStorage.getItem(VERSIONS) ?? '[]');
const v = (name, auto, version) => ({ id: `v${version}`, name, auto, version, snapshot: {}, created_at: new Date(version * 1000).toISOString() });

describe('version history limits', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
    useWorkspaceStore.getState().resetWorkspace();
    useWorkspaceStore.getState().setTenant(COMPANY, LAYOUT, 'HQ', 1);
    _setRevisionForTesting(0);
    _resetAutoVersionForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('capVersions keeps the newest 20 auto checkpoints and 30 named versions', () => {
    const list = [];
    for (let i = 100; i > 0; i--) list.push(v(i % 2 ? 'Auto-save checkpoint' : `Named ${i}`, i % 2 === 1, i));
    const kept = capVersions(list);
    expect(kept.filter((x) => x.auto)).toHaveLength(MAX_AUTO_VERSIONS);
    expect(kept.filter((x) => !x.auto)).toHaveLength(MAX_NAMED_VERSIONS);
    expect(kept[0].version).toBe(100); // newest first, order kept
    expect(Math.min(...kept.filter((x) => x.auto).map((x) => x.version))).toBe(61);
  });

  it('old saves without the auto flag count as auto by their name', () => {
    const list = [];
    for (let i = 30; i > 0; i--) list.push({ id: `v${i}`, name: 'Auto-save checkpoint', version: i });
    expect(capVersions(list)).toHaveLength(MAX_AUTO_VERSIONS);
  });

  it('a 31st named version drops the oldest named one; auto ones are kept', async () => {
    localStorage.setItem(VERSIONS, JSON.stringify([v('Auto-save checkpoint', true, 1)]));
    for (let i = 1; i <= 31; i++) {
      const res = await createVersion(`Plan ${i}`);
      expect(res.ok).toBe(true);
    }
    const list = saved();
    expect(list.filter((x) => !x.auto)).toHaveLength(MAX_NAMED_VERSIONS);
    expect(list.some((x) => x.name === 'Plan 1')).toBe(false);
    expect(list[0].name).toBe('Plan 31');
    expect(list.filter((x) => x.auto)).toHaveLength(1);
  });

  it('auto checkpoints are capped at 20 (oldest dropped)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let t = Date.UTC(2026, 9, 25, 9, 0, 0);
    vi.setSystemTime(t);
    for (let i = 0; i < 26; i++) {
      useWorkspaceStore.setState({ isDirty: true });
      await saveNow();
      await new Promise((r) => setTimeout(r, 0));
      t += AUTO_VERSION_EVERY;
      vi.setSystemTime(t);
    }
    const autos = saved().filter((x) => x.auto);
    expect(autos).toHaveLength(MAX_AUTO_VERSIONS);
    expect(autos[0].version).toBeGreaterThan(autos[autos.length - 1].version);
  });

  it('storage full: old auto checkpoints are dropped so the layout still saves', async () => {
    const big = 'x'.repeat(2000);
    const list = [];
    for (let i = 10; i > 0; i--) list.push({ ...v(i <= 8 ? 'Auto-save checkpoint' : `Named ${i}`, i <= 8, i), snapshot: { big } });
    localStorage.setItem(VERSIONS, JSON.stringify(list));
    useWorkspaceStore.getState().addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4, floor: 0, name: 'x'.repeat(6000) });
    localStorage.limit = storageUse().used + 1500; // the room's ~6 KB do not fit without freeing space

    const res = await saveNow();
    expect(res.ok).toBe(true);
    expect(useWorkspaceStore.getState().saveError).toBeFalsy();
    expect(JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_${LAYOUT}`)).rooms).toHaveLength(1);
    const left = saved();
    expect(left.filter((x) => !x.auto)).toHaveLength(2); // named versions are never dropped for space
    const autosLeft = left.filter((x) => x.auto).map((x) => x.version);
    expect(autosLeft.length).toBeGreaterThan(0);
    expect(autosLeft.length).toBeLessThan(8);
    expect(Math.min(...autosLeft)).toBe(8 - autosLeft.length + 1); // the oldest ones went first
  });

  it('storage full with nothing to drop: the layout save fails with the usual message, a version just fails', async () => {
    useWorkspaceStore.getState().addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4, floor: 0 });
    localStorage.limit = 10;
    const res = await saveNow();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no space left/);

    const version = await createVersion('Too big');
    expect(version).toEqual({ ok: false, error: 'No space left for another version' });
  });

  it('a version that does not fit never makes the layout save fail', async () => {
    useWorkspaceStore.getState().addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4, floor: 0 });
    expect((await saveNow()).ok).toBe(true);
    // room for the layout to grow a little, but not for a whole snapshot
    localStorage.limit = storageUse().used + 300;
    const version = await createVersion('No room');
    expect(version.ok).toBe(false);
    useWorkspaceStore.getState().renameFloor(0, 'Ground');
    expect((await saveNow()).ok).toBe(true);
    expect(await listVersions(COMPANY, LAYOUT)).toHaveLength(0);
  });

  it('storageUse() counts versions too (the 80 % warning)', async () => {
    const before = storageUse().used;
    localStorage.setItem(VERSIONS, JSON.stringify([{ ...v('Big', false, 1), snapshot: { big: 'x'.repeat(4_100_000) } }]));
    const use = storageUse();
    expect(use.used - before).toBeGreaterThan(4_100_000);
    expect(use.nearlyFull).toBe(true);

    useWorkspaceStore.setState({ isDirty: true });
    await saveNow();
    expect(useWorkspaceStore.getState().storageNearlyFull).toBe(true);
  });
});
