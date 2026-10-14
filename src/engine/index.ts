/**
 * engine/index.ts — Public barrel export for the Layout Engine package
 */

// Core engine
export { LayoutEngine } from './LayoutEngine';
export type { EngineMode, ViewMode, QualityLevel, EngineOptions } from './LayoutEngine';

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
