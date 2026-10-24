import { describe, it, expect } from 'vitest';
import { fitTransform, applyFit, regionBox } from '../modelFit';
import { MODEL_REGISTRY, modelPartsFor, usedModels, REALISTIC_SURFACES, TEXTURE_SETS } from '../../utils/modelRegistry';
import { ASSET_TYPES } from '../../utils/assetCatalog';

const box = (min, max) => ({ min, max });
const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

// Kenney's desk: about half real size, pivot at a back corner (x 0 → w, z −d → 0)
const kenneyDesk = box([-0.01, 0, -0.38], [0.724, 0.384, 0.012]);
// The primitive desk's box: 1.6 × 0.79 × 0.8, centred, on the floor
const deskBox = box([-0.8, 0, -0.4], [0.8, 0.79, 0.4]);

describe('fitTransform: stretch (default)', () => {
  it('fills the item box exactly, whatever the model pivot and units', () => {
    const fit = fitTransform(kenneyDesk, deskBox);
    const placed = applyFit(kenneyDesk, fit);
    close(placed.min, deskBox.min);
    close(placed.max, deskBox.max);
  });

  it('scales each axis on its own', () => {
    const { scale } = fitTransform(box([0, 0, 0], [1, 1, 1]), box([0, 0, 0], [2, 3, 4]));
    close(scale, [2, 3, 4]);
  });

  it('a flat model (a rug) keeps a sensible thickness and lies on the bottom', () => {
    const rug = box([0, 0, -0.92], [1.57, 0, 0]);
    const fit = fitTransform(rug, box([-1.5, 0, -1], [1.5, 0.02, 1]));
    expect(fit.scale[1]).toBeGreaterThan(1);
    const placed = applyFit(rug, fit);
    close([placed.min[0], placed.max[0], placed.min[2], placed.max[2]], [-1.5, 1.5, -1, 1]);
    expect(placed.min[1]).toBeCloseTo(0, 6);
  });

  it('a model with no size at all is only moved', () => {
    const fit = fitTransform(box([1, 1, 1], [1, 1, 1]), box([0, 0, 0], [1, 1, 1]));
    close(fit.scale, [1, 1, 1]);
  });
});

describe('fitTransform: contain', () => {
  it('keeps proportions, fits inside, stands on the bottom, centred in x and z', () => {
    const coffee = box([0, 0, -0.24], [0.19, 0.177, 0]);
    const target = box([-0.19, 0, -0.16], [0.19, 0.52, 0.16]);
    const fit = fitTransform(coffee, target, 'contain');
    expect(fit.scale[0]).toBeCloseTo(fit.scale[1], 9);
    expect(fit.scale[1]).toBeCloseTo(fit.scale[2], 9);
    const placed = applyFit(coffee, fit);
    expect(placed.min[1]).toBeCloseTo(0, 6);
    for (let i = 0; i < 3; i++) {
      expect(placed.min[i]).toBeGreaterThanOrEqual(target.min[i] - 1e-9);
      expect(placed.max[i]).toBeLessThanOrEqual(target.max[i] + 1e-9);
    }
    expect((placed.min[0] + placed.max[0]) / 2).toBeCloseTo(0, 6);
    expect((placed.min[2] + placed.max[2]) / 2).toBeCloseTo(0, 6);
    // the depth is the tight axis: it is filled
    expect(placed.max[2] - placed.min[2]).toBeCloseTo(0.32, 6);
  });
});

describe('regionBox', () => {
  it('takes fractions of the named axes, the others stay whole', () => {
    const r = regionBox(box([-1, 0, -0.5], [1, 2, 0.5]), { x: [0.5, 1] });
    close(r.min, [0, 0, -0.5]);
    close(r.max, [1, 2, 0.5]);
  });
  it('no region = the whole box', () => {
    const b = box([0, 0, 0], [1, 1, 1]);
    expect(regionBox(b)).toEqual(b);
  });
});

describe('modelRegistry', () => {
  it('only names catalogue items, and every part has a model', () => {
    for (const [type, entry] of Object.entries(MODEL_REGISTRY)) {
      expect(ASSET_TYPES[type], type).toBeTruthy();
      expect(entry.parts.length).toBeGreaterThan(0);
      for (const p of entry.parts) expect(typeof p.model).toBe('string');
    }
  });
  it('stairs and machines keep their primitive model', () => {
    for (const type of ['STAIRCASE', 'CNC_MACHINE', 'LATHE']) expect(modelPartsFor(type)).toBeNull();
  });
  it('lists each model file once', () => {
    const list = usedModels();
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain('desk');
  });
  it('every realistic surface has a texture set', () => {
    for (const set of Object.values(REALISTIC_SURFACES)) expect(TEXTURE_SETS[set], set).toBeTruthy();
  });
});
