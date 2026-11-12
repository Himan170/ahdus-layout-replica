// The placeholder characters: tiny rigged figures made from boxes, written as
// glTF binary (.glb) by this script (no 3D program, no downloads). Ours, CC0.
//   node scripts/make-placeholder-character.mjs
//   → public/assets/characters/placeholder-mixamo.glb  (Mixamo bone names, "mixamorig:" prefix)
//     public/assets/characters/placeholder-ue.glb      (Unreal-style names: pelvis, spine_01, thigh_l, …)
//     public/assets/characters/placeholder-walk.glb    (a walk clip only: the Mixamo-named skeleton + one animation,
//                                                       no mesh; walkthrough retargets it onto the player's character)
//     public/assets/characters/manifest.json           (the embed's character manifest for tests and demos)
// Same skeleton as a Mixamo character (Hips → Spine → Spine1 → Spine2 → Neck → Head, shoulders, arms,
// legs, feet), 1.75 m tall, in a T-pose, facing +Z: so CharacterSystem's pose code is tested on real
// skinned meshes. Each box follows one bone (weight 1). docs/ASSET_LICENSES.md.
// The material REQUIRES two glTF extensions, like the AHDUS office characters: a tiny white WebP texture
// (EXT_texture_webp) and KHR_materials_specular. If the loader ever lacks one, the file fails to load and
// e2e:characters fails (people stay simple figures), instead of real characters silently not showing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer/encoder';

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

/** A .glb from a glTF JSON and its binary chunks (each padded to 4 bytes). */
function glb(gltf, bin) {
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
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

// ── The walk clip: one cycle (two steps) in WALK_SECONDS, moving forward WALK_METRES (root motion on the hips) ──
const WALK_SECONDS = 1.0;
const WALK_METRES = 1.2;
const WALK_KEYS = 16;
/** Rotation about an axis, as a glTF quaternion [x, y, z, w]. */
const axisQuat = (axis, a) => [axis[0] * Math.sin(a / 2), axis[1] * Math.sin(a / 2), axis[2] * Math.sin(a / 2), Math.cos(a / 2)];
/** a ∘ b (b first), glTF quaternions. */
const mulQuat = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];
const X = [1, 0, 0];
const Z = [0, 0, 1];

