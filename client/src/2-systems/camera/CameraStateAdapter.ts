import * as THREE from 'three';
import { getStateManager } from '../../0-foundation/foundation/state/StateManager';
import { getCamera } from '../render/Camera';

/**
 * Camera State Adapter
 * Keeps Three.js camera synchronized with engine state
 * Bidirectional sync: State → Camera & Camera → State
 */

export type CameraAuthority = 'menu' | 'game' | 'editor' | 'snapshot';

export interface CameraSnapshot {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  quaternion?: { x: number; y: number; z: number; w: number };
  fov?: number;
}

export interface CameraAuthorityController {
  canWriteCamera(source: CameraAuthority): boolean;
}

let cameraAuthority: CameraAuthority = 'menu';
let cameraAuthorityController: CameraAuthorityController | null = null;

export function setCameraAuthority(authority: CameraAuthority): void {
  cameraAuthority = authority;
}

export function getCameraAuthority(): CameraAuthority {
  return cameraAuthority;
}

export function setCameraAuthorityController(controller: CameraAuthorityController | null): void {
  cameraAuthorityController = controller;
}

export function canWriteCamera(authority: CameraAuthority): boolean {
  if (cameraAuthorityController) {
    return cameraAuthorityController.canWriteCamera(authority);
  }
  return cameraAuthority === authority;
}

export class CameraStateAdapter {
  private camera: THREE.PerspectiveCamera | null;
  private stateManager: ReturnType<typeof getStateManager>;
  private unsubscribers: Array<() => void> = [];
  private syncing: boolean = false;
  private basePosition: THREE.Vector3 = new THREE.Vector3();
  private baseQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private baseFov: number = 75;
  private positionOffsets: Map<string, THREE.Vector3> = new Map();
  private fovOffsets: Map<string, number> = new Map();

  constructor() {
    this.camera = getCamera();
    this.stateManager = getStateManager();

    if (!this.camera || !this.stateManager) {
      console.error('[CameraStateAdapter] Camera or state manager not initialized');
      return;
    }

    this.captureCameraBase();
    this.setupStateSubscriptions();
  }

  private captureCameraBase(): void {
    if (!this.camera) return;
    this.basePosition.copy(this.camera.position);
    this.baseQuaternion.copy(this.camera.quaternion);
    this.baseFov = this.camera.fov;
  }

  /**
   * Setup subscriptions to sync State → Camera
   */
  private setupStateSubscriptions(): void {
    if (!this.stateManager) return;

    // When FOV changes in state, update camera
    const unsubFOV = this.stateManager.subscribe('camera.fov', (value: any) => {
      if (this.syncing || !this.camera || typeof value !== 'number') return;
      this.applySnapshot({ fov: value }, getCameraAuthority());
    });

    this.unsubscribers.push(unsubFOV);
  }

  private writeBaseState(): void {
    if (!this.stateManager) return;

    const rotation = new THREE.Euler().setFromQuaternion(this.baseQuaternion, 'YXZ');
    this.stateManager.update({
      'camera.position.x': this.basePosition.x,
      'camera.position.y': this.basePosition.y,
      'camera.position.z': this.basePosition.z,
      'camera.rotation.x': rotation.x,
      'camera.rotation.y': rotation.y,
      'camera.rotation.z': rotation.z,
      'camera.fov': this.baseFov,
    });
  }

  private applyCamera(syncState: boolean): void {
    if (!this.camera || !this.stateManager) return;

    const resolvedPosition = this.basePosition.clone();
    for (const offset of this.positionOffsets.values()) {
      resolvedPosition.add(offset);
    }

    let resolvedFov = this.baseFov;
    for (const offset of this.fovOffsets.values()) {
      resolvedFov += offset;
    }
    resolvedFov = Math.max(1, resolvedFov);

    this.syncing = true;
    this.camera.position.copy(resolvedPosition);
    this.camera.rotation.order = 'YXZ';
    this.camera.quaternion.copy(this.baseQuaternion);
    this.camera.rotation.setFromQuaternion(this.baseQuaternion, 'YXZ');
    this.camera.fov = resolvedFov;
    this.camera.updateProjectionMatrix();
    if (syncState) {
      this.writeBaseState();
    }
    this.syncing = false;
  }

