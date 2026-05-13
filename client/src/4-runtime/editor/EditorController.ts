import * as THREE from 'three';
import { getCamera } from '../../2-systems/render/Camera';
import { canWriteCamera, getCameraStateAdapter } from '../../2-systems/camera/CameraStateAdapter';
import { isConsoleOpen } from './Console';
import { gameBus } from '@engine/1-kernel/core/public-api';

/**
 * Editor Controller
 * Manages free-fly camera movement for editor mode
 */

interface EditorControllerConfig {
  moveSpeed?: number;       // units per second (default 8)
  rotationSpeed?: number;
  boostMultiplier?: number;
  forceSessionReset?: (reason: string) => void;
}

export class EditorController {
  private camera: THREE.PerspectiveCamera | null;
  private keys: Set<string> = new Set();
  private moveSpeed: number;
  private rotationSpeed: number;
  private boostMultiplier: number;
  private enabled: boolean = false;

  // Mouse tracking
  private mouseDown: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private readonly onWindowBlur: () => void;
  private readonly onVisibilityChange: () => void;
  private readonly forceSessionResetCallback: ((reason: string) => void) | null;

  constructor(config: EditorControllerConfig = {}) {
    this.camera = getCamera();
    this.moveSpeed = config.moveSpeed ?? 8;          // 8 units/second
    this.rotationSpeed = config.rotationSpeed ?? 0.005;
    this.boostMultiplier = config.boostMultiplier ?? 2.5;
    this.forceSessionResetCallback = config.forceSessionReset ?? null;

    this.onWindowBlur = () => this.clearInputState('window_blur');
    this.onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        this.clearInputState('visibility_hidden');
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.onWindowBlur, true);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange, true);
    }
  }

  private getWriteSource(): 'editor' | 'menu' | null {
    if (canWriteCamera('editor')) return 'editor';
    if (canWriteCamera('menu')) return 'menu';
    return null;
  }

  /**
   * Enable editor camera and input handling
   */
  enable(): void {
    if (this.enabled) return;

    this.enabled = true;
    gameBus.emit('stateMutation', {
      source: 'EditorController',
      path: 'editorController.enabled',
      changedCount: 1,
    });

    console.log('[Editor] Camera enabled');
  }

  /**
   * Disable editor camera and input handling
   */
  disable(): void {
    if (!this.enabled) return;

    this.enabled = false;
    this.clearInputState('disable');
    gameBus.emit('stateMutation', {
      source: 'EditorController',
      path: 'editorController.enabled',
      changedCount: 1,
    });
    console.log('[Editor] Camera disabled');
  }

  forceSessionReset(reason = 'exit_play_mode'): void {
    this.clearInputState(`force_session_reset:${reason}`);
    this.forceSessionResetCallback?.(reason);
    gameBus.emit('stateMutation', {
      source: 'EditorController',
      path: 'editorController.forceSessionReset',
      changedCount: 1,
    });
  }

  /**
   * Update camera position and rotation
   */
  update(deltaTime: number): void {
    if (!this.enabled) return;
    if (!this.camera) this.camera = getCamera();
    if (!this.camera) return;
    const writeSource = this.getWriteSource();
    const adapter = getCameraStateAdapter();
    if (!writeSource || !adapter) return;

    const dt = Math.min(deltaTime, 0.1); // cap at 100ms to avoid huge jumps

    // Calculate actual move speed with boost
    const isBoost = this.keys.has('shift');
    const actualSpeed = this.moveSpeed * (isBoost ? this.boostMultiplier : 1) * dt;

    // Get camera direction vectors
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    this.camera.getWorldDirection(forward);
    forward.y = 0; // Lock vertical movement
    forward.normalize();

    right.crossVectors(forward, up).normalize();
    const nextPosition = this.camera.position.clone();

    // Handle movement input
    if (this.keys.has('w')) {
      nextPosition.addScaledVector(forward, actualSpeed);
    }
    if (this.keys.has('s')) {
      nextPosition.addScaledVector(forward, -actualSpeed);
    }
    if (this.keys.has('d')) {
      nextPosition.addScaledVector(right, actualSpeed);
    }
    if (this.keys.has('a')) {
      nextPosition.addScaledVector(right, -actualSpeed);
    }

    // Vertical movement
    if (this.keys.has('space')) {
      nextPosition.y += actualSpeed;
    }
    if (this.keys.has('control')) {
      nextPosition.y -= actualSpeed;
    }

    adapter.applySnapshot({
      position: {
        x: nextPosition.x,
        y: nextPosition.y,
        z: nextPosition.z,
      },
    }, writeSource);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    // Suppress all input when console is open
    if (isConsoleOpen()) return false;
    // Prevent browser scroll on Space/Arrow keys
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    this.keys.add(this.normalizeKey(e.key, e.code));
    return true;
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    this.keys.delete(this.normalizeKey(e.key, e.code));
    return true;
  }

  private clearInputState(reason: string): void {
    if (this.keys.size > 0 || this.mouseDown) {
      this.keys.clear();
      this.mouseDown = false;
      void reason;
    }
  }

  private normalizeKey(key: string, code: string): string {
    const lowerKey = key.toLowerCase();

    if (code === 'Space' || key === ' ') {
      return 'space';
    }

    if (lowerKey.startsWith('control')) {
      return 'control';
    }

    if (lowerKey.startsWith('shift')) {
      return 'shift';
    }

    if (lowerKey.startsWith('alt')) {
      return 'alt';
    }

    if (key.length === 1) {
      return lowerKey;
    }

    return lowerKey;
  }

  handlePointerDown(e: MouseEvent): boolean {
    if (!this.enabled) return false;
    if (e.button === 2) {
      e.preventDefault();
      return true;
    }
    if (e.button === 0) {
      e.preventDefault();
      this.mouseDown = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      gameBus.emit('stateMutation', {
        source: 'EditorController',
        path: 'editorController.rotating',
        changedCount: 1,
      });
      return true;
    }
    return false;
  }

  handlePointerUp(e: MouseEvent): boolean {
    if (!this.enabled) return false;
    if (e.button === 2) {
      e.preventDefault();
      return true;
    }
    if (e.button === 0) {
      const wasRotating = this.mouseDown;
      this.mouseDown = false;
      if (wasRotating) {
        gameBus.emit('stateMutation', {
          source: 'EditorController',
          path: 'editorController.rotating',
          changedCount: 1,
        });
      }
      return wasRotating;
    }
    return false;
  }

  handlePointerMove(e: MouseEvent): boolean {
    if (!this.enabled || !this.mouseDown) return false;
    if (!this.camera) this.camera = getCamera();
    if (!this.camera) return false;
    const writeSource = this.getWriteSource();
    const adapter = getCameraStateAdapter();
    if (!writeSource || !adapter) return false;

    const deltaX = e.clientX - this.lastMouseX;
    const deltaY = e.clientY - this.lastMouseY;

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    // Rotate camera
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(this.camera.quaternion);

    euler.setFromVector3(new THREE.Vector3(
      euler.x - deltaY * this.rotationSpeed,
      euler.y - deltaX * this.rotationSpeed,
      euler.z
    ), 'YXZ');

    // Clamp pitch
    const maxPitch = Math.PI / 2.5;
    euler.x = Math.max(-maxPitch, Math.min(maxPitch, euler.x));

    adapter.applySnapshot({
      rotation: {
        x: euler.x,
        y: euler.y,
        z: euler.z,
      },
    }, writeSource);
    return true;
  }

  handleWheel(e: WheelEvent): boolean {
    // Scroll wheel for FOV zoom
    if (!this.enabled) return false;
    if (!this.camera) this.camera = getCamera();
    if (!this.camera) return false;
    const writeSource = this.getWriteSource();
    const adapter = getCameraStateAdapter();
    if (!writeSource || !adapter) return false;

    e.preventDefault();

    const moveSpeed = 0.5;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.normalize();

    const scrollDirection = e.deltaY < 0 ? 1 : -1;
    const currentPos = this.camera.position;
    const targetPos = {
      x: currentPos.x + forward.x * moveSpeed * scrollDirection,
      y: currentPos.y + forward.y * moveSpeed * scrollDirection,
      z: currentPos.z + forward.z * moveSpeed * scrollDirection,
    };

    adapter.applySnapshot({ position: targetPos }, writeSource);
    return true;
  }

  isRotating(): boolean {
    return this.mouseDown;
  }

  setMoveSpeed(speed: number): void {
    this.moveSpeed = speed;
  }

  setRotationSpeed(speed: number): void {
    this.rotationSpeed = speed;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        pressedKeyCount: this.keys.size,
        mouseDown: this.mouseDown,
        moveSpeed: this.moveSpeed,
        rotationSpeed: this.rotationSpeed,
        boostMultiplier: this.boostMultiplier,
      },
    };
  }

  destroy(): void {
    this.disable();
  }
}
