import { describe, it, expect, vi } from 'vitest';
import { parseManifest, readManifest, resolvePeople, DEFAULT_HEIGHT, MAX_TEXT } from '../characterManifest';

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
