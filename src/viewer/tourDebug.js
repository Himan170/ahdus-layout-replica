/**
 * viewer/tourDebug.js — the company tour's plan, drawn over a <LayoutViewer /> (v0.14.3)
 *
 *   http://localhost:3000/viewer.html?mode=view&debug=tour
 *
 * For checking the plan by eye (private-docs/EXPERIENCE_PLAN.md 3.5): every leg's route as an orange
 * line (the stairs: a line up to the next floor), each stop as a numbered marker (where you stand),
 * each passing mention as a small yellow marker with a line to the door it names, and a panel with
 * the stops, their directions, the length, the time, the skipped and missed rooms. Only the floor
 * shown is drawn (and the stairs to and from it). The plan is made again when the layout, the people or the
 * departments change (engine.navigation.planTour()). Loaded only with ?debug=tour (a dynamic import
 * from viewer/main.jsx), so no viewer or embed carries it. Dev hook: window.__ahdusTourDebug.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { elevationOf } from '../play/building';

const ROUTE_Y = 0.25;
const LABEL_Y = 3;
const KIND_COLOURS = {
  entrance: '#2563eb', reception: '#28664f', department: '#28664f', facility: '#7c3aed', return: '#64748b',
};
const escape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {object} engine  the LayoutEngine (onReady)
 * @param {HTMLElement} host  where the panel goes (position: relative)
 */
