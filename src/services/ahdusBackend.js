/**
 * ahdusBackend.js
 *
 * The AHDUS save backend (VITE_LAYOUT_BACKEND=ahdus): Workplace Studio inside
 * AHDUS loads and saves a site's DRAFT layout through the AHDUS API (FastAPI,
 * same origin as the AHDUS pages). Used only by apiService.js, and only when
 * backendFlags.isAhdusBackendOn(); the default build never calls anything here.
 *
 * Login: AHDUS keeps its token in localStorage 'authToken'; every request sends
 * it as "Authorization: Bearer <token>". The server decides who may edit.
 *
 * API (private-docs/WORKPLACE_INTEGRATION_PLAN.md 4.2). Layouts travel as v2 JSON
 * (src/engine/model); the store keeps v1, so this file converts both ways:
 *   GET  /api/workplace/sites/{site}/layout?state=draft  → { layout (v2 | null), revision, name? }
 *   PUT  /api/workplace/sites/{site}/layout               { layout, expectedRevision } → { revision }
 *        409 = someone saved in between; 401 = the login expired; 403 = not allowed to edit
 *   GET  /api/workplace/sites/{site}/versions             → [{ id, revision, name, kind, createdAt, createdBy }]
 *                                                           (or { versions: [...] })
 *   POST /api/workplace/sites/{site}/versions             { name, kind: 'auto' | 'named', layout, revision } → the version
 *   POST /api/workplace/sites/{site}/versions/{v}/restore → { layout, revision } (the draft is now that version)
 *   POST /api/workplace/sites/{site}/publish              { expectedRevision } → the draft becomes the published layout
 *
 * Every function returns { ok: true, … } or { ok: false, error, conflict?, loginExpired?, forbidden?, notFound? }; none throws.
 */

import { loadLayout as parseLayout, toV1, mergeV2Extras } from '../engine/model';

/** The store's companyId for an AHDUS site (the store's layoutId is the site id). */
export const AHDUS_COMPANY = 'ahdus';
/** Where "Back to AHDUS" goes. */
export const AHDUS_HOME = '/3d-model.html';
export const AHDUS_CHANGED = 'This workplace was changed by someone else';
export const AHDUS_NOT_ALLOWED = 'you are not allowed to edit this workplace';
export const AHDUS_LOGIN_EXPIRED = 'Your AHDUS login has expired. Log in again.';
const NO_CONNECTION = 'AHDUS could not be reached';
const NOT_FOUND = 'This workplace does not exist';
/** fetch's keepalive (a save still arrives when the tab closes) takes bodies up to 64 KB. */
const KEEPALIVE_LIMIT = 60_000;

/** The site to open: ?site=<id> in the page's address, or null. */
export function siteFromUrl(search = typeof window !== 'undefined' ? window.location.search : '') {
  const site = new URLSearchParams(search).get('site');
  return site && site.trim() ? site.trim() : null;
}

function sitePath(site, rest = '') {
  return `/api/workplace/sites/${encodeURIComponent(site)}${rest}`;
}

function authHeaders() {
  let token = null;
  try { token = localStorage.getItem('authToken'); } catch { /* storage blocked: no token */ }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** One API call. @returns {{ ok, status, data?, error?, conflict?, loginExpired?, forbidden?, notFound? }} */
async function request(method, path, body) {
  const headers = { Accept: 'application/json', ...authHeaders() };
  const init = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    if (init.body.length < KEEPALIVE_LIMIT) init.keepalive = true;
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: NO_CONNECTION };
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (res.ok) return { ok: true, status: res.status, data };
  if (res.status === 409) return { ok: false, status: 409, conflict: true, error: AHDUS_CHANGED };
  if (res.status === 401) return { ok: false, status: 401, loginExpired: true, error: AHDUS_LOGIN_EXPIRED };
  if (res.status === 403) return { ok: false, status: 403, forbidden: true, error: AHDUS_NOT_ALLOWED };
  if (res.status === 404) return { ok: false, status: 404, notFound: true, error: NOT_FOUND };
  const detail = typeof data?.detail === 'string' ? data.detail : null; // FastAPI's error shape
  return { ok: false, status: res.status, error: detail || `AHDUS answered ${res.status}` };
}

/** The store's layout (a save, v1) as v2; what only v2 has (routes, links, underlays) is kept from `loaded`. */
export function toServerLayout(payload, loaded = null) {
  const v2 = parseLayout(payload);
  return loaded ? mergeV2Extras(v2, loaded) : v2;
}

/** A layout from the server (v2) as { v1, v2 }; throws if it is not a layout. */
function fromServerLayout(layout) {
  const v2 = parseLayout(layout);
  return { v1: toV1(v2), v2 };
}

