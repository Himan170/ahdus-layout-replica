import { describe, it, expect, vi } from 'vitest';
import {
  parseManifest, readManifest, resolvePeople, resolvePlayer, walkClipUrlOf, charactersOf, idHash, neutralFor,
  DEFAULT_HEIGHT, MAX_TEXT,
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

describe('manifest version 2 (v0.16.0)', () => {
  const URL2 = 'https://ahdus.example/frontend/workplace/characters.json';
  const v2 = {
    version: 2,
    groups: { imported: false, rocketbox: true },
    clips: { female: { url: 'office/clips-female.glb' }, male: { url: 'office/clips-male.glb' } },
    neutral: ['rocketbox:aisha-v1', 'rocketbox:andre-v1', 'imported:nadia-v1'],
    characters: {
      'rocketbox:aisha-v1': { url: 'office/aisha.glb', height: 1.74, gender: 'female', group: 'rocketbox', outfit: 'rocketbox', clips: 'female' },
      'rocketbox:andre-v1': { url: 'office/andre.glb', height: 1.81, gender: 'male', group: 'rocketbox', outfit: 'rocketbox', clips: 'male' },
      'imported:nadia-v1': { url: 'office/nadia.glb', height: 1.76, gender: 'female', group: 'imported' },
      'mixamo:aj-v1': { url: 'office/aj.glb', height: 1.8 },
    },
  };

  it('reads characters, clip sets and the neutral set; a group switched off is left out', () => {
    const m = parseManifest(v2, URL2);
    expect(m.version).toBe(2);
    expect(m.off).toEqual(['imported']);
    expect([...m.characters.keys()]).toEqual(['rocketbox:aisha-v1', 'rocketbox:andre-v1', 'mixamo:aj-v1']);
    expect(m.characters.get('rocketbox:aisha-v1')).toEqual({
      url: 'https://ahdus.example/frontend/workplace/office/aisha.glb', rig: 'mixamo', height: 1.74, gender: 'female',
      group: 'rocketbox', outfit: 'rocketbox', clips: 'https://ahdus.example/frontend/workplace/office/clips-female.glb',
    });
    expect(m.clips.get('male')).toEqual({ url: 'https://ahdus.example/frontend/workplace/office/clips-male.glb' });
    // a neutral character of a group switched off is not in the set (and is reported)
    expect(m.neutral).toEqual(['rocketbox:aisha-v1', 'rocketbox:andre-v1']);
    expect(m.problems).toEqual(['neutral: imported:nadia-v1 is not a character here']);
    // switched on again: one flag
    const on = parseManifest({ ...v2, groups: { imported: true } }, URL2);
    expect(on.characters.has('imported:nadia-v1')).toBe(true);
    expect(on.neutral).toHaveLength(3);
  });

  it('says what is wrong and keeps the rest', () => {
    const m = parseManifest({
      version: 2,
      groups: { x: 'no' },
      clips: { bad: { url: 'javascript:1' } },
      neutral: 'all',
      characters: {
        a: { url: 'a.glb', gender: 'robot', outfit: 'toga', clips: 'bad' },
        b: { url: '' },
      },
    }, URL2);
    expect([...m.characters.keys()]).toEqual(['a']);
    expect(m.characters.get('a')).toEqual({ url: 'https://ahdus.example/frontend/workplace/a.glb', rig: 'mixamo', height: DEFAULT_HEIGHT });
    expect(m.problems).toEqual([
      'groups.x: must be true or false', 'clips.bad: only http(s) urls', 'a: unknown gender "robot"',
      'a: unknown outfit "toga" (shown as it is)', 'a: no clip set "bad"', 'b: no url', '"neutral" must be a list of asset references',
    ]);
    expect(parseManifest({ version: 2 }).problems).toEqual(['"characters" must be an object']);
    expect(parseManifest({ version: 3, a: { url: 'https://x/a.glb' } }).problems).toEqual(['unknown manifest version 3 (read as version 1)']);
  });

  it('a version 1 manifest reads as before (no clip sets, no neutral set)', () => {
    const m = parseManifest({ 'mixamo:aj-v1': { url: 'aj.glb' } }, BASE);
    expect(m).toMatchObject({ version: 1, neutral: [], off: [], problems: [] });
    expect(m.clips.size).toBe(0);
  });

  it('people and the player get gender, outfit and clips; the resolvers take the manifest or its Map', () => {
    const m = parseManifest(v2, URL2);
    const [p] = resolvePeople([{ personId: 'u1', deskId: 'd1', assetReference: 'rocketbox:andre-v1' }], m);
    expect(Object.keys(p.character)).toEqual(['url', 'rig', 'height', 'gender', 'outfit', 'clips']);
    expect(p.character.clips).toBe('https://ahdus.example/frontend/workplace/office/clips-male.glb');
    // no group in what the view gets
    expect(p.character.group).toBeUndefined();
    expect(resolvePlayer({ personId: 'u1', assetReference: 'rocketbox:aisha-v1' }, m).character.outfit).toBe('rocketbox');
    // a character switched off is unknown: their neutral character (aisha or andre here)
    expect(resolvePeople([{ personId: 'u2', deskId: 'd2', assetReference: 'imported:nadia-v1' }], m)[0].character.url).toMatch(/(aisha|andre).glb$/);
    expect(charactersOf(m)).toBe(m.characters);
    expect(charactersOf(m.characters)).toBe(m.characters);
    expect(charactersOf(null).size).toBe(0);
  });
});

describe('clothing (v0.16.0)', () => {
  it('people and the player keep their Wardrobe clothing, checked; none given = no field', () => {
    const [a, b] = resolvePeople([
      { personId: 'u1', deskId: 'd1', clothing: { pantsColor: 'blue', upperBody: 'shirt', upperColor: '#123ABC', note: 'x' } },
      { personId: 'u2', deskId: 'd2', clothing: 'formal' },
    ], new Map());
    expect(a.clothing).toEqual({ schemaVersion: 1, pantsColor: 'blue', upperBody: 'shirt', upperColor: '#123abc' });
    expect('clothing' in b).toBe(false);
    expect(resolvePlayer({ personId: 'u1', clothing: { upperBody: 'tshirt' } }, new Map()).clothing)
      .toEqual({ schemaVersion: 1, pantsColor: 'black', upperBody: 'tshirt', upperColor: null });
  });
});

describe('the even default: the neutral set (v0.16.0)', () => {
  const NEUTRAL = ['rocketbox:aisha-v1', 'rocketbox:emma-v1', 'rocketbox:olivia-v1', 'rocketbox:andre-v1', 'rocketbox:kenji-v1', 'rocketbox:carlos-v1'];
  const m = parseManifest({
    version: 2,
    groups: { imported: false },
    neutral: NEUTRAL,
    characters: {
      ...Object.fromEntries(NEUTRAL.map((ref) => [ref, { url: `${ref.split(':')[1]}.glb`, outfit: 'rocketbox' }])),
      'rocketbox:mei-v1': { url: 'mei.glb', outfit: 'rocketbox' },
      'imported:nadia-v1': { url: 'nadia.glb', group: 'imported' },
    },
  }, BASE);

  it('the hash is fixed (the same person looks the same everywhere)', () => {
    expect(idHash('')).toBe(0x811c9dc5);
    expect(idHash('a')).toBe(0xe40c292c);
    expect(idHash('user_14')).toBe(idHash('user_14'));
    expect(neutralFor('user_14', m)).toBe(neutralFor('user_14', m));
  });

  it('evenly: 6,000 ids, each of the six about 1,000 times; women and men about half each', () => {
    const counts = Object.fromEntries(NEUTRAL.map((r) => [r, 0]));
    for (let i = 0; i < 6000; i++) counts[neutralFor(`user_${i}`, m)]++;
    for (const n of Object.values(counts)) expect(Math.abs(n - 1000)).toBeLessThan(100);
    const women = counts[NEUTRAL[0]] + counts[NEUTRAL[1]] + counts[NEUTRAL[2]];
    expect(Math.abs(women - 3000)).toBeLessThan(150);
  });

  it('never chose, unknown or switched off = their neutral character; a choice wins; v1 = the simple figure', () => {
    const people = resolvePeople([
      { personId: 'u1', deskId: 'd1', assetReference: null },
      { personId: 'u1', deskId: 'd2', assetReference: 'mixamo:gone-v9' },
      { personId: 'u1', deskId: 'd3', assetReference: 'imported:nadia-v1' },
      { personId: 'u1', deskId: 'd4', assetReference: 'rocketbox:mei-v1' },
    ], m);
    const mine = `https://ahdus.example/frontend/character/${neutralFor('u1', m).split(':')[1]}.glb`;
    expect(people.slice(0, 3).map((p) => p.character.url)).toEqual([mine, mine, mine]);
    expect(people[3].character.url).toBe('https://ahdus.example/frontend/character/mei.glb');
    // "Choose your character" still only for someone who never chose
    expect(people.map((p) => p.characterChosen)).toEqual([false, true, true, true]);
    expect(resolvePlayer({ personId: 'u1' }, m).character.url).toBe(mine); // you walk as you sit
    const v1 = parseManifest({ a: { url: 'a.glb' } }, BASE);
    expect(resolvePeople([{ personId: 'u1', deskId: 'd1' }], v1)[0].character).toBeNull();
    expect(neutralFor('u1', v1.characters)).toBeNull();
    expect(neutralFor('', m)).toBeNull();
  });
});