function makeWalkGlb() {
  const joints = JOINTS.map(([mixamo, , parent, pos]) => ({ key: mixamo, name: `mixamorig:${mixamo}`, parent, pos }));
  const index = new Map(joints.map((j, i) => [j.key, i]));
  const nodes = joints.map((j) => {
    const parent = j.parent ? joints[index.get(j.parent)] : null;
    return { name: j.name, translation: parent ? j.pos.map((v, k) => +(v - parent.pos[k]).toFixed(4)) : j.pos };
  });
  joints.forEach((j, i) => {
    const children = joints.map((c, k) => (c.parent === j.key ? k : -1)).filter((k) => k >= 0);
    if (children.length) nodes[i].children = children;
  });

  // Key times and, per bone, a rotation at each time (the arms hang down from the T-pose first)
  const times = Array.from({ length: WALK_KEYS + 1 }, (_, i) => (i / WALK_KEYS) * WALK_SECONDS);
  const phase = (t) => (2 * Math.PI * t) / WALK_SECONDS;
  const rot = {
    // +X turns a hanging limb backwards (its end goes to -Z): a thigh forward is a negative angle
    LeftUpLeg: (p) => axisQuat(X, -0.42 * Math.sin(p)),
    RightUpLeg: (p) => axisQuat(X, 0.42 * Math.sin(p)),
    LeftLeg: (p) => axisQuat(X, 0.6 * Math.max(0, Math.cos(p))),
    RightLeg: (p) => axisQuat(X, 0.6 * Math.max(0, -Math.cos(p))),
    LeftArm: (p) => mulQuat(axisQuat(X, 0.32 * Math.sin(p)), axisQuat(Z, -1.3)),
    RightArm: (p) => mulQuat(axisQuat(X, -0.32 * Math.sin(p)), axisQuat(Z, 1.3)),
    LeftForeArm: (p) => axisQuat(X, -0.25 - 0.1 * Math.sin(p)),
    RightForeArm: (p) => axisQuat(X, -0.25 + 0.1 * Math.sin(p)),
    Spine: (p) => axisQuat([0, 1, 0], 0.06 * Math.sin(p)),
  };
  const hips = joints[index.get('Hips')].pos;
  const hipsAt = (t) => [hips[0], hips[1] + 0.025 * Math.cos(2 * phase(t)), hips[2] + (WALK_METRES * t) / WALK_SECONDS];

  const chunks = [];
  const views = [];
  const accessors = [];
  let offset = 0;
  const add = (values, accessor) => {
    const bytes = Buffer.from(new Float32Array(values).buffer);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    accessors.push({ bufferView: views.length - 1, componentType: 5126, ...accessor });
    return accessors.length - 1;
  };
  const input = add(times, { count: times.length, type: 'SCALAR', min: [0], max: [WALK_SECONDS] });
  const samplers = [];
  const channels = [];
  const animate = (node, path, values, type) => {
    samplers.push({ input, interpolation: 'LINEAR', output: add(values, { count: times.length, type }) });
    channels.push({ sampler: samplers.length - 1, target: { node, path } });
  };
  for (const [bone, f] of Object.entries(rot)) animate(index.get(bone), 'rotation', times.flatMap((t) => f(phase(t))), 'VEC4');
  animate(index.get('Hips'), 'translation', times.flatMap(hipsAt), 'VEC3');

  const gltf = {
    asset: { version: '2.0', generator: 'ahdus-layout-replica scripts/make-placeholder-character.mjs (CC0)' },
    scene: 0,
    scenes: [{ name: 'Walk', nodes: [index.get('Hips')] }],
    nodes,
    animations: [{ name: 'Walk', samplers, channels }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  return glb(gltf, Buffer.concat(chunks));
}

// ── v0.16.0: a figure built like a Rocketbox character, and a clip set ──
//
// placeholder-suit.glb / placeholder-own.glb: the parts the Rocketbox files have, each its own mesh and material
// (white, so tints multiply onto the vertex colours): Body (head, neck), Hair, Shoes, Trousers (light grey),
// Top_shirt + Skin_shirt (hands), Top_tee + Skin_tee (forearms, hands), and the suit: Outfit_formal + Skin_formal
// (fitted suit) or Outfit_original + Skin_original (their own suit, no Outfit_formal). One skeleton with Mixamo names
// ("mixamorig:") plus an unprefixed face bone ("Bip01 MJaw"), like the Rocketbox files. Compressed the same way:
// EXT_meshopt_compression and KHR_mesh_quantization (int8 normals), both REQUIRED.
// placeholder-clips.glb: an animation-only clip set (no mesh): Idle, Walk, Run, Wave, Sit, Type.

const ROCKETBOX_JOINTS = [...JOINTS, ['Bip01 MJaw', null, 'Head', [0, 1.6, 0.06]]];
const jointName = (key) => (key.startsWith('Bip01') ? key : `mixamorig:${key}`);
const GREY = [0.78, 0.78, 0.8];
const WHITE = [1, 1, 1];

/** Boxes per part: [part, bone, min, max, colour]. `suit` colours the suit. */
function outfitParts(suit) {
  const parts = [];
  const add = (part, bone, min, max, color) => parts.push([part, bone, min, max, color]);
  add('Body', 'Neck', [-0.045, 1.46, -0.04], [0.045, 1.56, 0.04], C.skin);
  add('Body', 'Head', [-0.1, 1.56, -0.11], [0.1, 1.74, 0.11], C.skin);
  add('Body', 'Head', [0.035, 1.65, 0.105], [0.065, 1.67, 0.115], C.eyes);
  add('Body', 'Head', [-0.065, 1.65, 0.105], [-0.035, 1.67, 0.115], C.eyes);
  add('Hair', 'Head', [-0.105, 1.68, -0.12], [0.105, 1.75, 0.1], C.hair);
  add('Hair', 'Head', [-0.105, 1.58, -0.125], [0.105, 1.7, -0.08], C.hair);
  const torso = (part, color, wide = 0) => {
    add(part, 'Hips', [-0.16 - wide, 0.98, -0.1 - wide], [0.16 + wide, 1.03, 0.1 + wide], color);
    add(part, 'Spine', [-0.165 - wide, 1.03, -0.1 - wide], [0.165 + wide, 1.17, 0.1 + wide], color);
    add(part, 'Spine1', [-0.17 - wide, 1.17, -0.105 - wide], [0.17 + wide, 1.3, 0.11 + wide], color);
    add(part, 'Spine2', [-0.18 - wide, 1.3, -0.105 - wide], [0.18 + wide, 1.46, 0.11 + wide], color);
  };
  const legs = (part, color) => {
    add(part, 'Hips', [-0.16, 0.86, -0.1], [0.16, 0.98, 0.1], color);
    for (const s of [1, -1]) {
      add(part, `${s === 1 ? 'Left' : 'Right'}UpLeg`, [s * 0.09 - 0.075, 0.5, -0.075], [s * 0.09 + 0.075, 0.92, 0.075], color);
      add(part, `${s === 1 ? 'Left' : 'Right'}Leg`, [s * 0.09 - 0.062, 0.1, -0.06], [s * 0.09 + 0.062, 0.5, 0.06], color);
    }
  };
  const feet = (part) => {
    for (const s of [1, -1]) {
      const side = s === 1 ? 'Left' : 'Right';
      add(part, `${side}Foot`, [s * 0.09 - 0.06, 0, -0.06], [s * 0.09 + 0.06, 0.1, 0.12], C.shoes);
      add(part, `${side}ToeBase`, [s * 0.09 - 0.055, 0, 0.12], [s * 0.09 + 0.055, 0.06, 0.2], C.shoes);
    }
  };
  /** Sleeves to `upTo` (1 = the wrist, 0.5 = half the upper arm), hands, and bare forearms when short. */
  const arms = (top, skin, color, sleeve) => {
    for (const s of [1, -1]) {
      const side = s === 1 ? 'Left' : 'Right';
      const x = (a, b) => (s === 1 ? [a, b] : [-b, -a]);
      const [s0, s1] = x(0.04, 0.2);
      const [a0, a1] = x(0.19, 0.47);
      const [h0, h1] = x(0.33, 0.47);
      const [f0, f1] = x(0.47, 0.72);
      const [k0, k1] = x(0.72, 0.87);
      add(top, `${side}Shoulder`, [s0, 1.37, -0.07], [s1, 1.46, 0.07], color);
      if (sleeve === 'long') {
        add(top, `${side}Arm`, [a0, 1.37, -0.055], [a1, 1.47, 0.055], color);
        add(top, `${side}ForeArm`, [f0, 1.375, -0.045], [f1, 1.465, 0.045], color);
      } else {
        add(top, `${side}Arm`, [s === 1 ? a0 : h0, 1.37, -0.058], [s === 1 ? h0 : a1, 1.47, 0.058], color);
        add(skin, `${side}Arm`, [s === 1 ? h0 : a0, 1.38, -0.045], [s === 1 ? a1 : h0, 1.46, 0.045], C.skin);
        add(skin, `${side}ForeArm`, [f0, 1.38, -0.04], [f1, 1.46, 0.04], C.skin);
      }
      add(skin, `${side}Hand`, [k0, 1.385, -0.035], [k1, 1.455, 0.04], C.skin);
    }
  };
  // shirt / T-shirt with the trousers and shoes
  torso('Top_shirt', WHITE);
  arms('Top_shirt', 'Skin_shirt', WHITE, 'long');
  torso('Top_tee', WHITE);
  arms('Top_tee', 'Skin_tee', WHITE, 'short');
  legs('Trousers', GREY);
  feet('Shoes');
  // the suit: jacket a little wider, its own trousers and shoes
  const [outfit, skin] = suit === 'fitted' ? ['Outfit_formal', 'Skin_formal'] : ['Outfit_original', 'Skin_original'];
  const cloth = suit === 'fitted' ? [0.2, 0.22, 0.3] : [0.28, 0.27, 0.27];
  torso(outfit, cloth, 0.008);
  arms(outfit, skin, cloth, 'long');
  add(outfit, 'Spine2', [-0.04, 1.36, 0.11], [0.04, 1.46, 0.125], WHITE); // the shirt front
  legs(outfit, cloth);
  feet(outfit);
  return parts;
}

/** A Rocketbox-like character: one mesh per part, one skin, meshopt + quantization. */
function makeOutfitGlb(suit) {
  const joints = ROCKETBOX_JOINTS.map(([key, , parent, pos]) => ({ key, name: jointName(key), parent, pos }));
  const index = new Map(joints.map((j, i) => [j.key, i]));
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  const byPart = new Map();
  for (const [part, bone, min, max, color] of outfitParts(suit)) {
    if (!byPart.has(part)) byPart.set(part, { positions: [], normals: [], colors: [], jointIds: [], weights: [], indices: [] });
    const g = byPart.get(part);
    for (const [n, corners] of FACES) {
      const first = g.positions.length / 3;
      for (const c of corners) {
        g.positions.push(...c.map((k, i) => (k ? max[i] : min[i])));
        g.normals.push(...n.map((v) => v * 127), 0);
        g.colors.push(...color, 1);
        g.jointIds.push(index.get(bone), 0, 0, 0);
        g.weights.push(1, 0, 0, 0);
      }
      g.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }

  const views = [];
  const accessors = [];
  const raw = []; // [data, stride, count, mode]
  /** A bufferView compressed with meshopt (its data in buffer 0, a fallback with no data in buffer 1). */
  const view = (typed, stride, count, mode, target) => {
    raw.push([new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), stride, count, mode]);
    views.push({ buffer: 1, byteOffset: 0, byteLength: typed.byteLength, ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}),
      ...(target ? { target } : {}) });
    return views.length - 1;
  };
  const add = (typed, stride, accessor, mode = 'ATTRIBUTES', target = 34962) => {
    accessors.push({ bufferView: view(typed, stride, accessor.count, mode, target), ...accessor });
    return accessors.length - 1;
  };
  const bounds = (a) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); }
    return { min, max };
  };
  const meshes = [];
  const materials = [];
  const nodes = [];
  for (const [part, g] of byPart) {
    const count = g.positions.length / 3;
    const attributes = {
      POSITION: add(new Float32Array(g.positions), 12, { componentType: 5126, count, type: 'VEC3', ...bounds(g.positions) }),
      // int8 normals (padded to 4 bytes): only valid with KHR_mesh_quantization
      NORMAL: add(new Int8Array(g.normals), 4, { componentType: 5120, normalized: true, count, type: 'VEC3' }),
      COLOR_0: add(new Float32Array(g.colors), 16, { componentType: 5126, count, type: 'VEC4' }),
      JOINTS_0: add(new Uint16Array(g.jointIds), 8, { componentType: 5123, count, type: 'VEC4' }),
      WEIGHTS_0: add(new Float32Array(g.weights), 16, { componentType: 5126, count, type: 'VEC4' }),
    };
    const indices = add(new Uint16Array(g.indices), 2, { componentType: 5123, count: g.indices.length, type: 'SCALAR' },
      'TRIANGLES', 34963);
    materials.push({ name: part, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } });
    meshes.push({ name: part, primitives: [{ attributes, indices, material: materials.length - 1 }] });
    nodes.push({ name: part, mesh: meshes.length - 1, skin: 0 });
  }
  const ibm = joints.flatMap(({ pos: [x, y, z] }) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]);
  const ibmAccessor = add(new Float32Array(ibm), 64, { componentType: 5126, count: joints.length, type: 'MAT4' }, 'ATTRIBUTES', 0);
  delete views[accessors[ibmAccessor].bufferView].target;
  delete views[accessors[ibmAccessor].bufferView].byteStride;

  const first = nodes.length;
  joints.forEach((j) => {
    const parent = j.parent ? joints[index.get(j.parent)] : null;
    nodes.push({ name: j.name, translation: parent ? j.pos.map((v, k) => +(v - parent.pos[k]).toFixed(4)) : j.pos });
  });
  joints.forEach((j, i) => {
    const children = joints.map((c, k) => (c.parent === j.key ? first + k : -1)).filter((k) => k >= 0);
    if (children.length) nodes[first + i].children = children;
  });
  const hips = first + index.get('Hips');

  // meshopt: every view compressed into buffer 0; buffer 1 is the fallback (no data in the file)
  const chunks = [];
  let packed = 0;
  let plain = 0;
  raw.forEach(([data, stride, count, mode], i) => {
    const bytes = Buffer.from(MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode));
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    views[i].byteOffset = plain;
    views[i].extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: packed, byteLength: bytes.length, byteStride: stride, count, mode } };
    plain += (data.byteLength + 3) & ~3;
    chunks.push(padded);
    packed += padded.length;
  });

  const gltf = {
    asset: { version: '2.0', generator: 'ahdus-layout-replica scripts/make-placeholder-character.mjs (CC0)' },
    scene: 0,
    scenes: [{ name: 'Placeholder', nodes: [...byPart.keys()].map((_, i) => i).concat(hips) }],
    nodes,
    meshes,
    materials,
    skins: [{ name: 'Armature', inverseBindMatrices: ibmAccessor, joints: joints.map((_, i) => first + i), skeleton: hips }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: packed }, { byteLength: plain, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
  };
  return glb(gltf, Buffer.concat(chunks));
}

