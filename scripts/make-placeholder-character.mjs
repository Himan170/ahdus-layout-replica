// The placeholder characters: tiny rigged figures made from boxes, written as
// glTF binary (.glb) by this script (no 3D program, no downloads). Ours, CC0.
//   node scripts/make-placeholder-character.mjs
//   → public/assets/characters/placeholder-mixamo.glb  (Mixamo bone names, "mixamorig:" prefix)
//     public/assets/characters/placeholder-ue.glb      (Unreal-style names: pelvis, spine_01, thigh_l, …)
//     public/assets/characters/manifest.json           (the embed's character manifest for tests and demos)
// Same skeleton as a Mixamo character (Hips → Spine → Spine1 → Spine2 → Neck → Head, shoulders, arms,
// legs, feet), 1.75 m tall, in a T-pose, facing +Z: so CharacterSystem's pose code is tested on real
// skinned meshes. Each box follows one bone (weight 1). docs/ASSET_LICENSES.md.
// The material REQUIRES two glTF extensions, like the AHDUS office characters: a tiny white WebP texture
// (EXT_texture_webp) and KHR_materials_specular. If the loader ever lacks one, the file fails to load and
// e2e:characters fails (people stay simple figures), instead of real characters silently not showing.
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/assets/characters';

// ── The skeleton: [mixamo name, unreal name, parent, world position (glTF: +Y up, +Z forward, +X = its left)] ──
const JOINTS = [
  ['Hips', 'pelvis', null, [0, 0.95, 0]],
  ['Spine', 'spine_01', 'Hips', [0, 1.05, 0]],
  ['Spine1', 'spine_02', 'Spine', [0, 1.17, 0]],
  ['Spine2', 'spine_03', 'Spine1', [0, 1.3, 0]],
  ['Neck', 'neck_01', 'Spine2', [0, 1.47, 0]],
  ['Head', 'head', 'Neck', [0, 1.56, 0]],
  ['HeadTop_End', null, 'Head', [0, 1.75, 0]],
  ...['Left', 'Right'].flatMap((side) => {
    const s = side === 'Left' ? 1 : -1;
    const u = side === 'Left' ? 'l' : 'r';
    return [
      [`${side}Shoulder`, `clavicle_${u}`, 'Spine2', [s * 0.06, 1.42, 0]],
      [`${side}Arm`, `upperarm_${u}`, `${side}Shoulder`, [s * 0.19, 1.42, 0]],
      [`${side}ForeArm`, `lowerarm_${u}`, `${side}Arm`, [s * 0.47, 1.42, 0]],
      [`${side}Hand`, `hand_${u}`, `${side}ForeArm`, [s * 0.72, 1.42, 0]],
      [`${side}HandMiddle4`, null, `${side}Hand`, [s * 0.88, 1.42, 0]],
      [`${side}UpLeg`, `thigh_${u}`, 'Hips', [s * 0.09, 0.9, 0]],
      [`${side}Leg`, `calf_${u}`, `${side}UpLeg`, [s * 0.09, 0.5, 0]],
      [`${side}Foot`, `foot_${u}`, `${side}Leg`, [s * 0.09, 0.09, 0]],
      [`${side}ToeBase`, `ball_${u}`, `${side}Foot`, [s * 0.09, 0.02, 0.12]],
      [`${side}Toe_End`, null, `${side}ToeBase`, [s * 0.09, 0.02, 0.2]],
    ];
  }),
];

