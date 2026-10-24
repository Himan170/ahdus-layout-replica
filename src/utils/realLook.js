/**
 * utils/realLook.js
 *
 * "Realistic look" per scene: real furniture models (Kenney GLBs), photo
 * textures on rooms and the HDRI sky (utils/modelRegistry.js lists them).
 * Off = the primitive models and procedural materials (for slow PCs; the
 * embed's quality: 'low'). The assets load after the scene is drawn; until
 * then, or if one fails, the procedural look stays.
 *
 * Where the asset files are: `<baseUrl>models/…`, `<baseUrl>textures/…`,
 * `<baseUrl>env/…`. Default: the app's public/assets/ folder.
 */

const DEFAULT_BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/`;
const STORAGE_KEY = 'ahdus.realisticLook';

const looks = new WeakMap(); // scene → { realistic, baseUrl, listeners, pending }

function lookOf(scene) {
  let look = looks.get(scene);
  if (!look) looks.set(scene, (look = { realistic: false, baseUrl: DEFAULT_BASE, listeners: new Set(), pending: new Set() }));
  return look;
}

/**
 * Set a scene's look before anything is drawn (SceneSetup.createLayoutScene).
 * @param {object} scene
 * @param {{ realistic?: boolean, baseUrl?: string }} [options]
 */
export function configureLook(scene, { realistic = true, baseUrl = undefined } = {}) {
  const look = lookOf(scene);
  look.realistic = !!realistic;
  if (baseUrl) look.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function isRealistic(scene) {
  return !!scene && lookOf(scene).realistic;
}

/** Turn the realistic look on or off; parts that care follow (onLookChange). */
export function setRealistic(scene, on) {
  const look = lookOf(scene);
  if (look.realistic === !!on) return;
  look.realistic = !!on;
  for (const fn of [...look.listeners]) {
    try { fn(look.realistic); } catch (e) { console.warn('[realLook]', e); }
  }
}

/** Call fn(realistic) whenever the look changes. @returns unsubscribe */
export function onLookChange(scene, fn) {
  const look = lookOf(scene);
  look.listeners.add(fn);
  return () => look.listeners.delete(fn);
}

/** URL of an asset file, e.g. assetUrl(scene, 'models/kenney/desk.glb'). */
export function assetUrl(scene, path) {
  return lookOf(scene).baseUrl + path;
}

/** Keep track of a load (whenLoaded waits for it). Returns the promise. */
export function trackLoad(scene, promise) {
  const look = lookOf(scene);
  look.pending.add(promise);
  const done = () => look.pending.delete(promise);
  promise.then(done, done);
  return promise;
}

/** Resolves when every asset load started so far has finished (or failed). */
export async function whenLoaded(scene) {
  const look = lookOf(scene);
  while (look.pending.size) await Promise.allSettled([...look.pending]);
}

// ── The Studio setting (per browser) ──

/** "Realistic look" in Studio's Settings: on unless switched off in this browser. */
export function storedRealisticLook() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function storeRealisticLook(on) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch { /* private window: the setting lasts for this visit only */ }
}
