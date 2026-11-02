/**
 * ui/publishFlow.js
 *
 * PURE: what Workplace Studio inside AHDUS says about publishing (tested in
 * ui/__tests__/publishFlow.test.js). The store has the draft's revision as last
 * saved (draftRevision) and the one employees see (publishedRevision: null =
 * never published, undefined = AHDUS hasn't said yet); apiService keeps both.
 */

/**
 * @param {{ draftRevision: number, publishedRevision: number|null|undefined, isDirty: boolean }} s
 * @returns {'unknown'|'never'|'changes'|'published'}
 */
export function publishState({ draftRevision, publishedRevision, isDirty }) {
  if (publishedRevision === undefined) return 'unknown';
  if (publishedRevision === null) return 'never';
  return !isDirty && draftRevision === publishedRevision ? 'published' : 'changes';
}

/** The Publish button: its text, whether it can be clicked, and the "newer draft" dot. */
export function publishButton(state) {
  if (state === 'published') return { label: 'Published ✓', disabled: true, dot: false };
  if (state === 'changes') return { label: 'Publish changes', disabled: false, dot: true };
  return { label: 'Publish', disabled: false, dot: false };
}

/** After "Saved" in the top bar ('' while AHDUS hasn't said). */
export function publishStatusText(state) {
  return {
    published: '· Published',
    changes: '· Unpublished changes',
    never: '· Not published yet',
  }[state] ?? '';
}

const SAVE_TEXT = {
  saved: 'Saved', saving: 'Saving…', unsaved: 'Not saved', offline: 'Offline (changes queued)', syncing: 'Syncing…',
};
const PUBLISH_PART = {
  published: { text: 'Published', short: 'Published', tone: 'ok' },
  changes: { text: 'Unpublished changes', short: 'Unpublished', tone: 'warn' },
  never: { text: 'Not published yet', short: 'Not published', tone: 'warn' },
};

/**
 * The status pill of the AHDUS look's top bar: saving and publishing in one.
 * @param {string} saveStatus  'saved' | 'saving' | 'unsaved' | 'offline' | 'syncing'
 * @param {string} state       publishState(): 'unknown' | 'never' | 'changes' | 'published'
 * @returns {{ tone: 'ok'|'warn'|'bad'|'neutral', text: string, short: string }}  short: for a phone
 */
export function statusPill(saveStatus, state, saveError = null) {
  if (saveStatus === 'unsaved') {
    const text = saveError ? `Not saved: ${saveError}` : 'Not saved';
    return { tone: 'bad', text, short: 'Not saved' };
  }
  const save = SAVE_TEXT[saveStatus] ?? '';
  if (saveStatus === 'offline' || saveStatus === 'syncing') return { tone: 'warn', text: save, short: save };
  const pub = PUBLISH_PART[state];
  if (!pub) return { tone: 'neutral', text: save, short: save };
  return { tone: saveStatus === 'saving' ? 'neutral' : pub.tone, text: `${save} · ${pub.text}`, short: `${save} · ${pub.short}` };
}

/**
 * Whether leaving now should be confirmed: a save is still waiting or running (isDirty),
 * or the saved draft is not what employees see (a never-published site counts once it
 * has been saved: revision > 0). Only inside AHDUS.
 */
export function shouldWarnOnLeave({ ahdus, draftRevision, publishedRevision, isDirty }) {
  if (!ahdus) return false;
  if (isDirty) return true;
  const state = publishState({ draftRevision, publishedRevision, isDirty });
  if (state === 'changes') return true;
  return state === 'never' && draftRevision > 0;
}

/** When the newest 'published' version was made (an ISO string), or null. Versions come newest first. */
export function lastPublishedAt(versions) {
  const list = Array.isArray(versions) ? versions : [];
  let best = null;
  for (const v of list) {
    if (v?.kind !== 'published' || !v.created_at) continue;
    if (best === null || Date.parse(v.created_at) > Date.parse(best)) best = v.created_at;
  }
  return best;
}

/** "Last published: 31 Oct 2026, 10:00" for the Publish dialog. */
export function lastPublishedText(iso, locale = undefined) {
  if (!iso) return 'Not published yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not published yet';
  return `Last published: ${date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/** An error from AHDUS as a sentence (some start lower case: they follow "Not saved: "). */
export function sentence(text) {
  const t = String(text ?? '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
