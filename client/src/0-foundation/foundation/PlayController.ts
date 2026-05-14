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

interface VirtualStickDom {
  root: HTMLDivElement;
  movePad: HTMLDivElement;
  moveThumb: HTMLDivElement;
  lookPad: HTMLDivElement;
  lookThumb: HTMLDivElement;
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

  private virtualStickDom: VirtualStickDom | null = null;
  private virtualStickDisposers: Array<() => void> = [];
  private moveStickPointerId: number | null = null;
  private lookStickPointerId: number | null = null;
  private moveStickAxis = { x: 0, y: 0 };
  private lookStickAxis = { x: 0, y: 0 };
  private moveStickCenter: { x: number; y: number } | null = null;
  private lookStickCenter: { x: number; y: number } | null = null;
  private moveStickRadius = 56;
  private lookStickRadius = 56;
  private readonly virtualStickDeadzone = 0.2;
  private readonly virtualLookPixelsPerSecond = 260;
  private readonly virtualStickThumbTravelRatio = 0.52;
  private readonly mobileTouchCapable = typeof window !== 'undefined'
    && (('ontouchstart' in window) || ((navigator as Navigator).maxTouchPoints ?? 0) > 0);

  private getCursorTarget(): HTMLElement | null {
    if (this.canvas instanceof HTMLElement && this.canvas.isConnected) {
      return this.canvas;
    }

    const canvas = document.querySelector('canvas');
    return canvas instanceof HTMLElement ? canvas : null;
  }

