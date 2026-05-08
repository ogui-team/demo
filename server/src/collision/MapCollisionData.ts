import * as fs from 'fs';
import * as path from 'path';

export interface CollisionVector3 {
  x: number;
  y: number;
  z: number;
}

export interface CollisionBox {
  id: string;
  position: CollisionVector3;
  halfExtents: CollisionVector3;
}

export interface MapCollisionLayout {
  mapId: string;
  sessionId: string;
  bounds: { halfWidth: number; halfDepth: number } | null;
  boxes: CollisionBox[];
}

export interface CollisionConfigMetadata {
  version: number;
  checksum: string;
}

type ConfigBox = {
  id: string;
  position: CollisionVector3;
  size: CollisionVector3;
};

type CollisionConfig = {
  version: number;
  maps: Record<string, {
    bounds?: { halfWidth: number; halfDepth: number };
    boxes?: ConfigBox[];
    seeded?: Record<string, any>;
  }>;
};

let cachedConfig: CollisionConfig | null = null;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function computeChecksum(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function loadCollisionConfig(): CollisionConfig {
  if (cachedConfig) return cachedConfig;

  const candidates = [
    path.resolve(process.cwd(), 'client/src/assets/mapColliders.json'),
    path.resolve(process.cwd(), '../client/src/assets/mapColliders.json'),
    path.resolve(__dirname, '../../client/src/assets/mapColliders.json'),
    path.resolve(__dirname, '../../../client/src/assets/mapColliders.json'),
  ];

  const resolvedPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolvedPath) {
    throw new Error('Unable to locate shared map collider data');
  }

  cachedConfig = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as CollisionConfig;
  return cachedConfig;
}

function hashSeed(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

function toCollisionBox(box: ConfigBox): CollisionBox {
  return {
    id: box.id,
    position: { ...box.position },
    halfExtents: {
      x: box.size.x * 0.5,
      y: box.size.y * 0.5,
      z: box.size.z * 0.5,
    },
  };
}

function buildDefaultArenaSeededBoxes(sessionId: string, config: any): CollisionBox[] {
  const rng = createRng(hashSeed(sessionId));
  const boxes: CollisionBox[] = [];
  const size = config.size as CollisionVector3;

  for (let index = 0; index < config.count; index += 1) {
    let x = 0;
    let z = 0;
    do {
      x = config.min.x + rng() * (config.max.x - config.min.x);
      z = config.min.z + rng() * (config.max.z - config.min.z);
    } while (x * x + z * z < config.avoidCenterRadiusSq);

    const stackHeight = Math.floor(rng() * config.stackHeightMax) + config.stackHeightMin;
    for (let heightIndex = 0; heightIndex < stackHeight; heightIndex += 1) {
      boxes.push({
        id: `crate_stack_${index}_${heightIndex}`,
        position: { x, y: 0.9 + heightIndex * size.y, z },
        halfExtents: { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
      });
      rng();
    }
  }

  return boxes;
}

function buildForestArenaSeededBoxes(sessionId: string, config: any): CollisionBox[] {
  const rng = createRng(hashSeed(sessionId));
  const boxes: CollisionBox[] = [];
  const rngRange = (min: number, max: number) => min + rng() * (max - min);

  for (let index = 0; index < config.dirtPatchCount; index += 1) {
    rngRange(2, 7);
    rngRange(2, 6);
    rngRange(-50, 50);
    rngRange(-50, 50);
    rng();
  }

  for (let index = 0; index < config.treeCount; index += 1) {
    let x = 0;
    let z = 0;
    do {
      x = rngRange(config.treeBounds.min, config.treeBounds.max);
      z = rngRange(config.treeBounds.min, config.treeBounds.max);
    } while (x * x + z * z < config.treeExcludeRadiusSq);

    const treeHeight = rngRange(4, 10);
    const trunkRadius = rngRange(0.2, 0.5);
    rngRange(1.5, 3.5);
    rngRange(3, 6);

    boxes.push({
      id: `tree_trunk_${index}`,
      position: { x, y: treeHeight * 0.5, z },
      halfExtents: { x: trunkRadius, y: treeHeight * 0.5, z: trunkRadius },
    });

    rng();
    if (rng() > 0.5) {
      rng();
    }
  }

  for (let index = 0; index < config.rockCount; index += 1) {
    const radius = rngRange(0.3, 1.8);
    const x = rngRange(config.rockBounds.min, config.rockBounds.max);
    const z = rngRange(config.rockBounds.min, config.rockBounds.max);
    boxes.push({
      id: `rock_${index}`,
      position: { x, y: radius * 0.4, z },
      halfExtents: { x: radius, y: radius, z: radius },
    });
    rng();
    rng();
    rng();
  }

  for (let index = 0; index < config.perimeterPostCount; index += 1) {
    const angle = (index / config.perimeterPostCount) * Math.PI * 2;
    boxes.push({
      id: `perimeter_post_${index}`,
      position: {
        x: Math.cos(angle) * config.perimeterRadius,
        y: 1.1,
        z: Math.sin(angle) * config.perimeterRadius,
      },
      halfExtents: { x: 0.4, y: 1.1, z: 0.4 },
    });
    rngRange(0.8, 2.2);
    rng();
  }

  return boxes;
}

export function getMapCollisionLayout(mapId: string, sessionId: string): MapCollisionLayout {
  const config = loadCollisionConfig();
  const mapConfig = config.maps[mapId];
  if (!mapConfig) {
    return { mapId, sessionId, bounds: null, boxes: [] };
  }

  const boxes = (mapConfig.boxes ?? []).map(toCollisionBox);
  if (mapId === 'map_default' && mapConfig.seeded?.crateStacks) {
    boxes.push(...buildDefaultArenaSeededBoxes(sessionId, mapConfig.seeded.crateStacks));
  }
  if (mapId === 'forest_arena' && mapConfig.seeded?.forest) {
    boxes.push(...buildForestArenaSeededBoxes(sessionId, mapConfig.seeded.forest));
  }

  return {
    mapId,
    sessionId,
    bounds: mapConfig.bounds ?? null,
    boxes,
  };
}

export function hasMapCollisionLayout(mapId: string): boolean {
  const config = loadCollisionConfig();
  return !!config.maps[mapId];
}

export function getCollisionConfigMetadata(): CollisionConfigMetadata {
  const config = loadCollisionConfig();
  return {
    version: config.version,
    checksum: computeChecksum(config),
  };
}