/**
 * engine/startMode.ts (v0.14.6, private-docs/EXPERIENCE_PLAN.md 3.1): how a viewer starts. PURE, except
 * the two localStorage helpers (each in try / catch).
 *
 * A viewer given `startMode` walks by default ('walkthrough': the welcome card) with three guards:
 *   1. the person's last choice (Overview / Walk, per browser) wins over startMode;
 *   2. a weak device (quality 'low', or WebGL drawn by software) starts in Overview, with a Walk button;
 *   3. a page that opens at a person or a room (a deep link) skips the welcome card.
 */

export type StartMode = 'walkthrough' | 'view';

/** Why the viewer starts the way it does. */
export type StartReason = 'start' | 'remembered' | 'weak' | 'link';

export interface StartChoice {
  mode: StartMode;
  /** Show the welcome card ("Welcome to … · Start the tour · Explore · Find someone"). */
  welcome: boolean;
  reason: StartReason;
}

/** The last Overview / Walk choice, per browser. */
export const START_MODE_KEY = 'ahdus.viewMode';

/** Where to start. `remembered`: the last choice (null: none); `openAt`: the page opens at a person or room. */
export function chooseStart({ startMode, remembered = null, weak = false, openAt = false }: {
  startMode: StartMode; remembered?: StartMode | null; weak?: boolean; openAt?: boolean;
}): StartChoice {
  if (weak) return { mode: 'view', welcome: false, reason: 'weak' };
  const mode = remembered ?? (startMode === 'view' ? 'view' : 'walkthrough');
  if (openAt) return { mode, welcome: false, reason: 'link' };
  return { mode, welcome: mode === 'walkthrough', reason: remembered ? 'remembered' : 'start' };
}

/** WebGL drawn by the CPU (no graphics card in use): walking would be slow there. */
export function softwareRenderer(renderer: unknown): boolean {
  return typeof renderer === 'string'
    && /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|gdi generic/i.test(renderer);
}

/** "Welcome to Meridian HQ" (no name: "Welcome"). */
export function welcomeTitle(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  return n ? `Welcome to ${n}` : 'Welcome';
}

/** The welcome card's buttons, in order: the tour and Find only where the viewer has them. */
export function welcomeActions({ tour = true, search = true }: { tour?: boolean; search?: boolean } = {}): ('tour' | 'explore' | 'find')[] {
  return [...(tour ? ['tour' as const] : []), 'explore', ...(search ? ['find' as const] : [])];
}

/** The last choice (null: none, or storage blocked). */
export function readStartMode(): StartMode | null {
  try {
    const v = window.localStorage.getItem(START_MODE_KEY);
    return v === 'view' || v === 'walkthrough' ? v : null;
  } catch {
    return null;
  }
}

export function rememberStartMode(mode: StartMode): void {
  try { window.localStorage.setItem(START_MODE_KEY, mode); } catch { /* this visit only */ }
}
