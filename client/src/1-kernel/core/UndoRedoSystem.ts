import { gameBus } from './EventBus';
import type { SystemCapabilities, SystemContext } from './types';

export interface UndoRedoAction {
  label: string;
  undo(): void;
  redo(): void;
}

export interface UndoRedoSnapshot {
  undoDepth: number;
  redoDepth: number;
  nextUndoLabel: string | null;
  nextRedoLabel: string | null;
}

type Listener = (snapshot: UndoRedoSnapshot) => void;

export class UndoRedoSystem {
  private undoStack: UndoRedoAction[] = [];
  private redoStack: UndoRedoAction[] = [];
  private listeners = new Set<Listener>();
  private maxDepth: number;
  private systemContext: SystemContext | null = null;

  constructor(maxDepth = 128) {
    this.maxDepth = Math.max(8, maxDepth);
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        undoDepth: this.undoStack.length,
        redoDepth: this.redoStack.length,
        nextUndoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
        nextRedoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  execute(action: UndoRedoAction): void {
    action.redo();
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.emit();
  }

  pushCompletedAction(action: UndoRedoAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;
    action.undo();
    this.redoStack.push(action);
    this.emit();
    return true;
  }

  redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;
    action.redo();
    this.undoStack.push(action);
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  snapshot(): UndoRedoSnapshot {
    return {
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      nextUndoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      nextRedoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    };
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    gameBus.emit('stateMutation', {
      source: 'undoRedoSystem',
      path: 'editor.undoRedo',
      changedCount: 1,
    });
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
