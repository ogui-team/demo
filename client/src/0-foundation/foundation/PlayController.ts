import * as THREE from 'three';
import { getCamera } from '../../2-systems/render/Camera';
import { isConsoleOpen } from '../../4-runtime/editor/Console';
import { gameBus } from '../../1-kernel/core/EventBus';
import { setContext } from '../../1-kernel/core/InputContext';
import { InputContextManager } from '../../1-kernel/core/InputContextManager';
import type { LifecycleOrchestrator } from '../../4-runtime/debug/LifecycleOrchestrator';

/**
 * Play Controller
 * Manages player-controlled FPS camera movement for play mode
 * 
 * ─ SAFE-INPUT-GATING: Guards all input requests against lifecycle state and context readiness ─
 */

interface PlayControllerConfig {
  moveSpeed?: number;       // units per second (default 6)
  rotationSpeed?: number;
  enableMouseLock?: boolean;
}

export class PlayController {
  private camera: THREE.PerspectiveCamera | null;
  private keys: Set<string> = new Set();
  private keyCodes: Set<string> = new Set();
  private moveSpeed: number;
  private rotationSpeed: number;
  private enableMouseLock: boolean;
  private enabled: boolean = false;
  private isPlayActive: boolean = true;
  private scene: THREE.Scene | null = null;

  // ─ SAFE-INPUT-GATING: Lifecycle orchestrator guard ─
  private orchestrator: LifecycleOrchestrator | null = null;

  // ─ INPUT-LOCKOUT-MANAGER: Prevent pointer lock spam
  private inputContextManager: InputContextManager;

  // ─ SAFE-INPUT-GATING: Retry mechanism for deferred pointer lock requests ─
  private pendingLockState: 'IDLE' | 'PENDING_LOCK' = 'IDLE';
  private lastLockAttemptTime = 0;
  private readonly MIN_RETRY_INTERVAL_MS = 100; // Retry at most once per 100ms
  private canvas: HTMLCanvasElement | null = null;

  // Mouse tracking
  private mouseLocked: boolean = false;
  private lookRotation = { x: 0, y: 0, z: 0 };
  private dragLookActive = false;
  private lastPointerPosition: { x: number; y: number } | null = null;
  private boundEntityId: string | null = null;
  private reconciliationActiveUntil = 0;
  private reconciliationPositionOverride: { x: number; y: number; z: number } | null = null;
  private readonly reconciliationControlWindowMs = 150;
  private readonly reconciliationDriftThreshold = 0.05;

  private pointerlockChangeHandler: (() => void) | null = null;
  private lifecycleDisposers: Array<() => void> = [];

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Link the LifecycleOrchestrator for input gating
   * ─ SAFE-INPUT-GATING: PlayController checks orchestrator.phase before input ─
   */
  setOrchestrator(orchestrator: LifecycleOrchestrator): void {
    this.orchestrator = orchestrator;
    console.log('[PlayController] Orchestrator linked - input gating enabled');
  }

