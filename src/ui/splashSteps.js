/**
 * ui/splashSteps.js — PURE (v0.17.2): the steps the loading screen shows (ui/StudioSplash.jsx, and index.html's
 * own copy before Studio's JS has arrived, which repeats these words: ui/__tests__/studioSplash.test.jsx checks).
 *
 *   Creating your workplace…   (only after the 3D Company page's "Create a workplace": ?new=1)
 *   Loading Studio…
 *   Ready
 *
 * The 3D Company page (AHDUS-FRONTEND workplace-page.js) shows the first step itself, in the same screen, while it
 * creates the site; Studio then shows it done.
 */

export const STEP_LABELS = Object.freeze({
  create: 'Creating your workplace',
  load: 'Loading Studio',
  ready: 'Ready',
});

/** The URL parameter the 3D Company page adds after creating the site (removed again by Studio). */
export const NEW_PARAM = 'new';

/**
 * @param {{ created?: boolean, phase: 'loading' | 'done' }} state
 * @returns {{ key: 'create' | 'load' | 'ready', label: string, state: 'done' | 'active' | 'todo' }[]}
 */
export function splashSteps({ created = false, phase }) {
  const done = phase === 'done';
  const steps = [];
  if (created) steps.push({ key: 'create', state: 'done' });
  steps.push({ key: 'load', state: done ? 'done' : 'active' });
  steps.push({ key: 'ready', state: done ? 'done' : 'todo' });
  return steps.map((s) => ({ ...s, label: s.state === 'active' ? `${STEP_LABELS[s.key]}…` : STEP_LABELS[s.key] }));
}

/** The words a screen reader hears: the step in progress, else "Ready". */
export function splashStatus(steps) {
  return steps.find((s) => s.state === 'active')?.label ?? STEP_LABELS.ready;
}

/** Came here from "Create a workplace" (?new=1)? */
export function createdFromUrl(search = typeof window !== 'undefined' ? window.location.search : '') {
  try { return new URLSearchParams(search).get(NEW_PARAM) === '1'; } catch { return false; }
}

/** The address without ?new=1, so a reload doesn't say "Creating your workplace" again (null: nothing to change). */
export function withoutNewParam(href) {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(NEW_PARAM)) return null;
    url.searchParams.delete(NEW_PARAM);
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

/** 'dark' only when AHDUS (same origin) is in dark mode: its localStorage "theme" (AHDUS-FRONTEND theme.js). */
export function splashTheme(ahdus, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!ahdus) return 'light';
  try { return storage?.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}
