// The walk map blocks each item's catalogue footprint (navigation/walkMap.js itemFootprint): check it
// covers the primitive model the item collides with (the realistic models are fitted into that model's box).
import { describe, it, expect, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';

vi.mock('../../../utils/materialLibrary', () => ({ getAssetMaterial: () => null }));
const { ASSET_TYPES, OBJECT_CATEGORIES, buildAssetMesh } = await import('../../../utils/assetCatalog');
const { itemFootprint, CLEARANCE, BODY_RADIUS } = await import('../walkMap');

describe('catalogue footprints', () => {
  it('every solid catalogue item\'s footprint covers its primitive model (the realistic models are fitted into it)', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tooBig = [];
    for (const [type, def] of Object.entries(ASSET_TYPES)) {
      if (def.category === OBJECT_CATEGORIES.MARKER || def.solid === false || type === 'STAIRCASE') continue;
      const root = buildAssetMesh(type, scene, `t_${type}`);
      if (!root) continue;
      root.computeWorldMatrix(true);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const mesh of root.getChildMeshes(false)) {
        mesh.computeWorldMatrix(true);
        const b = mesh.getBoundingInfo().boundingBox;
        x0 = Math.min(x0, b.minimumWorld.x); x1 = Math.max(x1, b.maximumWorld.x);
        z0 = Math.min(z0, b.minimumWorld.z); z1 = Math.max(z1, b.maximumWorld.z);
      }
      const fp = itemFootprint({ assetType: type, x: 0, z: 0 }, ASSET_TYPES);
      // a model may stick out a little (handles, a chair's wheels): never more than the 0.05 m margin
      const over = Math.max(x1 - fp.hw, -fp.hw - x0, z1 - fp.hd, -fp.hd - z0);
      if (over > CLEARANCE - BODY_RADIUS + 1e-6) tooBig.push(`${type} by ${over.toFixed(3)} m`);
    }
    engine.dispose();
    expect(tooBig).toEqual([]);
  });
});
