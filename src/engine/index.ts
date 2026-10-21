/**
 * engine/index.ts — Public barrel export for the Layout Engine package
 */

// Core engine
export { LayoutEngine, READ_ONLY } from './LayoutEngine';
export type {
  EngineMode, ViewMode, QualityLevel, EngineOptions, LayoutEditorApi, WorkspaceStore,
  SelectEvent, ChangeEvent, InteractEvent, EnterRoomEvent, ExitRoomEvent,
} from './LayoutEngine';

// Data model
export * from './model';

// Command system
export { CommandHistory } from './commands/CommandHistory';
export type { Command } from './commands/CommandHistory';
export {
  AddObjectCommand,
  DeleteObjectCommand,
  TransformCommand,
  AddRoomCommand,
  DeleteRoomCommand,
  UpdateRoomCommand,
} from './commands/LayoutCommands';

// Systems (for advanced usage / extension)
export {
  ObjectSystem,
  RoomSystem,
  SelectionSystem,
  PlacementSystem,
  FloorSystem,
  WalkthroughSystem,
} from './systems';