export function installTourDebug(engine, host) {
  const scene = engine.scene;
  const store = engine.getStore();
  const state = { plan: null, key: [], floor: null, drawn: null };

  const panel = document.createElement('div');
  panel.dataset.tourDebug = '';
  Object.assign(panel.style, {
    position: 'absolute', right: '12px', top: '12px', zIndex: 5, width: '360px', maxWidth: 'calc(100% - 24px)',
    maxHeight: 'calc(100% - 24px)', overflow: 'auto', padding: '10px 12px', boxSizing: 'border-box',
    background: 'rgba(15, 23, 42, 0.9)', color: '#f8fafc', borderRadius: '8px', font: '12px/1.45 Inter, system-ui, sans-serif',
  });
  host.appendChild(panel);

  const material = (name, colour, alpha = 1) => {
    const m = new StandardMaterial(name, scene);
    m.emissiveColor = Color3.FromHexString(colour);
    m.disableLighting = true;
    m.alpha = alpha;
    return m;
  };
  const routeMat = material('tour_route_mat', '#f97316');
  const mentionMat = material('tour_mention_mat', '#facc15');
  const stopMats = Object.fromEntries(Object.entries(KIND_COLOURS).map(([k, c]) => [k, material(`tour_stop_${k}`, c)]));
  let meshes = [];
  // drawn over the building (rendering group 1): the route along a corridor shows from any angle
  const keep = (m) => { m.isPickable = false; m.renderingGroupId = 1; m.metadata = { debug: 'tour' }; meshes.push(m); return m; };

  /** A number on a little board above the stop, always facing the camera. */
  const label = (text, colour, at) => {
    const texture = new DynamicTexture('tour_label_tex', { width: 160, height: 80 }, scene, false);
    const ctx = texture.getContext();
    ctx.fillStyle = colour;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(4, 4, 152, 72, 18);
    else ctx.rect(4, 4, 152, 72);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 80, 42);
    texture.hasAlpha = true;
    texture.update();
    const board = MeshBuilder.CreatePlane('tour_label', { width: 4.4, height: 2.2 }, scene);
    const m = new StandardMaterial('tour_label_mat', scene);
    m.diffuseTexture = texture;
    m.useAlphaFromDiffuseTexture = true;
    m.emissiveColor = Color3.White();
    m.disableLighting = true;
    m.backFaceCulling = false;
    board.material = m;
    board.billboardMode = Mesh.BILLBOARDMODE_ALL;
    board.position = at;
    return keep(board);
  };

  const draw = () => {
    for (const m of meshes) m.dispose(false, true);
    meshes = [];
    const plan = state.plan;
    if (!plan) return;
    const floors = store.getState().floors;
    const current = store.getState().currentFloor ?? 0;
    const shown = (f) => f === current; // only the floor shown: the floors below would show through
    const at = (p, f, y = ROUTE_Y) => new Vector3(p.x, elevationOf(floors, f) + y, p.z);
    const tube = (path, mat, radius = 0.14) => {
      if (path.length < 2) return;
      const t = MeshBuilder.CreateTube('tour_route', { path, radius, tessellation: 8, cap: 2 }, scene);
      t.material = mat;
      keep(t);
    };
    for (const s of plan.stops) {
      const leg = s.leg;
      if (!leg) continue;
      leg.legs.forEach((part, n) => {
        if (shown(part.floor)) tube(part.points.map((p) => at(p, part.floor)), routeMat);
        const next = leg.legs[n + 1];
        if (next && (shown(part.floor) || shown(next.floor))) tube([at(part.points.at(-1), part.floor), at(next.points[0], next.floor)], routeMat);
      });
      for (const m of leg.mentions) {
        if (!shown(m.at.floor)) continue;
        const dot = MeshBuilder.CreateSphere('tour_mention', { diameter: 0.45, segments: 8 }, scene);
        dot.position = at(m.at, m.at.floor, ROUTE_Y + 0.1);
        dot.material = mentionMat;
        keep(dot);
        tube([at(m.at, m.at.floor, ROUTE_Y + 0.1), at(m.door, m.at.floor, ROUTE_Y + 0.1)], mentionMat, 0.04);
      }
    }
    // the stops: one marker per spot (the way back to reception shares the reception's)
    const bySpot = new Map();
    for (const s of plan.stops) {
      const key = `${s.spot.floor}:${s.spot.x.toFixed(2)}:${s.spot.z.toFixed(2)}`;
      if (!bySpot.has(key)) bySpot.set(key, []);
      bySpot.get(key).push(s);
    }
    for (const group of bySpot.values()) {
      const s = group[0];
      if (!shown(s.floor)) continue;
      const disc = MeshBuilder.CreateCylinder('tour_stop', { diameter: 0.9, height: 0.12, tessellation: 24 }, scene);
      disc.position = at(s.spot, s.floor, 0.1);
      disc.material = stopMats[s.kind] ?? stopMats.department;
      keep(disc);
      // which way it faces: a short stick
      tube([at(s.spot, s.floor, 0.2), at({ x: s.spot.x + Math.sin(s.yaw) * 0.9, z: s.spot.z + Math.cos(s.yaw) * 0.9 }, s.floor, 0.2)], disc.material, 0.06);
      label(group.map((g) => g.n).join(' · '), KIND_COLOURS[s.kind] ?? '#28664f', at(s.spot, s.floor, LABEL_Y));
    }
  };

  const floorName = (f) => store.getState().floors?.[f]?.name ?? `Floor ${f}`;
  const write = () => {
    const plan = state.plan;
    if (!plan) { panel.textContent = 'No plan'; return; }
    const lines = [
      `<strong>Tour plan</strong> · <span data-tour-stops="${plan.stops.length}">${plan.stops.length} stops</span> · `
        + `<span data-tour-length>${Math.round(plan.length)} m</span> · about ${plan.minutes} min `
        + `(${Math.round(plan.walkSeconds)} s walking + ${Math.round(plan.pauseSeconds)} s at the stops) · `
        + `<span data-tour-ms>planned in ${Math.round(plan.ms)} ms</span><br>`,
      `Floors: ${plan.floors.map(floorName).join(' → ') || '—'} · ${plan.mentions.length} passing mentions`,
      '<ol style="margin:6px 0 0;padding-left:22px">',
    ];
    for (const s of plan.stops) {
      lines.push(`<li data-tour-stop="${escape(s.id)}" style="margin:4px 0">`
        + `<strong style="color:${KIND_COLOURS[s.kind]}">●</strong> <strong>${escape(s.name)}</strong> · ${escape(s.floorName)}`
        + `${s.leg ? ` · ${Math.round(s.leg.length)} m` : ''}`
        + `<div style="opacity:0.8">${s.lines.slice(1).map(escape).join(' · ')}</div>`
        + `${s.leg?.directions ? `<div style="color:#fdba74">${escape(s.leg.directions)}</div>` : ''}`
        + `${s.leg?.mentions.length ? `<div style="color:#fde047">${s.leg.mentions.map((m) => escape(m.text)).join(' · ')}</div>` : ''}`
        + '</li>');
    }
    lines.push('</ol>');
    if (plan.skipped.length) {
      lines.push(`<div data-tour-skipped="${plan.skipped.length}" style="color:#fca5a5;margin-top:6px"><strong>Skipped</strong>: `
        + `${plan.skipped.map((s) => escape(s.message)).join(' · ')}</div>`);
    }
    if (plan.missed.length) {
      lines.push(`<div style="opacity:0.7;margin-top:4px">Not passed: ${plan.missed.map((r) => escape(r.name)).join(', ')}</div>`);
    }
    panel.innerHTML = lines.join('');
  };

  const replan = () => {
    state.plan = engine.navigation.planTour();
    draw();
    write();
  };

  // made again when the layout, the people or the departments change; drawn again on another floor
  const frame = scene.onBeforeRenderObservable.add(() => {
    const s = store.getState();
    const key = [s.rooms, s.objects, s.floors, engine.navigation.places(), engine.navigation.departments];
    if (key.some((k, i) => k !== state.key[i])) {
      state.key = key;
      replan();
    } else if ((s.currentFloor ?? 0) !== state.floor) {
      draw();
    }
    state.floor = s.currentFloor ?? 0;
  });

  const api = {
    get plan() { return state.plan; },
    replan,
    dispose() {
      scene.onBeforeRenderObservable.remove(frame);
      for (const m of meshes) m.dispose(false, true);
      routeMat.dispose();
      mentionMat.dispose();
      for (const m of Object.values(stopMats)) m.dispose();
      panel.remove();
    },
  };
  if (import.meta.env.DEV) window.__ahdusTourDebug = api;
  return api;
}
