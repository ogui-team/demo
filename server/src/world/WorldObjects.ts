import { type Vec3 } from '../sessionContracts';

export interface WorldObjectState {
  id: string;
  entityType: string;
  position: Vec3;
  rotation: Vec3;
  renderData: { meshType: string; color: number; geometry: Record<string, unknown> };
}

export function getWorldObjectHalfExtents(
  worldObject: WorldObjectState,
  readFiniteNumber: (value: unknown) => number | undefined,
): Vec3 {
  const geometry = worldObject.renderData?.geometry ?? {};
  const width = readFiniteNumber(geometry.width) ?? readFiniteNumber(geometry.size) ?? 1;
  // Some geometry payloads use `length` to represent the vertical dimension.
  const lengthUsedAsHeight = readFiniteNumber(geometry.length);
  const height = readFiniteNumber(geometry.height) ?? lengthUsedAsHeight ?? width;
  const depth = readFiniteNumber(geometry.depth) ?? readFiniteNumber(geometry.size) ?? width;
  const radius = readFiniteNumber(geometry.radius)
    ?? readFiniteNumber(geometry.radiusTop)
    ?? readFiniteNumber(geometry.radiusBottom)
    ?? Math.max(width, depth) * 0.5;

  switch (worldObject.renderData?.meshType) {
    case 'sphere':
      return { x: radius, y: radius, z: radius };
    case 'cylinder':
    case 'cone':
    case 'capsule':
      return { x: radius, y: Math.max(height * 0.5, radius), z: radius };
    default:
      return { x: width * 0.5, y: height * 0.5, z: depth * 0.5 };
  }
}

export function createWorldObjectFromRequest(
  data: Record<string, unknown>,
  actorId: string,
  nextWorldObjectId: (actorId: string) => string,
  readFiniteNumber: (value: unknown) => number | undefined,
): WorldObjectState | null {
  const entityType = typeof data.entityType === 'string' ? data.entityType.trim() : '';
  const renderData = readWorldObjectRenderData(data.renderData, readFiniteNumber);
  if (!entityType || !renderData) {
    return null;
  }

  return {
    id: nextWorldObjectId(actorId),
    entityType,
    position: readWorldObjectVector(data.position, { x: 0, y: 1, z: 0 }, readFiniteNumber),
    rotation: readWorldObjectVector(data.rotation, { x: 0, y: 0, z: 0 }, readFiniteNumber),
    renderData,
  };
}

export function nextWorldObjectId(sessionId: string, sequence: number, actorId: string): string {
  return `world_object_${sessionId}_${actorId}_${sequence}`;
}

function readWorldObjectVector(
  value: unknown,
  fallback: Vec3,
  readFiniteNumber: (value: unknown) => number | undefined,
): Vec3 {
  const vector = (value ?? {}) as Partial<Vec3>;
  return {
    x: readFiniteNumber(vector.x) ?? fallback.x,
    y: readFiniteNumber(vector.y) ?? fallback.y,
    z: readFiniteNumber(vector.z) ?? fallback.z,
  };
}

function readWorldObjectRenderData(
  value: unknown,
  readFiniteNumber: (value: unknown) => number | undefined,
): WorldObjectState['renderData'] | null {
  const renderData = (value ?? {}) as {
    meshType?: unknown;
    color?: unknown;
    geometry?: unknown;
  };
  if (typeof renderData.meshType !== 'string') {
    return null;
  }

  return {
    meshType: renderData.meshType,
    color: readFiniteNumber(renderData.color) ?? 0xffffff,
    geometry: renderData.geometry && typeof renderData.geometry === 'object'
      ? { ...(renderData.geometry as Record<string, unknown>) }
      : {},
  };
}