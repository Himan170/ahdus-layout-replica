import { describe, it, expect, vi } from 'vitest';
import {
  parseManifest, readManifest, resolvePeople, resolvePlayer, walkClipUrlOf, DEFAULT_HEIGHT, MAX_TEXT,
} from '../characterManifest';

const BASE = 'https://ahdus.example/frontend/character/manifest.json';

describe('parseManifest', () => {
  it('resolves urls against the manifest, with rig and height', () => {
    const { characters, problems } = parseManifest({
      'mixamo:aj-v1': { url: 'office/aj.glb', rig: 'mixamo', height: 1.8 },
      'ahdus-human:studio-v1': { url: '/frontend/character/office/victoria.glb', rig: 'ue', height: 1.68 },
      'mixamo:claire-v1': { url: 'https://cdn.example/claire.glb' },
    }, BASE);
    expect(problems).toEqual([]);
    expect(characters.get('mixamo:aj-v1')).toEqual({ url: 'https://ahdus.example/frontend/character/office/aj.glb', rig: 'mixamo', height: 1.8 });
    expect(characters.get('ahdus-human:studio-v1')).toMatchObject({ url: 'https://ahdus.example/frontend/character/office/victoria.glb', rig: 'ue' });
    expect(characters.get('mixamo:claire-v1')).toEqual({ url: 'https://cdn.example/claire.glb', rig: 'mixamo', height: DEFAULT_HEIGHT });
  });

  it('leaves out unusable entries and says why', () => {
    const { characters, problems } = parseManifest({
      a: { url: '' }, b: null, c: { url: 'javascript:alert(1)' }, d: { url: 'x.glb', rig: 'blender', height: 9 },
    }, BASE);
    expect([...characters.keys()]).toEqual(['d']);
    expect(characters.get('d')).toMatchObject({ rig: 'mixamo', height: DEFAULT_HEIGHT });
    expect(problems).toHaveLength(4);
    expect(parseManifest([], BASE).problems).toHaveLength(1);
    expect(parseManifest('nope').characters.size).toBe(0);
  });
});

describe('readManifest', () => {
  it('fetches manifestUrl with the page cookies and headers', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ a: { url: 'a.glb' } }) }));
    const { characters } = await readManifest({ manifestUrl: '/chars/manifest.json' }, {
      fetch, headers: { Authorization: 'Bearer t' }, pageUrl: 'https://site.example/3d-model.html',
    });
    expect(fetch).toHaveBeenCalledWith('https://site.example/chars/manifest.json', expect.objectContaining({ credentials: 'include', headers: { Authorization: 'Bearer t' } }));
    expect(characters.get('a').url).toBe('https://site.example/chars/a.glb');
  });

  it('takes the manifest itself, or none', async () => {
    const fetch = vi.fn();
    expect((await readManifest({ manifest: { a: { url: 'a.glb' } } }, { fetch, pageUrl: 'https://s.example/p/' })).characters.get('a').url)
      .toBe('https://s.example/p/a.glb');
    expect((await readManifest(undefined, { fetch })).characters.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails with a short message', async () => {
    const notFound = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(readManifest({ manifestUrl: 'https://s.example/m.json' }, { fetch: notFound })).rejects.toThrow('(HTTP 404)');
    const html = vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }));
    await expect(readManifest({ manifestUrl: 'https://s.example/m.json' }, { fetch: html })).rejects.toThrow('did not send JSON');
  });
});

