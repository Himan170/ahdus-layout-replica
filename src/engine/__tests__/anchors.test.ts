import { describe, it, expect } from 'vitest';
import { anchorId } from '../model/anchors';

describe('anchor ids never change', () => {
  // Teammates store these ids. Values computed with uuid@9 before the move to
  // uuid@11: if this fails, every saved link to an anchor would break.
  it('uuid v5 of objectId + kind gives the same ids as before', () => {
    expect(anchorId('obj_12', 'workstation')).toBe('c5c4621c-be76-590d-a19f-20eb1e65940c');
    expect(anchorId('obj_7', 'machine')).toBe('0c7fc2db-3e3a-5189-8799-ce5c16668a75');
  });
});
