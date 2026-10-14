/**
 * commands/CommandHistory.ts
 *
 * Command pattern for fully undoable editing.
 * Every mutation goes through history.execute(cmd).
 * Ctrl+Z → history.undo(), Ctrl+Y → history.redo().
 */

// ── Command interface ────────────────────────────────────────────────────

export interface Command {
  /** Short human-readable description (shown in undo tooltip) */
  label: string;

  /** Apply the change */
  execute(): void;

  /** Reverse the change exactly */
  undo(): void;

  /**
   * Optional: absorb a newer command into this one, so that e.g. dragging a
   * slider or typing a name becomes ONE undo step instead of fifty.
   * Return true if merged (the newer command is then not pushed). Only merge
   * commands with the same mergeKey on the same target.
   * The newer command has already been executed when this is called.
   */
  mergeWith?(next: Command): boolean;
}

export interface CommandHistoryOptions {
  maxSize?: number;
  /**
   * A burst (consecutive commands that merge) ends after this many ms without
   * a command. Measured with `now`, which should give the time of the INPUT
   * (key press, mouse move), so a slow PC that handles presses late still
   * merges them.
   */
  mergeWindowMs?: number;
  onChange?: (canUndo: boolean, canRedo: boolean) => void;
  /** Time of the input behind the command being executed (ms); injectable for tests. */
  now?: () => number;
}

// ── History manager ──────────────────────────────────────────────────────

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;
  private mergeWindowMs: number;
  private onChange?: (canUndo: boolean, canRedo: boolean) => void;
  private now: () => number;
  private lastExecuteAt = -Infinity;

  constructor(options: CommandHistoryOptions = {}) {
    this.maxSize = options.maxSize ?? 200;
    this.mergeWindowMs = options.mergeWindowMs ?? 2000;
    this.onChange = options.onChange;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Execute a command and push it to the undo stack, or merge it into the top
   * one: the previous command (nothing came between them), same mergeKey and
   * target (mergeWith decides), and the burst hasn't ended.
   */
  execute(cmd: Command): void {
    cmd.execute();

    // Clear redo — a new edit forks the timeline
    this.redoStack = [];

    const t = this.now();
    const top = this.undoStack[this.undoStack.length - 1];
    const merged =
      top !== undefined &&
      t - this.lastExecuteAt < this.mergeWindowMs &&
      top.mergeWith?.(cmd) === true;
    this.lastExecuteAt = t;

    if (!merged) {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
    }

    this.notify();
  }

  /** Undo the most recent command */
  undo(): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;

    cmd.undo();
    this.redoStack.push(cmd);
    this.lastExecuteAt = -Infinity; // never merge across an undo
    this.notify();
    return cmd;
  }

  /** Redo the most recently undone command */
  redo(): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;

    cmd.execute();
    this.undoStack.push(cmd);
    this.lastExecuteAt = -Infinity;
    this.notify();
    return cmd;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    const top = this.undoStack[this.undoStack.length - 1];
    return top ? top.label : null;
  }

  get redoLabel(): string | null {
    const top = this.redoStack[this.redoStack.length - 1];
    return top ? top.label : null;
  }

  /**
   * End the current burst: the next command starts a new undo step even with
   * the same mergeKey (the mouse was released, the tool changed).
   */
  endBurst(): void {
    this.lastExecuteAt = -Infinity;
  }

  /** Wipe all history (e.g., on layout load) */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastExecuteAt = -Infinity;
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this.canUndo, this.canRedo);
  }
}
