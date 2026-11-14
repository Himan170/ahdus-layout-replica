// PURE (v0.17.2): the files Workplace Studio needs to start, from Vite's build manifest (vite.ahdus.config.js
// `build.manifest`). scripts/build-ahdus.mjs writes them to dist-ahdus/workplace-studio/prefetch.json; AHDUS-FRONTEND's
// 3D Company page (workplace-page.js) prefetches them, at low priority and for editors only, so a click on "Edit in
// Studio" or "Create a workplace" finds them in the browser's cache. Paths are relative to /workplace-studio/.
// Tests: src/__tests__/studioPrefetch.test.js.
//
//   { version, files: [{ href, as: 'script' | 'style' | 'font' }] }
//
// The entry's script, its static imports, their CSS and the latin Inter fonts that CSS needs (not the other
// alphabets' subsets); and the dynamic chunks Studio loads while it opens (START_CHUNKS: Babylon's WebGL shaders, the
// glTF loader, the sky's .env loader). Not the WebGPU (WGSL) shaders, other texture formats, jsPDF, html2canvas or
// the demo modules: those load on first use, if ever.

const FONT = /inter-latin-(400|500|600)-normal.*\.woff2$/;
export const START_CHUNKS = [
  /@babylonjs\/core\/Shaders\//, // WebGL shaders (and their includes); not ShadersWGSL/
  /@babylonjs\/loaders\//, /glTFLoader|gltfExtensions/i, /\/Loading\/sceneLoader/,
  /envTextureLoader/, /mesh\.vertexData\.functions/,
];

export function studioPrefetch(manifest, version) {
  const entry = Object.values(manifest).find((c) => c.isEntry) ?? manifest['index.html'];
  if (!entry) throw new Error('No entry in the Vite manifest');
  const seen = new Set();
  const files = [];
  const add = (href, as) => { if (href && !seen.has(href)) { seen.add(href); files.push({ href, as }); } };
  const walk = (chunk) => {
    if (!chunk || seen.has(chunk.file)) return;
    add(chunk.file, 'script');
    for (const css of chunk.css ?? []) add(css, 'style');
    for (const asset of chunk.assets ?? []) if (FONT.test(asset)) add(asset, 'font');
    for (const key of chunk.imports ?? []) walk(manifest[key]);
  };
  walk(entry);
  for (const key of entry.dynamicImports ?? []) if (START_CHUNKS.some((re) => re.test(key))) walk(manifest[key]);
  // Fonts are often listed on the CSS's own manifest entry, not the chunk's
  for (const c of Object.values(manifest)) {
    if (c.file?.endsWith('.css') && seen.has(c.file)) for (const asset of c.assets ?? []) if (FONT.test(asset)) add(asset, 'font');
  }
  return { version, files };
}
