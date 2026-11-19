import { describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import {
  readManifest, readItem, readPrefab, parseMaterial, MANIFEST, MANIFEST_TYPES, PREFABS, prefabById, manifestDesks,
} from '../manifest';
import { ASSET_TYPES, buildAssetMesh } from '../../utils/assetCatalog';
import { chipOf, FURNITURE_TILES } from '../../ui/library';
import { itemFootprints } from '../../play/navigation/walkMap';
import { DESK_SIZES, DESK_WORK_SIDE, isDesk } from '../../play/people';
import { isDesk as isSeatDesk } from '../../ui/seatFlow';
import { shortLabel } from '../../play/hotbarItems';

// Node has no canvas: a texture whose 2D context takes every drawing call
vi.mock('@babylonjs/core/Materials/Textures/dynamicTexture', () => {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : () => ctx), set: () => true });
  class DynamicTexture {
    constructor(name) { this.name = name; }
    getContext() { return ctx; }
    update() {}
    dispose() {}
  }
  return { DynamicTexture };
});

const file = (items, prefabs = []) => ({ format: 'ahdus-catalog', version: 1, items, prefabs });
const chair = {
  id: 'CHAIR_TEST', label: 'Test chair', chip: 'Seating', size: { w: 0.5, d: 0.5, h: 0.9 },
  parts: [{ shape: 'box', size: [0.5, 0.05, 0.5], at: [0, 0.45, 0], material: 'fabric:#334455' }],
};

describe('the asset manifest (v0.18.0)', () => {
  it('reads the app manifest with no problems', () => {
    expect(MANIFEST.problems).toEqual([]);
    expect(Object.keys(MANIFEST_TYPES)).toEqual(expect.arrayContaining(['DESK_WORKSTATION', 'DESK_MANAGER', 'CHAIR_VISITOR', 'PEDESTAL_DRAWERS', 'PARTITION_SCREEN']));
    expect(PREFABS.map((p) => p.id)).toEqual(['WS_SINGLE', 'WS_CLUSTER_2', 'WS_CLUSTER_4', 'WS_CLUSTER_6', 'WS_CLUSTER_8', 'WS_ROW_4', 'WS_MANAGER', 'WS_CABIN']);
    expect(prefabById('WS_CLUSTER_6').seats).toBe(6);
    expect(prefabById('WS_CABIN').room).toMatchObject({ type: 'CABIN', width: 3.6 });
  });

  it('turns an entry into a catalogue entry', () => {
    const { def } = readItem(chair);
    expect(def).toMatchObject({ label: 'Test chair', chip: 'Seating', defaultWidth: 0.5, defaultDepth: 0.5, defaultHeight: 0.9, solid: true, manifest: true });
  });

  it('leaves out a bad entry with a reason, never throws', () => {
    const bad = [
      { ...chair, id: 'lower' },
      { ...chair, id: 'NO_SIZE', size: { w: 1 } },
      { ...chair, id: 'NO_PARTS', parts: [] },
      { ...chair, id: 'BAD_SHAPE', parts: [{ shape: 'cone', size: [1, 1, 1], at: [0, 0, 0], material: 'matte' }] },
      { ...chair, id: 'BAD_MAT', parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0, 0], material: 'gold:#ffffff' }] },
      null,
    ];
    const out = readManifest(file([chair, ...bad]));
    expect(Object.keys(out.types)).toEqual(['CHAIR_TEST']);
    expect(out.problems).toHaveLength(6);
    expect(readManifest({ format: 'other' }).problems[0]).toMatch(/not an ahdus-catalog/);
    expect(readManifest(file([chair, chair])).problems[0]).toMatch(/already/);
    expect(readItem(chair, { CHAIR_TEST: {} }).problem).toMatch(/already in the catalogue/);
  });

  it('checks prefabs', () => {
    const types = { DESK_X: { defaultWidth: 1.2, defaultDepth: 0.6 } };
    expect(readPrefab({ id: 'P_A', layout: 'cluster', seats: 4, desk: 'DESK_X' }, types).prefab.params)
      .toEqual({ deskWidth: 1.2, deskDepth: 0.6, partition: 'fabric', partitionHeight: 0.45 });
    expect(readPrefab({ id: 'P_B', layout: 'cluster', seats: 3, desk: 'DESK_X' }, types).problem).toMatch(/even/);
    expect(readPrefab({ id: 'P_C', layout: 'tower', seats: 2, desk: 'DESK_X' }, types).problem).toMatch(/layout/);
    expect(readPrefab({ id: 'P_D', layout: 'row', seats: 2, desk: 'DESK_NONE' }, types).problem).toMatch(/desk/);
    expect(readPrefab({ id: 'P_E', layout: 'cabin', seats: 1, desk: 'DESK_X' }, types).problem).toMatch(/room/);
  });

  it('parses materials', () => {
    expect(parseMaterial('fabric:#4A5568')).toEqual({ finish: 'fabric', hex: '#4a5568' });
    expect(parseMaterial('glass')).toEqual({ finish: 'glass', hex: '#a8d4f5' });
    expect(parseMaterial('fabric:red')).toBeNull();
  });

  it('joins the catalogue: library chip, short name, desk rules', () => {
    for (const id of Object.keys(MANIFEST_TYPES)) {
      expect(ASSET_TYPES[id], id).toBeTruthy();
      expect(typeof ASSET_TYPES[id].buildMesh).toBe('function');
    }
    // the hand-built items are untouched
    expect(ASSET_TYPES.DESK_STANDARD.manifest).toBeUndefined();
    expect(chipOf('DESK_WORKSTATION')).toBe('Workstations');
    expect(chipOf('CHAIR_VISITOR')).toBe('Seating');
    expect(FURNITURE_TILES.find((t) => t.assetType === 'PARTITION_SCREEN').chip).toBe('Workstations');
    expect(shortLabel({ kind: 'object', assetType: 'DESK_MANAGER', label: 'Manager Desk' })).toBe('Mgr desk');
    expect(manifestDesks()).toMatchObject({ DESK_WORKSTATION: { width: 1.4, depth: 0.7, workSide: 1, typing: 'screen' } });
    expect(DESK_SIZES.DESK_WORKSTATION).toEqual({ width: 1.4, depth: 0.7 });
    expect(DESK_WORK_SIDE.DESK_MANAGER).toBe(1);
    // a workstation is a desk to people at desks AND to the AHDUS seats rule (DESK*)
    for (const t of ['DESK_WORKSTATION', 'DESK_MANAGER']) {
      expect(isDesk(t)).toBe(true);
      expect(isSeatDesk(t)).toBe(true);
    }
    expect(isDesk('CHAIR_VISITOR')).toBe(false);
  });

  it('gives the walk map its footprint boxes', () => {
    const screen = { id: 's', assetType: 'PARTITION_SCREEN', x: 2, z: 1, rotationY: 0, scaleX: 2, scaleZ: 1 };
    const [fp] = itemFootprints(screen, ASSET_TYPES);
    expect(fp.hw).toBeCloseTo(1.2);
    expect(fp.hd).toBeCloseTo(0.025);
    // and its two feet
    expect(itemFootprints(screen, ASSET_TYPES)).toHaveLength(3);
    expect(fp.x).toBeCloseTo(2);
  });

  it('draws an item from its parts', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = buildAssetMesh('CHAIR_VISITOR', scene, 'c1');
    expect(root.metadata).toMatchObject({ assetType: 'CHAIR_VISITOR', objectId: 'c1' });
    expect(root.getChildMeshes().length).toBe(6);
    scene.dispose();
    engine.dispose();
  });
});
