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

export function snapshotSceneRoot(filter?: (object: THREE.Object3D) => boolean): THREE.Group | null {
  if (!scene) return null;

  const root = new THREE.Group();
  root.name = scene.name || 'engine-scene-root';

  for (const child of scene.children) {
    if (filter && !filter(child)) {
      continue;
    }
    root.add(child.clone(true));
  }

  return root;
}

export function replaceSceneRoot(root: THREE.Object3D): void {
  if (!scene) return;
  while (scene.children.length > 0) {
    scene.remove(scene.children[0]);
  }
  for (const child of [...root.children]) {
    scene.add(child.clone(true));
  }
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