  /**
   * Set the canvas element for pointer lock requests
   * ─ SAFE-INPUT-GATING: Canvas is required for safe pointer lock attempts ─
   */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    console.debug('[PlayController] Canvas element set for pointer lock', {
      hasCanvas: canvas !== null,
    });
  }

  constructor(config: PlayControllerConfig = {}) {
    this.camera = getCamera();
    this.inputContextManager = new InputContextManager();
    
    if (this.camera) {
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.setFromQuaternion(this.camera.quaternion);
      this.lookRotation = { x: euler.x, y: euler.y, z: euler.z };
    }
    this.moveSpeed = config.moveSpeed ?? 6;          // 6 units/second
    this.rotationSpeed = config.rotationSpeed ?? 0.003;
    this.enableMouseLock = config.enableMouseLock !== false;
    this.lifecycleDisposers.push(
      gameBus.on('ENGINE_RESET', () => {
        this.bind(null);
        this.reset();
        // Re-arm the lifecycle gate; the new spawn sequence will unlock it.
        this.isPlayActive = false;
      }),
      gameBus.on('FORCE_REBIND_INPUT', ({ entityId }) => {
        this.bind(entityId);
      }),
      // LifecycleOrchestrator gate — blocks input until spawn sequence completes in multiplayer.
      gameBus.on('LIFECYCLE_PLAY_ACTIVE', () => {
        this.isPlayActive = true;
        // ─ MULTIPLAYER SYNC FIX: Force context to break deadlock ─
        console.log('[PlayController] LIFECYCLE_PLAY_ACTIVE received - force-activating PLAY context');
        this.inputContextManager.forceSetContext('play');
        setContext('game');
        this.enable();
        
        // ─ FALLBACK: If lock still deferred after 500ms, force-retry ─
        setTimeout(() => {
          if (this.pendingLockState === 'PENDING_LOCK') {
            console.warn('[PlayController] Lock still pending after 500ms - forcing retry', {
              timestamp: Date.now(),
            });
            this.attemptPointerLock();
          }
        }, 500);
        
        console.log('[PlayController] Input enabled, PLAY context force-activated');
      }),
      gameBus.on('RECONCILIATION_BEGIN', ({ playerId, tick }) => {
        // ─ FIX #3: isReconciling Guard ─
        // Ensure controller stays active during reconciliation to allow user input
        // to flow through without being blocked. Reconciliation window extends
        // past the END event to cover potential additional corrections.
        this.reconciliationActiveUntil = Date.now() + this.reconciliationControlWindowMs;
        console.debug('[PlayController] Reconciliation started, input window extended', {
          playerId,
          tick,
          windowMs: this.reconciliationControlWindowMs,
        });
      }),
      gameBus.on('ENTITY_RECONCILED', ({ correctionDistance, authoritativePosition }) => {
        if (correctionDistance > this.reconciliationDriftThreshold) {
          this.reconciliationPositionOverride = authoritativePosition;
          this.reconciliationActiveUntil = Date.now() + this.reconciliationControlWindowMs;
        }
      }),
    );
  }

  /**
   * Enable player camera and input handling
   */
  enable(): void {
    if (this.enabled) return;

    this.enabled = true;
    this.pointerlockChangeHandler = () => this.onPointerLockChange();
    document.addEventListener('pointerlockchange', this.pointerlockChangeHandler);
    gameBus.emit('stateMutation', {
      source: 'PlayController',
      path: 'playController.enabled',
      changedCount: 1,
    });

    console.log('[Play] Player controller enabled');
  }

  /**
   * Disable player camera and input handling
   */
  disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Exit pointer lock if active
    if (this.mouseLocked) {
      document.exitPointerLock();
    }

    if (this.pointerlockChangeHandler)
      document.removeEventListener('pointerlockchange', this.pointerlockChangeHandler);

    this.keys.clear();
    this.keyCodes.clear();
    this.dragLookActive = false;
    this.lastPointerPosition = null;
    gameBus.emit('stateMutation', {
      source: 'PlayController',
      path: 'playController.enabled',
      changedCount: 1,
    });
    console.log('[Play] Player controller disabled');
  }

  /**
   * Clear all held input state.
   * Call on death / respawn to prevent stale movement carrying over.
   */
  reset(): void {
    this.keys.clear();
    this.keyCodes.clear();
    gameBus.emit('stateMutation', {
      source: 'PlayController',
      path: 'playController.reset',
      changedCount: 1,
    });
    console.log('[Play] Player controller reset');
  }

  /**
   * Update camera position and rotation
   */
  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;
    if (!this.camera) this.camera = getCamera();
    if (!this.camera) return;
    void deltaTime;

    // BRIDGE: Emit movement input to gameBus so NetworkSyncSystem (in network domain) can receive it
    // This fixes the "Movement Silo" by making input available across domains via the global event bus
    const movementInput = this.getMovementInput();
    const reconciliationActive = this.isReconciliationOverrideActive();
    const reconciliationPositionOverride = reconciliationActive ? this.reconciliationPositionOverride ?? undefined : undefined;
    gameBus.emit('playerMovementInputCaptured', {
      entityId: this.boundEntityId,
      forward: movementInput.forward,
      backward: movementInput.backward,
      left: movementInput.left,
      right: movementInput.right,
      jump: movementInput.jump,
      sprint: movementInput.sprint,
      crouch: movementInput.crouch,
      movementIntent: movementInput.movementIntent,
      yaw: movementInput.yaw,
      pitch: movementInput.pitch,
      reconciliationActive,
      reconciliationPositionOverride,
      timestamp: Date.now(),
    });
    if (reconciliationPositionOverride) {
      this.reconciliationPositionOverride = null;
    }
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    if (!this.isPlayActive && !this.isReconciliationOverrideActive()) return false;
    
    // ─ SAFE-INPUT-GATING: Guard against input before PLAY_ACTIVE ─
    if (this.orchestrator && this.orchestrator.phase !== 'PLAY_ACTIVE') {
      console.debug('[PlayController] Input ignored - not in PLAY_ACTIVE phase', {
        phase: this.orchestrator.phase,
      });
      return false;
    }
    
    // Suppress all input when console is open
    if (isConsoleOpen()) return false;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight'].includes(e.code)) {
      e.preventDefault();
    }
    this.keys.add(e.key);
    this.keyCodes.add(e.code);

    if (!this.mouseLocked && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      this.attemptPointerLock();
    }

    // ESC key to unlock mouse
    if (e.key === 'Escape' && this.mouseLocked) {
      document.exitPointerLock();
    }

    // K key to toggle mouse cursor
    if (e.key === 'k' || e.key === 'K') {
      if (this.mouseLocked) {
        document.exitPointerLock();
      } else {
        this.attemptPointerLock();
      }
    }

    return true;
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    this.keys.delete(e.key);
    this.keyCodes.delete(e.code);
    return true;
  }

  handlePointerDown(e: MouseEvent): boolean {
    if (!this.enabled) return false;
    if (!this.isPlayActive && !this.isReconciliationOverrideActive()) return false;
    
    // ─ SAFE-INPUT-GATING: Guard against input before PLAY_ACTIVE ─
    if (this.orchestrator && this.orchestrator.phase !== 'PLAY_ACTIVE') {
      console.debug('[PlayController] Pointer input ignored - not in PLAY_ACTIVE phase', {
        phase: this.orchestrator.phase,
      });
      return false;
    }
    
    if (e.button === 0 && this.enableMouseLock && !this.mouseLocked) {
      this.dragLookActive = true;
      this.lastPointerPosition = { x: e.clientX, y: e.clientY };
      this.attemptPointerLock();
      return true;
    }

    return false;
  }

  handlePointerMove(e: MouseEvent): boolean {
    if (!this.enabled || !this.camera) return false;
    if (!this.isPlayActive && !this.isReconciliationOverrideActive()) return false;

    if (this.mouseLocked) {
      this.applyLookDelta((e as any).movementX || 0, (e as any).movementY || 0);
      return true;
    }

    if ((e.buttons & 1) === 1 && !this.dragLookActive) {
      this.dragLookActive = true;
      this.lastPointerPosition = { x: e.clientX, y: e.clientY };
      return true;
    }

    if (!this.lastPointerPosition) {
      this.lastPointerPosition = { x: e.clientX, y: e.clientY };
      return true;
    }

    const movementX = e.clientX - this.lastPointerPosition.x;
    const movementY = e.clientY - this.lastPointerPosition.y;
    this.lastPointerPosition = { x: e.clientX, y: e.clientY };

    if (!this.dragLookActive && (e.buttons & 1) === 0) {
      this.applyLookDelta(movementX, movementY);
      return true;
    }

    if (!this.dragLookActive) return false;

    this.applyLookDelta(movementX, movementY);
    return true;
  }

  handlePointerUp(e: MouseEvent): boolean {
    if (!this.enabled) return false;
    if (e.button === 0) {
      this.dragLookActive = false;
      this.lastPointerPosition = null;
    }
    return false;
  }

  /**
   * ─ SAFE-INPUT-GATING: Graceful pointer lock with retry mechanism ─
   * Attempts to lock pointer with try-catch error handling.
   * If lock fails, sets PENDING_LOCK state for retry on next input.
   * Never crashes - always returns gracefully.
   */
  private attemptPointerLock(): void {
    try {
      const now = Date.now();
      
      // Check retry interval to avoid spam
      if (now - this.lastLockAttemptTime < this.MIN_RETRY_INTERVAL_MS) {
        if (this.pendingLockState === 'IDLE') {
          console.debug('[PlayController] Lock attempt deferred - too soon', {
            timeSinceLastAttempt: now - this.lastLockAttemptTime,
            threshold: this.MIN_RETRY_INTERVAL_MS,
          });
        }
        return;
      }

      this.lastLockAttemptTime = now;

      // Try using safe tryLock() first - only works if PLAY context is active
      const lockSuccessful = this.inputContextManager.tryLock(this.canvas);

      if (!lockSuccessful) {
        // Lock deferred - set PENDING_LOCK for retry on next input
        if (this.pendingLockState !== 'PENDING_LOCK') {
          this.pendingLockState = 'PENDING_LOCK';
          console.debug('[PlayController] Lock pending - will retry on next input', {
            activeContext: this.inputContextManager.getActiveContext(),
            timestamp: now,
          });
        }
        return;
      }

      // Lock was attempted successfully
      this.pendingLockState = 'IDLE';
      console.debug('[PlayController] Lock attempt succeeded', { timestamp: now });

    } catch (error: unknown) {
      // ─ GRACEFUL: Never crash on pointer lock errors ─
      console.error('[PlayController] Pointer lock error (gracefully handled)', {
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
      });
      
      // Set PENDING_LOCK for retry
      this.pendingLockState = 'PENDING_LOCK';
    }
  }

  private onPointerLockChange(): void {
    this.mouseLocked = (document as any).pointerLockElement !== null;
    if (this.mouseLocked) {
      this.dragLookActive = false;
      this.lastPointerPosition = null;
    }

    if (this.mouseLocked) {
      console.log('[Play] Mouse locked');
    } else {
      console.log('[Play] Mouse unlocked');
    }
    gameBus.emit('stateMutation', {
      source: 'PlayController',
      path: 'playController.pointerLock',
      changedCount: 1,
    });
  }

  setMoveSpeed(speed: number): void {
    this.moveSpeed = speed;
  }

  setRotationSpeed(speed: number): void {
    this.rotationSpeed = speed;
  }

  bind(entityId: string | null): void {
    this.boundEntityId = entityId;
    gameBus.emit('stateMutation', {
      source: 'PlayController',
      path: 'playController.boundEntityId',
      changedCount: 1,
    });
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        mouseLocked: this.mouseLocked,
        boundEntityId: this.boundEntityId,
        pressedKeyCount: this.keys.size,
        dragLookActive: this.dragLookActive,
        enableMouseLock: this.enableMouseLock,
        lookRotation: this.getViewRotation(),
      },
    };
  }

  getBoundEntityId(): string | null {
    return this.boundEntityId;
  }

  setViewRotation(rotation: { x: number; y: number; z: number }): void {
    this.lookRotation = {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
    };
  }

  getViewRotation(): { x: number; y: number; z: number } {
    return {
      x: this.lookRotation.x,
      y: this.lookRotation.y,
      z: this.lookRotation.z,
    };
  }

  getMovementInput(): {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    sprint: boolean;
    crouch: boolean;
    movementIntent: {
      jump: boolean;
      crouch: boolean;
    };
    yaw: number;
    pitch: number;
  } {
    const jump = this.isActionPressed([' '], ['Space']);
    const crouch = this.isActionPressed(['Control'], ['ControlLeft', 'ControlRight']);
    return {
      forward: this.isActionPressed(['w', 'W'], ['KeyW']),
      backward: this.isActionPressed(['s', 'S'], ['KeyS']),
      left: this.isActionPressed(['a', 'A'], ['KeyA']),
      right: this.isActionPressed(['d', 'D'], ['KeyD']),
      jump,
      sprint: this.isActionPressed(['Shift'], ['ShiftLeft', 'ShiftRight']),
      crouch,
      movementIntent: {
        jump,
        crouch,
      },
      yaw: this.lookRotation.y,
      pitch: this.lookRotation.x,
    };
  }

  isCrouching(): boolean {
    return this.isActionPressed(['Control'], ['ControlLeft', 'ControlRight']);
  }

  private isActionPressed(keys: string[], codes: string[] = []): boolean {
    return keys.some((key) => this.keys.has(key)) || codes.some((code) => this.keyCodes.has(code));
  }

  isMouseLocked(): boolean {
    return this.mouseLocked;
  }

  requestPointerLock(target?: EventTarget | null): void {
    if (!this.enabled || !this.enableMouseLock) return;
    void target;
    
    const canvas = document.querySelector('canvas');
    if (!canvas || !canvas.isConnected || canvas.ownerDocument !== document || document.visibilityState !== 'visible') {
      return;
    }

    // ─ INPUT CONTEXT: Attempt lock immediately - no waiting ─
    // If context not active, InputContextManager will throw error we can see
    const lockRequested = this.inputContextManager.requestPointerLock(canvas);
    
    if (!lockRequested) {
      const activeContext = this.inputContextManager.getActiveContext();
      console.warn('[PlayController] Pointer lock request failed', {
        activeContext,
        isPlayActive: this.isPlayActive,
        timestamp: Date.now(),
      });
    }
  }

  private applyLookDelta(movementX: number, movementY: number): void {
    const maxPitch = Math.PI / 2.5;
    this.lookRotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.lookRotation.x - movementY * this.rotationSpeed));
    this.lookRotation.y -= movementX * this.rotationSpeed;
  }

  releasePointerLock(): void {
    // ─ INPUT-LOCKOUT-MANAGER: Use context manager for safe release
    this.inputContextManager.releasePointerLock();
  }

  syncPointerLockState(): void {
    this.inputContextManager.syncLockState();
    this.onPointerLockChange();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private isReconciliationOverrideActive(): boolean {
    if (Date.now() > this.reconciliationActiveUntil) {
      this.reconciliationPositionOverride = null;
      return false;
    }
    return true;
  }

  destroy(): void {
    this.disable();
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
  }
}
