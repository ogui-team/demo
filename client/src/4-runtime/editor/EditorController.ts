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

  constructor(config: EditorControllerConfig = {}) {
    this.camera = getCamera();
    this.moveSpeed = config.moveSpeed ?? 8;          // 8 units/second
    this.rotationSpeed = config.rotationSpeed ?? 0.005;
    this.boostMultiplier = config.boostMultiplier ?? 2.5;
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

    this.keys.clear();
    this.mouseDown = false;
    gameBus.emit('stateMutation', {
      source: 'EditorController',
      path: 'editorController.enabled',
      changedCount: 1,
    });
    console.log('[Editor] Camera disabled');
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
    const isBoost = this.keys.has('Shift');
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
    if (this.keys.has('w') || this.keys.has('W')) {
      nextPosition.addScaledVector(forward, actualSpeed);
    }
    if (this.keys.has('s') || this.keys.has('S')) {
      nextPosition.addScaledVector(forward, -actualSpeed);
    }
    if (this.keys.has('d') || this.keys.has('D')) {
      nextPosition.addScaledVector(right, actualSpeed);
    }
    if (this.keys.has('a') || this.keys.has('A')) {
      nextPosition.addScaledVector(right, -actualSpeed);
    }

    // Vertical movement
    if (this.keys.has(' ') || this.keys.has('Space')) {
      nextPosition.y += actualSpeed;
    }
    if (this.keys.has('Control')) {
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
    this.keys.add(e.key);
    return true;
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    this.keys.delete(e.key);
    return true;
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

    const zoomSpeed = 0.05;
    const fovDelta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;

    adapter.applySnapshot({
      fov: Math.max(15, Math.min(120, this.camera.fov + fovDelta)),
    }, writeSource);
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
