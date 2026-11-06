/**
 * viewer/walkMapDebug.js — the walk map and a route, drawn over a <LayoutViewer /> (v0.13.2)
 *
 *   http://localhost:3000/viewer.html?mode=view&debug=walkmap
 *   …&to=x,z,floor   a route from the entrance to there      …&from=x,z,floor   from there instead
 *
 * For checking navigation by eye (private-docs/NAVIGATION_PLAN.md 5): the current floor's walk map
 * as coloured cells (green: free, red: a wall or furniture is too close for the body, blue: stairs,
 * yellow: a narrow door opened on its centre line, nothing: nowhere to stand) and the route as an
 * orange line (stairs: a line up to the next floor). Click the floor: a route from the start to
 * there; Shift + click: start there. Loaded only with ?debug=walkmap (a dynamic import from
 * viewer/main.jsx), so no viewer or embed carries it. Dev hook: window.__ahdusWalkDebug.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';

import { createWalkMapCache, FREE, BLOCKED, STAIRS } from '../play/navigation/walkMap';
import { findRoute } from '../play/navigation/route';
import { entranceSpawn } from '../play/navigation/entrance';
import { elevationOf } from '../play/building';
import { ASSET_TYPES } from '../utils/assetCatalog';

const COLOURS = {
  [FREE]: [40, 170, 90, 60],
  [BLOCKED]: [220, 50, 50, 150],
  [STAIRS]: [50, 110, 230, 170],
};
const PASSAGE = [250, 200, 0, 255];
const GRID_Y = 0.05; // over the room floors (0.02)
const ROUTE_Y = 0.25;
const MAX_TEXTURE = 4096;

/**
 * @param {object} engine  the LayoutEngine (onReady)
 * @param {HTMLElement} host  where the info panel goes (position: relative)
 * @param {{ from?: {x,z,floor}, to?: {x,z,floor} }} [options]
 */
