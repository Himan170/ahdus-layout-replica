/**
 * embed/characterManifest.js — the pure parts of the embed's people
 * (mount option `characters`, handle.setPeople): reading the character
 * manifest and turning the page's list of people into what the viewer draws.
 * No DOM, no Babylon (tests: embed/__tests__/characterManifest.test.js).
 *
 * The manifest (JSON, served by AHDUS) maps each character's asset reference
 * to its file. Version 1 (a flat map, still read):
 *   { "mixamo:aj-v1": { "url": "office/aj.glb", "rig": "mixamo", "height": 1.78 }, … }
 * Version 2 (v0.16.0):
 *   { "version": 2,
 *     "groups": { "imported": false },                     // a group switched off: its characters are left out
 *     "clips": { "female": { "url": "clips-female.glb" } }, // animation-only files, shared by many characters
 *     "neutral": ["rocketbox:aisha-v1", …],                // the even default (part 5)
 *     "characters": { "rocketbox:aisha-v1": { "url": "…", "rig": "mixamo", "height": 1.74, "gender": "female",
 *                                             "group": "rocketbox", "outfit": "rocketbox", "clips": "female" } } }
 * url: relative to the manifest's own address (or absolute); rig: 'mixamo'
 * (default) or 'ue' (Unreal-style bone names); height in m (default 1.75);
 * "walk": false = walking through, this character doesn't use the walk clip
 * (it stands and slides), for a skeleton the clip doesn't fit. v2 only: gender
 * 'female' | 'male'; group (any name, for "groups"); outfit 'rocketbox' = the
 * file has the Rocketbox outfit parts (Body, Top_shirt, Trousers, Outfit_formal…);
 * clips = the name of one of "clips" (resolved to its url here).
 */

import { cleanClothing } from '../play/outfit';

export const DEFAULT_HEIGHT = 1.75;
const MIN_HEIGHT = 1;
const MAX_HEIGHT = 2.3;
/** Names and departments are cut to this many characters. */
export const MAX_TEXT = 120;
/** The outfit kinds a character file can have (play/outfit.js knows their parts). */
export const OUTFITS = Object.freeze(['rocketbox']);
const GENDERS = ['female', 'male'];

