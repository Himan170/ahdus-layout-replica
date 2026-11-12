import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import { MeshoptEncoder } from 'meshoptimizer/encoder';

import { bundledMeshopt, registerGltfExtensions } from '../gltfExtensions';
import { GLB_LOAD_OPTIONS } from '../modelLoader';

/**
 * A .glb like the Rocketbox characters: positions quantized to int16 (KHR_mesh_quantization) and both buffers
 * meshopt-compressed (EXT_meshopt_compression, both REQUIRED), a fallback buffer with no data.
 */
async function meshoptGlb() {
  await MeshoptEncoder.ready;
  const positions = new Int16Array([0, 0, 0, 0, 0, 1000, 0, 0, 2000, 1000, 0, 0, 0, 0, 3000, 0]); // 4 × (x, y, z, pad)
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const posBytes = new Uint8Array(positions.buffer);
  const idxBytes = new Uint8Array(indices.buffer);
  const posPacked = MeshoptEncoder.encodeGltfBuffer(posBytes, 4, 8, 'ATTRIBUTES');
  const idxPacked = MeshoptEncoder.encodeGltfBuffer(idxBytes, 6, 2, 'TRIANGLES');
  const pad4 = (n) => (n + 3) & ~3;
  const bin = new Uint8Array(pad4(posPacked.length) + pad4(idxPacked.length));
  bin.set(posPacked, 0);
  bin.set(idxPacked, pad4(posPacked.length));
  const ext = (byteOffset, byteLength, byteStride, count, mode) => ({
    EXT_meshopt_compression: { buffer: 0, byteOffset, byteLength, byteStride, count, mode },
  });
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    buffers: [{ byteLength: bin.length }, { byteLength: 32 + 12, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews: [
      { buffer: 1, byteOffset: 0, byteLength: 32, byteStride: 8, target: 34962, extensions: ext(0, posPacked.length, 8, 4, 'ATTRIBUTES') },
      { buffer: 1, byteOffset: 32, byteLength: 12, target: 34963, extensions: ext(pad4(posPacked.length), idxPacked.length, 2, 6, 'TRIANGLES') },
    ],
    accessors: [
      { bufferView: 0, componentType: 5122, count: 4, type: 'VEC3', min: [0, 0, 0], max: [2000, 1000, 3000] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    meshes: [{ name: 'quad', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    // the dequantization, as gltfpack writes it: a node scale
    nodes: [{ name: 'quad', mesh: 0, scale: [0.001, 0.001, 0.001] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(text.length);
  const total = 12 + 8 + jsonLen + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(text, 20);
  view.setUint32(20 + jsonLen, bin.length, true);
  view.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return out;
}

let engine;
let scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('glTF extensions (v0.16.0)', () => {
  it('the bundled meshopt decoder gives back what was encoded', async () => {
    await MeshoptEncoder.ready;
    const data = new Uint8Array(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    const packed = MeshoptEncoder.encodeGltfBuffer(data, 2, 16, 'ATTRIBUTES');
    const back = await bundledMeshopt.decodeGltfBufferAsync(packed, 2, 16, 'ATTRIBUTES');
    expect([...new Float32Array(back.buffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a meshopt-compressed, quantized .glb loads with no CDN (Rocketbox characters)', async () => {
    await registerGltfExtensions();
    const fetches = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (...a) => { fetches.push(String(a[0])); return realFetch(...a); };
    try {
      const container = await LoadAssetContainerAsync(await meshoptGlb(), scene, GLB_LOAD_OPTIONS);
      const mesh = container.meshes.find((m) => m.name === 'quad');
      expect(mesh).toBeTruthy();
      expect([...mesh.getIndices()]).toEqual([0, 1, 2, 0, 2, 3]);
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
      // int16 positions read as they are, the node's scale does the rest
      expect(Math.max(...pos)).toBe(3000);
      container.addAllToScene();
      for (const n of [container.meshes[0], mesh]) n.computeWorldMatrix(true);
      mesh.refreshBoundingInfo();
      const bb = mesh.getBoundingInfo().boundingBox;
      expect(bb.maximumWorld.y).toBeCloseTo(1, 5);
      expect(Math.abs(bb.maximumWorld.z) + Math.abs(bb.minimumWorld.z)).toBeCloseTo(3, 5);
      expect(fetches).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