/**
 * The clip set: one skeleton (Mixamo names, the placeholder's T-pose) and six clips, no mesh. Rotations are
 * local = about the world axes (the joints have no rest rotation). The arms hang down first (Z ±1.3).
 */
function makeClipsGlb() {
  const joints = JOINTS.map(([key, , parent, pos]) => ({ key, name: `mixamorig:${key}`, parent, pos }));
  const index = new Map(joints.map((j, i) => [j.key, i]));
  const nodes = joints.map((j) => {
    const parent = j.parent ? joints[index.get(j.parent)] : null;
    return { name: j.name, translation: parent ? j.pos.map((v, k) => +(v - parent.pos[k]).toFixed(4)) : j.pos };
  });
  joints.forEach((j, i) => {
    const children = joints.map((c, k) => (c.parent === j.key ? k : -1)).filter((k) => k >= 0);
    if (children.length) nodes[i].children = children;
  });
  const hips = joints[index.get('Hips')].pos;
  const Y = [0, 1, 0];
  const down = { LeftArm: axisQuat(Z, -1.3), RightArm: axisQuat(Z, 1.3) };
  const armDown = (side, forward = 0) => mulQuat(axisQuat(X, -forward), down[`${side}Arm`]);

  const chunks = [];
  const views = [];
  const accessors = [];
  let offset = 0;
  const data = (values, accessor) => {
    const bytes = Buffer.from(new Float32Array(values).buffer);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    accessors.push({ bufferView: views.length - 1, componentType: 5126, ...accessor });
    return accessors.length - 1;
  };
  /** A clip: `seconds` long, `keys` + 1 samples, bones → (phase 0…2π) → quaternion, hips → (phase, t) → position. */
  const clip = (name, seconds, keys, bones, hipsAt) => {
    const times = Array.from({ length: keys + 1 }, (_, i) => (i / keys) * seconds);
    const input = data(times, { count: times.length, type: 'SCALAR', min: [0], max: [seconds] });
    const samplers = [];
    const channels = [];
    const animate = (node, path, values, type) => {
      samplers.push({ input, interpolation: 'LINEAR', output: data(values, { count: times.length, type }) });
      channels.push({ sampler: samplers.length - 1, target: { node, path } });
    };
    for (const [bone, f] of Object.entries(bones)) animate(index.get(bone), 'rotation', times.flatMap((t) => f((2 * Math.PI * t) / seconds)), 'VEC4');
    animate(index.get('Hips'), 'translation', times.flatMap((t) => hipsAt((2 * Math.PI * t) / seconds, t)), 'VEC3');
    return { name, samplers, channels };
  };
  const still = () => [...hips];
  const legsWalk = (swing, knee) => ({
    LeftUpLeg: (p) => axisQuat(X, -swing * Math.sin(p)),
    RightUpLeg: (p) => axisQuat(X, swing * Math.sin(p)),
    LeftLeg: (p) => axisQuat(X, knee * Math.max(0, Math.cos(p))),
    RightLeg: (p) => axisQuat(X, knee * Math.max(0, -Math.cos(p))),
  });
  // seated: thighs forward, shins down, the hips on a 0.46 m seat (+ 0.1)
  const seatedLegs = {
    LeftUpLeg: () => axisQuat(X, -1.5), RightUpLeg: () => axisQuat(X, -1.5),
    LeftLeg: () => axisQuat(X, 1.45), RightLeg: () => axisQuat(X, 1.45),
  };
  const seatedHips = () => [hips[0], 0.56, hips[2] - 0.05];
  const animations = [
    clip('Idle', 4, 16, {
      LeftArm: () => armDown('Left'), RightArm: () => armDown('Right'),
      Spine: (p) => axisQuat(X, 0.02 * Math.sin(p)),
    }, still),
    clip('Walk', 1, 16, {
      ...legsWalk(0.42, 0.6),
      LeftArm: (p) => mulQuat(axisQuat(X, 0.32 * Math.sin(p)), down.LeftArm),
      RightArm: (p) => mulQuat(axisQuat(X, -0.32 * Math.sin(p)), down.RightArm),
      Spine: (p) => axisQuat(Y, 0.06 * Math.sin(p)),
    }, (p, t) => [hips[0], hips[1] + 0.025 * Math.cos(2 * p), hips[2] + 1.2 * t]),
    clip('Run', 0.7, 14, {
      ...legsWalk(0.75, 1.3),
      LeftArm: (p) => mulQuat(axisQuat(X, 0.7 * Math.sin(p)), down.LeftArm),
      RightArm: (p) => mulQuat(axisQuat(X, -0.7 * Math.sin(p)), down.RightArm),
      LeftForeArm: () => axisQuat(X, -1.3), RightForeArm: () => axisQuat(X, -1.3),
      Spine: () => axisQuat(X, 0.15),
    }, (p, t) => [hips[0], hips[1] - 0.04 + 0.05 * Math.cos(2 * p), hips[2] + (2.8 * t) / 0.7]),
    clip('Wave', 2, 16, {
      LeftArm: () => armDown('Left'),
      RightArm: () => axisQuat(Z, -1.1), // the right arm up and out
      RightForeArm: (p) => axisQuat(Z, -0.5 + 0.45 * Math.sin(2 * p)),
    }, still),
    clip('Sit', 4, 8, {
      ...seatedLegs,
      LeftArm: () => armDown('Left', 0.5), RightArm: () => armDown('Right', 0.5),
      LeftForeArm: () => axisQuat(X, -0.9), RightForeArm: () => axisQuat(X, -0.9),
      Spine: (p) => axisQuat(X, -0.05 + 0.02 * Math.sin(p)),
    }, seatedHips),
    clip('Type', 1, 16, {
      ...seatedLegs,
      Spine: () => axisQuat(X, 0.12),
      LeftArm: () => armDown('Left', 0.75), RightArm: () => armDown('Right', 0.75),
      LeftForeArm: () => axisQuat(X, -1.0), RightForeArm: () => axisQuat(X, -1.0),
      LeftHand: (p) => axisQuat(X, 0.15 * Math.max(0, Math.sin(4 * p))),
      RightHand: (p) => axisQuat(X, 0.15 * Math.max(0, -Math.sin(4 * p))),
    }, seatedHips),
  ];
  const gltf = {
    asset: { version: '2.0', generator: 'ahdus-layout-replica scripts/make-placeholder-character.mjs (CC0)' },
    scene: 0,
    scenes: [{ name: 'Clips', nodes: [index.get('Hips')] }],
    nodes,
    animations,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  return glb(gltf, Buffer.concat(chunks));
}

await MeshoptEncoder.ready;
mkdirSync(OUT, { recursive: true });
const files = [
  ['placeholder-mixamo.glb', makeGlb({ rig: 'mixamo', shirt: [0.24, 0.43, 0.84] })],
  ['placeholder-ue.glb', makeGlb({ rig: 'ue', shirt: [0.16, 0.4, 0.31] })],
  ['placeholder-walk.glb', makeWalkGlb()],
  ['placeholder-suit.glb', makeOutfitGlb('fitted')],
  ['placeholder-own.glb', makeOutfitGlb('own')],
  ['placeholder-clips.glb', makeClipsGlb()],
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