function revisionOf(data) {
  return Number.isFinite(data?.revision) ? data.revision : 0;
}

/**
 * The site's draft. A site with no draft yet gives an empty layout (layout: null).
 * @returns {Promise<{ ok: true, layout: object|null, v2: object|null, revision: number, name: string|null }|{ ok: false, error }>}
 */
export async function loadDraft(site) {
  const res = await request('GET', sitePath(site, '/layout?state=draft'));
  if (!res.ok) return res;
  const name = typeof res.data?.name === 'string' ? res.data.name : null;
  if (!res.data?.layout) return { ok: true, layout: null, v2: null, revision: revisionOf(res.data), name };
  try {
    const { v1, v2 } = fromServerLayout(res.data.layout);
    return { ok: true, layout: v1, v2, revision: revisionOf(res.data), name };
  } catch (err) {
    return { ok: false, error: `The saved workplace can't be read: ${err?.message ?? err}` };
  }
}

/**
 * Save the draft, only if the server still has `expectedRevision`.
 * @param {object} payload  the store's exportWorkspace()
 * @param {object|null} loaded  the v2 layout as loaded (its extras are kept)
 * @returns {Promise<{ ok: true, revision: number }|{ ok: false, error, conflict?, loginExpired?, forbidden? }>}
 */
export async function saveDraft(site, payload, expectedRevision, loaded = null) {
  let layout;
  try {
    layout = toServerLayout(payload, loaded);
  } catch (err) {
    return { ok: false, error: `This layout can't be saved: ${err?.message ?? err}` };
  }
  const res = await request('PUT', sitePath(site, '/layout'), { layout, expectedRevision });
  if (!res.ok) return res;
  return { ok: true, revision: Number.isFinite(res.data?.revision) ? res.data.revision : expectedRevision + 1 };
}

/** A server version in the shape VersionHistory shows (and apiService's local versions have). */
function toVersion(v) {
  const version = v.version ?? v.revision;
  return {
    id: v.id,
    name: v.name || (v.kind === 'published' ? 'Published' : `Version ${version}`),
    version,
    revision: v.revision,
    kind: v.kind,
    auto: v.kind === 'auto',
    snapshot: v.snapshot ?? undefined,
    created_by: v.createdBy ?? v.created_by ?? null,
    created_at: v.createdAt ?? v.created_at ?? null,
  };
}

/** @returns {Promise<{ ok: true, versions: object[] }|{ ok: false, error }>} newest first */
export async function listVersions(site) {
  const res = await request('GET', sitePath(site, '/versions'));
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.versions) ? res.data.versions : [];
  return { ok: true, versions: list.filter((v) => v && v.id != null).map(toVersion) };
}

/**
 * Save a version of the layout on the server.
 * @param {{ name?: string, auto?: boolean, payload: object, loaded?: object|null, revision: number }} options
 * @returns {Promise<{ ok: true, version: object }|{ ok: false, error }>}
 */
export async function createVersion(site, { name = '', auto = false, payload, loaded = null, revision }) {
  let layout;
  try {
    layout = toServerLayout(payload, loaded);
  } catch (err) {
    return { ok: false, error: `This layout can't be saved: ${err?.message ?? err}` };
  }
  const res = await request('POST', sitePath(site, '/versions'), {
    name: name.trim(), kind: auto ? 'auto' : 'named', layout, revision,
  });
  if (!res.ok) return res;
  return { ok: true, version: toVersion({ name: name.trim(), kind: auto ? 'auto' : 'named', revision, ...res.data }) };
}

/**
 * Make a version the site's draft on the server. The caller puts the returned
 * layout into the editor with editor.restoreVersion (one undo step).
 * @returns {Promise<{ ok: true, layout: object, v2: object, revision: number }|{ ok: false, error }>}
 */
export async function restoreVersion(site, versionId) {
  const res = await request('POST', sitePath(site, `/versions/${encodeURIComponent(versionId)}/restore`));
  if (!res.ok) return res.notFound ? { ...res, error: 'Version not found' } : res;
  if (!res.data?.layout) return { ok: false, error: 'Version not found' };
  try {
    const { v1, v2 } = fromServerLayout(res.data.layout);
    return { ok: true, layout: v1, v2, revision: revisionOf(res.data) };
  } catch (err) {
    return { ok: false, error: `This version can't be read: ${err?.message ?? err}` };
  }
}

/** The draft (as saved at `expectedRevision`) becomes what employees see. @returns {Promise<{ ok, error? }>} */
export async function publish(site, expectedRevision) {
  const res = await request('POST', sitePath(site, '/publish'), { expectedRevision });
  return res.ok ? { ok: true } : res;
}
