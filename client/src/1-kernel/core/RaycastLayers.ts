import * as THREE from 'three';
import type { InputContext } from './InputContext';

export type RaycastLayer = 'editor' | 'player' | 'world';

const RAYCAST_LAYERS_KEY = 'raycastLayers';

function normalizeLayers(layers: RaycastLayer | RaycastLayer[]): RaycastLayer[] {
  const source = Array.isArray(layers) ? layers : [layers];
  return Array.from(new Set(source));
}

export function setRaycastLayers(object: THREE.Object3D, layers: RaycastLayer | RaycastLayer[]): void {
  object.userData[RAYCAST_LAYERS_KEY] = normalizeLayers(layers);
}

export function setRaycastLayersRecursive(object: THREE.Object3D, layers: RaycastLayer | RaycastLayer[]): void {
  const normalized = normalizeLayers(layers);
  object.traverse((child) => {
    child.userData[RAYCAST_LAYERS_KEY] = normalized;
  });
}

export function getRaycastLayers(object: THREE.Object3D | null | undefined): RaycastLayer[] {
  if (!object) return [];

  let current: THREE.Object3D | null = object;
  while (current) {
    const layers = current.userData[RAYCAST_LAYERS_KEY] as RaycastLayer[] | undefined;
    if (Array.isArray(layers) && layers.length > 0) {
      return layers;
    }
    current = current.parent;
  }

  return [];
}

export function matchesRaycastLayers(
  object: THREE.Object3D | null | undefined,
  layers: RaycastLayer[] | undefined,
): boolean {
  if (!layers || layers.length === 0) return true;
  const objectLayers = getRaycastLayers(object);
  if (objectLayers.length === 0) return false;
  return layers.some((layer) => objectLayers.includes(layer));
}

export function filterRaycastObjects(
  objects: THREE.Object3D[],
  layers: RaycastLayer[] | undefined,
): THREE.Object3D[] {
  if (!layers || layers.length === 0) return objects;
  return objects.filter((object) => matchesRaycastLayers(object, layers));
}

export function raycastObjects(
  raycaster: THREE.Raycaster,
  objects: THREE.Object3D[],
  layers: RaycastLayer[] | undefined,
): THREE.Intersection[] {
  return raycaster.intersectObjects(filterRaycastObjects(objects, layers), true);
}

export function getContextRaycastLayers(context: InputContext): RaycastLayer[] {
  switch (context) {
    case 'editor':
      return ['editor'];
    case 'game':
      return ['player', 'world'];
    case 'ui':
    default:
      return [];
  }
}
