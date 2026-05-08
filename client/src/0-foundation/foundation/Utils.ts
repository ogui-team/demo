import * as THREE from 'three';

/**
 * Utilities module
 * Common helper functions for the engine
 */

/**
 * Create a standard PS1-style material
 */
export function createPS1Material(
  color: number = 0xffffff,
  options: {
    flatShading?: boolean;
    wireframe?: boolean;
    roughness?: number;
    metalness?: number;
  } = {}
): THREE.MeshStandardMaterial {
  const defaults = {
    flatShading: true,
    wireframe: false,
    roughness: 0.8,
    metalness: 0.0,
  };

  const settings = { ...defaults, ...options };

  const material = new THREE.MeshStandardMaterial({
    color,
    flatShading: settings.flatShading,
    wireframe: settings.wireframe,
    roughness: settings.roughness,
    metalness: settings.metalness,
  });

  return material;
}

/**
 * Create a simple primitive mesh
 */
export function createBox(size: number = 1, color: number = 0xffffff): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = createPS1Material(color);
  return new THREE.Mesh(geometry, material);
}

export function createSphere(radius: number = 1, color: number = 0xffffff): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 16, 16);
  const material = createPS1Material(color);
  return new THREE.Mesh(geometry, material);
}

export function createPlane(width: number = 10, height: number = 10, color: number = 0xffffff): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = createPS1Material(color);
  return new THREE.Mesh(geometry, material);
}

/**
 * Vector utilities
 */
export function vec3(x: number = 0, y: number = 0, z: number = 0): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

export function vec2(x: number = 0, y: number = 0): THREE.Vector2 {
  return new THREE.Vector2(x, y);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Normalize angle to 0-360 range
 */
export function normalizeAngle(angle: number): number {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * Convert degrees to radians
 */
export function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
export function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}
