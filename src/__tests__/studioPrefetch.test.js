// What the 3D Company page prefetches for editors (v0.17.2, scripts/studio-prefetch.mjs).
import { describe, it, expect } from 'vitest';
import { studioPrefetch } from '../../scripts/studio-prefetch.mjs';

const MANIFEST = {
  'index.html': {
    file: 'assets/main-AAA.js', isEntry: true, imports: ['_vendor-BBB.js'], dynamicImports: ['node_modules/jspdf/x.js', 'node_modules/@babylonjs/core/Shaders/pbr.fragment.js',
      'node_modules/@babylonjs/core/ShadersWGSL/pbr.fragment.js', '_glTFLoader-H.js'],
    css: ['assets/main-CCC.css'],
    assets: ['assets/inter-latin-400-normal-D.woff2', 'assets/inter-cyrillic-400-normal-E.woff2', 'assets/inter-latin-400-normal-F.woff'],
  },
  '_vendor-BBB.js': { file: 'assets/vendor-BBB.js', imports: ['index.html'] },
  'node_modules/jspdf/x.js': { file: 'assets/jspdf-GGG.js', isDynamicEntry: true },
  'node_modules/@babylonjs/core/Shaders/pbr.fragment.js': { file: 'assets/pbr.fragment-GL.js', isDynamicEntry: true },
  'node_modules/@babylonjs/core/ShadersWGSL/pbr.fragment.js': { file: 'assets/pbr.fragment-WGSL.js', isDynamicEntry: true },
  '_glTFLoader-H.js': { file: 'assets/glTFLoader-H.js', imports: ['_vendor-BBB.js'] },
};

describe('studioPrefetch', () => {
  it('the entry, its static imports, its CSS, the latin Inter woff2 fonts and the start chunks; no WGSL, no jsPDF, no loops', () => {
    const { version, files } = studioPrefetch(MANIFEST, '0.17.2');
    expect(version).toBe('0.17.2');
    expect(files).toEqual([
      { href: 'assets/main-AAA.js', as: 'script' },
      { href: 'assets/main-CCC.css', as: 'style' },
      { href: 'assets/inter-latin-400-normal-D.woff2', as: 'font' },
      { href: 'assets/vendor-BBB.js', as: 'script' },
      { href: 'assets/pbr.fragment-GL.js', as: 'script' },
      { href: 'assets/glTFLoader-H.js', as: 'script' },
    ]);
  });

  it('no entry: says so', () => {
    expect(() => studioPrefetch({}, '1')).toThrow(/entry/);
  });
});
