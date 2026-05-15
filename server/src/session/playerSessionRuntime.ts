import { createIdleInputState } from '../movement/MovementRuntime';
import { getDefaultSpawnPointsForMap, type Vec3 } from '../sessionContracts';
import type { PlayerState } from '../core/GameSession';
import {
  cloneTropicalHorrorArchetypeAppearance,
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  getTropicalHorrorArchetype,
  resolveTropicalHorrorArchetypeId,
  type TropicalHorrorArchetypeId,
} from '@shared/contracts';

interface SpawnablePlayer {
  dead: boolean;
  position: Vec3;
}

interface CreatePlayerStateOptions {
  id: string;
  name: string;
  appearance?: Record<string, unknown> | null;
  archetypeId?: TropicalHorrorArchetypeId | null;
  spawn: Vec3;
  now: number;
  equipment?: string[];
}

interface GetPlayerSpawnPointOptions<TPlayer extends SpawnablePlayer> {
  startIndex: number;
  spawnPoints: Vec3[];
  selectedMap: Parameters<typeof getDefaultSpawnPointsForMap>[0];
  players: Iterable<[string, TPlayer]>;
  excludePlayerId?: string;
  isPositionValid: (position: Vec3, radius: number) => boolean;
  playerCollisionRadius: number;
}

interface PlayerArchetypeRuntimeState {
  archetypeId: TropicalHorrorArchetypeId;
  archetypeName: string;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  mana: number;
  maxMana: number;
  damageReduction: number;
  damageMultiplier: number;
  attackSpeed: number;
  equipment: string[];
}

