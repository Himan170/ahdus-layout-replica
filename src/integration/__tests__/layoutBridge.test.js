import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore, createWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';
import { layoutBridge as bridge, connectEngine } from '../layoutBridge';
import { anchorsFromStore, primaryAnchor } from '../anchorsFromStore';
import { anchorId } from '../../engine/model/anchors';
import { loadLayout } from '../../engine/model/migrate';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Just what connectEngine uses of a LayoutEngine (LayoutEngine.test.ts connects a real one). */
function fakeEngine(store, mode = 'edit') {
  const handlers = new Map();
  return {
    mode,
    scene: { name: 'viewer scene' },
    walkthrough: null,
    editor: createEditorHistory(undefined, { workspace: store }),
    getStore: () => store,
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    fire: (event, payload) => handlers.get(event)?.(payload),
  };
}

/**
 * The bridge reads the layout of Workplace Studio (the app's store) or of a
 * viewer (a LayoutEngine with its own store, connected with connectEngine).
 * Every test runs on both.
 */
const SOURCES = [
  {
    name: 'Workplace Studio (the app store)',
    setup() {
      this.store = useWorkspaceStore;
    },
    editor: () => createEditorHistory(),
    openEditor() {
      const editor = createEditorHistory();
      bridge._attach({ editor });
      return editor;
    },
  },
  {
    name: 'a viewer (a LayoutEngine\'s own store)',
    setup() {
      this.store = createWorkspaceStore();
      this.engine = fakeEngine(this.store);
      connectEngine(this.engine);
    },
    editor() { return this.engine.editor; },
    openEditor() { return this.engine.editor; },
  },
];

