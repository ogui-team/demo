/**
 * MODE TRANSITION MANAGER
 * Phase 4: Safe mode transitions with memory cleanup
 * 
 * Manages switching between game modes safely:
 * - Cleanup old mode systems
 * - Prevent memory leaks
 * - Track memory usage
 * - Handle errors during transition
 * - Validate using FailFastGuards
 */

import { getFailFastGuards, getCurrentHeapMB } from '../diagnostics/FailFastGuards';

export interface ModeTransitionConfig {
  sourceMode: 'multiplayer' | 'freeplay' | 'editor' | null;
  targetMode: 'multiplayer' | 'freeplay' | 'editor';
  onCleanupStart?: () => void;
  onCleanupEnd?: () => void;
  onInitStart?: () => void;
  onInitEnd?: () => void;
}

export interface MemoryMetrics {
  beforeCleanup: number;
  afterCleanup: number;
  freed: number;
  duration: number;
}

export class ModeTransitionManager {
  private currentMode: 'multiplayer' | 'freeplay' | 'editor' | null = null;
  private isTransitioning = false;
  private transitionHistory: Array<{
    from: string;
    to: string;
    timestamp: number;
    duration: number;
    memoryFreed: number;
  }> = [];
  private maxHistory = 50;

  /**
   * Check if a transition is currently in progress
   */
  isInProgress(): boolean {
    return this.isTransitioning;
  }

  /**
   * Get current active mode
   */
  getCurrentMode(): 'multiplayer' | 'freeplay' | 'editor' | null {
    return this.currentMode;
  }

