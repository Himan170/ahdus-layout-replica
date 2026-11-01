// Inside AHDUS: what Studio says about publishing (ui/publishFlow.js, pure).
import { describe, it, expect } from 'vitest';
import {
  publishState, publishButton, publishStatusText, shouldWarnOnLeave, lastPublishedAt, lastPublishedText, sentence,
} from '../publishFlow';

describe('publishState', () => {
  it('never published: publishedRevision null', () => {
    expect(publishState({ draftRevision: 4, publishedRevision: null, isDirty: false })).toBe('never');
    expect(publishState({ draftRevision: 0, publishedRevision: null, isDirty: true })).toBe('never');
  });

  it('published: the saved draft is the published revision, nothing waiting to save', () => {
    expect(publishState({ draftRevision: 9, publishedRevision: 9, isDirty: false })).toBe('published');
  });

  it('unpublished changes: a newer saved draft, or a change not saved yet', () => {
    expect(publishState({ draftRevision: 10, publishedRevision: 9, isDirty: false })).toBe('changes');
    expect(publishState({ draftRevision: 9, publishedRevision: 9, isDirty: true })).toBe('changes');
  });

  it('unknown until AHDUS has said (publishedRevision undefined)', () => {
    expect(publishState({ draftRevision: 3, publishedRevision: undefined, isDirty: false })).toBe('unknown');
  });
});

describe('the Publish button and the status text', () => {
  it('Published ✓ is disabled; Publish changes has the dot; Publish otherwise', () => {
    expect(publishButton('published')).toEqual({ label: 'Published ✓', disabled: true, dot: false });
    expect(publishButton('changes')).toEqual({ label: 'Publish changes', disabled: false, dot: true });
    expect(publishButton('never')).toEqual({ label: 'Publish', disabled: false, dot: false });
    expect(publishButton('unknown')).toEqual({ label: 'Publish', disabled: false, dot: false });
  });

  it('after "Saved"', () => {
    expect(publishStatusText('published')).toBe('· Published');
    expect(publishStatusText('changes')).toBe('· Unpublished changes');
    expect(publishStatusText('never')).toBe('· Not published yet');
    expect(publishStatusText('unknown')).toBe('');
  });
});

describe('shouldWarnOnLeave', () => {
  const at = (draftRevision, publishedRevision, isDirty = false, ahdus = true) =>
    shouldWarnOnLeave({ ahdus, draftRevision, publishedRevision, isDirty });

  it('warns when employees see an older version than the saved draft', () => {
    expect(at(10, 9)).toBe(true);
  });

  it('warns while a save is waiting or running', () => {
    expect(at(9, 9, true)).toBe(true);
    expect(at(0, null, true)).toBe(true);
    expect(at(3, undefined, true)).toBe(true);
  });

  it('a never-published site warns once something was saved', () => {
    expect(at(2, null)).toBe(true);
    expect(at(0, null)).toBe(false); // nothing drawn yet
  });

  it('no warning when published, while unknown, or outside AHDUS', () => {
    expect(at(9, 9)).toBe(false);
    expect(at(9, undefined)).toBe(false);
    expect(at(10, 9, true, false)).toBe(false);
  });
});

describe('last published', () => {
  const versions = [
    { id: 3, kind: 'auto', created_at: '2026-10-31T12:00:00Z' },
    { id: 2, kind: 'published', created_at: '2026-10-30T09:15:00Z' },
    { id: 1, kind: 'published', created_at: '2026-10-20T09:15:00Z' },
  ];

  it('the newest published version', () => {
    expect(lastPublishedAt(versions)).toBe('2026-10-30T09:15:00Z');
    expect(lastPublishedAt([...versions].reverse())).toBe('2026-10-30T09:15:00Z');
    expect(lastPublishedAt([{ kind: 'named', created_at: '2026-10-30T09:15:00Z' }])).toBe(null);
    expect(lastPublishedAt(null)).toBe(null);
  });

  it('as text', () => {
    expect(lastPublishedText('2026-10-30T09:15:00Z', 'en-GB')).toMatch(/^Last published: 30 Oct 2026/);
    expect(lastPublishedText(null)).toBe('Not published yet');
  });

  it('errors read as sentences', () => {
    expect(sentence('you are not allowed to edit this workplace')).toBe('You are not allowed to edit this workplace');
    expect(sentence('')).toBe('');
  });
});
