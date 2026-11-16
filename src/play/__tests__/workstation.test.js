import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { wsParams, wsKey, wsPatch, isWorkstation, hasOwnScreen, PARTITION_HEIGHT_MAX } from '../workstation';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { UNKNOWN_ITEM_SIZE } from '../../catalog/manifest';
import { itemFootprint } from '../navigation/walkMap';
import { createItemMesh, disposeItemMesh } from '../../utils/assetInstances';

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

const WS = ASSET_TYPES.DESK_WORKSTATION;
const desk = (extra = {}) => ({ id: 'd1', assetType: 'DESK_WORKSTATION', x: 0, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1, metadata: {}, ...extra });

describe('workstation options (v0.18.0)', () => {
  it('takes its size from the scale and its options from metadata.ws, else the catalogue', () => {
    expect(isWorkstation(WS)).toBe(true);
    expect(isWorkstation(ASSET_TYPES.DESK_STANDARD)).toBe(false);
    expect(wsParams(desk(), WS)).toEqual({
      width: 1.4, depth: 0.7, height: 0.75, partition: 'fabric', partitionHeight: 0.45,
      sides: 'none', pedestal: true, screen: true, modesty: false,
    });
    const p = wsParams(desk({ scaleX: 1.6 / 1.4, scaleZ: -1, metadata: { ws: { partition: 'glass', partitionHeight: 3, sides: 'both' } } }), WS);
    expect(p).toMatchObject({ width: 1.6, depth: 0.7, partition: 'glass', partitionHeight: PARTITION_HEIGHT_MAX, sides: 'both' });
    expect(wsParams(desk({ metadata: { ws: { partition: 'brick' } } }), WS).partition).toBe('none');
    expect(wsParams(desk(), ASSET_TYPES.DESK_MANAGER)).toMatchObject({ width: 1.8, partition: 'none', modesty: true });
  });

  it('keys equal shapes equally', () => {
    const a = wsKey(wsParams(desk(), WS));
    expect(wsKey(wsParams(desk({ id: 'other', x: 5 }), WS))).toBe(a);
    expect(wsKey(wsParams(desk({ scaleX: 1.2 }), WS))).not.toBe(a);
    // with no partition its height and sides change nothing
    const none = (ws) => wsKey(wsParams(desk({ metadata: { ws: { partition: 'none', ...ws } } }), WS));
    expect(none({ partitionHeight: 0.3, sides: 'left' })).toBe(none({ partitionHeight: 0.8 }));
  });

  it('patches metadata.ws and keeps the rest of metadata', () => {
    const obj = desk({ metadata: { group: { id: 'g' }, ws: { sides: 'left' } } });
    expect(wsPatch(obj, { partition: 'glass', partitionHeight: 0.333 })).toEqual({
      metadata: { group: { id: 'g' }, ws: { sides: 'left', partition: 'glass', partitionHeight: 0.33 } },
    });
    expect(wsPatch(obj, { sides: null })).toEqual({ metadata: { group: { id: 'g' } } });
  });

  it('types at a desk with its own screen only', () => {
    expect(hasOwnScreen(desk(), WS)).toBe(true);
    expect(hasOwnScreen(desk({ metadata: { ws: { screen: false } } }), WS)).toBe(false);
    expect(hasOwnScreen({ assetType: 'DESK_STANDARD' }, ASSET_TYPES.DESK_STANDARD)).toBe(false);
  });
});

describe('workstation meshes (v0.18.0)', () => {
  let engine;
  let scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  const make = (id, obj) => {
    const params = wsParams(obj, WS);
    return createItemMesh('DESK_WORKSTATION', scene, id, { variant: { key: wsKey(params), params } });
  };
  const sizeOf = (root) => {
    const mesh = root.getChildMeshes()[0];
    const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
    mesh.computeWorldMatrix(true);
    return { w: max.x - min.x, h: max.y - min.y, d: max.z - min.z };
  };

  it('desks with the same options share ONE template; their real size is drawn', () => {
    const a = make('a', desk());
    const b = make('b', desk({ id: 'b' }));
    const wide = make('c', desk({ id: 'c', scaleX: 1.8 / 1.4 }));
    const tA = a.getChildMeshes()[0].sourceMesh;
    expect(tA).toBeTruthy();
    expect(b.getChildMeshes()[0].sourceMesh).toBe(tA);
    expect(wide.getChildMeshes()[0].sourceMesh).not.toBe(tA);
    expect(sizeOf(a).w).toBeCloseTo(1.4, 2);
    expect(sizeOf(wide).w).toBeCloseTo(1.8, 2);
    // the partition stands on the desk top: 0.75 + 0.45 + its rail
    expect(sizeOf(a).h).toBeCloseTo(0.75 + 0.45 + 0.015, 2);
    expect(a.metadata.variant).toBe(wsKey(wsParams(desk(), WS)));
    for (const r of [a, b, wide]) disposeItemMesh(r);
  });

  it('a desk with no partition is only as high as its monitor', () => {
    const low = make('n', desk({ metadata: { ws: { partition: 'none' } } }));
    expect(sizeOf(low).h).toBeCloseTo(0.75 + 0.1 + 0.34, 2);
    disposeItemMesh(low);
  });
});

describe('a type this version does not know (v0.18.0)', () => {
  let engine;
  let scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); });

  it('is a plain desk-sized box on the floor, with one warning per type, never a crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = createItemMesh('DESK_FROM_THE_FUTURE', scene, 'u1');
    const b = createItemMesh('DESK_FROM_THE_FUTURE', scene, 'u2');
    const mesh = a.getChildMeshes()[0];
    mesh.computeWorldMatrix(true);
    const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
    expect(max.x - min.x).toBeCloseTo(UNKNOWN_ITEM_SIZE.width, 3);
    expect(max.y - min.y).toBeCloseTo(UNKNOWN_ITEM_SIZE.height, 3);
    expect(max.z - min.z).toBeCloseTo(UNKNOWN_ITEM_SIZE.depth, 3);
    expect(min.y).toBeCloseTo(0, 3);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('DESK_FROM_THE_FUTURE'))).toHaveLength(1);
    // walked round as that size
    const fp = itemFootprint({ assetType: 'DESK_FROM_THE_FUTURE', x: 0, z: 0 }, ASSET_TYPES);
    expect([fp.hw * 2, fp.hd * 2]).toEqual([UNKNOWN_ITEM_SIZE.width, UNKNOWN_ITEM_SIZE.depth]);
    for (const r of [a, b]) disposeItemMesh(r);
  });
});