// ── The body: boxes [bone, min xyz, max xyz, colour] in world space (bind pose) ──
/** 4 × 4 white pixels, lossless WebP (made with sharp): multiplies the vertex colours by 1. */
const WHITE_WEBP = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAfQ//73v/+BiOh/AAA=', 'base64');
const C = {
  skin: [0.85, 0.66, 0.51], hair: [0.18, 0.13, 0.1], trousers: [0.17, 0.19, 0.25], shoes: [0.08, 0.08, 0.09],
  eyes: [0.05, 0.05, 0.06],
};
function body(shirt) {
  const boxes = [
    ['Hips', [-0.16, 0.86, -0.1], [0.16, 1.03, 0.1], C.trousers],
    ['Spine', [-0.165, 1.03, -0.1], [0.165, 1.17, 0.1], shirt],
    ['Spine1', [-0.17, 1.17, -0.105], [0.17, 1.3, 0.11], shirt],
    ['Spine2', [-0.18, 1.3, -0.105], [0.18, 1.46, 0.11], shirt],
    ['Neck', [-0.045, 1.46, -0.04], [0.045, 1.56, 0.04], C.skin],
    ['Head', [-0.1, 1.56, -0.11], [0.1, 1.74, 0.11], C.skin],
    ['Head', [-0.105, 1.68, -0.12], [0.105, 1.75, 0.1], C.hair],
    ['Head', [-0.105, 1.58, -0.125], [0.105, 1.7, -0.08], C.hair],
    ['Head', [0.035, 1.65, 0.105], [0.065, 1.67, 0.115], C.eyes],
    ['Head', [-0.065, 1.65, 0.105], [-0.035, 1.67, 0.115], C.eyes],
  ];
  for (const s of [1, -1]) {
    const side = s === 1 ? 'Left' : 'Right';
    const x = (a, b) => (s === 1 ? [a, b] : [-b, -a]);
    const [s0, s1] = x(0.04, 0.2);
    const [a0, a1] = x(0.19, 0.47);
    const [f0, f1] = x(0.47, 0.72);
    const [h0, h1] = x(0.72, 0.87);
    boxes.push(
      [`${side}Shoulder`, [s0, 1.37, -0.07], [s1, 1.46, 0.07], shirt],
      [`${side}Arm`, [a0, 1.37, -0.055], [a1, 1.47, 0.055], shirt],
      [`${side}ForeArm`, [f0, 1.375, -0.045], [f1, 1.465, 0.045], shirt],
      [`${side}Hand`, [h0, 1.385, -0.035], [h1, 1.455, 0.04], C.skin],
      [`${side}UpLeg`, [s * 0.09 - 0.075, 0.5, -0.075], [s * 0.09 + 0.075, 0.92, 0.075], C.trousers],
      [`${side}Leg`, [s * 0.09 - 0.062, 0.09, -0.06], [s * 0.09 + 0.062, 0.5, 0.06], C.trousers],
      [`${side}Foot`, [s * 0.09 - 0.06, 0, -0.06], [s * 0.09 + 0.06, 0.1, 0.12], C.shoes],
      [`${side}ToeBase`, [s * 0.09 - 0.055, 0, 0.12], [s * 0.09 + 0.055, 0.06, 0.2], C.shoes],
    );
  }
  return boxes;
}