describe('resolvePeople', () => {
  const characters = parseManifest({ 'mixamo:aj-v1': { url: 'aj.glb', height: 1.8 } }, BASE).characters;

  it('gives each person their character from the manifest; unknown or null = simple figure', () => {
    const people = resolvePeople([
      { personId: 'u1', deskId: 'obj_1', name: 'Asha Rao', department: 'Engineering', assetReference: 'mixamo:aj-v1' },
      { personId: 'u2', deskId: 'obj_2', name: 'Ben', department: 'HR', assetReference: 'mixamo:gone-v9' },
      { personId: 'u3', deskId: 'obj_3', name: 'Chen', department: 'HR', assetReference: null },
    ], characters);
    expect(people[0].character).toEqual({ url: 'https://ahdus.example/frontend/character/aj.glb', rig: 'mixamo', height: 1.8 });
    expect(people[1].character).toBeNull();
    expect(people[2].character).toBeNull();
    // "Choose your character" is for people who never chose (not for a file the manifest lacks)
    expect(people.map((p) => p.characterChosen)).toEqual([true, true, false]);
  });

  it('keeps only the fields the view needs, as plain text', () => {
    const [p] = resolvePeople([{
      personId: 7, deskId: 'obj_1', name: '<b>Asha</b>', department: 'x'.repeat(500), email: 'asha@example.com', userId: 99,
    }], characters);
    expect(p).toEqual({ personId: '7', deskId: 'obj_1', name: '<b>Asha</b>', department: 'x'.repeat(MAX_TEXT), character: null, characterChosen: false });
    expect(JSON.stringify(p)).not.toContain('example.com');
  });

  it('leaves out people with no desk or id, and refuses a non-list', () => {
    expect(resolvePeople([{ personId: 'a' }, { deskId: 'd' }, null], characters)).toEqual([]);
    expect(() => resolvePeople('nope', characters)).toThrow(TypeError);
  });
});

describe('walking as yourself: the player and the walk clip', () => {
  const { characters } = parseManifest({
    'mixamo:aj-v1': { url: 'office/aj.glb', height: 1.8 },
    'ue:victoria-v1': { url: 'office/victoria.glb', rig: 'ue', height: 1.68, walk: false },
  }, 'https://ahdus.example/frontend/workplace/characters.json');

  it('"walk": false is kept for a character the clip doesn\'t fit; a wrong value is reported', () => {
    expect(characters.get('ue:victoria-v1')).toMatchObject({ rig: 'ue', walk: false });
    expect(characters.get('mixamo:aj-v1').walk).toBeUndefined();
    expect(parseManifest({ a: { url: 'https://x/a.glb', walk: 'no' } }).problems).toEqual(['a: "walk" must be true or false']);
    // people at desks get the file only (url, rig, height)
    const [p] = resolvePeople([{ personId: 'u1', deskId: 'd1', assetReference: 'ue:victoria-v1' }], characters);
    expect(Object.keys(p.character)).toEqual(['url', 'rig', 'height']);
  });

  it('the player: their character from the manifest; unknown or none = the simple figure', () => {
    expect(resolvePlayer({ personId: 7, assetReference: 'mixamo:aj-v1' }, characters)).toEqual({
      personId: '7', walk: true,
      character: { url: 'https://ahdus.example/frontend/workplace/office/aj.glb', rig: 'mixamo', height: 1.8 },
    });
    expect(resolvePlayer({ personId: 'u2', assetReference: 'ue:victoria-v1' }, characters)).toMatchObject({ walk: false });
    expect(resolvePlayer({ personId: 'u3', assetReference: 'mixamo:not-there' }, characters)).toEqual({ personId: 'u3', character: null, walk: true });
    expect(resolvePlayer({ personId: 'u4', assetReference: null }, characters)).toEqual({ personId: 'u4', character: null, walk: true });
    // the manifest not read yet: the person only
    expect(resolvePlayer({ personId: 'u1', assetReference: 'mixamo:aj-v1' }, new Map())).toEqual({ personId: 'u1', character: null, walk: true });
    expect(resolvePlayer({ assetReference: 'mixamo:aj-v1' }, characters)?.character?.rig).toBe('mixamo'); // no seat: still walks as them
    expect(resolvePlayer(null, characters)).toBeNull();
    expect(resolvePlayer({ personId: '' }, characters)).toBeNull();
  });

  it('walkClipUrl: relative to the page, http(s) only', () => {
    const page = 'https://ahdus.example/3d-model.html';
    expect(walkClipUrlOf({ walkClipUrl: '/frontend/character/office/walk.glb' }, page)).toBe('https://ahdus.example/frontend/character/office/walk.glb');
    expect(walkClipUrlOf({ walkClipUrl: 'javascript:alert(1)' }, page)).toBeNull();
    expect(walkClipUrlOf({ walkClipUrl: '  ' }, page)).toBeNull();
    expect(walkClipUrlOf(undefined, page)).toBeNull();
  });
});
