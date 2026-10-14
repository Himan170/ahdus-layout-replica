import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';
import { layoutBridge as bridge } from '../layoutBridge';
import { anchorsFromStore, primaryAnchor } from '../anchorsFromStore';
import { anchorId } from '../../engine/model/anchors';
import { loadLayout } from '../../engine/model/migrate';

const S = () => useWorkspaceStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

let ids;
beforeEach(() => {
  bridge._resetForTests();
  S().resetWorkspace();
  const office = S().addRoom({ type: 'OFFICE', x: 0, z: 0, width: 8, depth: 6 }).id;
  const desk = S().addObject({ assetType: 'DESK_STANDARD', x: 1, z: 1, roomId: office }).id;
  const chair = S().addObject({ assetType: 'CHAIR_OFFICE', x: 1, z: 0.4, roomId: office }).id;
  const cnc = S().addObject({ assetType: 'CNC_MACHINE', x: -2, z: 1, rotationY: Math.PI / 2, roomId: office }).id;
  const recep = S().addObject({ assetType: 'RECEPTION_DESK', x: 0, z: -2, roomId: office }).id;
  ids = { office, desk, chair, cnc, recep };
});

describe('anchors in the live editor', () => {
  it('every hook-point object gets the right kind, with a stable ID', () => {
    const byObject = (id) => bridge.getAnchors({ objectId: id }).map((a) => a.kind);
    expect(byObject(ids.desk)).toEqual(['workstation']);
    expect(byObject(ids.chair)).toEqual(['seat']);
    expect(byObject(ids.cnc)).toEqual(['machine']);
    expect(byObject(ids.recep)).toEqual(['reception']);
    expect(bridge.getAnchors({ kind: 'machine' })[0].id).toBe(anchorId(ids.cnc, 'machine'));
  });

  it('filters by kind, room and floor', () => {
    expect(bridge.getAnchors({ kind: 'seat' })).toHaveLength(1);
    expect(bridge.getAnchorsByRoom(ids.office)).toHaveLength(4);
    expect(bridge.getAnchors({ floorId: 1 })).toHaveLength(0);
  });

  it('anchors follow their object when it moves', () => {
    S().updateObject(ids.desk, { x: 5, z: -1 });
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    expect(ws.position.x).toBe(5);
    expect(ws.position.z).toBe(-1);
  });

  it('a machine anchor is in front of the machine, whichever way it faces', () => {
    const m = bridge.getAnchors({ kind: 'machine' })[0];
    // rotated 90°: "in front" (+Z locally) becomes +X in the world
    expect(m.position.x).toBeCloseTo(-2 + 0.8);
    expect(m.position.z).toBeCloseTo(1);
  });

  it('getObject / getRoom return plain, readable data', () => {
    expect(bridge.getObject(ids.cnc)).toMatchObject({ id: ids.cnc, label: 'CNC Machine', category: 'Industrial', roomId: ids.office });
    expect(bridge.getRoom(ids.office)).toMatchObject({ id: ids.office, type: 'OFFICE', typeLabel: 'Office', width: 8 });
    expect(bridge.getObject('nope')).toBeNull();
  });
});

describe('upper floors', () => {
  it('hook points on Floor 1 are 3.5 m higher (world positions), also in the v2 format', () => {
    S().addFloor();                                   // Floor 1 at 3.5 m
    const id = S().addObject({ assetType: 'CHAIR_OFFICE', x: 0, z: 0, floor: 1 }).id;
    const seat = bridge.getAnchors({ objectId: id })[0];
    expect(seat.floorId).toBe(1);
    expect(seat.position.y).toBeCloseTo(3.5 + 0.45);
    expect(bridge.getObject(id).position.y).toBeCloseTo(3.5);

    const v2 = loadLayout(JSON.parse(JSON.stringify(S().exportWorkspace())));
    expect(v2.anchors.find((a) => a.objectId === id).position.y).toBeCloseTo(3.95);
  });
});

describe('linking a desk to a job position', () => {
  it('saves positionRef on the anchor; null removes it', () => {
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    expect(bridge.setPositionRef(ws.id, 'pos-eng-head')).toBe(true);
    expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-eng-head');
    bridge.setPositionRef(ws.id, null);
    expect(bridge.getAnchor(ws.id).positionRef).toBeUndefined();
    expect(S().anchorData).toEqual({});
  });

  it('unknown anchor → false, nothing saved', () => {
    expect(bridge.setPositionRef('not-an-anchor', 'x')).toBe(false);
    expect(S().anchorData).toEqual({});
  });

  it('is undoable when the editor is open', () => {
    const editor = createEditorHistory();
    bridge._attach({ editor });
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    bridge.setPositionRef(ws.id, 'pos-eng-head');
    editor.undo();
    expect(bridge.getAnchor(ws.id).positionRef).toBeUndefined();
    editor.redo();
    expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-eng-head');
  });

  it('typing a position ID letter by letter is one undo step', () => {
    const editor = createEditorHistory();
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    for (const v of ['p', 'po', 'pos', 'pos-1']) {
      editor.setAnchorData(ws.id, { positionRef: v }, { mergeKey: 'position-typing' });
    }
    expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-1');
    editor.undo();
    expect(bridge.getAnchor(ws.id).positionRef).toBeUndefined();
  });

  it('the link survives deleting and undo-restoring the desk', () => {
    const editor = createEditorHistory();
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    bridge.setPositionRef(ws.id, 'pos-eng-head');
    editor.deleteObject(ids.desk);
    expect(bridge.getAnchor(ws.id)).toBeNull();
    editor.undo();
    expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-eng-head');
  });

  it('is saved and loaded with the layout, and carried into the v2 format', () => {
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    bridge.setPositionRef(ws.id, 'pos-eng-head');
    const saved = JSON.parse(JSON.stringify(S().exportWorkspace()));

    S().resetWorkspace();
    expect(bridge.getAnchor(ws.id)).toBeNull();
    S().loadWorkspace(saved);
    expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-eng-head');

    const v2 = loadLayout(saved);
    expect(v2.anchors.find((a) => a.id === ws.id).positionRef).toBe('pos-eng-head');
  });
});