  private resolveWritePermission(source: CameraAuthority): boolean {
    if (cameraAuthorityController) {
      return cameraAuthorityController.canWriteCamera(source);
    }
    return cameraAuthority === source;
  }

  private createStateSnapshot(): CameraSnapshot | null {
    if (!this.stateManager) return null;

    const state = this.stateManager.getState();
    if (!state?.camera) return null;

    const snapshot: CameraSnapshot = {};
    if (state.camera.position) {
      snapshot.position = {
        x: state.camera.position.x,
        y: state.camera.position.y,
        z: state.camera.position.z,
      };
    }
    if (state.camera.rotation) {
      snapshot.rotation = {
        x: state.camera.rotation.x,
        y: state.camera.rotation.y,
        z: state.camera.rotation.z,
      };
    }
    if (typeof state.camera.fov === 'number') {
      snapshot.fov = state.camera.fov;
    }
    return snapshot;
  }

  applySnapshot(snapshot: CameraSnapshot, source: CameraAuthority): boolean {
    if (!this.camera || !this.stateManager || this.syncing) return false;
    if (!this.resolveWritePermission(source)) return false;

    if (snapshot.position) {
      this.basePosition.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    }

    if (snapshot.quaternion) {
      this.baseQuaternion.set(
        snapshot.quaternion.x,
        snapshot.quaternion.y,
        snapshot.quaternion.z,
        snapshot.quaternion.w,
      );
    } else if (snapshot.rotation) {
      this.baseQuaternion.setFromEuler(
        new THREE.Euler(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z, 'YXZ'),
      );
    }

    if (typeof snapshot.fov === 'number') {
      this.baseFov = snapshot.fov;
    }

    this.applyCamera(true);
    return true;
  }

  setPositionOffset(channel: string, offset: { x: number; y: number; z: number }): void {
    this.positionOffsets.set(channel, new THREE.Vector3(offset.x, offset.y, offset.z));
    this.applyCamera(false);
  }

  clearPositionOffset(channel: string): void {
    if (!this.positionOffsets.delete(channel)) return;
    this.applyCamera(false);
  }

  setFovOffset(channel: string, offset: number): void {
    this.fovOffsets.set(channel, offset);
    this.applyCamera(false);
  }

  clearFovOffset(channel: string): void {
    if (!this.fovOffsets.delete(channel)) return;
    this.applyCamera(false);
  }

  /**
   * Sync camera position to state
   * Called by controllers after they update the camera
   */
  syncCameraToState(): void {
    if (!this.camera || !this.stateManager || this.syncing) return;

    this.captureCameraBase();
    this.syncing = true;
    this.writeBaseState();
    this.syncing = false;
  }

  /**
   * Initialize camera from state
   */
  initializeFromState(): void {
    if (!this.camera || !this.stateManager) return;

    const snapshot = this.createStateSnapshot();
    if (snapshot) {
      this.applySnapshot(snapshot, getCameraAuthority());
    } else {
      this.captureCameraBase();
      this.applyCamera(true);
    }
  }

  destroy(): void {
    this.positionOffsets.clear();
    this.fovOffsets.clear();
    this.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        console.warn('[CameraStateAdapter] Error unsubscribing:', e);
      }
    });
    this.unsubscribers = [];
  }
}

let cameraAdapterInstance: CameraStateAdapter | null = null;

export function initCameraStateAdapter(): CameraStateAdapter {
  if (!cameraAdapterInstance) {
    cameraAdapterInstance = new CameraStateAdapter();
  }
  return cameraAdapterInstance;
}

export function getCameraStateAdapter(): CameraStateAdapter | null {
  return cameraAdapterInstance;
}
