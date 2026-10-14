/**
 * assetCatalog.js
 *
 * Full asset catalog for the 3D Company Workspace Builder.
 * 40+ items across 6 categories with rich procedural meshes.
 *
 * Categories:
 *  - ARCHITECTURE  (walls, glass partitions, doors, windows, columns, stairs)
 *  - FURNITURE     (desks, chairs, sofas, tables, reception)
 *  - STORAGE       (cabinets, shelves, lockers, racks)
 *  - TECH          (monitors, servers, printers, projectors)
 *  - AMENITY       (plants, vending, coffee, water cooler)
 *  - SAFETY        (fire extinguisher, emergency exit, first aid)
 *  - MARKER        (spawn points, waypoints, zones)
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CSG } from '@babylonjs/core/Meshes/csg';
import { getAssetMaterial } from './materialLibrary';
import { STAIR, stairDims } from '../play/building';

// ─── Categories ───
export const OBJECT_CATEGORIES = {
  ARCHITECTURE: 'Architecture',
  FURNITURE: 'Furniture',
  STORAGE: 'Storage',
  TECH: 'Technology',
  AMENITY: 'Amenity',
  SAFETY: 'Safety',
  MARKER: 'Marker',
  INDUSTRIAL: 'Industrial',
};

// ─── Material helpers ───
// All furniture materials are SHARED per scene (see materialLibrary.getAssetMaterial):
// never dispose them, and never change them per object (use mesh overlays instead).

// Colours in the catalog that are really wood or upholstery get a texture.
const WOOD_HEXES = new Set(['#c8a87a', '#8b6f47', '#5c4a2a', '#c8b898', '#2a1f10', '#7a6040']);
const FABRIC_HEXES = new Set(['#1e2230', '#4a5568']);

function mat(scene, hex) {
  const h = hex.toLowerCase();
  if (WOOD_HEXES.has(h)) return getAssetMaterial(scene, 'veneer', h);
  if (FABRIC_HEXES.has(h)) return getAssetMaterial(scene, 'fabric', h);
  return getAssetMaterial(scene, 'matte', h);
}

function glossMat(scene, hex) {
  return getAssetMaterial(scene, 'gloss', hex.toLowerCase());
}

function glassMat(scene, hex = '#a8d4f5') {
  return getAssetMaterial(scene, 'glass', hex.toLowerCase());
}

function metalMat(scene, hex = '#8a8e96') {
  return getAssetMaterial(scene, 'metal', hex.toLowerCase());
}

// ─── Mesh helpers ───
function box(scene, name, w, h, d, px = 0, py = 0, pz = 0) {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(px, py + h / 2, pz);
  return m;
}

function cyl(scene, name, r, h, px = 0, py = 0, pz = 0, sides = 12) {
  const m = MeshBuilder.CreateCylinder(name, { diameter: r * 2, height: h, tessellation: sides }, scene);
  m.position.set(px, py + h / 2, pz);
  return m;
}

function sphere(scene, name, r, px = 0, py = 0, pz = 0) {
  const m = MeshBuilder.CreateSphere(name, { diameter: r * 2, segments: 12 }, scene);
  m.position.set(px, py + r, pz);
  return m;
}

function mergeIntoRoot(scene, parts, rootName, mat_) {
  const root = new TransformNode(rootName, scene);
  for (const p of parts) {
    p.parent = root;
    if (mat_) p.material = mat_;
    p.isPickable = true;
  }
  return root;
}

// ─── Asset Type Definitions ───
export const ASSET_TYPES = {

  // ══════════════════════════════════════════
  //  ARCHITECTURE
  // ══════════════════════════════════════════

  WALL_SEGMENT: {
    label: 'Wall Segment',
    icon: '🧱',
    category: OBJECT_CATEGORIES.ARCHITECTURE,
    defaultWidth: 3, defaultHeight: 2.8, defaultDepth: 0.2,
    color: '#c8c0b8',
    buildMesh(scene, id) {
      const root = new TransformNode('arch_wall_' + id, scene);
      const wall = box(scene, 'wall', 3, 2.8, 0.2);
      wall.material = mat(scene, '#d4cfc8');
      wall.parent = root;
      wall.isPickable = true;
      root.metadata = { assetType: 'WALL_SEGMENT', objectId: id };
      return root;
    },
  },

  GLASS_PARTITION: {
    label: 'Glass Partition',
    icon: '🪟',
    category: OBJECT_CATEGORIES.ARCHITECTURE,
    defaultWidth: 3, defaultHeight: 2.8, defaultDepth: 0.08,
    color: '#a8d4f5',
    buildMesh(scene, id) {
      const root = new TransformNode('arch_glass_' + id, scene);
      // Frame
      const frameT = box(scene, 'ft', 3, 0.08, 0.08, 0, 2.76, 0);
      const frameB = box(scene, 'fb', 3, 0.08, 0.08, 0, 0, 0);
      const frameL = box(scene, 'fl', 0.08, 2.8, 0.08, -1.46, 0, 0);
      const frameR = box(scene, 'fr', 0.08, 2.8, 0.08, 1.46, 0, 0);
      const glass = box(scene, 'g', 2.84, 2.64, 0.06, 0, 0.08, 0);
      const frameMat = metalMat(scene, '#a0a8b0');
      [frameT, frameB, frameL, frameR].forEach(f => { f.material = frameMat; f.parent = root; f.isPickable = true; });
      glass.material = glassMat(scene);
      glass.parent = root;
      glass.isPickable = true;
      root.metadata = { assetType: 'GLASS_PARTITION', objectId: id };
      return root;
    },
  },

  DOOR_SINGLE: {
    label: 'Single Door',
    icon: '🚪',
    category: OBJECT_CATEGORIES.ARCHITECTURE,
    defaultWidth: 1, defaultHeight: 2.2, defaultDepth: 0.1,
    color: '#8b6f47',
    buildMesh(scene, id) {
      const root = new TransformNode('arch_door_' + id, scene);
      // Door panel
      const panel = box(scene, 'dp', 0.9, 2.1, 0.07, 0, 0, 0);
      panel.material = mat(scene, '#8b6f47');
      // Handle
      const handle = cyl(scene, 'dh', 0.04, 0.1, 0.35, 1.0, 0);
      handle.rotation.z = Math.PI / 2;
      handle.material = metalMat(scene, '#d4af37');
      // Frame
      const fTop = box(scene, 'dft', 1, 0.1, 0.12, 0, 2.2, 0);
      const fL = box(scene, 'dfl', 0.1, 2.2, 0.12, -0.5, 0, 0);
      const fR = box(scene, 'dfr', 0.1, 2.2, 0.12, 0.5, 0, 0);
      const fMat = mat(scene, '#5c4a2a');
      [fTop, fL, fR].forEach(f => { f.material = fMat; f.parent = root; f.isPickable = true; });
      panel.parent = root; panel.isPickable = true;
      handle.parent = root; handle.isPickable = false;
      root.metadata = { assetType: 'DOOR_SINGLE', objectId: id };
      return root;
    },
  },

  WINDOW_FRAME: {
    label: 'Window',
    icon: '🪟',
    category: OBJECT_CATEGORIES.ARCHITECTURE,
    defaultWidth: 1.5, defaultHeight: 1.2, defaultDepth: 0.12,
    color: '#a8d4f5',
    buildMesh(scene, id) {
      const root = new TransformNode('arch_win_' + id, scene);
      const fMat = metalMat(scene, '#9098a0');
      // Frame
      [box(scene,'wft',1.5,0.08,0.12,0,1.2,0), box(scene,'wfb',1.5,0.08,0.12,0,0,0),
       box(scene,'wfl',0.08,1.2,0.12,-0.71,0,0), box(scene,'wfr',0.08,1.2,0.12,0.71,0,0)
      ].forEach(f => { f.material = fMat; f.parent = root; f.isPickable = false; });
      // Glass panes
      const g1 = box(scene, 'wg1', 0.67, 1.04, 0.05, -0.37, 0.08, 0);
      const g2 = box(scene, 'wg2', 0.67, 1.04, 0.05, 0.37, 0.08, 0);
      [g1,g2].forEach(g => { g.material = glassMat(scene); g.parent = root; g.isPickable = true; });
      root.metadata = { assetType: 'WINDOW_FRAME', objectId: id };
      return root;
    },
  },

  COLUMN: {
    label: 'Column / Pillar',
    icon: '🏛️',
    category: OBJECT_CATEGORIES.ARCHITECTURE,
    defaultWidth: 0.4, defaultHeight: 3, defaultDepth: 0.4,
    color: '#d0ccc8',
    buildMesh(scene, id) {
      const root = new TransformNode('arch_col_' + id, scene);
      const shaft = cyl(scene, 'cs', 0.2, 2.8, 0, 0, 0);
      const capT = cyl(scene, 'cct', 0.28, 0.12, 0, 2.8, 0);
      const capB = cyl(scene, 'ccb', 0.28, 0.12, 0, 0, 0);
      const m = mat(scene, '#d0ccc8');
      [shaft, capT, capB].forEach(p => { p.material = m; p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'COLUMN', objectId: id };
      return root;
    },
  },

  STAIRCASE: {
    label: 'Staircase',
    icon: '🪜',
    category: OBJECT_CATEGORIES.ARCHITECTURE,
    // One flight that climbs exactly one storey (see play/building.js stairDims):
    // bottom step at local -Z, top lands on the floor above at local +Z.
    // opts.rise = the height of the floor it stands on (steps of at most 0.2 m).
    defaultWidth: STAIR.width, defaultHeight: STAIR.rise, defaultDepth: STAIR.length,
    color: '#b0a898',
    buildMesh(scene, id, opts = {}) {
      const root = new TransformNode('arch_stair_' + id, scene);
      const stepMat = mat(scene, '#c8c0b0');
      const noseMat = mat(scene, '#8a8278');
      const { width, length, rise, steps } = stairDims(opts.rise ?? STAIR.rise);
      const stepH = rise / steps;
      const tread = length / steps;
      for (let i = 0; i < steps; i++) {
        // Solid block from the floor up to this step's tread (looks like a real concrete flight)
        const h = (i + 1) * stepH;
        const z = -length / 2 + (i + 0.5) * tread;
        const s = box(scene, 'step_' + i, width, h, tread, 0, 0, z);
        s.material = stepMat;
        s.parent = root;
        s.isPickable = true;
        // darker nosing strip on the front edge of each tread
        const nose = box(scene, 'nose_' + i, width, 0.02, 0.05, 0, h - 0.02, z - tread / 2 + 0.025);
        nose.material = noseMat;
        nose.parent = root;
        nose.isPickable = false;
      }
      // Handrail along the slope on the open side, with a post at each end
      const railMat = metalMat(scene, '#a0a8b0');
      const slope = Math.hypot(length, rise);
      const rail = MeshBuilder.CreateBox('rail', { width: 0.05, height: 0.05, depth: slope }, scene);
      rail.rotation.x = -Math.atan2(rise, length);
      rail.position.set(width / 2 - 0.05, rise / 2 + 0.9, 0);
      rail.material = railMat;
      rail.parent = root;
      rail.isPickable = false;
      [[-length / 2 + 0.05, stepH], [length / 2 - 0.05, rise]].forEach(([pz, base], k) => {
        const post = cyl(scene, 'post_' + k, 0.025, 0.9, width / 2 - 0.05, base, pz);
        post.material = railMat;
        post.parent = root;
        post.isPickable = false;
      });
      root.metadata = { assetType: 'STAIRCASE', objectId: id, rise };
      return root;
    },
  },

  // ══════════════════════════════════════════
  //  FURNITURE
  // ══════════════════════════════════════════

  DESK_STANDARD: {
    label: 'Standard Desk',
    icon: '🖥️',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 1.6, defaultHeight: 0.75, defaultDepth: 0.8,
    color: '#8b6f47',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_desk_' + id, scene);
      const top = box(scene, 'dt', 1.6, 0.04, 0.8, 0, 0.75, 0);
      top.material = mat(scene, '#c8a87a');
      const legMat = metalMat(scene, '#606870');
      [[-0.72, 0, -0.34],[0.72, 0, -0.34],[-0.72, 0, 0.34],[0.72, 0, 0.34]].forEach(([x,y,z], i) => {
        const leg = box(scene, 'dl'+i, 0.05, 0.73, 0.05, x, y, z);
        leg.material = legMat; leg.parent = root; leg.isPickable = false;
      });
      top.parent = root; top.isPickable = true;
      root.metadata = { assetType: 'DESK_STANDARD', objectId: id };
      return root;
    },
  },

  DESK_CORNER: {
    label: 'L-Shape Corner Desk',
    icon: '🖥️',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 2.4, defaultHeight: 0.75, defaultDepth: 2.4,
    color: '#7a6040',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_ldsk_' + id, scene);
      const topMat = mat(scene, '#c8a87a');
      const seg1 = box(scene, 'ls1', 2.4, 0.04, 0.8, 0, 0.75, 0.8);
      const seg2 = box(scene, 'ls2', 0.8, 0.04, 2.4, -0.8, 0.75, 0);
      [seg1, seg2].forEach(s => { s.material = topMat; s.parent = root; s.isPickable = true; });
      const legMat = metalMat(scene, '#606870');
      [[-1.1,0,-0.34],[1.1,0,0.42],[-0.42,0,1.08],[-0.42,0,-1.08]].forEach(([x,y,z],i)=>{
        const leg = box(scene,'cll'+i,0.05,0.73,0.05,x,y,z);
        leg.material = legMat; leg.parent = root; leg.isPickable = false;
      });
      root.metadata = { assetType: 'DESK_CORNER', objectId: id };
      return root;
    },
  },

  CHAIR_OFFICE: {
    label: 'Office Chair',
    icon: '🪑',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 0.6, defaultHeight: 1.1, defaultDepth: 0.6,
    color: '#2a2e38',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_chair_' + id, scene);
      const seat = box(scene, 'cs', 0.55, 0.07, 0.52, 0, 0.46, 0);
      seat.material = mat(scene, '#1e2230');
      const back = box(scene, 'cb', 0.52, 0.5, 0.06, 0, 0.76, -0.24);
      back.material = mat(scene, '#1e2230');
      const base = cyl(scene, 'cbase', 0.25, 0.05, 0, 0, 0);
      base.material = metalMat(scene, '#707880');
      const pole = cyl(scene, 'cpole', 0.04, 0.44, 0, 0, 0);
      pole.material = metalMat(scene, '#909098');
      // Wheels (5 arms)
      const wheelMat = mat(scene, '#303040');
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const wx = Math.cos(angle) * 0.22;
        const wz = Math.sin(angle) * 0.22;
        const arm = box(scene, 'arm'+i, 0.24, 0.025, 0.025, wx / 2, 0.02, wz / 2);
        arm.rotation.y = -angle;
        arm.material = wheelMat; arm.parent = root; arm.isPickable = false;
      }
      [seat, back, base, pole].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'CHAIR_OFFICE', objectId: id };
      return root;
    },
  },

  SOFA_3SEAT: {
    label: '3-Seat Sofa',
    icon: '🛋️',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 2.2, defaultHeight: 0.85, defaultDepth: 0.9,
    color: '#4a5568',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_sofa_' + id, scene);
      const fabric = mat(scene, '#4a5568');
      // Base
      const base = box(scene, 'sb', 2.2, 0.28, 0.9, 0, 0, 0);
      // Seat cushion
      const seat = box(scene, 'ss', 2.1, 0.2, 0.78, 0, 0.28, 0.05);
      // Back
      const back = box(scene, 'sbk', 2.1, 0.45, 0.12, 0, 0.28, -0.39);
      // Armrests
      const armL = box(scene, 'sal', 0.12, 0.38, 0.8, -1.14, 0.28, 0.04);
      const armR = box(scene, 'sar', 0.12, 0.38, 0.8,  1.14, 0.28, 0.04);
      // Legs
      const legMat = mat(scene, '#2a1f10');
      [[-1.0,0,-0.38],[1.0,0,-0.38],[-1.0,0,0.38],[1.0,0,0.38]].forEach(([x,y,z],i) => {
        const leg = box(scene,'sl'+i,0.08,0.08,0.08,x,y,z);
        leg.material = legMat; leg.parent = root;
      });
      [base, seat, back, armL, armR].forEach(p => { p.material = fabric; p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'SOFA_3SEAT', objectId: id };
      return root;
    },
  },

  TABLE_MEETING: {
    label: 'Meeting Table',
    icon: '🪑',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 3.2, defaultHeight: 0.75, defaultDepth: 1.4,
    color: '#a0896a',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_mtbl_' + id, scene);
      const top = box(scene, 'mt', 3.2, 0.05, 1.4, 0, 0.75, 0);
      top.material = mat(scene, '#c8a87a');
      const legMat = metalMat(scene, '#505860');
      [[-1.4,0,-0.58],[1.4,0,-0.58],[-1.4,0,0.58],[1.4,0,0.58]].forEach(([x,y,z],i) => {
        const leg = box(scene,'ml'+i,0.06,0.73,0.06,x,y,z);
        leg.material = legMat; leg.parent = root; leg.isPickable = false;
      });
      top.parent = root; top.isPickable = true;
      root.metadata = { assetType: 'TABLE_MEETING', objectId: id };
      return root;
    },
  },

  TABLE_COFFEE: {
    label: 'Coffee Table',
    icon: '☕',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 1.0, defaultHeight: 0.42, defaultDepth: 0.55,
    color: '#8b6f47',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_ctbl_' + id, scene);
      const top = box(scene, 'ctt', 1.0, 0.04, 0.55, 0, 0.42, 0);
      top.material = glossMat(scene, '#2a2420');
      const legMat = metalMat(scene, '#c0c0c0');
      [[-0.43,0,-0.23],[0.43,0,-0.23],[-0.43,0,0.23],[0.43,0,0.23]].forEach(([x,y,z],i) => {
        const leg = box(scene,'ctl'+i,0.035,0.4,0.035,x,y,z);
        leg.material = legMat; leg.parent = root; leg.isPickable = false;
      });
      top.parent = root; top.isPickable = true;
      root.metadata = { assetType: 'TABLE_COFFEE', objectId: id };
      return root;
    },
  },

  RECEPTION_DESK: {
    label: 'Reception Desk',
    icon: '🏢',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 2.5, defaultHeight: 1.1, defaultDepth: 0.85,
    color: '#5a6080',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_recep_' + id, scene);
      // Main body
      const body = box(scene, 'rb', 2.5, 1.0, 0.85, 0, 0, 0);
      body.material = mat(scene, '#3a4060');
      // Counter top
      const top = box(scene, 'rt', 2.6, 0.06, 0.7, 0, 1.0, -0.075);
      top.material = mat(scene, '#c0c8d0');
      // Front panel (raised lip)
      const front = box(scene, 'rf', 2.5, 0.25, 0.04, 0, 0.82, 0.405);
      front.material = mat(scene, '#4a5470');
      [body, top, front].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'RECEPTION_DESK', objectId: id };
      return root;
    },
  },

  WHITEBOARD: {
    label: 'Whiteboard',
    icon: '📋',
    category: OBJECT_CATEGORIES.FURNITURE,
    defaultWidth: 2.0, defaultHeight: 1.2, defaultDepth: 0.06,
    color: '#f0f0ee',
    buildMesh(scene, id) {
      const root = new TransformNode('furn_wb_' + id, scene);
      const frame = box(scene, 'wbf', 2.0, 1.2, 0.06, 0, 0, 0);
      frame.material = metalMat(scene, '#808890');
      const board = box(scene, 'wbb', 1.88, 1.06, 0.02, 0, 0.07, 0.03);
      board.material = mat(scene, '#f8f8f6');
      // Tray
      const tray = box(scene,'wbt',1.88,0.06,0.1,0,-0.57,0.04);
      tray.material = metalMat(scene,'#9098a0');
      [frame, board, tray].forEach(p => { p.parent = root; p.isPickable = true; });
      // Legs (floor-standing)
      const legMat = metalMat(scene, '#a0a8b0');
      [[-0.9, 0, 0],[0.9, 0, 0]].forEach(([x,y,z],i) => {
        const leg = cyl(scene,'wbl'+i,0.03,0.6+0.6,x,y-0.6,z);
        leg.material = legMat; leg.parent = root;
      });
      root.metadata = { assetType: 'WHITEBOARD', objectId: id };
      return root;
    },
  },

  BOOKSHELF: {
    label: 'Bookshelf',
    icon: '📚',
    category: OBJECT_CATEGORIES.STORAGE,
    defaultWidth: 1.0, defaultHeight: 1.8, defaultDepth: 0.35,
    color: '#7a6040',
    buildMesh(scene, id) {
      const root = new TransformNode('stor_shelf_' + id, scene);
      const woodMat = mat(scene, '#8b6f47');
      const bodyParts = [
        box(scene,'shleft',0.03,1.8,0.35,-0.485,0,0),
        box(scene,'shright',0.03,1.8,0.35,0.485,0,0),
        box(scene,'shtop',1.0,0.03,0.35,0,1.8,0),
        box(scene,'shbot',1.0,0.03,0.35,0,0,0),
        box(scene,'shback',1.0,1.8,0.03,0,0,-0.16),
      ];
      // Shelves
      for (let i = 1; i < 4; i++) {
        const shelf = box(scene,'sh'+i,0.94,0.025,0.33,0,i*0.44,0);
        bodyParts.push(shelf);
      }
      bodyParts.forEach(p => { p.material = woodMat; p.parent = root; p.isPickable = true; });
      // Book decoration
      const bookColors = ['#c0392b','#2980b9','#27ae60','#8e44ad','#e67e22'];
      for (let i = 0; i < 5; i++) {
        const bk = box(scene,'bk'+i,0.05,0.27,0.22,-0.3+i*0.14,0.48,0.02);
        bk.material = mat(scene, bookColors[i]);
        bk.parent = root;
      }
      root.metadata = { assetType: 'BOOKSHELF', objectId: id };
      return root;
    },
  },

  // ══════════════════════════════════════════
  //  STORAGE
  // ══════════════════════════════════════════

  FILING_CABINET: {
    label: 'Filing Cabinet',
    icon: '🗄️',
    category: OBJECT_CATEGORIES.STORAGE,
    defaultWidth: 0.46, defaultHeight: 1.32, defaultDepth: 0.62,
    color: '#78828c',
    buildMesh(scene, id) {
      const root = new TransformNode('stor_fc_' + id, scene);
      const body = box(scene, 'fcb', 0.46, 1.32, 0.62, 0, 0, 0);
      body.material = metalMat(scene, '#78828c');
      const handleMat = metalMat(scene, '#c0c8d0');
      [0.22, 0.55, 0.88].forEach((y, i) => {
        const drawer = box(scene,'fcd'+i,0.42,0.28,0.02,0,y,0.3);
        drawer.material = metalMat(scene,'#8a9098');
        const handle = box(scene,'fch'+i,0.18,0.04,0.03,0,y,0.32);
        handle.material = handleMat;
        [drawer, handle].forEach(p => { p.parent = root; p.isPickable = true; });
      });
      body.parent = root; body.isPickable = true;
      root.metadata = { assetType: 'FILING_CABINET', objectId: id };
      return root;
    },
  },

  LOCKER_BANK: {
    label: 'Locker Bank (4x)',
    icon: '🔒',
    category: OBJECT_CATEGORIES.STORAGE,
    defaultWidth: 1.0, defaultHeight: 1.8, defaultDepth: 0.45,
    color: '#607080',
    buildMesh(scene, id) {
      const root = new TransformNode('stor_locker_' + id, scene);
      const colors = ['#607080','#607080','#607080','#607080'];
      for (let i = 0; i < 4; i++) {
        const lk = box(scene,'lk'+i,0.23,1.75,0.43,-0.365+i*0.243,0,0);
        lk.material = metalMat(scene, '#607080');
        const door = box(scene,'lkd'+i,0.21,1.71,0.02,-0.365+i*0.243,0.02,0.215);
        door.material = metalMat(scene, '#6f8090');
        const vent = box(scene,'lkv'+i,0.15,0.06,0.02,-0.365+i*0.243,1.55,0.225);
        vent.material = metalMat(scene,'#405060');
        [lk, door, vent].forEach(p => { p.parent = root; p.isPickable = true; });
      }
      root.metadata = { assetType: 'LOCKER_BANK', objectId: id };
      return root;
    },
  },

  STORAGE_RACK: {
    label: 'Storage Rack',
    icon: '🏗️',
    category: OBJECT_CATEGORIES.STORAGE,
    defaultWidth: 2.0, defaultHeight: 2.0, defaultDepth: 0.6,
    color: '#8a7060',
    buildMesh(scene, id) {
      const root = new TransformNode('stor_rack_' + id, scene);
      const metalM = metalMat(scene, '#909898');
      // Uprights
      [[-0.96,0],[0.96,0]].forEach(([x,z],i) => {
        const post = box(scene,'rp'+i,0.05,2.0,0.05,x,0,0);
        post.material = metalM; post.parent = root;
      });
      // Shelves
      [0.3, 0.9, 1.5, 1.9].forEach((y,i) => {
        const shelf = box(scene,'rsh'+i,1.96,0.03,0.58,0,y,0);
        shelf.material = mat(scene,'#c8b898'); shelf.parent = root; shelf.isPickable = true;
      });
      root.metadata = { assetType: 'STORAGE_RACK', objectId: id };
      return root;
    },
  },

  // ══════════════════════════════════════════
  //  TECHNOLOGY
  // ══════════════════════════════════════════

  MONITOR_DUAL: {
    label: 'Dual Monitor Setup',
    icon: '🖥️',
    category: OBJECT_CATEGORIES.TECH,
    defaultWidth: 0.9, defaultHeight: 0.45, defaultDepth: 0.2,
    color: '#1a1e28',
    buildMesh(scene, id) {
      const root = new TransformNode('tech_mon_' + id, scene);
      const screenMat = mat(scene, '#1a1e28');
      const frameMat = metalMat(scene, '#2a2e38');
      [-0.25, 0.25].forEach((x, i) => {
        const frame = box(scene,'mf'+i,0.42,0.28,0.03,x,0.38,0);
        frame.material = frameMat;
        const screen = box(scene,'ms'+i,0.38,0.24,0.01,x,0.38,0.01);
        screen.material = screenMat;
        const stand = box(scene,'mst'+i,0.04,0.18,0.04,x,0.18,0.02);
        stand.material = frameMat;
        const base = box(scene,'mb'+i,0.18,0.03,0.14,x,0.02,0.05);
        base.material = frameMat;
        [frame, screen, stand, base].forEach(p => { p.parent = root; p.isPickable = true; });
      });
      root.metadata = { assetType: 'MONITOR_DUAL', objectId: id };
      return root;
    },
  },

  SERVER_RACK: {
    label: 'Server Rack',
    icon: '🖥️',
    category: OBJECT_CATEGORIES.TECH,
    defaultWidth: 0.62, defaultHeight: 2.0, defaultDepth: 0.9,
    color: '#303440',
    buildMesh(scene, id) {
      const root = new TransformNode('tech_srv_' + id, scene);
      const body = box(scene,'svb',0.62,2.0,0.9,0,0,0);
      body.material = metalMat(scene,'#303440');
      // Server units
      const serverMat = mat(scene,'#1a1e28');
      const ledMat = mat(scene,'#00ff88');
      for (let i = 0; i < 8; i++) {
        const unit = box(scene,'svu'+i,0.58,0.2,0.85,0,0.15+i*0.23,-0.015);
        unit.material = serverMat;
        const led = box(scene,'led'+i,0.03,0.04,0.02,0.26,0.15+i*0.23,0.43);
        led.material = ledMat;
        [unit, led].forEach(p => { p.parent = root; p.isPickable = false; });
      }
      body.parent = root; body.isPickable = true;
      root.metadata = { assetType: 'SERVER_RACK', objectId: id };
      return root;
    },
  },

  PROJECTOR_SCREEN: {
    label: 'Projector Screen',
    icon: '📽️',
    category: OBJECT_CATEGORIES.TECH,
    defaultWidth: 2.4, defaultHeight: 1.5, defaultDepth: 0.05,
    color: '#f0f0f0',
    buildMesh(scene, id) {
      const root = new TransformNode('tech_proj_' + id, scene);
      const casing = box(scene,'psc',2.5,0.08,0.08,0,1.55,0);
      casing.material = metalMat(scene,'#606870');
      const screen = box(scene,'pss',2.4,1.5,0.02,0,0,0);
      screen.material = mat(scene,'#f2f2f0');
      [casing, screen].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'PROJECTOR_SCREEN', objectId: id };
      return root;
    },
  },

  PRINTER: {
    label: 'Office Printer',
    icon: '🖨️',
    category: OBJECT_CATEGORIES.TECH,
    defaultWidth: 0.55, defaultHeight: 0.48, defaultDepth: 0.42,
    color: '#e0e0e0',
    buildMesh(scene, id) {
      const root = new TransformNode('tech_prt_' + id, scene);
      const body = box(scene,'pb',0.55,0.44,0.42,0,0,0);
      body.material = mat(scene,'#e0e0e0');
      const tray = box(scene,'pt',0.48,0.02,0.32,0,0.44,0.04);
      tray.material = mat(scene,'#d0d0d0');
      const panel = box(scene,'pp',0.45,0.08,0.02,0,0.42,-0.195);
      panel.material = mat(scene,'#c0c8d0');
      [body, tray, panel].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'PRINTER', objectId: id };
      return root;
    },
  },

  TV_DISPLAY: {
    label: 'Large Display TV',
    icon: '📺',
    category: OBJECT_CATEGORIES.TECH,
    defaultWidth: 1.6, defaultHeight: 0.95, defaultDepth: 0.08,
    color: '#1a1e28',
    buildMesh(scene, id) {
      const root = new TransformNode('tech_tv_' + id, scene);
      const frame = box(scene,'tvf',1.6,0.95,0.06,0,0,0);
      frame.material = metalMat(scene,'#1a1e28');
      const screen = box(scene,'tvs',1.52,0.87,0.02,0,0.04,0.025);
      screen.material = mat(scene,'#0d1020');
      [frame, screen].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'TV_DISPLAY', objectId: id };
      return root;
    },
  },

  // ══════════════════════════════════════════
  //  AMENITY
  // ══════════════════════════════════════════

  PLANT_LARGE: {
    label: 'Large Plant',
    icon: '🌿',
    category: OBJECT_CATEGORIES.AMENITY,
    defaultWidth: 0.5, defaultHeight: 1.6, defaultDepth: 0.5,
    color: '#2d6a2d',
    buildMesh(scene, id) {
      const root = new TransformNode('amen_plant_' + id, scene);
      const pot = cyl(scene,'pp',0.2,0.35,0,0,0,12);
      pot.material = mat(scene,'#8b5a2b');
      const soil = cyl(scene,'ps',0.18,0.03,0,0.33,0,12);
      soil.material = mat(scene,'#3a2a1a');
      const trunk = cyl(scene,'pt',0.04,0.9,0,0.35,0,8);
      trunk.material = mat(scene,'#5c3a1a');
      // Foliage layers
      const greenMat = mat(scene,'#2d6a2d');
      const g1 = sphere(scene,'pg1',0.28,0,1.1,0);
      const g2 = sphere(scene,'pg2',0.22,-0.12,1.3,0.12);
      const g3 = sphere(scene,'pg3',0.18,0.12,1.25,-0.1);
      [g1,g2,g3].forEach(g => { g.material = greenMat; g.parent = root; g.isPickable = true; });
      [pot, soil, trunk].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'PLANT_LARGE', objectId: id };
      return root;
    },
  },

  PLANT_SMALL: {
    label: 'Desk Plant',
    icon: '🪴',
    category: OBJECT_CATEGORIES.AMENITY,
    defaultWidth: 0.2, defaultHeight: 0.25, defaultDepth: 0.2,
    color: '#2d6a2d',
    buildMesh(scene, id) {
      const root = new TransformNode('amen_splant_' + id, scene);
      const pot = cyl(scene,'spp',0.09,0.12,0,0,0,8);
      pot.material = mat(scene,'#c07040');
      const plant = sphere(scene,'spg',0.1,0,0.14,0);
      plant.material = mat(scene,'#2d8a2d');
      [pot, plant].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'PLANT_SMALL', objectId: id };
      return root;
    },
  },

  VENDING_MACHINE: {
    label: 'Vending Machine',
    icon: '🥤',
    category: OBJECT_CATEGORIES.AMENITY,
    defaultWidth: 0.6, defaultHeight: 1.8, defaultDepth: 0.7,
    color: '#d02020',
    buildMesh(scene, id) {
      const root = new TransformNode('amen_vend_' + id, scene);
      const body = box(scene,'vb',0.6,1.8,0.7,0,0,0);
      body.material = mat(scene,'#cc2020');
      const glass = box(scene,'vg',0.44,0.9,0.04,0,0.7,0.33);
      glass.material = glassMat(scene,'#a8d4f5');
      const panel = box(scene,'vp',0.44,0.24,0.04,0,0.22,0.33);
      panel.material = mat(scene,'#202838');
      [body, glass, panel].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'VENDING_MACHINE', objectId: id };
      return root;
    },
  },

  COFFEE_MACHINE: {
    label: 'Coffee Machine',
    icon: '☕',
    category: OBJECT_CATEGORIES.AMENITY,
    defaultWidth: 0.38, defaultHeight: 0.52, defaultDepth: 0.32,
    color: '#202020',
    buildMesh(scene, id) {
      const root = new TransformNode('amen_coffee_' + id, scene);
      const body = box(scene,'cfb',0.38,0.52,0.32,0,0,0);
      body.material = metalMat(scene,'#202020');
      const panel = box(scene,'cfp',0.3,0.16,0.02,0,0.3,0.15);
      panel.material = mat(scene,'#1a2030');
      const tray = box(scene,'cft',0.3,0.02,0.2,0,0.06,0.06);
      tray.material = metalMat(scene,'#606870');
      [body, panel, tray].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'COFFEE_MACHINE', objectId: id };
      return root;
    },
  },

  WATER_COOLER: {
    label: 'Water Cooler',
    icon: '💧',
    category: OBJECT_CATEGORIES.AMENITY,
    defaultWidth: 0.35, defaultHeight: 1.4, defaultDepth: 0.35,
    color: '#e0e8f0',
    buildMesh(scene, id) {
      const root = new TransformNode('amen_wcool_' + id, scene);
      const body = box(scene,'wcb',0.35,0.9,0.35,0,0,0);
      body.material = mat(scene,'#d8e0e8');
      const bottle = cyl(scene,'wcbt',0.15,0.42,0,0.87,0,12);
      bottle.material = glassMat(scene,'#a8d0f0');
      const cap = cyl(scene,'wcbc',0.17,0.04,0,0.9,0,12);
      cap.material = mat(scene,'#4080c0');
      [body, bottle, cap].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'WATER_COOLER', objectId: id };
      return root;
    },
  },

  // ══════════════════════════════════════════
  //  SAFETY
  // ══════════════════════════════════════════

  FIRE_EXTINGUISHER: {
    label: 'Fire Extinguisher',
    icon: '🧯',
    category: OBJECT_CATEGORIES.SAFETY,
    defaultWidth: 0.2, defaultHeight: 0.6, defaultDepth: 0.2,
    color: '#cc0000',
    buildMesh(scene, id) {
      const root = new TransformNode('safe_fire_' + id, scene);
      const body = cyl(scene,'feb',0.1,0.55,0,0,0,12);
      body.material = mat(scene,'#cc1010');
      const nozzle = cyl(scene,'fen',0.025,0.15,0,0.56,0,8);
      nozzle.material = metalMat(scene,'#404040');
      const top = sphere(scene,'fet',0.1,0,0.56,0);
      top.material = mat(scene,'#cc1010');
      [body, nozzle, top].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'FIRE_EXTINGUISHER', objectId: id };
      return root;
    },
  },

  EMERGENCY_EXIT: {
    label: 'Emergency Exit Sign',
    icon: '🚨',
    category: OBJECT_CATEGORIES.SAFETY,
    defaultWidth: 0.6, defaultHeight: 0.25, defaultDepth: 0.08,
    color: '#00aa44',
    buildMesh(scene, id) {
      const root = new TransformNode('safe_exit_' + id, scene);
      const sign = box(scene,'ess',0.6,0.25,0.06,0,0,0);
      sign.material = mat(scene,'#00aa44');
      const text = box(scene,'est',0.5,0.15,0.01,0,0.05,0.03);
      text.material = mat(scene,'#ffffff');
      [sign, text].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'EMERGENCY_EXIT', objectId: id };
      return root;
    },
  },

  FIRST_AID: {
    label: 'First Aid Kit',
    icon: '🩺',
    category: OBJECT_CATEGORIES.SAFETY,
    defaultWidth: 0.35, defaultHeight: 0.28, defaultDepth: 0.14,
    color: '#ffffff',
    buildMesh(scene, id) {
      const root = new TransformNode('safe_aid_' + id, scene);
      const box_ = box(scene,'fab',0.35,0.28,0.14,0,0,0);
      box_.material = mat(scene,'#f0f0f0');
      const cross = box(scene,'fac',0.08,0.03,0.12,0,0.14,0.06);
      cross.material = mat(scene,'#cc0000');
      [box_, cross].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'FIRST_AID', objectId: id };
      return root;
    },
  },

  // ══════════════════════════════════════════
  //  MARKER / SYSTEM
  // ══════════════════════════════════════════

  SPAWN_POINT: {
    label: 'Spawn Point',
    icon: '📍',
    category: OBJECT_CATEGORIES.MARKER,
    defaultWidth: 0.5, defaultHeight: 0.1, defaultDepth: 0.5,
    color: '#4a6cff',
    buildMesh(scene, id) {
      const root = new TransformNode('mark_spawn_' + id, scene);
      const disc = cyl(scene,'spd',0.4,0.04,0,0,0,32);
      disc.material = glassMat(scene,'#4a6cff'); // shared: never edit it per object
      const ring = cyl(scene,'spr',0.44,0.015,0,0.04,0,32);
      ring.material = mat(scene,'#8aaeff');
      const arrow = box(scene,'spa',0.08,0.35,0.08,0,0.04,0);
      arrow.material = mat(scene,'#6c8cff');
      [disc, ring, arrow].forEach(p => { p.parent = root; p.isPickable = true; });
      root.metadata = { assetType: 'SPAWN_POINT', objectId: id };
      return root;
    },
  },

  ZONE_MARKER: {
    label: 'Zone Marker',
    icon: '🏷️',
    category: OBJECT_CATEGORIES.MARKER,
    defaultWidth: 2, defaultHeight: 0.02, defaultDepth: 2,
    color: '#ffaa00',
    buildMesh(scene, id) {
      const root = new TransformNode('mark_zone_' + id, scene);
      const zone = box(scene,'zm',2,0.02,2,0,0,0);
      const zoneMat = new StandardMaterial('zmat_'+id, scene);
      zoneMat.diffuseColor = new Color3(1, 0.67, 0);
      zoneMat.alpha = 0.3;
      zoneMat.backFaceCulling = false;
      zone.material = zoneMat;
      zone.parent = root; zone.isPickable = true;
      root.metadata = { assetType: 'ZONE_MARKER', objectId: id };
      return root;
    },
  },

  // ── Shop floor (small-scale industry). These get a `machine` hook point,
  //    where Karthik's module attaches operation videos and manuals. ──

  CNC_MACHINE: {
    label: 'CNC Machine',
    icon: '⚙️',
    category: OBJECT_CATEGORIES.INDUSTRIAL,
    defaultWidth: 2.2, defaultHeight: 2.15, defaultDepth: 1.6,
    color: '#d8dbd4',
    buildMesh(scene, id) {
      const root = new TransformNode('ind_cnc_' + id, scene);
      const parts = [];
      const add = (m, material) => { m.material = material; m.parent = root; m.isPickable = true; parts.push(m); };
      // enclosure + roof
      add(box(scene, 'cnc_body', 2.2, 1.9, 1.6, 0, 0, 0), mat(scene, '#d8dbd4'));
      add(box(scene, 'cnc_roof', 2.2, 0.25, 1.6, 0, 1.9, 0), metalMat(scene, '#3a3f47'));
      // sliding door with window (front = +Z)
      add(box(scene, 'cnc_door', 1.25, 1.05, 0.04, -0.25, 0.55, 0.81), metalMat(scene, '#9aa1a8'));
      add(box(scene, 'cnc_win', 0.95, 0.7, 0.02, -0.25, 0.75, 0.835), glassMat(scene, '#9ccbe8'));
      // control panel with screen
      add(box(scene, 'cnc_panel', 0.45, 0.75, 0.14, 0.82, 0.85, 0.86), metalMat(scene, '#2b2f36'));
      add(box(scene, 'cnc_screen', 0.32, 0.24, 0.01, 0.82, 1.3, 0.935), glossMat(scene, '#2f6fae'));
      add(box(scene, 'cnc_keys', 0.32, 0.22, 0.01, 0.82, 0.98, 0.935), mat(scene, '#5b626b'));
      // safety stripe + chip tray
      add(box(scene, 'cnc_stripe', 2.2, 0.07, 0.01, 0, 0.12, 0.805), mat(scene, '#f2b705'));
      add(box(scene, 'cnc_tray', 1.4, 0.12, 0.18, -0.25, 0, 0.89), metalMat(scene, '#555b62'));
      root.metadata = { assetType: 'CNC_MACHINE', objectId: id };
      return root;
    },
  },

  LATHE: {
    label: 'Lathe',
    icon: '🛠️',
    category: OBJECT_CATEGORIES.INDUSTRIAL,
    defaultWidth: 2.4, defaultHeight: 1.35, defaultDepth: 0.8,
    color: '#4f6b5c',
    buildMesh(scene, id) {
      const root = new TransformNode('ind_lathe_' + id, scene);
      const green = mat(scene, '#4f6b5c');
      const steel = metalMat(scene, '#8a948f');
      const add = (m, material) => { m.material = material; m.parent = root; m.isPickable = true; return m; };
      // pedestals and bed
      add(box(scene, 'lt_pedL', 0.5, 0.75, 0.7, -0.85, 0, 0), green);
      add(box(scene, 'lt_pedR', 0.45, 0.75, 0.7, 0.9, 0, 0), green);
      add(box(scene, 'lt_bed', 2.35, 0.18, 0.5, 0, 0.75, 0), steel);
      // headstock, tailstock, carriage
      add(box(scene, 'lt_head', 0.6, 0.45, 0.62, -0.86, 0.93, 0), green);
      add(box(scene, 'lt_tail', 0.3, 0.3, 0.4, 0.95, 0.93, 0), green);
      add(box(scene, 'lt_carr', 0.38, 0.12, 0.62, 0.15, 0.93, 0), steel);
      // chuck (a cylinder lying along X) and the workpiece
      const chuck = add(MeshBuilder.CreateCylinder('lt_chuck', { diameter: 0.3, height: 0.14, tessellation: 20 }, scene), steel);
      chuck.rotation.z = Math.PI / 2;
      chuck.position.set(-0.49, 1.17, 0);
      const work = add(MeshBuilder.CreateCylinder('lt_work', { diameter: 0.07, height: 1.2, tessellation: 12 }, scene),
        metalMat(scene, '#b8bec3'));
      work.rotation.z = Math.PI / 2;
      work.position.set(0.18, 1.17, 0);
      // safety stripe on the front of the pedestals
      add(box(scene, 'lt_stripe', 2.2, 0.05, 0.01, 0, 0.62, 0.36), mat(scene, '#f2b705'));
      root.metadata = { assetType: 'LATHE', objectId: id };
      return root;
    },
  },
};

// ─── Build a mesh instance from a type key ───

/**
 * Build a new instanced mesh for the given asset type.
 * Returns a TransformNode (root) with all child meshes parented to it.
 *
 * @param {string} assetType - key in ASSET_TYPES
 * @param {Scene} scene
 * @param {string} objectId - unique object ID (used for naming)
 * @param {object} [opts]   asset options, e.g. { rise } for a staircase (its floor's height)
 * @returns {TransformNode}
 */
export function buildAssetMesh(assetType, scene, objectId = 'tmp', opts = {}) {
  const def = ASSET_TYPES[assetType];
  if (!def) {
    console.warn('Unknown asset type:', assetType);
    // Fallback: plain box
    const fallback = new TransformNode('unknown_' + objectId, scene);
    const m = MeshBuilder.CreateBox('fb', { width: 1, height: 1, depth: 1 }, scene);
    m.material = new StandardMaterial('fbm', scene);
    m.material.diffuseColor = new Color3(1, 0, 1);
    m.parent = fallback;
    fallback.metadata = { assetType, objectId };
    return fallback;
  }
  const root = def.buildMesh(scene, objectId, opts);
  if (!root.metadata) root.metadata = {};
  root.metadata.assetType = assetType;
  root.metadata.objectId = objectId;
  return root;
}

/**
 * Get all asset types grouped by category.
 */
export function getAssetsByCategory() {
  const grouped = {};
  for (const [key, def] of Object.entries(ASSET_TYPES)) {
    const cat = def.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ key, ...def });
  }
  return grouped;
}