describe('events', () => {
  it('on / off / emit; a failing handler does not stop the others', () => {
    const got = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.on('interact', () => { throw new Error('boom'); });
    const off = bridge.on('interact', (p) => got.push(p.objectId));
    bridge._emit('interact', { objectId: 'a' });
    off();
    bridge._emit('interact', { objectId: 'b' });
    expect(got).toEqual(['a']);
    spy.mockRestore();
  });

  it('unknown event names are rejected with a helpful message', () => {
    expect(() => bridge.on('click', () => {})).toThrow(/interact, enterRoom, exitRoom, anchorsChange/);
  });

  it('anchorsChange fires once per change, with the new anchors', async () => {
    const calls = [];
    bridge.on('anchorsChange', ({ anchors }) => calls.push(anchors));
    S().updateObject(ids.chair, { x: 3 });
    S().updateObject(ids.chair, { z: 2 });      // same tick → batched
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].find((a) => a.kind === 'seat').position).toMatchObject({ x: 3, z: 2 });

    S().selectRoom(ids.office);                  // not an anchor change
    await flush();
    expect(calls).toHaveLength(1);
  });
});

describe('press E', () => {
  it('describes what you look at: object, primary anchor, room, linked position', () => {
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    bridge.setPositionRef(ws.id, 'pos-eng-head');
    const t = bridge._describeTarget({ objectId: ids.desk, point: { x: 1, y: 0.8, z: 1 }, distance: 2 });
    expect(t).toMatchObject({
      kind: 'object', objectId: ids.desk, anchorKind: 'workstation', anchorId: ws.id,
      positionRef: 'pos-eng-head', roomId: ids.office, distance: 2,
    });
    expect(t.room.name).toMatch(/Office/);

    const door = bridge._describeTarget({ roomId: ids.office, part: 'door' });
    expect(door).toMatchObject({ kind: 'door', objectId: null, anchorKind: null, roomId: ids.office });
  });

  it('the first matching interaction wins; label can depend on the target', () => {
    bridge.addInteraction({ id: 'video', when: (t) => t.anchorKind === 'machine', label: (t) => `Watch ${t.object.label} video`, run() {} });
    bridge.addInteraction({ id: 'any', label: 'Info', run() {} });
    const cnc = bridge._describeTarget({ objectId: ids.cnc });
    const desk = bridge._describeTarget({ objectId: ids.desk });
    expect(bridge._interactionFor(cnc)).toMatchObject({ id: 'video', label: 'Watch CNC Machine video' });
    expect(bridge._interactionFor(desk)).toMatchObject({ id: 'any', label: 'Info' });
  });

  it('a label of null skips that interaction; removing and re-adding by id works', () => {
    const remove = bridge.addInteraction({ id: 'x', label: () => null, run() {} });
    expect(bridge._interactionFor(bridge._describeTarget({ objectId: ids.desk }))).toBeNull();
    remove();
    bridge.addInteraction({ id: 'y', label: 'A', run() {} });
    bridge.addInteraction({ id: 'y', label: 'B', run() {} }); // same id replaces
    expect(bridge._interactionFor(bridge._describeTarget({ objectId: ids.desk })).label).toBe('B');
  });

  it('primaryAnchor prefers machine > reception > workstation > seat', () => {
    const anchors = anchorsFromStore(S().objects, {});
    expect(primaryAnchor(anchors).kind).toBe('machine');
    expect(primaryAnchor(anchors.filter((a) => a.kind !== 'machine')).kind).toBe('reception');
  });
});

describe('positions provider', () => {
  it('returns the provider list, or [] if there is none or it fails', () => {
    expect(bridge.getPositions()).toEqual([]);
    bridge.setPositionProvider(() => [{ id: 'p1', title: 'HR Manager' }]);
    expect(bridge.getPositions()).toEqual([{ id: 'p1', title: 'HR Manager' }]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.setPositionProvider(() => { throw new Error('offline'); });
    expect(bridge.getPositions()).toEqual([]);
    spy.mockRestore();
  });
});
