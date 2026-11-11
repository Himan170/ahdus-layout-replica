import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';
import { createEditorHistory } from '../editorHistory';
import { loadLayout } from '../../engine/model/migrate';
import { toV1 } from '../../engine/model/toV1';

beforeEach(() => useWorkspaceStore.getState().resetWorkspace());
describe('ignored layout checks', () => {
  it('Ignore and Show again undo and redo, save and survive v2 export/import', () => {
    const editor = createEditorHistory();
    const state = () => useWorkspaceStore.getState();
    editor.setIgnoredChecks(['ROOM_NO_DOOR:room_a']);
    expect(state().ignoredChecks).toEqual(['ROOM_NO_DOOR:room_a']);
    editor.undo();
    expect(state().ignoredChecks).toEqual([]);
    editor.redo();
    const snapshot = toV1(loadLayout(state().exportWorkspace()));
    state().resetWorkspace();
    state().loadWorkspace(snapshot);
    expect(state().ignoredChecks).toEqual(['ROOM_NO_DOOR:room_a']);
    editor.setIgnoredChecks([]);
    expect(state().ignoredChecks).toEqual([]);
    editor.undo();
    expect(state().ignoredChecks).toEqual(['ROOM_NO_DOOR:room_a']);
  });
  it('old saves start with no ignores and bad values are discarded', () => {
    const state = () => useWorkspaceStore.getState();
    state().loadWorkspace({});
    expect(state().ignoredChecks).toEqual([]);
    state().loadWorkspace({ ignoredChecks: [null, 3, '', 'same', 'same'] });
    expect(state().ignoredChecks).toEqual(['same']);
  });
});
