/**
 * embed/embedLayout.js — the pure parts of AHDUSWorkplace (embed/index.jsx):
 * reading the layout a page gives (`layout` or `layoutUrl`), checking the
 * mode, which "Press E" action a target matches and filtering hook points.
 * No DOM, no Babylon (tests: embed/__tests__/embedLayout.test.js).
 */

import { loadLayout as parseLayout, detectVersion, LAYOUT_FILE_FORMAT } from '../engine/model/migrate';

/** The modes the embed shows ('edit' is refused: admins edit in Workplace Studio). */
export const VIEW_MODES = ['view', 'walkthrough'];

export const EDIT_REFUSED = 'Editing isn\'t available here: admins edit the workplace in Workplace Studio';
export const NOT_A_LAYOUT = 'This is not an AHDUS layout: expected v2 layout JSON or an exported .ahdus.json file';

/** What is wrong with a mode, or null if the embed can show it. */
export function modeProblem(mode) {
  if (mode === 'edit') return EDIT_REFUSED;
  if (!VIEW_MODES.includes(mode)) return `Unknown mode "${mode}": use 'view' or 'walkthrough'`;
  return null;
}

/**
 * The layout to show, as validated v2: `layout`, else the JSON at `layoutUrl`
 * (fetched with the page's cookies, plus `headers` if given). Throws an Error
 * with a short message if there is none, it can't be fetched or it isn't ours.
 * @param {{ layout?: unknown, layoutUrl?: string, headers?: Record<string, string> }} options
 * @param {{ signal?: AbortSignal, fetch?: typeof fetch }} [io]
 */
export async function readLayout({ layout, layoutUrl, headers } = {}, { signal, fetch: fetchFn = globalThis.fetch } = {}) {
  let data = layout;
  if (data === undefined || data === null) {
    if (!layoutUrl) throw new Error('No layout given: pass layout or layoutUrl');
    data = await fetchJson(String(layoutUrl), { headers, signal }, fetchFn);
  }
  return toLayout(data);
}

async function fetchJson(url, { headers, signal }, fetchFn) {
  let res;
  try {
    res = await fetchFn(url, { credentials: 'include', headers, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(`Could not load the layout from ${url}: ${err?.message ?? err}`, { cause: err });
  }
  if (!res.ok) {
    const error = new Error(`Could not load the layout from ${url} (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`${url} did not send JSON`, { cause: err });
  }
}

/**
 * v2 layout JSON or an exported layout file, validated. Anything else is
 * refused, also a bare save: an API answering with some other JSON (an error
 * object) must not show as an empty workplace.
 */
export function toLayout(data) {
  const ours = !!data && typeof data === 'object' && (data.format === LAYOUT_FILE_FORMAT || detectVersion(data) === 2);
  if (!ours) throw new Error(NOT_A_LAYOUT);
  try {
    return parseLayout(data);
  } catch (err) {
    const issue = err?.issues?.[0];
    const where = issue ? `: ${issue.path.join('.')}: ${issue.message}` : '';
    throw new Error(`This AHDUS layout is damaged${where}`, { cause: err });
  }
}

/**
 * registerAction's first argument as a test on a target (layoutBridge's E
 * target): an asset type ('CNC_MACHINE'), a hook-point kind ('machine',
 * 'workstation', …), an item id, a hook-point id, 'door' or 'window', a list
 * of those, or a function (target) => boolean.
 */
export function actionMatcher(match) {
  if (typeof match === 'function') return match;
  const list = Array.isArray(match) ? match : [match];
  if (list.length === 0 || !list.every((m) => typeof m === 'string' && m)) {
    throw new TypeError('registerAction: the first argument is an asset type (e.g. "CNC_MACHINE"), a hook-point kind, an id, or a function');
  }
  const wanted = new Set(list);
  return (t) => {
    if (t.kind === 'door' || t.kind === 'window') return wanted.has(t.kind);
    return wanted.has(t.object?.assetType) || wanted.has(t.objectId)
      || (t.anchors ?? []).some((a) => wanted.has(a.kind) || wanted.has(a.id));
  };
}

/** Hook points matching { kind, roomId, floorId, objectId } (floorId 1 and '1' are the same floor). */
export function filterAnchors(anchors, { kind, roomId, floorId, objectId } = {}) {
  return anchors.filter((a) =>
    (kind === undefined || a.kind === kind) &&
    (roomId === undefined || a.roomId === roomId) &&
    (floorId === undefined || String(a.floorId) === String(floorId)) &&
    (objectId === undefined || a.objectId === objectId));
}