// ── glTF binary ──
function makeGlb({ rig, shirt }) {
  const joints = JOINTS.filter(([, ue]) => rig === 'mixamo' || ue)
    .map(([mixamo, ue, parent, pos]) => ({ key: mixamo, name: rig === 'mixamo' ? `mixamorig:${mixamo}` : ue, parent, pos }));
  const index = new Map(joints.map((j, i) => [j.key, i]));

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const jointIds = [];
  const weights = [];
  const indices = [];
  // a box's 6 faces: normal, then 4 corners (counter-clockwise seen from outside)
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  for (const [bone, min, max, color] of body(shirt)) {
    const j = index.get(bone);
    for (const [n, corners] of FACES) {
      const first = positions.length / 3;
      for (const c of corners) {
        positions.push(...c.map((k, i) => (k ? max[i] : min[i])));
        normals.push(...n);
        uvs.push(0.5, 0.5);
        colors.push(...color, 1);
        jointIds.push(j, 0, 0, 0);
        weights.push(1, 0, 0, 0);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  // inverse bind matrices: the joints have no rotation, so a translation by -position (column-major)
  const ibm = joints.flatMap(({ pos: [x, y, z] }) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]);

  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;
  const view = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(padded);
    offset += padded.length;
    return views.length - 1;
  };
  const add = (typed, accessor, target) => {
    accessors.push({ bufferView: view(typed, target), ...accessor });
    return accessors.length - 1;
  };
  const vec3Bounds = (a) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); }
    return { min, max };
  };
  const count = positions.length / 3;
  const ARRAY = 34962;
  const ELEMENTS = 34963;
  const FLOAT = 5126;
  const attributes = {
    POSITION: add(new Float32Array(positions), { componentType: FLOAT, count, type: 'VEC3', ...vec3Bounds(positions) }, ARRAY),
    NORMAL: add(new Float32Array(normals), { componentType: FLOAT, count, type: 'VEC3' }, ARRAY),
    TEXCOORD_0: add(new Float32Array(uvs), { componentType: FLOAT, count, type: 'VEC2' }, ARRAY),
    COLOR_0: add(new Float32Array(colors), { componentType: FLOAT, count, type: 'VEC4' }, ARRAY),
    JOINTS_0: add(new Uint16Array(jointIds), { componentType: 5123, count, type: 'VEC4' }, ARRAY),
    WEIGHTS_0: add(new Float32Array(weights), { componentType: FLOAT, count, type: 'VEC4' }, ARRAY),
  };
  const indexAccessor = add(new Uint16Array(indices), { componentType: 5123, count: indices.length, type: 'SCALAR' }, ELEMENTS);
  const ibmAccessor = add(new Float32Array(ibm), { componentType: FLOAT, count: joints.length, type: 'MAT4' });
  const imageView = view(WHITE_WEBP);

  // nodes: 0 = the mesh, then the joints (translations relative to their parent)
  const nodes = [{ name: 'Body', mesh: 0, skin: 0 }];
  joints.forEach((j) => {
    const parent = j.parent ? joints[index.get(j.parent)] : null;
    const t = parent ? j.pos.map((v, k) => +(v - parent.pos[k]).toFixed(4)) : j.pos;
    nodes.push({ name: j.name, translation: t });
  });
  joints.forEach((j, i) => {
    const children = joints.map((c, k) => (c.parent === j.key ? k + 1 : -1)).filter((k) => k >= 0);
    if (children.length) nodes[i + 1].children = children;
  });
  let roots = [index.get('Hips') + 1];
  if (rig === 'ue') {
    // Victoria-style files have a Root joint at the feet above the pelvis
    nodes.push({ name: 'Root', children: roots });
    roots = [nodes.length - 1];
  }

  const gltf = {
    asset: { version: '2.0', generator: 'ahdus-layout-replica scripts/make-placeholder-character.mjs (CC0)' },
    scene: 0,
    scenes: [{ name: 'Placeholder', nodes: [0, ...roots] }],
    nodes,
    meshes: [{ name: 'Body', primitives: [{ attributes, indices: indexAccessor, material: 0 }] }],
    materials: [{
      name: 'Placeholder',
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 },
      extensions: { KHR_materials_specular: { specularFactor: 0.5 } },
    }],
    // only the WebP source, no PNG / JPEG fallback: so EXT_texture_webp is required
    textures: [{ sampler: 0, extensions: { EXT_texture_webp: { source: 0 } } }],
    samplers: [{ magFilter: 9729, minFilter: 9729 }],
    images: [{ bufferView: imageView, mimeType: 'image/webp' }],
    extensionsUsed: ['EXT_texture_webp', 'KHR_materials_specular'],
    extensionsRequired: ['EXT_texture_webp', 'KHR_materials_specular'],
    skins: [{ name: 'Armature', inverseBindMatrices: ibmAccessor, joints: joints.map((_, i) => i + 1), skeleton: roots[0] }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };

  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['placeholder-mixamo.glb', makeGlb({ rig: 'mixamo', shirt: [0.24, 0.43, 0.84] })],
  ['placeholder-ue.glb', makeGlb({ rig: 'ue', shirt: [0.16, 0.4, 0.31] })],
];
for (const [name, data] of files) {
  writeFileSync(`${OUT}/${name}`, data);
  console.log(`${OUT}/${name}  ${(data.length / 1024).toFixed(1)} kB`);
}
// The manifest the tests and demos use: assetReference → { url (relative to this file), rig, height }
const manifest = {
  'placeholder:mixamo-v1': { url: 'placeholder-mixamo.glb', rig: 'mixamo', height: 1.75 },
  'placeholder:ue-v1': { url: 'placeholder-ue.glb', rig: 'ue', height: 1.68 },
  'placeholder:tall-v1': { url: 'placeholder-mixamo.glb', rig: 'mixamo', height: 1.88 },
};
writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${OUT}/manifest.json`);
