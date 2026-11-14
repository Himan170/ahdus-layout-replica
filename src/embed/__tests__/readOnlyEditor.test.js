import { describe, expect, it } from 'vitest';
import { createEditorHistory as realEditor } from '../../store/editorHistory';
import { createWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory as readOnlyEditor, EDITOR_COMMANDS } from '../readOnlyEditor';
import { READ_ONLY } from '../../engine/LayoutEngine';

// v0.17.0: the embed's file uses a read-only editor in place of Studio's commands: the same names, nothing changes.
describe('readOnlyEditor (v0.17.0)', () => {
  it('has every command the real editor has, and only those', () => {
    const real = realEditor(undefined, { workspace: createWorkspaceStore() });
    const names = Object.keys(real).filter((k) => k !== 'history').sort();
    expect([...EDITOR_COMMANDS].sort()).toEqual(names);
    expect(Object.keys(readOnlyEditor()).filter((k) => k !== 'history').sort()).toEqual(names);
  });

  it('refuses every change with the engine\'s read-only answer', () => {
    const editor = readOnlyEditor();
    expect(editor.addRoom({ x: 0, z: 0, width: 4, depth: 4 })).toEqual({ problem: READ_ONLY });
    expect(editor.undo()).toEqual({ problem: READ_ONLY });
    expect(() => editor.clear()).not.toThrow();
    expect(editor.history.canUndo).toBe(false);
  });
});
