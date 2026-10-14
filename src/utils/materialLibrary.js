/**
 * materialLibrary.js
 *
 * Realistic-looking materials drawn in code (canvas → DynamicTexture), so the
 * project needs no image downloads. Each material is created ONCE per scene and
 * shared by every room/wall that uses it.
 *
 * Textures repeat in real-world units: call scaleUVs(mesh, width, depth, tile)
 * on a floor so planks/tiles keep their real size whatever the room size.
 *
 * Later (Workstream C) these can be swapped for photo-scanned PBR textures
 * without touching roomBuilder: only this file changes.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

// ── Seeded random so textures look the same every time ──
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `rgb(${r},${g},${b})`;
}

function noise(ctx, size, rand, alpha, count = size * size * 0.15, light = false) {
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand() * alpha})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
}

// ── Texture painters (each draws ONE repeat tile) ──
const painters = {
  /** Oak planks: 1 tile = 2 m × 2 m, planks 0.2 m wide, staggered joints */
  wood(ctx, S, rand) {
    const rows = 10;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * S * 0.6;
      while (x < S) {
        const len = S * (0.35 + rand() * 0.4);
        ctx.fillStyle = shade('#b48a5c', (rand() - 0.5) * 0.22);
        ctx.fillRect(x, r * h, len, h);
        // grain
        for (let g = 0; g < 7; g++) {
          ctx.strokeStyle = `rgba(80,50,25,${0.08 + rand() * 0.1})`;
          ctx.lineWidth = 0.6 + rand();
          const y = r * h + rand() * h;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 4, x + len * 0.7, y + (rand() - 0.5) * 4, x + len, y);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(40,25,10,0.55)';
        ctx.fillRect(x, r * h, 1.5, h); // end joint
        x += len;
      }
      ctx.fillStyle = 'rgba(40,25,10,0.5)';
      ctx.fillRect(0, r * h, S, 1.5); // long joint
    }
  },

  /** Office carpet tiles: 1 tile = 1 m (2 × 2 carpet squares of 0.5 m) */
  carpet(ctx, S, rand) {
    ctx.fillStyle = '#5b6672';
    ctx.fillRect(0, 0, S, S);
    noise(ctx, S, rand, 0.35, S * S * 0.5);
    noise(ctx, S, rand, 0.12, S * S * 0.3, true);
    ctx.strokeStyle = 'rgba(30,35,40,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, S / 2, S / 2);
    ctx.strokeRect(S / 2, S / 2, S / 2, S / 2);
    ctx.strokeRect(S / 2, 0, S / 2, S / 2);
    ctx.strokeRect(0, S / 2, S / 2, S / 2);
  },

  /** Large porcelain tiles: 1 tile = 1.2 m (2 × 2 tiles of 0.6 m) */
  tile(ctx, S, rand) {
    ctx.fillStyle = '#9a958d';
    ctx.fillRect(0, 0, S, S); // grout
    const t = S / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = shade('#e4e0d8', (rand() - 0.5) * 0.05);
        ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
        // soft marble veins
        for (let v = 0; v < 3; v++) {
          ctx.strokeStyle = `rgba(150,145,135,${0.08 + rand() * 0.1})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(i * t + rand() * t, j * t);
          ctx.quadraticCurveTo(i * t + rand() * t, j * t + t / 2, i * t + rand() * t, j * t + t);
          ctx.stroke();
        }
      }
    }
  },

  /** Small bathroom tiles: 1 tile = 0.8 m (4 × 4 tiles of 0.2 m) */
  smallTile(ctx, S, rand) {
    ctx.fillStyle = '#b8bcbf';
    ctx.fillRect(0, 0, S, S);
    const n = 4;
    const t = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = shade('#eef1f2', (rand() - 0.5) * 0.04);
        ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      }
    }
  },

  /** Polished/epoxy concrete for production areas: 1 tile = 4 m */
  concrete(ctx, S, rand) {
    ctx.fillStyle = '#8d918f';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? 0 : 255},${rand() < 0.5 ? 0 : 255},${rand() < 0.5 ? 0 : 255},0.025)`;
      ctx.beginPath();
      ctx.arc(rand() * S, rand() * S, 20 + rand() * 80, 0, Math.PI * 2);
      ctx.fill();
    }
    noise(ctx, S, rand, 0.2, S * S * 0.25);
    ctx.strokeStyle = 'rgba(50,50,50,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, S, S); // saw-cut joints every 4 m
  },

  /** Server-room raised floor: 1 tile = 1.2 m (2 × 2 panels of 0.6 m) */
  raised(ctx, S, rand) {
    ctx.fillStyle = '#54595e';
    ctx.fillRect(0, 0, S, S);
    const t = S / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = shade('#b9bdc1', (rand() - 0.5) * 0.05);
        ctx.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        if ((i + j) % 2 === 0) {
          ctx.fillStyle = 'rgba(60,65,70,0.45)';
          for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
            ctx.fillRect(i * t + 16 + a * ((t - 32) / 8), j * t + 16 + b * ((t - 32) / 8), 3, 3);
          }
        }
      }
    }
  },

  /**
   * Furniture wood veneer: long continuous grain, painted LIGHT and neutral so
   * any wood colour can be made by tinting (diffuseColor multiplies the texture).
   */
  veneer(ctx, S, rand) {
    ctx.fillStyle = '#f1e9dc';
    ctx.fillRect(0, 0, S, S);
    for (let g = 0; g < 70; g++) {
      const y = rand() * S;
      ctx.strokeStyle = `rgba(120,85,50,${0.05 + rand() * 0.12})`;
      ctx.lineWidth = 0.6 + rand() * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(S * 0.3, y + (rand() - 0.5) * 14, S * 0.7, y + (rand() - 0.5) * 14, S, y);
      ctx.stroke();
    }
    // a couple of soft knots
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = 'rgba(110,75,40,0.12)';
      const cx = rand() * S, cy = rand() * S;
      for (let r = 3; r < 14; r += 3) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 2.2, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },

  /** Upholstery fabric: fine woven texture, neutral so it can be tinted */
  fabric(ctx, S, rand) {
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.05})`;
      ctx.fillRect(0, y, S, 1);
    }
    for (let x = 0; x < S; x += 3) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.05})`;
      ctx.fillRect(x, 0, 1, S);
    }
    noise(ctx, S, rand, 0.12, S * S * 0.2);
  },

  /** Painted plaster wall */
  plaster(ctx, S, rand) {
    ctx.fillStyle = '#ece8e1';
    ctx.fillRect(0, 0, S, S);
    noise(ctx, S, rand, 0.06, S * S * 0.4);
    noise(ctx, S, rand, 0.05, S * S * 0.2, true);
  },

  /** Outdoor paving slabs around the building: 1 tile = 2 m (4 × 4 slabs) */
  paving(ctx, S, rand) {
    ctx.fillStyle = '#6f6b66';
    ctx.fillRect(0, 0, S, S);
    const n = 4;
    const t = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = shade('#a9a49c', (rand() - 0.5) * 0.12);
        ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      }
    }
    noise(ctx, S, rand, 0.15, S * S * 0.2);
  },

  /** Grass for the surrounding land: 1 tile = 4 m */
  grass(ctx, S, rand) {
    ctx.fillStyle = '#5d7d3c';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < S * S * 0.25; i++) {
      const g = 90 + rand() * 70;
      ctx.fillStyle = `rgba(${g * 0.55},${g},${g * 0.35},0.5)`;
      ctx.fillRect(rand() * S, rand() * S, 1, 2 + rand() * 3);
    }
  },
};

