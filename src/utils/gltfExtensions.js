/**
 * utils/gltfExtensions.js
 *
 * The glTF extensions our .glb files use, registered with Babylon's glTF loader
 * (each import registers one; a file that REQUIRES a missing one fails to
 * load). Not the whole Extensions index: it is big.
 *
 * - EXT_texture_webp, KHR_materials_specular: the AHDUS office characters.
 * - KHR_materials_unlit: the Kenney models (their materials are replaced anyway).
 * - EXT_meshopt_compression + KHR_mesh_quantization (v0.16.0): the Rocketbox
 *   characters and their light copies. Babylon's meshopt support would fetch
 *   its decoder from Babylon's CDN; ours is the npm `meshoptimizer` decoder
 *   (MIT, WebAssembly inside the module), bundled, so nothing comes from a CDN
 *   (the embed works offline and behind a strict Content-Security-Policy).
 *
 * Used by utils/modelLoader.js (every .glb of the app, viewer and embed) and by
 * the character tests (Node).
 */

import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';

/**
 * A stand-in for Babylon's MeshoptCompression.Default: decodes on this thread
 * with the bundled decoder (a character file decodes in a few ms).
 */
export const bundledMeshopt = Object.freeze({
  /**
   * @param {Uint8Array} source the compressed bufferView
   * @param {number} count elements
   * @param {number} stride bytes per element
   * @param {'ATTRIBUTES' | 'TRIANGLES' | 'INDICES'} mode
   * @param {'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL'} [filter]
   * @returns {Promise<Uint8Array>}
   */
  async decodeGltfBufferAsync(source, count, stride, mode, filter) {
    await MeshoptDecoder.ready;
    const target = new Uint8Array(count * stride);
    MeshoptDecoder.decodeGltfBuffer(target, count, stride, source, mode, filter);
    return target;
  },
  dispose() {},
});

let registered = null;

/** Registers the extensions (once); resolves when they are registered. */
export function registerGltfExtensions() {
  registered ??= Promise.all([
    import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp'),
    import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular'),
    import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit'),
    import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression'),
    import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization'),
  ]).then(() => {
    // EXT_meshopt_compression asks MeshoptCompression.Default, made on first use: ours instead
    MeshoptCompression._Default = bundledMeshopt;
  });
  return registered;
}
