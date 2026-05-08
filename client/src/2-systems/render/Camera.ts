import * as THREE from 'three';
import { getCameraAuthority, getCameraStateAdapter } from '../camera/CameraStateAdapter';

/**
 * Camera module
 * Handles camera initialization and management
 */

let camera: THREE.PerspectiveCamera | null = null;

export function initCamera(): THREE.PerspectiveCamera {
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );

  return camera;
}

export function getCamera(): THREE.PerspectiveCamera | null {
  return camera;
}

export function setCameraPosition(x: number, y: number, z: number): void {
  if (!camera) return;
  const cameraAdapter = getCameraStateAdapter();
  if (!cameraAdapter) {
    console.warn('[Camera] CameraStateAdapter not initialized');
    return;
  }
  const applied = cameraAdapter.applySnapshot({
    position: { x, y, z },
  }, getCameraAuthority());
  if (!applied) {
    console.warn('[Camera] Camera position update was blocked by authority gating');
  }
}

export function setCameraLookAt(x: number, y: number, z: number): void {
  if (!camera) return;
  const cameraAdapter = getCameraStateAdapter();
  if (!cameraAdapter) {
    console.warn('[Camera] CameraStateAdapter not initialized');
    return;
  }
  const target = new THREE.Vector3(x, y, z);
  const lookAtMatrix = new THREE.Matrix4().lookAt(camera.position, target, camera.up);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
  const applied = cameraAdapter.applySnapshot({
    quaternion: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  }, getCameraAuthority());
  if (!applied) {
    console.warn('[Camera] Camera look-at update was blocked by authority gating');
  }
}

export function updateCameraAspect(width: number, height: number): void {
  if (!camera) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