/** Real-world size (metres) covered by one repeat of each texture. */
export const TILE_SIZE = {
  wood: 2, carpet: 1, tile: 1.2, smallTile: 0.8, concrete: 4,
  raised: 1.2, plaster: 2, paving: 2, grass: 4,
};

/** Which floor each room type gets. */
export const FLOOR_BY_ROOM_TYPE = {
  OFFICE: 'wood',
  MEETING: 'carpet',
  RECEPTION: 'tile',
  CORRIDOR: 'tile',
  PRODUCTION: 'concrete',
  STAIRCASE: 'concrete',
  SERVER_ROOM: 'raised',
  RESTROOM: 'smallTile',
};

const libraries = new WeakMap();

function makeTextureMaterial(scene, key, { specular = 0.05, size = 512 } = {}) {
  const tex = new DynamicTexture(`tex_${key}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  painters[key](ctx, size, rng(key.length * 7919 + 17));
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;

  const mat = new StandardMaterial(`mat_${key}`, scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(specular, specular, specular);
  mat.specularPower = 64;
  return markShared(mat);
}

// ── Shared materials ─────────────────────────────────────────────────────
// Materials from this library are used by many meshes at once. Code that
// disposes a mesh must NOT dispose a shared material (it would break every
// other mesh using it). Check with isSharedMaterial() first.

export function markShared(material) {
  material.metadata = { ...(material.metadata ?? {}), shared: true };
  return material;
}

export function isSharedMaterial(material) {
  return !!material?.metadata?.shared;
}

/** Dispose a material unless it is shared. */
export function disposeMaterialIfOwned(material) {
  if (material && !isSharedMaterial(material)) material.dispose();
}

const assetCaches = new WeakMap();
const textureCaches = new WeakMap();

function sharedTexture(scene, key) {
  let cache = textureCaches.get(scene);
  if (!cache) textureCaches.set(scene, (cache = {}));
  if (!cache[key]) {
    const size = 256;
    const tex = new DynamicTexture(`tex_${key}`, { width: size, height: size }, scene, true);
    painters[key](tex.getContext(), size, rng(key.length * 7919 + 17));
    tex.update();
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    cache[key] = tex;
  }
  return cache[key];
}

/**
 * Shared furniture material, created once per (scene, finish, colour).
 * 50 identical desks now use ONE material instead of 50 × parts.
 *
 * @param {'matte'|'gloss'|'metal'|'glass'|'veneer'|'fabric'} finish
 * @param {string} hex  base colour (for veneer/fabric: the tint)
 */
export function getAssetMaterial(scene, finish, hex) {
  let cache = assetCaches.get(scene);
  if (!cache) assetCaches.set(scene, (cache = new Map()));
  const key = `${finish}:${hex}`;
  if (cache.has(key)) return cache.get(key);

  const m = new StandardMaterial(`asset_${finish}_${hex}`, scene);
  const color = Color3.FromHexString(hex);
  const spec = (v) => new Color3(v, v, v);
  switch (finish) {
    case 'veneer':
      m.diffuseTexture = sharedTexture(scene, 'veneer');
      m.diffuseColor = color.scale(1.15);
      m.specularColor = spec(0.18);
      m.specularPower = 48;
      break;
    case 'fabric':
      m.diffuseTexture = sharedTexture(scene, 'fabric');
      m.diffuseColor = color.scale(1.3);
      m.specularColor = spec(0.02);
      break;
    case 'gloss':
      m.diffuseColor = color;
      m.specularColor = spec(0.6);
      m.specularPower = 64;
      break;
    case 'metal':
      m.diffuseColor = color;
      m.specularColor = spec(0.5);
      m.specularPower = 32;
      break;
    case 'glass':
      m.diffuseColor = color;
      m.alpha = 0.35;
      m.specularColor = spec(0.9);
      m.specularPower = 128;
      m.backFaceCulling = false;
      break;
    default: // matte
      m.diffuseColor = color;
      m.specularColor = spec(0.08);
  }
  markShared(m);
  cache.set(key, m);
  return m;
}

function makeColorMaterial(scene, name, hex, { specular = 0.05, alpha = 1 } = {}) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = new Color3(specular, specular, specular);
  mat.alpha = alpha;
  if (alpha < 1) mat.backFaceCulling = false;
  return markShared(mat);
}

/**
 * Shared materials for this scene (created on first use).
 */
export function getMaterials(scene) {
  let lib = libraries.get(scene);
  if (lib) return lib;

  const cache = {};
  const lazy = (key, create) => () => (cache[key] ??= create());
  const floorGetters = Object.fromEntries(
    ['wood', 'carpet', 'tile', 'smallTile', 'concrete', 'raised'].map((k) => [
      k,
      lazy(k, () => makeTextureMaterial(scene, k, { specular: k === 'tile' ? 0.25 : k === 'wood' ? 0.12 : 0.04 })),
    ]),
  );

  lib = {
    floor: (kind) => (floorGetters[kind] ?? floorGetters.wood)(),
    plaster: lazy('plaster', () => makeTextureMaterial(scene, 'plaster', { specular: 0.02 })),
    paving: lazy('paving', () => makeTextureMaterial(scene, 'paving', { specular: 0.03 })),
    grass: lazy('grass', () => makeTextureMaterial(scene, 'grass', { specular: 0 })),
    skirting: lazy('skirting', () => makeColorMaterial(scene, 'mat_skirting', '#5a5149', { specular: 0.1 })),
    doorFrame: lazy('doorFrame', () => makeColorMaterial(scene, 'mat_doorFrame', '#7b5b3c', { specular: 0.15 })),
    windowFrame: lazy('windowFrame', () => makeColorMaterial(scene, 'mat_windowFrame', '#cfd4d8', { specular: 0.4 })),
    // Flat roof membrane (dark, slightly rough)
    roofTop: lazy('roofTop', () => makeColorMaterial(scene, 'mat_roofTop', '#6a6e72', { specular: 0.04 })),
    // Indoor ceiling: bright paint, a little self-lit so it never looks black from below
    ceiling: lazy('ceiling', () => {
      const m = makeColorMaterial(scene, 'mat_ceiling', '#f3f1ec', { specular: 0.02 });
      m.emissiveColor = new Color3(0.42, 0.41, 0.4);
      m.backFaceCulling = true;
      return m;
    }),
    // Recessed LED panel
    lightPanel: lazy('lightPanel', () => {
      const m = makeColorMaterial(scene, 'mat_lightPanel', '#ffffff', { specular: 0 });
      m.emissiveColor = new Color3(0.97, 0.96, 0.9);
      m.disableLighting = true;
      return m;
    }),
    glass: lazy('glass', () => {
      const m = makeColorMaterial(scene, 'mat_glass', '#a9d2ec', { specular: 0.9, alpha: 0.28 });
      m.specularPower = 128;
      return m;
    }),
  };
  libraries.set(scene, lib);
  return lib;
}

/**
 * Scale a flat mesh's UVs so its texture repeats every `tile` metres.
 * Works for CreateGround (u → X, v → Z, both 0..1).
 */
export function scaleUVs(mesh, width, depth, tile) {
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uvs) return;
  for (let i = 0; i < uvs.length; i += 2) {
    uvs[i] *= width / tile;
    uvs[i + 1] *= depth / tile;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}