/** An http(s) url resolved against the manifest's address, or a problem. */
function resolveUrl(raw, baseUrl) {
  if (typeof raw !== 'string' || !raw.trim()) return { problem: 'no url' };
  let url;
  try {
    url = baseUrl ? new URL(raw, baseUrl).href : new URL(raw).href;
  } catch {
    return { problem: `bad url "${raw}"` };
  }
  if (!/^https?:/.test(url)) return { problem: 'only http(s) urls' };
  return { url };
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A manifest as { version, characters, clips, neutral, groups, problems }:
 * characters = Map assetReference → { url, rig, height, walk?, gender?, group?, outfit?, clips? } (clips = the clip
 * set's url); clips = Map name → { url }; neutral = the asset references of the neutral set that are in
 * `characters`; off = the names of the groups switched off. Entries that aren't usable are left out (listed in `problems`);
 * characters of a group switched off are left out too (not a problem).
 * @param {unknown} data
 * @param {string} [baseUrl] where the manifest came from (relative urls are resolved against it)
 */
export function parseManifest(data, baseUrl) {
  const characters = new Map();
  const clips = new Map();
  const problems = [];
  const out = { version: 1, characters, clips, neutral: [], off: [], problems };
  if (!isObject(data)) {
    problems.push('The character manifest is not a JSON object');
    return out;
  }
  const v2 = data.version === 2;
  if (data.version !== undefined && !v2 && typeof data.version === 'number') {
    problems.push(`unknown manifest version ${data.version} (read as version 1)`);
  }
  let entries = data;
  if (v2) {
    out.version = 2;
    if (!isObject(data.characters)) problems.push('"characters" must be an object');
    entries = isObject(data.characters) ? data.characters : {};
    if (data.groups !== undefined && !isObject(data.groups)) problems.push('"groups" must be an object');
    for (const [name, on] of Object.entries(isObject(data.groups) ? data.groups : {})) {
      if (typeof on !== 'boolean') problems.push(`groups.${name}: must be true or false`);
      else if (!on) out.off.push(name);
    }
    if (data.clips !== undefined && !isObject(data.clips)) problems.push('"clips" must be an object');
    for (const [name, set] of Object.entries(isObject(data.clips) ? data.clips : {})) {
      const r = resolveUrl(set?.url, baseUrl);
      if (r.problem) problems.push(`clips.${name}: ${r.problem}`);
      else clips.set(name, { url: r.url });
    }
  }
  for (const [ref, entry] of Object.entries(entries)) {
    if (!v2 && ref === 'version' && typeof entry === 'number') continue; // an unknown version, said above
    if (!isObject(entry)) {
      problems.push(`${ref}: no url`);
      continue;
    }
    if (v2 && typeof entry.group === 'string' && out.off.includes(entry.group)) continue;
    const r = resolveUrl(entry.url, baseUrl);
    if (r.problem) {
      problems.push(`${ref}: ${r.problem}`);
      continue;
    }
    if (entry.rig !== undefined && entry.rig !== 'mixamo' && entry.rig !== 'ue') problems.push(`${ref}: unknown rig "${entry.rig}" (using mixamo)`);
    const h = Number(entry.height);
    if (entry.walk !== undefined && typeof entry.walk !== 'boolean') problems.push(`${ref}: "walk" must be true or false`);
    const character = {
      url: r.url,
      rig: entry.rig === 'ue' ? 'ue' : 'mixamo',
      height: Number.isFinite(h) && h >= MIN_HEIGHT && h <= MAX_HEIGHT ? h : DEFAULT_HEIGHT,
      ...(entry.walk === false ? { walk: false } : {}),
    };
    if (v2) {
      if (entry.gender !== undefined) {
        if (GENDERS.includes(entry.gender)) character.gender = entry.gender;
        else problems.push(`${ref}: unknown gender "${entry.gender}"`);
      }
      if (typeof entry.group === 'string' && entry.group.trim()) character.group = entry.group.trim();
      if (entry.outfit !== undefined) {
        if (OUTFITS.includes(entry.outfit)) character.outfit = entry.outfit;
        else problems.push(`${ref}: unknown outfit "${entry.outfit}" (shown as it is)`);
      }
      if (entry.clips !== undefined) {
        const set = clips.get(entry.clips);
        if (set) character.clips = set.url;
        else problems.push(`${ref}: no clip set "${entry.clips}"`);
      }
    }
    characters.set(ref, character);
  }
  if (v2 && data.neutral !== undefined) {
    if (!Array.isArray(data.neutral)) problems.push('"neutral" must be a list of asset references');
    else {
      for (const ref of data.neutral) {
        if (typeof ref !== 'string') problems.push('neutral: asset references are text');
        else if (!characters.has(ref)) problems.push(`neutral: ${ref} is not a character here`);
        else if (!out.neutral.includes(ref)) out.neutral.push(ref);
      }
    }
  }
  return out;
}

/** The characters Map of a manifest (parseManifest's result) or the Map itself (as before v0.16.0). */
export function charactersOf(manifest) {
  if (manifest instanceof Map) return manifest;
  return manifest?.characters instanceof Map ? manifest.characters : new Map();
}

/**
 * A number from a person's id (FNV-1a, 32 bits): the same id = the same number on every page and device.
 * Never the name: who someone looks like must not be guessed from it.
 * @param {string} personId
 */
export function idHash(personId) {
  let h = 0x811c9dc5;
  const s = String(personId);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The neutral character of someone with none (never chose, a character the manifest doesn't have, or one of a
 * group switched off): one of the manifest's neutral set, picked evenly by their id (`idHash(personId) % n`).
 * null = no neutral set (a v1 manifest) or no id: the simple figure, as before.
 * @param {string | null} personId
 * @param {{ neutral?: string[], characters?: Map<string, object> } | Map<string, object>} manifest
 * @returns {string | null} its asset reference
 */
export function neutralFor(personId, manifest) {
  const set = manifest instanceof Map ? [] : (manifest?.neutral ?? []);
  if (!personId || !set.length) return null;
  return set[idHash(personId) % set.length];
}

/** A person's manifest entry: their own, else their neutral one (or null). */
function entryFor(ref, personId, manifest) {
  const characters = charactersOf(manifest);
  return (ref && characters.get(ref)) || characters.get(neutralFor(personId, manifest)) || null;
}

/**
 * The manifest of mount's `characters` option: `manifest` (the JSON itself),
 * else fetched from `manifestUrl` (with the page's cookies, plus `headers`).
 * No option = an empty manifest (everyone a simple figure). Throws if it
 * can't be fetched.
 * @param {{ manifestUrl?: string, manifest?: object } | undefined} option
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal, fetch?: typeof fetch, pageUrl?: string }} [io]
 */
export async function readManifest(option, { headers, signal, fetch: fetchFn = globalThis.fetch, pageUrl } = {}) {
  if (!option) return parseManifest({});
  if (option.manifest) return parseManifest(option.manifest, option.manifestUrl ?? pageUrl);
  if (!option.manifestUrl) return parseManifest({});
  const url = new URL(String(option.manifestUrl), pageUrl).href;
  let res;
  try {
    res = await fetchFn(url, { credentials: 'include', headers, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(`Could not load the character manifest from ${url}: ${err?.message ?? err}`, { cause: err });
  }
  if (!res.ok) throw new Error(`Could not load the character manifest from ${url} (HTTP ${res.status})`);
  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`${url} did not send JSON`, { cause: err });
  }
  return parseManifest(data, url);
}

const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, MAX_TEXT) : '');

/**
 * The page's people as the viewer draws them: { personId, deskId, name,
 * department, character }. A person's character comes from the manifest by
 * their `assetReference`; unknown, switched off or null = their neutral character (v2: neutralFor), else the
 * simple figure. Only
 * these fields are kept (no email or anything else reaches the 3D view).
 * People with no personId or deskId are left out.
 * @param {unknown[]} list
 * @param {Map<string, object> | { characters: Map<string, object> }} manifest parseManifest's result (or its Map)
 */
export function resolvePeople(list, manifest) {
  if (!Array.isArray(list)) throw new TypeError('setPeople(list): list must be an array of { personId, deskId, name, department, assetReference }');
  const out = [];
  for (const p of list) {
    const personId = text(p?.personId);
    const deskId = text(p?.deskId);
    if (!personId || !deskId) continue;
    const ref = typeof p.assetReference === 'string' ? p.assetReference : null;
    out.push({
      personId,
      deskId,
      name: text(p.name),
      department: text(p.department),
      character: fileOf(entryFor(ref, personId, manifest)),
      characterChosen: ref !== null,
      ...clothingOf(p.clothing),
    });
  }
  return out;
}

/**
 * A manifest entry as the viewer draws it: { url, rig, height } and, from a v2 manifest, gender / outfit / clips
 * (the clip set's url) when it has them (no other fields), or null.
 */
function fileOf(entry) {
  if (!entry) return null;
  const file = { url: entry.url, rig: entry.rig, height: entry.height };
  for (const key of ['gender', 'outfit', 'clips']) if (entry[key]) file[key] = entry[key];
  return file;
}

/**
 * The person looking (mount's `player`, setPlayer): { personId, assetReference }
 * → what the viewer takes: { personId, character, walk }. Walking through, they
 * are their character from the manifest (unknown / null = their neutral one, as at their desk, else the simple figure);
 * `walk` false if the manifest says so. null = nobody given.
 * @param {unknown} value
 * @param {Map<string, object> | { characters: Map<string, object> }} manifest parseManifest's result (or its Map)
 */
export function resolvePlayer(value, manifest) {
  if (!value || typeof value !== 'object') return null;
  const personId = text(value.personId) || null;
  const ref = typeof value.assetReference === 'string' ? value.assetReference : null;
  const entry = entryFor(ref, personId, manifest);
  if (!personId && !entry) return null;
  return { personId, character: fileOf(entry), walk: entry?.walk !== false, ...clothingOf(value.clothing) };
}

/** { clothing } when the page gave usable clothing (play/outfit.js cleanClothing), else nothing. */
function clothingOf(value) {
  const clothing = cleanClothing(value);
  return clothing ? { clothing } : {};
}

/**
 * The walk clip of mount's `characters` option (`walkClipUrl`, relative to the
 * page), or null: none given, or not http(s).
 * @param {{ walkClipUrl?: string } | undefined} option
 * @param {string} pageUrl
 */
export function walkClipUrlOf(option, pageUrl) {
  const raw = option?.walkClipUrl;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim(), pageUrl).href;
    return /^https?:/.test(url) ? url : null;
  } catch {
    return null;
  }
}
