// The third-person camera's shoulder offset (v0.13.1): centred on a portrait phone, over the shoulder when wide.
import { describe, expect, it } from 'vitest';
import { shoulderOffset } from '../playController';

const FOV = 1.0; // playController's camera (vertical)
const CAM_DISTANCE = 3.8;
/** Half the width the camera sees at the character's distance (m). */
const halfWidth = (aspect) => Math.tan(FOV / 2) * aspect * CAM_DISTANCE;

describe('shoulderOffset', () => {
  it('a portrait phone (390 × 844) puts the character in the middle', () => {
    expect(shoulderOffset(390 / 844)).toBe(0);
    expect(shoulderOffset(0.75)).toBe(0);
  });

  it('desktop and landscape views keep the over-the-shoulder view (0.85 m)', () => {
    expect(shoulderOffset(1440 / 900)).toBeCloseTo(0.85);
    expect(shoulderOffset(16 / 9)).toBeCloseTo(0.85);
    expect(shoulderOffset(844 / 390)).toBeCloseTo(0.85);
  });

  it('in between it eases, and the character (0.3 m each side) always stays on screen', () => {
    let last = -1;
    for (let aspect = 0.4; aspect <= 2.5; aspect += 0.05) {
      const off = shoulderOffset(aspect);
      expect(off).toBeGreaterThanOrEqual(last);
      expect(off + 0.3).toBeLessThan(halfWidth(aspect));
      last = off;
    }
  });

  it('a view with no size yet (0, NaN) gets the default', () => {
    expect(shoulderOffset(0)).toBeCloseTo(0.85);
    expect(shoulderOffset(NaN)).toBeCloseTo(0.85);
  });
});