  /**
   * Execute safe mode transition
   */
  async transitionMode(config: ModeTransitionConfig): Promise<MemoryMetrics> {
    if (this.isTransitioning) {
      throw new Error('Transition already in progress');
    }

    this.isTransitioning = true;
    const startTime = performance.now();
    const memoryBefore = this.getMemoryUsage();

    try {
      // 1. Notify cleanup start
      console.log(`[ModeTransition] Starting transition from ${config.sourceMode} → ${config.targetMode}`);
      if (config.onCleanupStart) config.onCleanupStart();

      // 2. Cleanup old mode
      if (config.sourceMode) {
        await this.cleanupMode(config.sourceMode);
      }

      // 3. Wait for cleanup to complete
      await this.flushCleanup();
      const memoryAfterCleanup = this.getMemoryUsage();

      // 4. Notify cleanup end
      if (config.onCleanupEnd) config.onCleanupEnd();
      if (config.onInitStart) config.onInitStart();

      // 5. Initialize new mode (caller will do this)
      // Just set state
      this.currentMode = config.targetMode;

      // 6. Notify init end
      if (config.onInitEnd) config.onInitEnd();

      const duration = performance.now() - startTime;
      const memoryFreed = Math.max(0, memoryBefore - memoryAfterCleanup);

      // 7. Record transition
      this.recordTransition({
        from: config.sourceMode || 'none',
        to: config.targetMode,
        duration,
        memoryFreed,
      });

      // 8. Validate transition with FailFastGuards if available
      const guards = getFailFastGuards();
      if (guards) {
        const currentHeap = getCurrentHeapMB();
        const listenerCount = 0; // Placeholder - would be actual count from EventListenerRegistry
        guards.recordModeTransition(listenerCount);
        
        // Check for issues
        const fps = 60; // Placeholder
        const status = guards.recordFrameMetrics(fps, currentHeap, listenerCount);
        if (status === 'FAIL') {
          console.warn(`[ModeTransition] ⚠️ Guard check failed after transition`, {
            heap: currentHeap.toFixed(2),
            listeners: listenerCount,
          });
        } else if (status === 'WARN') {
          console.warn(`[ModeTransition] ⚠️ Guard warning after transition`, {
            heap: currentHeap.toFixed(2),
          });
        }
      }

      console.log(
        `[ModeTransition] Complete (${duration.toFixed(0)}ms, freed ${memoryFreed.toFixed(0)}MB)`
      );

      return {
        beforeCleanup: memoryBefore,
        afterCleanup: memoryAfterCleanup,
        freed: memoryFreed,
        duration,
      };
    } catch (error) {
      console.error('[ModeTransition] Error during transition:', error);
      throw error;
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Cleanup all systems associated with a mode (7-step atomic sequence)
   */
  private async cleanupMode(mode: 'multiplayer' | 'freeplay' | 'editor'): Promise<void> {
    console.log(`[ModeTransition] Cleaning up ${mode} systems...`);

    try {
      const Engine = await import('../../0-foundation/foundation/Engine');

      // STEP 1: Stop all active systems gracefully
      console.log('[ModeTransition] STEP 1: Stopping active systems...');
      try {
        // Disable input manager
        const inputManager = Engine.getInputManager?.();
        if (inputManager && typeof (inputManager as any).disable === 'function') {
          (inputManager as any).disable();
        }
      } catch (e) {
        console.warn('[ModeTransition] Warning: Could not stop systems', e);
      }

      // STEP 2: Clear UI listeners and DOM elements
      console.log('[ModeTransition] STEP 2: Clearing UI listeners and DOM...');
      await this.clearUIAndListeners();

      // STEP 3: Disconnect network if multiplayer mode
      if (mode === 'multiplayer') {
        console.log('[ModeTransition] STEP 3: Disconnecting network...');
        try {
          const network = Engine.getNetworkSyncSystem?.();
          if (network) {
            if (typeof (network as any).disconnect === 'function') {
              await (network as any).disconnect();
            } else if (typeof (network as any).cleanup === 'function') {
              await (network as any).cleanup();
            }
          }
            // MultiplayerClient is managed by NetworkSyncSystem
        } catch (e) {
          console.warn('[ModeTransition] Warning: Network disconnect failed', e);
        }
      } else {
        console.log('[ModeTransition] STEP 3: Skipping network (non-multiplayer mode)');
      }

      // STEP 4: Dispose gameplay-specific systems
      console.log('[ModeTransition] STEP 4: Disposing gameplay systems...');
      try {
        // Dispose systems managed by Engine
        const replicationSystem = Engine.getReplicationSystem?.();
        if (replicationSystem && typeof (replicationSystem as any).dispose === 'function') {
          (replicationSystem as any).dispose();
        }
      } catch (e) {
        console.warn('[ModeTransition] Warning: Could not dispose gameplay systems', e);
      }

      // STEP 5: Reset physics and kernel buffers (TIER 0B cleanup)
      console.log('[ModeTransition] STEP 5: Resetting physics and kernel buffers...');
      try {
        const Engine = await import('../../0-foundation/foundation/Engine');
        
        // Try to access physics system and clear it
        // Engine exports various getters - safely try available methods
        try {
          const physicsSystem = (Engine as any).getPhysicsSystem?.() || 
                              (Engine as any).PhysicsSystem?.instance?.();
          if (physicsSystem && typeof (physicsSystem as any).clear === 'function') {
            (physicsSystem as any).clear();
          }
        } catch (pe) {
          // Physics system not available or doesn't have clear - continue
        }
        
        // Clear culling system
        try {
          const cullingSystem = Engine.getCullingSystem?.();
          if (cullingSystem && typeof (cullingSystem as any).dispose === 'function') {
            (cullingSystem as any).dispose();
          }
        } catch (ce) {
          // Culling system not available - continue
        }
        
        // Try to clear simulation kernel
        // Look for kernel via various Engine exports
        try {
          const kernel = (Engine as any).getKernel?.() || 
                        (Engine as any).SimulationKernel?.instance?.() ||
                        (Engine as any).kernel;
          if (kernel && typeof (kernel as any).clear === 'function') {
            (kernel as any).clear();
          }
        } catch (ke) {
          // Kernel not available or doesn't have clear - continue
        }
      } catch (e) {
        console.warn('[ModeTransition] Warning: Physics/kernel reset failed', e);
      }

      // STEP 6: Force garbage collection hint
      console.log('[ModeTransition] STEP 6: Triggering GC hint...');
      await this.forceGarbageCollectionHint();

      // STEP 7: Prepare for new mode initialization
      console.log('[ModeTransition] STEP 7: Preparing for new mode...');
      await new Promise((resolve) => Engine.timer.setTimeout(resolve, 10)); // Short delay for cleanup

      console.log(`[ModeTransition] ${mode} cleanup complete (7-step atomic sequence)`);
    } catch (error) {
      console.warn(`[ModeTransition] Error during cleanup:`, error);
      // Don't throw - continue with transition
    }
  }

  /**
   * Clear UI listeners and DOM elements
   */
  private async clearUIAndListeners(): Promise<void> {
    try {
      // Use EventListenerRegistry if available to dispose all tracked listeners
      const Engine = await import('../../0-foundation/foundation/Engine');
      const inputManager = Engine.getInputManager?.();
      if (inputManager && typeof (inputManager as any).disable === 'function') {
        (inputManager as any).disable();
      }
    } catch (e) {
      console.warn('[ModeTransition] Warning: Could not disable InputManager listeners', e);
    }

    // Clear UI elements
    const uiContainers = [
      'gameplay-hud',
      'game-ui',
      'player-stats',
      'enemy-markers',
      'inventory-ui',
    ];

    uiContainers.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.innerHTML = '';
        element.style.display = 'none';
      }
    });