  private setGameplayCursorHidden(hidden: boolean): void {
    const cursor = hidden ? 'none' : '';
    const target = this.getCursorTarget();
    if (target) {
      target.style.cursor = cursor;
    }

    if (document.body) {
      document.body.style.cursor = cursor;
    }
  }

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
        Engine.timer.setTimeout(() => {
          if (this.pendingLockState === 'PENDING_LOCK') {
            console.warn('[PlayController] Lock still pending after 500ms - forcing retry', {
              timestamp: Engine.time.now(),
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
        this.reconciliationActiveUntil = Engine.time.now() + this.reconciliationControlWindowMs;
        console.debug('[PlayController] Reconciliation started, input window extended', {
          playerId,
          tick,
          windowMs: this.reconciliationControlWindowMs,
        });
      }),
      gameBus.on('ENTITY_RECONCILED', ({ correctionDistance, authoritativePosition }) => {
        if (correctionDistance > this.reconciliationDriftThreshold) {
          this.reconciliationPositionOverride = authoritativePosition;
          this.reconciliationActiveUntil = Engine.time.now() + this.reconciliationControlWindowMs;
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
    this.setupVirtualTouchControls();
    this.setGameplayCursorHidden(false);
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
    this.resetVirtualTouchState();
    this.teardownVirtualTouchControls();
    this.setGameplayCursorHidden(false);

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
    this.resetVirtualTouchState();
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
    if (this.mobileTouchCapable) {
      const lookDeltaX = this.lookStickAxis.x * this.virtualLookPixelsPerSecond * deltaTime;
      const lookDeltaY = this.lookStickAxis.y * this.virtualLookPixelsPerSecond * deltaTime;
      if (lookDeltaX !== 0 || lookDeltaY !== 0) {
        this.applyLookDelta(lookDeltaX, lookDeltaY);
      }
    }

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
      timestamp: Engine.time.now(),
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

    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (!e.repeat) {
        window.dispatchEvent(new CustomEvent('ui:toggle-editor-play'));
      }
      return true;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight'].includes(e.code)) {
      e.preventDefault();
    }
    this.keys.add(e.key);
    this.keyCodes.add(e.code);

    if (
      !this.mouseLocked
      && !e.repeat
      && !['Escape', 'p', 'P', 'k', 'K'].includes(e.key)
    ) {
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
      const now = Engine.time.now();
      
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
        timestamp: Engine.time.now(),
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

    this.setGameplayCursorHidden(this.enabled && this.mouseLocked);

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
    const touchForward = this.moveStickAxis.y < -this.virtualStickDeadzone;
    const touchBackward = this.moveStickAxis.y > this.virtualStickDeadzone;
    const touchLeft = this.moveStickAxis.x < -this.virtualStickDeadzone;
    const touchRight = this.moveStickAxis.x > this.virtualStickDeadzone;
    return {
      forward: this.isActionPressed(['w', 'W'], ['KeyW']) || touchForward,
      backward: this.isActionPressed(['s', 'S'], ['KeyS']) || touchBackward,
      left: this.isActionPressed(['a', 'A'], ['KeyA']) || touchLeft,
      right: this.isActionPressed(['d', 'D'], ['KeyD']) || touchRight,
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

  beginPlaySessionPointerCapture(): void {
    if (!this.enableMouseLock) {
      return;
    }

    const canvas = this.canvas ?? (document.querySelector('canvas') as HTMLCanvasElement | null);
    if (!canvas || !canvas.isConnected || canvas.ownerDocument !== document || document.visibilityState !== 'visible') {
      return;
    }

    this.inputContextManager.forceSetContext('play');
    setContext('game');

    const lockRequested = this.inputContextManager.requestPointerLock(canvas);
    this.pendingLockState = lockRequested ? 'IDLE' : 'PENDING_LOCK';
    if (!lockRequested) {
      console.warn('[PlayController] Early play-session pointer capture deferred', {
        timestamp: Engine.time.now(),
      });
    }
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
        timestamp: Engine.time.now(),
      });
    }
  }

  private applyLookDelta(movementX: number, movementY: number): void {
    const maxPitch = Math.PI / 2.5;
    this.lookRotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.lookRotation.x - movementY * this.rotationSpeed));
    this.lookRotation.y -= movementX * this.rotationSpeed;
  }

  private setupVirtualTouchControls(): void {
    if (!this.mobileTouchCapable || this.virtualStickDom) {
      return;
    }

    const root = document.createElement('div');
    const movePad = document.createElement('div');
    const moveThumb = document.createElement('div');
    const lookPad = document.createElement('div');
    const lookThumb = document.createElement('div');

    const viewportMin = Math.min(window.innerWidth || 360, window.innerHeight || 640);
    const padSize = Math.round(Math.max(96, Math.min(140, viewportMin * 0.26)));
    const thumbSize = Math.round(Math.max(34, Math.min(58, padSize * 0.44)));
    const bottomInset = Math.round(Math.max(14, Math.min(28, viewportMin * 0.04)));
    const sideInset = Math.round(Math.max(12, Math.min(24, viewportMin * 0.035)));

    root.style.cssText = [
      'position:fixed',
      `left:${sideInset}px`,
      `right:${sideInset}px`,
      `bottom:${bottomInset}px`,
      'display:flex',
      'justify-content:space-between',
      'align-items:flex-end',
      'pointer-events:none',
      'z-index:1200',
      'user-select:none',
      '-webkit-user-select:none',
      '-webkit-touch-callout:none',
    ].join(';');

    const basePadStyle = [
      `width:${padSize}px`,
      `height:${padSize}px`,
      'border-radius:50%',
      'border:2px solid rgba(255,255,255,0.34)',
      'background:radial-gradient(circle at 32% 30%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 32%, rgba(0,0,0,0.22) 100%)',
      'box-shadow:0 10px 24px rgba(0,0,0,0.35), inset 0 0 16px rgba(0,0,0,0.32)',
      'position:relative',
      'pointer-events:auto',
      'touch-action:none',
    ].join(';');

    const baseThumbStyle = [
      `width:${thumbSize}px`,
      `height:${thumbSize}px`,
      'border-radius:50%',
      'background:linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(220,225,230,0.36) 100%)',
      'box-shadow:0 6px 18px rgba(0,0,0,0.32)',
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%, -50%)',
    ].join(';');

    movePad.style.cssText = `${basePadStyle};border-color:rgba(157,234,193,0.55);`;
    lookPad.style.cssText = `${basePadStyle};border-color:rgba(168,202,255,0.55);`;
    moveThumb.style.cssText = baseThumbStyle;
    lookThumb.style.cssText = baseThumbStyle;

    movePad.appendChild(moveThumb);
    lookPad.appendChild(lookThumb);
    root.appendChild(movePad);
    root.appendChild(lookPad);
    document.body.appendChild(root);

    this.virtualStickDom = { root, movePad, moveThumb, lookPad, lookThumb };
    this.moveStickRadius = padSize / 2;
    this.lookStickRadius = padSize / 2;

    const onResize = () => {
      this.resetVirtualTouchState();
      this.teardownVirtualTouchControls();
      this.setupVirtualTouchControls();
    };

    const bindStick = (
      pad: HTMLDivElement,
      thumb: HTMLDivElement,
      isMoveStick: boolean,
    ) => {
      const onPointerDown = (event: PointerEvent) => {
        if (event.pointerType !== 'touch') {
          return;
        }
        event.preventDefault();
        pad.setPointerCapture(event.pointerId);
        const center = this.readPadCenter(pad);
        if (!center) {
          return;
        }
        if (isMoveStick) {
          this.moveStickPointerId = event.pointerId;
          this.moveStickCenter = center;
        } else {
          this.lookStickPointerId = event.pointerId;
          this.lookStickCenter = center;
        }
        this.updateStickFromPointer(event, thumb, isMoveStick);
      };

      const onPointerMove = (event: PointerEvent) => {
        const activePointerId = isMoveStick ? this.moveStickPointerId : this.lookStickPointerId;
        if (activePointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        this.updateStickFromPointer(event, thumb, isMoveStick);
      };

      const onPointerUp = (event: PointerEvent) => {
        const activePointerId = isMoveStick ? this.moveStickPointerId : this.lookStickPointerId;
        if (activePointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        this.resetStick(thumb, isMoveStick);
      };

      pad.addEventListener('pointerdown', onPointerDown, { passive: false });
      pad.addEventListener('pointermove', onPointerMove, { passive: false });
      pad.addEventListener('pointerup', onPointerUp, { passive: false });
      pad.addEventListener('pointercancel', onPointerUp, { passive: false });
      this.virtualStickDisposers.push(() => {
        pad.removeEventListener('pointerdown', onPointerDown);
        pad.removeEventListener('pointermove', onPointerMove);
        pad.removeEventListener('pointerup', onPointerUp);
        pad.removeEventListener('pointercancel', onPointerUp);
      });
    };

    bindStick(movePad, moveThumb, true);
    bindStick(lookPad, lookThumb, false);

    window.addEventListener('resize', onResize);
    this.virtualStickDisposers.push(() => window.removeEventListener('resize', onResize));
  }

  private teardownVirtualTouchControls(): void {
    while (this.virtualStickDisposers.length > 0) {
      this.virtualStickDisposers.pop()?.();
    }
    if (this.virtualStickDom?.root.parentElement) {
      this.virtualStickDom.root.parentElement.removeChild(this.virtualStickDom.root);
    }
    this.virtualStickDom = null;
  }

  private resetVirtualTouchState(): void {
    this.moveStickAxis = { x: 0, y: 0 };
    this.lookStickAxis = { x: 0, y: 0 };
    this.moveStickPointerId = null;
    this.lookStickPointerId = null;
    this.moveStickCenter = null;
    this.lookStickCenter = null;
    if (this.virtualStickDom) {
      this.virtualStickDom.moveThumb.style.transform = 'translate(-50%, -50%)';
      this.virtualStickDom.lookThumb.style.transform = 'translate(-50%, -50%)';
    }
  }

  private readPadCenter(pad: HTMLDivElement): { x: number; y: number } | null {
    const rect = pad.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
      return null;
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  private updateStickFromPointer(event: PointerEvent, thumb: HTMLDivElement, isMoveStick: boolean): void {
    const center = isMoveStick ? this.moveStickCenter : this.lookStickCenter;
    if (!center) {
      return;
    }
    const radius = isMoveStick ? this.moveStickRadius : this.lookStickRadius;
    const dx = event.clientX - center.x;
    const dy = event.clientY - center.y;
    const length = Math.hypot(dx, dy);
    const clampedLength = Math.min(length, radius);
    const nx = length > 0 ? dx / length : 0;
    const ny = length > 0 ? dy / length : 0;
    const axisX = (nx * clampedLength) / radius;
    const axisY = (ny * clampedLength) / radius;

    const thumbTravel = radius * this.virtualStickThumbTravelRatio;
    const thumbX = axisX * thumbTravel;
    const thumbY = axisY * thumbTravel;
    thumb.style.transform = `translate(calc(-50% + ${thumbX}px), calc(-50% + ${thumbY}px))`;

    if (isMoveStick) {
      this.moveStickAxis = { x: axisX, y: axisY };
    } else {
      this.lookStickAxis = { x: axisX, y: axisY };
    }
  }

  private resetStick(thumb: HTMLDivElement, isMoveStick: boolean): void {
    thumb.style.transform = 'translate(-50%, -50%)';
    if (isMoveStick) {
      this.moveStickPointerId = null;
      this.moveStickCenter = null;
      this.moveStickAxis = { x: 0, y: 0 };
      return;
    }
    this.lookStickPointerId = null;
    this.lookStickCenter = null;
    this.lookStickAxis = { x: 0, y: 0 };
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
    if (Engine.time.now() > this.reconciliationActiveUntil) {
      this.reconciliationPositionOverride = null;
      return false;
    }
    return true;
  }

  destroy(): void {
    this.disable();
    this.teardownVirtualTouchControls();
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
  }
}
