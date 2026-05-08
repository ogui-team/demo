import {
  gameBus,
  type EditorTool,
  type SystemCapabilities,
  type SystemContext,
} from '@engine/1-kernel/core/public-api';

type BusyOwner = 'none' | 'gizmo' | 'paint' | 'whitebox';

export interface EditorToolCoordinatorConfig {
  initialTool?: EditorTool;
  enableLogging?: boolean;
}

export interface EditorToolCoordinatorState {
  activeTool: EditorTool;
  isGizmoDragging: boolean;
  isPainting: boolean;
  isWhiteboxing: boolean;
  busyOwner: BusyOwner;
}

const DEFAULT_STATE: EditorToolCoordinatorState = {
  activeTool: 'SELECT',
  isGizmoDragging: false,
  isPainting: false,
  isWhiteboxing: false,
  busyOwner: 'none',
};

export class EditorToolCoordinator {
  private state: EditorToolCoordinatorState;
  private readonly enableLogging: boolean;
  private readonly lifecycleDisposers: Array<() => void> = [];
  private systemContext: SystemContext | null = null;

  constructor(config: EditorToolCoordinatorConfig = {}) {
    this.state = {
      ...DEFAULT_STATE,
      activeTool: config.initialTool ?? DEFAULT_STATE.activeTool,
    };
    this.enableLogging = config.enableLogging ?? false;

    this.lifecycleDisposers.push(
      gameBus.on('EDITOR_TOOL_CHANGE_REQUESTED', ({ tool, reason, source }) => {
        this.setActiveTool(tool, reason, source);
      }),
      gameBus.on('ENGINE_RESET', () => this.reset('engine_reset')),
      gameBus.on('ROUND_TRANSITION', () => this.reset('round_transition')),
    );

    this.emitStateChanged('init');
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  destroy(): void {
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
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

  update(_dt: number): void {
    // State is event-driven; no per-frame work required.
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.isBusy() ? 'busy' : 'idle',
      active: true,
      metrics: {
        ...this.state,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  getState(): EditorToolCoordinatorState {
    return { ...this.state };
  }

  getActiveTool(): EditorTool {
    return this.state.activeTool;
  }

  isToolActive(tool: EditorTool): boolean {
    return this.state.activeTool === tool;
  }

  isBusy(): boolean {
    return this.state.busyOwner !== 'none';
  }

  canSelect(): boolean {
    return this.state.activeTool === 'SELECT' && this.state.busyOwner !== 'paint' && this.state.busyOwner !== 'whitebox';
  }

  canUseGizmo(): boolean {
    return this.state.activeTool === 'SELECT' && this.state.busyOwner !== 'paint' && this.state.busyOwner !== 'whitebox';
  }

  canPaint(): boolean {
    return this.state.activeTool === 'PAINT' && this.state.busyOwner !== 'gizmo' && this.state.busyOwner !== 'whitebox';
  }

  canWhitebox(): boolean {
    return this.state.activeTool === 'WHITEBOX' && this.state.busyOwner !== 'gizmo' && this.state.busyOwner !== 'paint';
  }

  setActiveTool(
    tool: EditorTool,
    reason = 'direct_set',
    source: 'ui' | 'hotkey' | 'system' = 'system',
  ): boolean {
    const previousTool = this.state.activeTool;
    if (previousTool === tool && !this.isBusy()) {
      return false;
    }

    this.clearTransientState(`tool_change:${reason}`);
    this.state.activeTool = tool;

    gameBus.emit('EDITOR_TOOL_CHANGED', {
      tool,
      previousTool,
      reason,
      source,
      timestamp: Date.now(),
    });

    this.emitStateChanged(reason);
    this.log(`Tool changed ${previousTool} -> ${tool} (${reason})`);
    return true;
  }

  beginGizmoDrag(reason = 'gizmo_drag_start'): boolean {
    if (!this.canUseGizmo()) {
      return false;
    }
    return this.setTransientState('gizmo', true, reason);
  }

  endGizmoDrag(reason = 'gizmo_drag_end'): boolean {
    return this.setTransientState('gizmo', false, reason);
  }

  beginPaintStroke(reason = 'paint_stroke_start'): boolean {
    if (!this.canPaint()) {
      return false;
    }
    return this.setTransientState('paint', true, reason);
  }

  endPaintStroke(reason = 'paint_stroke_end'): boolean {
    return this.setTransientState('paint', false, reason);
  }

  beginWhiteboxDrag(reason = 'whitebox_drag_start'): boolean {
    if (!this.canWhitebox()) {
      return false;
    }
    return this.setTransientState('whitebox', true, reason);
  }

  endWhiteboxDrag(reason = 'whitebox_drag_end'): boolean {
    return this.setTransientState('whitebox', false, reason);
  }

  reset(reason = 'reset'): void {
    const previousTool = this.state.activeTool;
    const wasBusy = this.isBusy();
    this.state = { ...DEFAULT_STATE };

    if (previousTool !== DEFAULT_STATE.activeTool) {
      gameBus.emit('EDITOR_TOOL_CHANGED', {
        tool: this.state.activeTool,
        previousTool,
        reason,
        source: 'system',
        timestamp: Date.now(),
      });
    }

    if (wasBusy || previousTool !== DEFAULT_STATE.activeTool) {
      this.emitStateChanged(reason);
    }
  }

  private setTransientState(owner: Exclude<BusyOwner, 'none'>, active: boolean, reason: string): boolean {
    const nextState = { ...this.state };

    if (owner === 'gizmo') {
      if (nextState.isGizmoDragging === active) return false;
      nextState.isGizmoDragging = active;
      if (active) {
        nextState.isPainting = false;
        nextState.isWhiteboxing = false;
      }
    }

    if (owner === 'paint') {
      if (nextState.isPainting === active) return false;
      nextState.isPainting = active;
      if (active) {
        nextState.isGizmoDragging = false;
        nextState.isWhiteboxing = false;
      }
    }

    if (owner === 'whitebox') {
      if (nextState.isWhiteboxing === active) return false;
      nextState.isWhiteboxing = active;
      if (active) {
        nextState.isGizmoDragging = false;
        nextState.isPainting = false;
      }
    }

    nextState.busyOwner = this.resolveBusyOwner(nextState);
    this.state = nextState;
    this.emitStateChanged(reason);
    return true;
  }

  private clearTransientState(reason: string): void {
    if (!this.isBusy()) return;
    this.state = {
      ...this.state,
      isGizmoDragging: false,
      isPainting: false,
      isWhiteboxing: false,
      busyOwner: 'none',
    };
    this.emitStateChanged(reason);
  }

  private resolveBusyOwner(state: EditorToolCoordinatorState): BusyOwner {
    if (state.isGizmoDragging) return 'gizmo';
    if (state.isPainting) return 'paint';
    if (state.isWhiteboxing) return 'whitebox';
    return 'none';
  }

  private emitStateChanged(reason: string): void {
    gameBus.emit('EDITOR_TOOL_STATE_CHANGED', {
      activeTool: this.state.activeTool,
      isGizmoDragging: this.state.isGizmoDragging,
      isPainting: this.state.isPainting,
      isWhiteboxing: this.state.isWhiteboxing,
      busyOwner: this.state.busyOwner,
      reason,
      timestamp: Date.now(),
    });
  }

  private log(message: string): void {
    if (!this.enableLogging) return;
    console.log(`[EditorToolCoordinator] ${message}`);
  }
}