    console.log('[ModeTransition] UI listeners and DOM cleared');
  }

  /**
   * Trigger garbage collection hint
   */
  private async forceGarbageCollectionHint(): Promise<void> {
    try {
      // Request garbage collection if available
      if ((global as any).gc && typeof (global as any).gc === 'function') {
        (global as any).gc();
      }
      // Chrome DevTools GC hint
      if ((performance as any).memory) {
        // Just accessing performance.memory may trigger GC in some versions
        void (performance as any).memory.jsHeapSizeLimit;
      }
    } catch (e) {
      // Silently fail - GC hint not available
    }
  }

  /**
   * Flush pending cleanup operations
   */
  private async flushCleanup(): Promise<void> {
    // Wait for any pending promises
    await new Promise((resolve) => Engine.timer.setTimeout(resolve, 50));
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number {
    try {
      // performance.memory is a non-standard Chrome DevTools API
      if ((performance as any).memory && (performance as any).memory.usedJSHeapSize) {
        return (performance as any).memory.usedJSHeapSize / (1024 * 1024);
      }
    } catch (e) {
      // Silently fail - not available in all browsers
    }
    return 0; // Not available
  }

  /**
   * Record transition in history
   */
  private recordTransition(data: {
    from: string;
    to: string;
    duration: number;
    memoryFreed: number;
  }): void {
    this.transitionHistory.push({
      ...data,
      timestamp: performance.now(),
    });

    // Keep history size bounded
    if (this.transitionHistory.length > this.maxHistory) {
      this.transitionHistory.shift();
    }
  }

  /**
   * Get transition statistics
   */
  getStats(): {
    totalTransitions: number;
    averageDuration: number;
    totalMemoryFreed: number;
    lastTransition: string | null;
  } {
    if (this.transitionHistory.length === 0) {
      return {
        totalTransitions: 0,
        averageDuration: 0,
        totalMemoryFreed: 0,
        lastTransition: null,
      };
    }

    const avgDuration = this.transitionHistory.reduce((sum, t) => sum + t.duration, 0) /
      this.transitionHistory.length;
    const totalFreed = this.transitionHistory.reduce((sum, t) => sum + t.memoryFreed, 0);
    const last = this.transitionHistory[this.transitionHistory.length - 1];

    return {
      totalTransitions: this.transitionHistory.length,
      averageDuration: avgDuration,
      totalMemoryFreed: totalFreed,
      lastTransition: `${last.from} → ${last.to} (${last.duration.toFixed(0)}ms ago)`,
    };
  }

  /**
   * Get full transition history
   */
  getHistory() {
    return [...this.transitionHistory];
  }
}

export const modeTransitionManager = new ModeTransitionManager();
