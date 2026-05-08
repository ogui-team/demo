import * as THREE from 'three';

/**
 * Scene module
 * Handles scene initialization and management
 */

let scene: THREE.Scene | null = null;

export function initScene(): THREE.Scene {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d0d); // Very dark background for PS1 aesthetic
  return scene;
}

export function getScene(): THREE.Scene | null {
  return scene;
}

export function addToScene(object: THREE.Object3D): void {
  if (!scene) return;
  scene.add(object);
}

export function removeFromScene(object: THREE.Object3D): void {
  if (!scene) return;
  scene.remove(object);
}

export function clearScene(): void {
  if (!scene) return;
  while (scene.children.length > 0) {
    scene.remove(scene.children[0]);
  }
}