export function installWalkMapDebug(engine, host, options = {}) {
  const scene = engine.scene;
  const store = engine.getStore();
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const layout = () => {
    const s = store.getState();
    return { rooms: s.rooms, objects: s.objects, floors: s.floors };
  };
  const state = { from: options.from ?? null, to: options.to ?? null, route: null, ms: 0, floor: null, map: null };

  const panel = document.createElement('div');
  panel.dataset.walkmapDebug = '';
  Object.assign(panel.style, {
    position: 'absolute', left: '12px', bottom: '12px', zIndex: 5, maxWidth: '340px', padding: '10px 12px',
    background: 'rgba(15, 23, 42, 0.88)', color: '#f8fafc', borderRadius: '8px', font: '12px/1.45 Inter, system-ui, sans-serif',
    pointerEvents: 'none',
  });
  host.appendChild(panel);

  // ── the grid of the current floor ──
  let grid = null;
  const drawGrid = () => {
    const floor = store.getState().currentFloor ?? 0;
    const map = maps.get(layout(), floor);
    if (map === state.map && floor === state.floor && grid) return;
    state.map = map;
    state.floor = floor;
    grid?.mesh.dispose(false, true);
    const step = Math.max(1, Math.ceil(Math.max(map.cols, map.rows) / MAX_TEXTURE));
    const w = Math.ceil(map.cols / step);
    const h = Math.ceil(map.rows / step);
    const texture = new DynamicTexture('walkmap_debug_tex', { width: w, height: h }, scene, false, Texture.NEAREST_SAMPLINGMODE);
    const ctx = texture.getContext();
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const j = map.rows - 1 - y * step; // the canvas's top row is the map's far (+z) edge
      for (let x = 0; x < w; x++) {
        const k = Math.max(0, j) * map.cols + x * step;
        const c = map.passages.has(k) ? PASSAGE : COLOURS[map.cells[k]];
        if (!c) continue;
        image.data.set(c, (y * w + x) * 4);
      }
    }
    ctx.putImageData(image, 0, 0);
    texture.hasAlpha = true;
    texture.update();
    const mesh = MeshBuilder.CreateGround('walkmap_debug', { width: map.cols * map.cell, height: map.rows * map.cell }, scene);
    mesh.position.set(map.x0 + (map.cols * map.cell) / 2, elevationOf(store.getState().floors, floor) + GRID_Y, map.z0 + (map.rows * map.cell) / 2);
    const mat = new StandardMaterial('walkmap_debug_mat', scene);
    mat.diffuseTexture = texture;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.metadata = { debug: 'walkmap' };
    grid = { mesh };
    showRoute();
    write();
  };

  // ── the route ──
  let routeMeshes = [];
  const routeMat = new StandardMaterial('walkmap_route_mat', scene);
  routeMat.emissiveColor = new Color3(1, 0.45, 0.05);
  routeMat.disableLighting = true;
  const markMat = (name, c) => { const m = new StandardMaterial(name, scene); m.emissiveColor = c; m.disableLighting = true; return m; };
  const startMat = markMat('walkmap_start_mat', new Color3(0.1, 0.8, 0.3));
  const goalMat = markMat('walkmap_goal_mat', new Color3(0.9, 0.1, 0.4));

  const showRoute = () => {
    for (const m of routeMeshes) m.dispose();
    routeMeshes = [];
    const r = state.route;
    if (!r || r.problem) return;
    const floors = store.getState().floors;
    const current = store.getState().currentFloor ?? 0;
    const shown = (f) => elevationOf(floors, f) <= elevationOf(floors, current); // floors above are hidden
    const at = (p, f) => new Vector3(p.x, elevationOf(floors, f) + ROUTE_Y, p.z);
    const tube = (path) => {
      if (path.length < 2) return;
      const t = MeshBuilder.CreateTube('walkmap_route', { path, radius: 0.09, tessellation: 8, cap: 2 }, scene);
      t.material = routeMat;
      t.isPickable = false;
      routeMeshes.push(t);
    };
    r.legs.forEach((leg, n) => {
      if (shown(leg.floor)) tube(leg.points.map((p) => at(p, leg.floor)));
      const next = r.legs[n + 1];
      if (next && shown(next.floor)) tube([at(leg.points.at(-1), leg.floor), at(next.points[0], next.floor)]); // the stairs
    });
    const mark = (p, f, mat) => {
      if (!shown(f)) return;
      const s = MeshBuilder.CreateSphere('walkmap_mark', { diameter: 0.6, segments: 12 }, scene);
      s.position = at(p, f);
      s.material = mat;
      s.isPickable = false;
      routeMeshes.push(s);
    };
    mark(r.from, r.from.floor, startMat);
    mark(r.to, r.to.floor, goalMat);
  };

  const floorName = (f) => store.getState().floors?.[f]?.name ?? `Floor ${f}`;
  const fmt = (p) => `${p.x.toFixed(1)}, ${p.z.toFixed(1)} (${floorName(p.floor)})`;
  const write = () => {
    const map = state.map;
    const r = state.route;
    const lines = [
      `<strong>Walk map</strong> · ${floorName(state.floor)} · ${map ? `${map.cols} × ${map.rows} cells of ${map.cell} m` : ''}`,
      '<span style="color:#4ade80">■</span> free <span style="color:#f87171">■</span> too close to a wall or furniture '
        + '<span style="color:#60a5fa">■</span> stairs <span style="color:#facc15">■</span> narrow door',
    ];
    if (!r) lines.push('Click the floor: a route from the entrance to there. Shift + click: start there.');
    else if (r.problem) lines.push(`<span data-route-problem="${r.problem}">${r.message}</span>`);
    else {
      const stairs = r.legs.filter((l) => l.stairsAtEnd).map((l) => `stairs ${l.stairsAtEnd.direction} to ${floorName(l.stairsAtEnd.toFloor)}`);
      lines.push(`<span data-route-length>Route ${r.length.toFixed(1)} m · ${Math.round(r.seconds)} s at walking speed · ${state.ms.toFixed(0)} ms</span>`);
      lines.push(`From ${fmt(r.from)} to ${fmt(r.to)}${stairs.length ? ` · ${stairs.join(', ')}` : ''}`);
      lines.push(`${r.legs.reduce((n, l) => n + l.points.length, 0)} points on ${r.legs.length} floor${r.legs.length > 1 ? 's' : ''}`);
    }
    panel.innerHTML = lines.join('<br>');
  };

  const update = () => {
    if (!state.to) { state.route = null; showRoute(); write(); return; }
    const l = layout();
    const from = state.from ?? entranceSpawn(l, { catalog: ASSET_TYPES, maps });
    const t0 = performance.now();
    state.route = findRoute(l, { x: from.x, z: from.z, floor: from.floor ?? 0 }, state.to, { maps });
    state.ms = performance.now() - t0;
    showRoute();
    write();
  };

  // clicks on the floor: the goal (Shift: the start)
  const pointer = scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERTAP) return;
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => m.isPickable && m.isEnabled() && m.isVisible);
    if (!hit?.hit || !hit.pickedPoint) return;
    const p = { x: hit.pickedPoint.x, z: hit.pickedPoint.z, floor: store.getState().currentFloor ?? 0 };
    if (info.event.shiftKey) state.from = p;
    else state.to = p;
    update();
  });
  const frame = scene.onBeforeRenderObservable.add(drawGrid); // floor changes, layout edits (cheap when nothing changed)

  drawGrid();
  update();

  const api = {
    /** Route between two spots ({ x, z, floor }); from null = the entrance. */
    route(from, to) { state.from = from ?? null; state.to = to; update(); return state.route; },
    get last() { return state.route; },
    get ms() { return state.ms; },
    dispose() {
      scene.onPointerObservable.remove(pointer);
      scene.onBeforeRenderObservable.remove(frame);
      grid?.mesh.dispose(false, true);
      for (const m of routeMeshes) m.dispose();
      panel.remove();
    },
  };
  if (import.meta.env.DEV) window.__ahdusWalkDebug = api;
  return api;
}

/** "x,z,floor" from the address → { x, z, floor } (null: none or not numbers). */
export function parseSpot(text) {
  if (!text) return null;
  const [x, z, floor = 0] = text.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(floor) ? { x, z, floor } : null;
}
