/**
 * embed/characterManifest.js — the pure parts of the embed's people
 * (mount option `characters`, handle.setPeople): reading the character
 * manifest and turning the page's list of people into what the viewer draws.
 * No DOM, no Babylon (tests: embed/__tests__/characterManifest.test.js).
 *
 * The manifest (JSON, served by AHDUS) maps each character's asset reference
 * to its file:
 *   { "mixamo:aj-v1": { "url": "office/aj.glb", "rig": "mixamo", "height": 1.78 }, … }
 * url: relative to the manifest's own address (or absolute); rig: 'mixamo'
 * (default) or 'ue' (Unreal-style bone names); height in m (default 1.75).
 */

export const DEFAULT_HEIGHT = 1.75;
const MIN_HEIGHT = 1;
const MAX_HEIGHT = 2.3;
/** Names and departments are cut to this many characters. */
export const MAX_TEXT = 120;

/**
 * A manifest as a Map assetReference → { url, rig, height }. Entries that
 * aren't usable are left out (listed in `problems`).
 * @param {unknown} data
 * @param {string} [baseUrl] where the manifest came from (relative urls are resolved against it)
 * @returns {{ characters: Map<string, { url: string, rig: 'mixamo' | 'ue', height: number }>, problems: string[] }}
 */
export function parseManifest(data, baseUrl) {
  const characters = new Map();
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { characters, problems: ['The character manifest is not a JSON object'] };
  }
  for (const [ref, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string' || !entry.url.trim()) {
      problems.push(`${ref}: no url`);
      continue;
    }
    let url;
    try {
      url = baseUrl ? new URL(entry.url, baseUrl).href : new URL(entry.url).href;
    } catch {
      problems.push(`${ref}: bad url "${entry.url}"`);
      continue;
    }
    if (!/^https?:/.test(url)) {
      problems.push(`${ref}: only http(s) urls`);
      continue;
    }
    if (entry.rig !== undefined && entry.rig !== 'mixamo' && entry.rig !== 'ue') problems.push(`${ref}: unknown rig "${entry.rig}" (using mixamo)`);
    const h = Number(entry.height);
    characters.set(ref, {
      url,
      rig: entry.rig === 'ue' ? 'ue' : 'mixamo',
      height: Number.isFinite(h) && h >= MIN_HEIGHT && h <= MAX_HEIGHT ? h : DEFAULT_HEIGHT,
    });
  }
  return { characters, problems };
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
 * their `assetReference`; unknown or null = the neutral simple figure. Only
 * these fields are kept (no email or anything else reaches the 3D view).
 * People with no personId or deskId are left out.
 * @param {unknown[]} list
 * @param {Map<string, object>} characters
 */
export function resolvePeople(list, characters) {
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
      character: (ref && characters.get(ref)) || null,
      characterChosen: ref !== null,
    });
  }
  return out;
}
