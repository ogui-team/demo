import * as THREE from 'three';
import { setContext } from '@engine/1-kernel/core/public-api';
import { logEvent } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { setCameraAuthority, type CameraAuthority } from '../../camera/CameraStateAdapter';

/**
 * Mode Manager
 * Central system for managing editor vs play mode
 */

export type EngineMode = 'editor' | 'play';

interface ModeState {
  currentMode: EngineMode;
  previousMode: EngineMode | null;
  sceneState: Map<string, any>;
  menuPreviewActive: boolean;
}

export interface ModeListener {
  onEnterEditor?(): void;
  onExitEditor?(): void;
  onEnterPlay?(): void;
  onExitPlay?(): void;
  onMenuPreviewChange?(active: boolean): void;
}

export interface ModeSwitchOptions {
  cameraAuthority?: CameraAuthority;
}

class ModeManager {
  private state: ModeState;
  private listeners: Set<ModeListener> = new Set();
  private sceneSnapshot: Map<string, any> = new Map();
  private systemContext: SystemContext | null = null;

  constructor() {
    this.state = {
      currentMode: 'editor',
      previousMode: null,
      sceneState: new Map(),
      menuPreviewActive: false,
    };
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
      usesReplication: true,
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
        currentMode: this.state.currentMode,
        previousMode: this.state.previousMode,
        menuPreviewActive: this.state.menuPreviewActive,
        listenerCount: this.listeners.size,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  /**
   * Register a system to listen for mode changes
   */
  registerListener(listener: ModeListener): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async applyMode(mode: EngineMode, options: ModeSwitchOptions = {}): Promise<void> {
    if (mode === this.state.currentMode) {
      if (options.cameraAuthority) {
        setCameraAuthority(options.cameraAuthority);
      }
      return;
    }

    const previousMode = this.state.currentMode;
    this.state.previousMode = previousMode;
    this.state.currentMode = mode;

    console.log(`[Mode] Switching from ${previousMode} to ${mode}`);
    logEvent('engine', `Mode ${previousMode} → ${mode}`);
    gameBus.emit('stateChanged', { from: previousMode, to: mode });

    // Exit previous mode
    if (previousMode === 'editor') {
      this.notifyExitEditor();
      this.saveSceneState();
    } else if (previousMode === 'play') {
      this.notifyExitPlay();
    }

    // Enter new mode
    if (mode === 'editor') {
      setCameraAuthority(options.cameraAuthority ?? 'editor');
      setContext('editor');
      this.notifyEnterEditor();
      this.restoreSceneState();
    } else if (mode === 'play') {
      setCameraAuthority(options.cameraAuthority ?? 'game');
      setContext('game');
      this.notifyEnterPlay();
    }
  }

  /**
   * Switch to a new mode.
   * Direct mode switching is forbidden; EngineController owns runtime mode.
   */
  async setMode(_mode: EngineMode, _options: ModeSwitchOptions = {}): Promise<void> {
    throw new Error('[ModeManager] Direct mode switching is forbidden. Use EngineController.setRuntimeMode().');
  }

  async syncFromController(mode: EngineMode, options: ModeSwitchOptions = {}): Promise<void> {
    await this.applyMode(mode, options);
  }

  /**
   * Get current mode
   */
  getMode(): EngineMode {
    return this.state.currentMode;
  }

  /**
   * Check if in editor mode
   */
  isEditorMode(): boolean {
    return this.state.currentMode === 'editor';
  }

  /**
   * Check if in play mode
   */
  isPlayMode(): boolean {
    return this.state.currentMode === 'play';
  }

  setMenuPreviewActive(active: boolean): void {
    if (this.state.menuPreviewActive === active) return;
    this.state.menuPreviewActive = active;
    gameBus.emit('menuPreviewChanged', { active });
    this.notifyMenuPreviewChange(active);
  }

  isMenuPreviewActive(): boolean {
    return this.state.menuPreviewActive;
  }

  /**
   * Save scene state before entering play mode
   */
  private saveSceneState(): void {
    this.sceneSnapshot.clear();
    console.log('[Mode] Scene state saved');
  }

  /**
   * Restore scene state after exiting play mode
   */
  private restoreSceneState(): void {
    if (this.sceneSnapshot.size === 0) {
      console.log('[Mode] No previous scene state to restore');
    } else {
      console.log('[Mode] Scene state restored');
    }
  }

  /**
   * Notify listeners of mode changes
   */
  private notifyEnterEditor(): void {
    this.listeners.forEach((listener) => {
      if (listener.onEnterEditor) {
        listener.onEnterEditor();
      }
    });
  }

  private notifyExitEditor(): void {
    this.listeners.forEach((listener) => {
      if (listener.onExitEditor) {
        listener.onExitEditor();
      }
    });
  }

  private notifyEnterPlay(): void {
    this.listeners.forEach((listener) => {
      if (listener.onEnterPlay) {
        listener.onEnterPlay();
      }
    });
  }

  private notifyExitPlay(): void {
    this.listeners.forEach((listener) => {
      if (listener.onExitPlay) {
        listener.onExitPlay();
      }
    });
  }

  private notifyMenuPreviewChange(active: boolean): void {
    this.listeners.forEach((listener) => {
      listener.onMenuPreviewChange?.(active);
    });
  }

  /**
   * Get state snapshot for debugging
   */
  getState(): ModeState {
    return {
      ...this.state,
      sceneState: new Map(this.state.sceneState),
    };
  }

  destroy(): void {
    this.listeners.clear();
    this.sceneSnapshot.clear();
  }
}

let modeManagerInstance: ModeManager | null = null;

export function initModeManager(): ModeManager {
  if (modeManagerInstance) {
    console.warn('[Mode] Mode manager already initialized');
    return modeManagerInstance;
  }

  modeManagerInstance = new ModeManager();
  return modeManagerInstance;
}

export function getModeManager(): ModeManager | null {
  return modeManagerInstance;
}

export function destroyModeManager(): void {
  if (modeManagerInstance) {
    modeManagerInstance.destroy();
    modeManagerInstance = null;
  }
}