describe.each(SOURCES)('layoutBridge on $name', (source) => {
  const S = () => source.store.getState();

  let ids;
  beforeEach(() => {
    bridge._resetForTests();
    useWorkspaceStore.getState().resetWorkspace();
    source.setup();
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
      const editor = source.openEditor();
      const ws = bridge.getAnchors({ kind: 'workstation' })[0];
      bridge.setPositionRef(ws.id, 'pos-eng-head');
      editor.undo();
      expect(bridge.getAnchor(ws.id).positionRef).toBeUndefined();
      editor.redo();
      expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-eng-head');
    });

    it('typing a position ID letter by letter is one undo step', () => {
      const editor = source.editor();
      const ws = bridge.getAnchors({ kind: 'workstation' })[0];
      for (const v of ['p', 'po', 'pos', 'pos-1']) {
        editor.setAnchorData(ws.id, { positionRef: v }, { mergeKey: 'position-typing' });
      }
      expect(bridge.getAnchor(ws.id).positionRef).toBe('pos-1');
      editor.undo();
      expect(bridge.getAnchor(ws.id).positionRef).toBeUndefined();
    });

    it('the link survives deleting and undo-restoring the desk', () => {
      const editor = source.editor();
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
});

describe('which layout the bridge uses (Studio and viewers on one page)', () => {
  const layoutWith = (store, name) => {
    store.getState().resetWorkspace();
    const room = store.getState().addRoom({ type: 'OFFICE', name, x: 0, z: 0, width: 4, depth: 4 }).id;
    store.getState().addObject({ assetType: 'DESK_STANDARD', x: 1, z: 1, roomId: room });
    return room;
  };
  let studioRoom;
  beforeEach(() => {
    bridge._resetForTests();
    studioRoom = layoutWith(useWorkspaceStore, 'Studio office');
  });
  const roomNames = () => bridge.getRooms().map((r) => r.name);

  it('a viewer reads its own layout; the app store is left alone', () => {
    const store = createWorkspaceStore();
    layoutWith(store, 'Viewer office');
    connectEngine(fakeEngine(store, 'walkthrough'));
    expect(roomNames()).toEqual(['Viewer office']);
    expect(Object.values(useWorkspaceStore.getState().rooms).map((r) => r.name)).toEqual(['Studio office']);
  });

  it('edit or walkthrough mode wins over view; among equals the last connected; disconnecting goes back', () => {
    const studio = { mode: 'edit' };
    bridge._attach(studio);
    const viewStore = createWorkspaceStore();
    layoutWith(viewStore, 'View-only office');
    const disconnectView = connectEngine(fakeEngine(viewStore, 'view'));
    expect(roomNames()).toEqual(['Studio office']); // Studio edits; the viewer only shows

    const walkStore = createWorkspaceStore();
    layoutWith(walkStore, 'Walkthrough office');
    const disconnectWalk = connectEngine(fakeEngine(walkStore, 'walkthrough'));
    expect(roomNames()).toEqual(['Walkthrough office']); // mounted last, and walking

    disconnectWalk();
    expect(roomNames()).toEqual(['Studio office']);
    bridge._detach(studio);
    expect(roomNames()).toEqual(['View-only office']); // the only one left
    disconnectView();
    expect(roomNames()).toEqual(['Studio office']); // nothing attached: the app store
  });

  it('the rule follows a mode change (a getter on the context)', () => {
    bridge._attach({ mode: 'edit' });
    const store = createWorkspaceStore();
    layoutWith(store, 'Viewer office');
    const engine = fakeEngine(store, 'view');
    connectEngine(engine);
    expect(roomNames()).toEqual(['Studio office']);
    engine.mode = 'walkthrough';
    expect(roomNames()).toEqual(['Viewer office']);
  });

  it('anchorsChange listeners get the new layout\'s anchors when another one becomes active, then its changes', async () => {
    const calls = [];
    bridge.on('anchorsChange', ({ anchors }) => calls.push(anchors.map((a) => a.position.x)));
    const store = createWorkspaceStore();
    layoutWith(store, 'Viewer office');
    store.getState().updateObject(Object.keys(store.getState().objects)[0], { x: 7 });
    connectEngine(fakeEngine(store, 'walkthrough'));
    await flush();
    expect(calls).toEqual([[7]]);
    store.getState().updateObject(Object.keys(store.getState().objects)[0], { x: 8 });
    await flush();
    expect(calls).toEqual([[7], [8]]);
    useWorkspaceStore.getState().updateObject(Object.keys(useWorkspaceStore.getState().objects)[0], { x: 9 });
    await flush();
    expect(calls).toHaveLength(2); // Studio's store is not the one in use
  });

  it('a viewer that refuses edits (view / walkthrough mode): setPositionRef and setAnchorLabel return false', () => {
    const store = createWorkspaceStore();
    layoutWith(store, 'Viewer office');
    const engine = fakeEngine(store, 'walkthrough');
    engine.editor = { setAnchorData: () => ({ problem: 'This layout is view-only here' }) };
    connectEngine(engine);
    const ws = bridge.getAnchors({ kind: 'workstation' })[0];
    expect(bridge.setPositionRef(ws.id, 'pos-1')).toBe(false);
    expect(bridge.setAnchorLabel(ws.id, 'Lead desk')).toBe(false);
    expect(store.getState().anchorData).toEqual({});
  });

  it('getScene and getPlayer are the viewer\'s', () => {
    const store = createWorkspaceStore();
    const engine = fakeEngine(store, 'walkthrough');
    engine.walkthrough = {
      isActive: () => true, getPosition: () => ({ x: 1, y: 0, z: 2 }), getYaw: () => 0.5, getRoomId: () => 'r1',
    };
    connectEngine(engine);
    expect(bridge.getScene()).toBe(engine.scene);
    expect(bridge.getPlayer()).toEqual({ position: { x: 1, y: 0, z: 2 }, yaw: 0.5, roomId: 'r1' });
  });
});

describe('connectEngine: a viewer\'s walkthrough events reach the modules', () => {
  let store;
  let engine;
  let room;
  let desk;
  let cards;
  let disconnect;
  beforeEach(() => {
    bridge._resetForTests();
    useWorkspaceStore.getState().resetWorkspace();
    store = createWorkspaceStore();
    room = store.getState().addRoom({ type: 'OFFICE', name: 'Viewer office', x: 0, z: 0, width: 4, depth: 4 }).id;
    desk = store.getState().addObject({ assetType: 'DESK_STANDARD', x: 1, z: 1, roomId: room }).id;
    engine = fakeEngine(store, 'walkthrough');
    cards = [];
    disconnect = connectEngine(engine, { showCard: (card) => cards.push(card) });
  });

  it('enterRoom / exitRoom with the room as modules see it', () => {
    const got = [];
    bridge.on('enterRoom', (e) => got.push(['enter', e.roomId, e.room.name, e.fromRoomId]));
    bridge.on('exitRoom', (e) => got.push(['exit', e.roomId, e.room.name, e.toRoomId]));
    engine.fire('enterRoom', { roomId: room, floorId: 0, roomName: 'Viewer office', roomType: 'OFFICE', fromRoomId: null });
    engine.fire('exitRoom', { roomId: room, floorId: 0, toRoomId: null });
    expect(got).toEqual([['enter', room, 'Viewer office', null], ['exit', room, 'Viewer office', null]]);
  });

  it('E: interact is described from the viewer\'s layout, and the first matching "Press E" action runs', () => {
    const got = [];
    bridge.on('interact', (t) => got.push(t));
    const ran = [];
    bridge.addInteraction({ id: 'desk', when: (t) => t.anchorKind === 'workstation', label: 'Show handover', run: (t) => ran.push(t.objectId) });
    engine.fire('interact', { anchorId: null, objectId: desk, position: { x: 1, y: 0.7, z: 1 }, roomId: room, part: null, distance: 1.2 });
    expect(got[0]).toMatchObject({ kind: 'object', objectId: desk, anchorKind: 'workstation', roomId: room, distance: 1.2 });
    expect(ran).toEqual([desk]);
    expect(cards).toEqual([]);
    expect(engine.describeInteraction({ objectId: desk })).toEqual({ label: 'Show handover', name: 'Standard Desk', handled: true });
  });

  it('E with no module action shows the default card in the viewer; a door is described as a door', () => {
    engine.fire('interact', { anchorId: null, objectId: null, position: { x: 0, y: 1, z: -2 }, roomId: room, part: 'door', distance: 1 });
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Door');
    expect(cards[0].body).toMatch(/Viewer office/);
  });

  it('disconnecting stops the events and gives the bridge back', () => {
    const got = [];
    bridge.on('enterRoom', (e) => got.push(e));
    disconnect();
    engine.fire('enterRoom', { roomId: room, floorId: 0, roomName: '', roomType: '', fromRoomId: null });
    expect(got).toEqual([]);
    expect(engine.describeInteraction).toBeNull();
    expect(bridge.getRooms()).toEqual([]); // the (empty) app store again
  });
});