function resolvePlayerArchetypeRuntimeState(
  rawArchetypeId?: TropicalHorrorArchetypeId | null,
  equipment?: string[],
): PlayerArchetypeRuntimeState {
  const archetypeId = resolveTropicalHorrorArchetypeId(rawArchetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
  const archetype = getTropicalHorrorArchetype(archetypeId);
  const resolvedEquipment = equipment && equipment.length > 0
    ? [...new Set(equipment)]
    : [...new Set(archetype.spawn.weapons.length > 0 ? archetype.spawn.weapons : ['pistol'])];

  return {
    archetypeId,
    archetypeName: archetype.stats.classLabel,
    health: archetype.stats.maxHealth,
    maxHealth: archetype.stats.maxHealth,
    armor: archetype.stats.maxShield,
    maxArmor: archetype.stats.maxShield,
    mana: archetype.stats.maxMana,
    maxMana: archetype.stats.maxMana,
    damageReduction: archetype.stats.armor,
    damageMultiplier: archetype.stats.damageMultiplier,
    attackSpeed: archetype.stats.attackSpeed,
    equipment: resolvedEquipment,
  };
}

export function applyPlayerArchetypeState(
  player: PlayerState,
  archetypeId?: TropicalHorrorArchetypeId | null,
  equipment?: string[],
): void {
  const archetype = resolvePlayerArchetypeRuntimeState(archetypeId ?? player.archetypeId, equipment ?? player.equipment);
  player.archetypeId = archetype.archetypeId;
  player.archetypeName = archetype.archetypeName;
  player.health = archetype.health;
  player.maxHealth = archetype.maxHealth;
  player.armor = archetype.armor;
  player.maxArmor = archetype.maxArmor;
  player.mana = archetype.mana;
  player.maxMana = archetype.maxMana;
  player.damageReduction = archetype.damageReduction;
  player.damageMultiplier = archetype.damageMultiplier;
  player.attackSpeed = archetype.attackSpeed;
  player.equipment = [...archetype.equipment];
}

export function createPlayerState(options: CreatePlayerStateOptions): PlayerState {
  const archetype = resolvePlayerArchetypeRuntimeState(options.archetypeId, options.equipment);
  return {
    id: options.id,
    name: options.name,
    appearance: options.appearance
      ? { ...options.appearance }
      : { ...cloneTropicalHorrorArchetypeAppearance(archetype.archetypeId) },
    archetypeId: archetype.archetypeId,
    archetypeName: archetype.archetypeName,
    position: { ...options.spawn },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    isCrouching: false,
    isAirborne: false,
    groundHeight: options.spawn.y,
    jumpHeld: false,
    currentInput: createIdleInputState(),
    jumpBufferRemaining: 0,
    coyoteTimeRemaining: 0,
    pendingMovementIntent: null,
    activeMovementStatuses: [],
    statusMovementModifier: null,
    debugStatusOverride: null,
    health: archetype.health,
    maxHealth: archetype.maxHealth,
    armor: archetype.armor,
    maxArmor: archetype.maxArmor,
    mana: archetype.mana,
    maxMana: archetype.maxMana,
    damageReduction: archetype.damageReduction,
    damageMultiplier: archetype.damageMultiplier,
    attackSpeed: archetype.attackSpeed,
    dead: false,
    lastUpdate: options.now,
    lastInputSeq: 0,
    lastProcessedInputSeq: 0,
    lastProcessedInputTick: 0,
    lastMoveCommandAt: 0,
    kills: 0,
    deaths: 0,
    level: 1,
    exp: 0,
    ping: 0,
    equipment: [...archetype.equipment],
    respawnAt: null,
  };
}

export function resetPlayerRuntimeState(player: PlayerState, spawn: Vec3): void {
  player.position = { ...spawn };
  player.rotation = { x: 0, y: 0, z: 0 };
  player.velocity = { x: 0, y: 0, z: 0 };
  player.isCrouching = false;
  player.isAirborne = false;
  player.groundHeight = spawn.y;
  player.jumpHeld = false;
  player.currentInput = createIdleInputState();
  player.jumpBufferRemaining = 0;
  player.coyoteTimeRemaining = 0;
  player.pendingMovementIntent = null;
  player.activeMovementStatuses = [];
  player.statusMovementModifier = null;
  player.debugStatusOverride = null;
  player.dead = false;
  player.respawnAt = null;
  player.lastMoveCommandAt = 0;
  applyPlayerArchetypeState(player, player.archetypeId, player.equipment);
}

export function getPlayerSpawnPoint<TPlayer extends SpawnablePlayer>(options: GetPlayerSpawnPointOptions<TPlayer>): Vec3 {
  const points = options.spawnPoints.length > 0
    ? options.spawnPoints
    : getDefaultSpawnPointsForMap(options.selectedMap);
  const orderedCandidates = points.map((_, offset) => points[(options.startIndex + offset) % points.length]);

  for (const candidate of orderedCandidates) {
    if (isSpawnPositionUsable(candidate, options)) {
      return { ...candidate };
    }
  }

  for (const candidate of orderedCandidates) {
    const resolved = findNearbyValidSpawn(candidate, options);
    if (resolved) {
      return resolved;
    }
  }

  return { ...points[options.startIndex % points.length] };
}

function findNearbyValidSpawn<TPlayer extends SpawnablePlayer>(
  origin: Vec3,
  options: GetPlayerSpawnPointOptions<TPlayer>,
): Vec3 | null {
  const radii = [2, 4, 6, 8, 10, 12];
  const steps = 16;

  for (const radius of radii) {
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const candidate = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y,
        z: origin.z + Math.sin(angle) * radius,
      };
      if (isSpawnPositionUsable(candidate, options)) {
        return candidate;
      }
    }
  }

  return null;
}

function isSpawnPositionUsable<TPlayer extends SpawnablePlayer>(
  position: Vec3,
  options: GetPlayerSpawnPointOptions<TPlayer>,
): boolean {
  if (!options.isPositionValid(position, options.playerCollisionRadius)) {
    return false;
  }

  const minSpacingSq = 4;
  for (const [playerId, player] of options.players) {
    if (playerId === options.excludePlayerId || player.dead) continue;
    const dx = player.position.x - position.x;
    const dz = player.position.z - position.z;
    if (dx * dx + dz * dz < minSpacingSq) {
      return false;
    }
  }

  return true;
}