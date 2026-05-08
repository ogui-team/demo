import type { Vector3 } from './vector';
import type { Transform } from './transform';

// ── Vector3 utilities ──────────────────────────────────────────────────────

export function vec3Add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vector3, scalar: number): Vector3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

export function vec3Dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3LengthSq(v: Vector3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Length(v: Vector3): number {
  return Math.sqrt(vec3LengthSq(v));
}

export function vec3Normalize(v: Vector3): Vector3 {
  const len = vec3Length(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function vec3Distance(a: Vector3, b: Vector3): number {
  return vec3Length(vec3Sub(a, b));
}

export function vec3DistanceSq(a: Vector3, b: Vector3): number {
  return vec3LengthSq(vec3Sub(a, b));
}

export function vec3Lerp(a: Vector3, b: Vector3, t: number): Vector3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function vec3Clone(v: Vector3): Vector3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function vec3Zero(): Vector3 {
  return { x: 0, y: 0, z: 0 };
}

export function vec3Equals(a: Vector3, b: Vector3, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.z - b.z) < epsilon
  );
}

export function vec3FromArray(arr: [number, number, number]): Vector3 {
  return { x: arr[0], y: arr[1], z: arr[2] };
}

export function vec3ToArray(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

// ── Transform utilities ────────────────────────────────────────────────────

export function createTransform(
  position: Vector3 = vec3Zero(),
  rotation: Vector3 = vec3Zero(),
  scale: Vector3 = { x: 1, y: 1, z: 1 },
): Transform {
  return { position, rotation, scale };
}

export function transformIdentity(): Transform {
  return createTransform();
}

export function transformGetWorldPosition(t: Transform): Vector3 {
  return vec3Clone(t.position);
}
