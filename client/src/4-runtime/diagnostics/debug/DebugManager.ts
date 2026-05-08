import * as Engine from '../../../0-foundation/foundation/Engine';
import { ParameterRegistry, ParameterBinding } from './ParameterBinding';
import { DebugUI } from './DebugUI';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { setContext } from '@engine/1-kernel/core/public-api';

/**
 * Debug Manager
 * Central controller for debugging system
 * Orchestrates parameter binding and UI
 */

export interface DebugManagerConfig {
  enableKeyToggle?: boolean;
  toggleKey?: string;
  enabled?: boolean;
}

export class DebugManager {
  private parameterRegistry: ParameterRegistry;
  private debugUI: DebugUI | null = null;
  private enabled: boolean;
  private toggleKey: string;
  private enableKeyToggle: boolean;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  private systemContext: SystemContext | null = null;

  constructor(config: DebugManagerConfig = {}) {
    this.parameterRegistry = new ParameterRegistry();
    this.enabled = config.enabled ?? false;
    this.toggleKey = config.toggleKey ?? 'F1';
    this.enableKeyToggle = config.enableKeyToggle ?? true;

    this.setupUI();
    this.setupKeyboardToggle();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: this.enabled,
      metrics: {
        hasSystemContext: this.systemContext !== null,
        toggleKey: this.toggleKey,
        keyToggleEnabled: this.enableKeyToggle,
        groupCount: this.parameterRegistry.getGroups().length,
        parameterCount: this.parameterRegistry.getGroups().reduce((count, group) => count + group.parameters.length, 0),
      },
    };
  }

  private setupUI(): void {
    this.debugUI = new DebugUI(this.parameterRegistry);
    if (!this.enabled) {
      this.debugUI.hide();
    } else {
      this.debugUI.show();
    }
  }

  private setupKeyboardToggle(): void {
    if (!this.enableKeyToggle) return;

    this.keyboardHandler = (e: KeyboardEvent) => {
      if (e.key === this.toggleKey) {
        this.toggle();
      }
    };

    window.addEventListener('keydown', this.keyboardHandler);
  }

  addParameter(groupName: string, binding: ParameterBinding): void {
    this.parameterRegistry.addParameter(groupName, binding);
    this.refreshUI();
  }

  addGroup(groupName: string): void {
    this.parameterRegistry.addGroup(groupName);
  }

  toggle(): void {
    if (!this.enabled) {
      this.enable();
    } else {
      this.disable();
    }
  }

  enable(): void {
    this.enabled = true;
    setContext('ui');
    if (this.debugUI) {
      this.debugUI.show();
    }
    gameBus.emit('stateMutation', {
      source: 'debugManager',
      path: 'debug.enabled',
      changedCount: 1,
    });
    console.log('[Debug] Debug system enabled');
  }

  disable(): void {
    this.enabled = false;
    if (this.debugUI) {
      this.debugUI.hide();
    }
    setContext(Engine.getAuthoritativeInputContext());
    gameBus.emit('stateMutation', {
      source: 'debugManager',
      path: 'debug.enabled',
      changedCount: 1,
    });
    console.log('[Debug] Debug system disabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  refreshUI(): void {
    if (this.debugUI) {
      this.debugUI.refresh();
    }
  }

  getRegistry(): ParameterRegistry {
    return this.parameterRegistry;
  }

  destroy(): void {
    if (this.keyboardHandler) {
      window.removeEventListener('keydown', this.keyboardHandler);
    }
    if (this.debugUI) {
      this.debugUI.destroy();
    }
    this.parameterRegistry.clear();
  }
}

let debugManagerInstance: DebugManager | null = null;

export function initDebugManager(config: DebugManagerConfig = {}): DebugManager {
  if (debugManagerInstance) {
    console.warn('[Debug] Debug manager already initialized');
    return debugManagerInstance;
  }

  debugManagerInstance = new DebugManager(config);
  return debugManagerInstance;
}

export function getDebugManager(): DebugManager | null {
  return debugManagerInstance;
}

export function destroyDebugManager(): void {
  if (debugManagerInstance) {
    debugManagerInstance.destroy();
    debugManagerInstance = null;
  }
}

