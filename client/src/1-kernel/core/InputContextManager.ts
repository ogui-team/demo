/**
 * ─ INPUT-LOCKOUT-MANAGER: Stack-based Pointer Lock Context System
 * 
 * Prevents "Mouse locked/unlocked" spam by maintaining a context stack:
 * - Only the TOP context can request pointerLock
 * - When one context activates, it PAUSES (doesn't delete) the context below
 * - Lock state changesmust pass: currentState !== desiredState check
 * 
 * Stack example: [EDITOR (paused)] → [PLAY (active)] → [UI (hidden)]
 * Only PLAY can request lock when active
 */

export type InputContext = 'editor' | 'play' | 'ui';

interface ContextStackEntry {
  context: InputContext;
  isActive: boolean;
  requestedLockState: boolean | null; // null = not requested, true = want lock, false = want unlock
}

// ─ CONTEXT WAIT QUEUE: For operations waiting for context activation
interface ContextWaitPromise {
  context: InputContext;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export class InputContextManager {
  private contextStack: ContextStackEntry[] = [];
  private currentLockState: boolean = false; // document.pointerLockElement !== null
  private lastLockChangeTime = 0;
  private readonly MIN_LOCK_CHANGE_INTERVAL_MS = 50; // Debounce lock changes
  private readonly CONTEXT_WAIT_TIMEOUT_MS = 5000; // Max wait time for context
  private contextWaitQueue: ContextWaitPromise[] = [];

  constructor() {
    // ─ INITIAL STACK: Default contexts in priority order
    this.contextStack = [
      { context: 'editor', isActive: false, requestedLockState: null },
      { context: 'play', isActive: false, requestedLockState: null },
      { context: 'ui', isActive: false, requestedLockState: null },
    ];

    // ─ LOCK STATE MONITOR: Track actual pointer lock state changes
    document.addEventListener('pointerlockchange', () => {
      this.currentLockState = document.pointerLockElement !== null;
      console.log('[InputContextManager] Pointer lock changed', {
        newLockState: this.currentLockState,
        timestamp: Engine.time.now(),
        activeContext: this.getActiveContext(),
      });
    });
  }

  /**
   * Switch to a context, pausing all others
   */
  setActiveContext(context: InputContext): void {
    if (this.getActiveContext() === context) {
      return;
    }

    // Pause all contexts
    for (const entry of this.contextStack) {
      entry.isActive = false;
    }

    // Activate requested context
    const target = this.contextStack.find((e) => e.context === context);
    if (target) {
      target.isActive = true;
      console.log('[InputContextManager] Context switched', {
        newActiveContext: context,
        stack: this.contextStack.map((e) => ({ context: e.context, active: e.isActive })),
        timestamp: Engine.time.now(),
      });
      
      // ─ CONTEXT WAIT QUEUE: Notify waiting promises for this context
      this.contextWaitQueue = this.contextWaitQueue.filter((waitPromise) => {
        if (waitPromise.context === context) {
          Engine.timer.clearTimeout(waitPromise.timeoutHandle);
          waitPromise.resolve();
          console.log('[InputContextManager] Context wait completed', {
            context,
            timestamp: Engine.time.now(),
          });
          return false; // Remove from queue
        }
        return true; // Keep in queue
      });
    }
  }

  /**
   * Get currently active context (top of stack)
   */
  getActiveContext(): InputContext | null {
    const active = this.contextStack.find((e) => e.isActive);
    return active ? active.context : null;
  }

  /**
   * Force-set context without regard for current state
   * ─ MULTIPLAYER SYNC FIX: Used to break deadlock when LIFECYCLE_PLAY_ACTIVE is reached ─
   * This ensures input is never blocked due to stale context state
   */
  forceSetContext(context: InputContext): void {
    console.warn('[InputContextManager] ⚠️  forceSetContext called - bypassing normal stack mechanics', {
      targetContext: context,
      previousActiveContext: this.getActiveContext(),
      timestamp: Engine.time.now(),
      reason: 'LIFECYCLE_PLAY_ACTIVE deadlock recovery',
    });

    // Deactivate all contexts
    for (const entry of this.contextStack) {
      entry.isActive = false;
    }

    // Force-activate requested context
    const target = this.contextStack.find((e) => e.context === context);
    if (target) {
      target.isActive = true;
      target.requestedLockState = null;

      console.log('[InputContextManager] Context force-set to', {
        context,
        stack: this.contextStack.map((e) => ({ context: e.context, active: e.isActive })),
        timestamp: Engine.time.now(),
      });

      // Notify waiting promises for this context
      this.contextWaitQueue = this.contextWaitQueue.filter((waitPromise) => {
        if (waitPromise.context === context) {
          Engine.timer.clearTimeout(waitPromise.timeoutHandle);
          waitPromise.resolve();
          console.log('[InputContextManager] Forced context wait completed', {
            context,
            timestamp: Engine.time.now(),
          });
          return false;
        }
        return true;
      });
    }
  }

  /**
   * Request pointer lock for the active context
   * Returns true if lock was requested (not guaranteed to be granted)
   * Returns false gracefully if no active context exists - no crash
   * 
   * ─ SAFE-INPUT-GATING: Graceful failure instead of fatal error ─
   */
  requestPointerLock(canvas: HTMLCanvasElement | null): boolean {
    if (!canvas || !canvas.isConnected) {
      return false;
    }

    const activeContext = this.getActiveContext();
    if (!activeContext) {
      // ─ GRACEFUL FALLBACK: No context active - defer and log instead of crash ─
      console.warn('[Input] Lock deferred: No active context', {
        contextStack: this.contextStack.map((e) => ({ context: e.context, isActive: e.isActive })),
        timestamp: Engine.time.now(),
      });
      return false;
    }

    // ─ LOCK SPAM PREVENTION: Check if lock state change is already in progress
    const now = Engine.time.now();
    if (now - this.lastLockChangeTime < this.MIN_LOCK_CHANGE_INTERVAL_MS) {
      console.warn('[InputContextManager] Lock request rejected: debounced', {
        lastChangeAge: now - this.lastLockChangeTime,
        threshold: this.MIN_LOCK_CHANGE_INTERVAL_MS,
      });
      return false;
    }

    // ─ CRITICAL: Never request if already locked to this canvas
    if (this.currentLockState && document.pointerLockElement === canvas) {
      console.log('[InputContextManager] Lock already active, skipping request', {
        context: activeContext,
      });
      return false;
    }

    // ─ REQUEST: Only the active context can request lock
    const entry = this.contextStack.find((e) => e.context === activeContext);
    if (!entry) {
      return false;
    }

    entry.requestedLockState = true;
    this.lastLockChangeTime = now;

    console.log('[InputContextManager] Pointer lock requested', {
      context: activeContext,
      desiredLockState: true,
      currentLockState: this.currentLockState,
      timestamp: now,
    });

    try {
      const requestResult = (canvas as HTMLCanvasElement & {
        requestPointerLock?: () => void | Promise<void>;
      }).requestPointerLock?.();
      
      if (typeof requestResult === 'object' && requestResult !== null && 'catch' in requestResult) {
        (requestResult as Promise<void>).catch((error: unknown) => {
          console.warn('[InputContextManager] Pointer lock request rejected', {
            context: activeContext,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return true;
    } catch (error: unknown) {
      console.error('[InputContextManager] Pointer lock request threw', {
        context: activeContext,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Release pointer lock for the active context
   */
  releasePointerLock(): boolean {
    const activeContext = this.getActiveContext();
    if (!activeContext) {
      return false;
    }

    if (!this.currentLockState) {
      console.log('[InputContextManager] Lock already released', {
        context: activeContext,
      });
      return false;
    }

    const now = Engine.time.now();
    if (now - this.lastLockChangeTime < this.MIN_LOCK_CHANGE_INTERVAL_MS) {
      console.warn('[InputContextManager] Release rejected: debounced', {
        lastChangeAge: now - this.lastLockChangeTime,
      });
      return false;
    }

    const entry = this.contextStack.find((e) => e.context === activeContext);
    if (!entry) {
      return false;
    }

    entry.requestedLockState = false;
    this.lastLockChangeTime = now;

    console.log('[InputContextManager] Pointer lock released', {
      context: activeContext,
      timestamp: now,
    });

    try {
      document.exitPointerLock();
      return true;
    } catch (error: unknown) {
      console.error('[InputContextManager] exitPointerLock threw', {
        context: activeContext,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Synchronize lock state from document
   */
  syncLockState(): void {
    const wasLocked = this.currentLockState;
    this.currentLockState = document.pointerLockElement !== null;

    if (wasLocked !== this.currentLockState) {
      console.log('[InputContextManager] Lock state synced', {
        previousState: wasLocked,
        currentState: this.currentLockState,
        activeContext: this.getActiveContext(),
        timestamp: Engine.time.now(),
      });
    }
  }

  /**
   * Safe pointer lock - only locks if PLAY context is active
   * This is the recommended method for PlayController integration
   * 
   * ─ SAFE-INPUT-GATING: tryLock() ensures context is verified before locking ─
   */
  tryLock(canvas: HTMLCanvasElement | null): boolean {
    const activeContext = this.getActiveContext();
    
    if (activeContext !== 'play') {
      console.debug('[InputContextManager] tryLock() deferred: active context is not PLAY', {
        currentContext: activeContext,
        timestamp: Engine.time.now(),
      });
      return false;
    }

    // Safe to request lock - PLAY context is active
    return this.requestPointerLock(canvas);
  }

  /**
   * Wait for a specific context to become active
   * Returns a promise that resolves when context is activated or rejects on timeout
   */
  waitForContext(desiredContext: InputContext): Promise<void> {
    // Check if already active
    if (this.getActiveContext() === desiredContext) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = Engine.timer.setTimeout(() => {
        // Remove from queue and reject
        this.contextWaitQueue = this.contextWaitQueue.filter((w) => w.timeoutHandle !== timeoutHandle);
        console.warn('[InputContextManager] Context wait timeout', {
          desiredContext,
          actualContext: this.getActiveContext(),
          timeoutMs: this.CONTEXT_WAIT_TIMEOUT_MS,
          timestamp: Engine.time.now(),
        });
        reject(new Error(`Context '${desiredContext}' not activated within ${this.CONTEXT_WAIT_TIMEOUT_MS}ms`));
      }, this.CONTEXT_WAIT_TIMEOUT_MS);

      const waitPromise: ContextWaitPromise = {
        context: desiredContext,
        resolve,
        reject,
        timeoutHandle,
      };
      this.contextWaitQueue.push(waitPromise);

      console.log('[InputContextManager] Waiting for context', {
        desiredContext,
        actualContext: this.getActiveContext(),
        timeoutMs: this.CONTEXT_WAIT_TIMEOUT_MS,
        timestamp: Engine.time.now(),
      });
    });
  }

  /**
   * Check if pointer is currently locked
   */
  isPointerLocked(): boolean {
    return this.currentLockState;
  }

  /**
   * Get diagnostics for debugging
   */
  getDiagnostics(): Record<string, unknown> {
    return {
      activeContext: this.getActiveContext(),
      isPointerLocked: this.isPointerLocked(),
      contextStack: this.contextStack.map((e) => ({
        context: e.context,
        isActive: e.isActive,
        requestedLockState: e.requestedLockState,
      })),
      lastLockChangeTime: this.lastLockChangeTime,
      minLockChangeInterval: this.MIN_LOCK_CHANGE_INTERVAL_MS,
      pendingContextWaits: this.contextWaitQueue.length,
    };
  }

  /**
   * Cleanup: Cancel all pending context wait promises
   * Call this on destroy or reset
   */
  cleanup(): void {
    console.log('[InputContextManager] Cleaning up context wait queue', {
      pendingCount: this.contextWaitQueue.length,
      timestamp: Engine.time.now(),
    });

    for (const waitPromise of this.contextWaitQueue) {
      Engine.timer.clearTimeout(waitPromise.timeoutHandle);
      waitPromise.reject(new Error('InputContextManager cleaned up'));
    }
    this.contextWaitQueue = [];
  }
}
