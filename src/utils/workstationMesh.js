/**
 * utils/workstationMesh.js (v0.18.0)
 *
 * The parametric workstation desk, built in code from simple parts in the style of the hand-built
 * furniture (assetCatalog.js): desk top, a metal frame (two legs and a beam), a drawer pedestal, a back
 * partition and side screens (fabric or glass, on the desk top), a modesty panel, a monitor and a
 * keyboard. Drawn at the item's real size (play/workstation.js wsParams), so legs and panels never
 * stretch. Its person works at its local +Z side (people.DESK_WORK_SIDE): the partition is at −Z.
 * No branding. assetInstances.js merges the parts into one template per variant (one draw call per
 * material for every desk with the same options).
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { getAssetMaterial } from './materialLibrary';
import { wsParams } from '../play/workstation';

const TOP = 0.025;       // desk top thickness
const LEG = 0.05;        // frame leg thickness
const PANEL = 0.03;      // partition panel thickness
const PANEL_GAP = 0.005; // panels stand just inside the desk's edge (back-to-back desks: no shared faces)

function part(scene, root, name, w, h, d, x, y, z, material, pick = true) {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y + h / 2, z);
  m.material = material;
  m.isPickable = pick;
  m.parent = root;
  return m;
}

/**
 * Build a workstation's parts under `root`.
 * @param {{ variant?: object }} opts  variant = wsParams of the item (none: the catalogue's)
 */
export function buildWorkstation(scene, root, def, opts = {}) {
  const p = opts.variant ?? wsParams(null, def);
  const { width: w, depth: d, height: h } = p;
  const top = getAssetMaterial(scene, 'veneer', '#c8b898');
  const frame = getAssetMaterial(scene, 'metal', '#606870');
  const white = getAssetMaterial(scene, 'matte', '#d9dcde');
  const front = getAssetMaterial(scene, 'matte', '#c4c8cc');

  part(scene, root, 'ws_top', w, TOP, d, 0, h - TOP, 0, top);
  // the frame: a leg panel at each end and a beam under the back of the top
  const legH = h - TOP;
  for (const sx of [-1, 1]) part(scene, root, `ws_leg${sx}`, LEG, legH, d - 0.08, sx * (w / 2 - 0.05), 0, 0, frame, false);
  part(scene, root, 'ws_beam', w - 0.12, 0.06, 0.04, 0, legH - 0.08, -d / 2 + 0.1, frame, false);

  if (p.pedestal) {
    const pw = 0.4;
    const pd = Math.min(0.55, d - 0.12);
    const ph = Math.min(0.6, legH - 0.08);
    const px = w / 2 - 0.08 - pw / 2;
    const pz = -d / 2 + 0.06 + pd / 2;
    part(scene, root, 'ws_ped', pw, ph, pd, px, 0.02, pz, white);
    const drawer = (ph - 0.06) / 3;
    for (let i = 0; i < 3; i++) {
      part(scene, root, `ws_drw${i}`, pw - 0.04, drawer - 0.02, 0.01, px, 0.04 + i * drawer, pz + pd / 2, front, false);
    }
  }

  if (p.modesty) part(scene, root, 'ws_modesty', w - 0.14, 0.4, 0.02, 0, legH - 0.48, -d / 2 + 0.03, white, false);

  if (p.partition !== 'none') {
    const glass = p.partition === 'glass';
    const panel = glass ? getAssetMaterial(scene, 'glass', '#a8d4f5') : getAssetMaterial(scene, 'fabric', '#5b6b7a');
    const rail = getAssetMaterial(scene, 'metal', '#9aa1a8');
    const ph = p.partitionHeight;
    const back = -d / 2 + PANEL_GAP + PANEL / 2;
    part(scene, root, 'ws_part', w - 2 * PANEL_GAP, ph, PANEL, 0, h, back, panel);
    part(scene, root, 'ws_rail', w - 2 * PANEL_GAP, 0.015, PANEL + 0.006, 0, h + ph, back, rail, false);
    const sideDepth = Math.min(d - PANEL - PANEL_GAP, 0.6);
    const sideZ = -d / 2 + PANEL_GAP + PANEL + sideDepth / 2;
    const sides = p.sides === 'both' ? [-1, 1] : p.sides === 'left' ? [-1] : p.sides === 'right' ? [1] : [];
    for (const sx of sides) {
      const x = sx * (w / 2 - PANEL_GAP - PANEL / 2);
      part(scene, root, `ws_side${sx}`, PANEL, ph, sideDepth, x, h, sideZ, panel);
      part(scene, root, `ws_srail${sx}`, PANEL + 0.006, 0.015, sideDepth, x, h + ph, sideZ, rail, false);
    }
  }

  if (p.screen) {
    const dark = getAssetMaterial(scene, 'gloss', '#1a1d24');
    const stand = getAssetMaterial(scene, 'metal', '#8a8e96');
    const sz = -d / 2 + Math.min(0.22, d * 0.3);
    part(scene, root, 'ws_mbase', 0.22, 0.012, 0.16, 0, h, sz, stand, false);
    part(scene, root, 'ws_mneck', 0.04, 0.14, 0.03, 0, h + 0.012, sz - 0.04, stand, false);
    part(scene, root, 'ws_mon', Math.min(0.6, w - 0.3), 0.34, 0.03, 0, h + 0.1, sz, dark);
    part(scene, root, 'ws_kbd', 0.44, 0.02, 0.14, 0, h, d / 2 - 0.2, dark, false);
  }
  return root;
}
