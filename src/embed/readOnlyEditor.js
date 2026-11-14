// v0.17.0: the embed's editor. The embed never edits (mode 'edit' is refused), so LayoutEngine's `editor` answers
// every change with { problem: READ_ONLY } anyway: the one-file build (vite.embed.config.js) uses this instead of
// store/editorHistory.js, which brought Studio's commands (and the geometry they use) into the file.
// The same names as createEditorHistory's api (embed/__tests__/readOnlyEditor.test.js keeps them in step).
import { CommandHistory } from '../engine/commands/CommandHistory';

export const EDITOR_COMMANDS = [
  'addObject', 'deleteObject', 'updateObject', 'duplicateObject', 'moveObjects', 'replaceObjects', 'lockObjects',
  'toggleLock', 'addRoom', 'deleteRoom', 'lockRooms', 'toggleRoomLock', 'moveRoom', 'turnRoom', 'updateRoom',
  'setWallHeight', 'setFloorHeight', 'toggleDoor', 'addOpenings', 'removeOpenings', 'resizeOpening',
  'setIgnoredChecks', 'setAnchorData', 'addFloor', 'removeFloor', 'renameFloor', 'applyProposedLayout',
  'restoreVersion', 'undo', 'redo', 'clear', 'endBurst',
];

// LayoutEngine.READ_ONLY (not imported: the engine imports this file)
const READ_ONLY = 'This layout is view-only here';

export function createEditorHistory() {
  const history = new CommandHistory({ maxSize: 1 });
  const api = { history };
  for (const name of EDITOR_COMMANDS) api[name] = () => ({ problem: READ_ONLY });
  api.clear = () => history.clear();
  api.endBurst = () => {};
  return api;
}
