/**
 * ENTITY TYPE DEFINITIONS
 * 
 * Shared Player and Entity State interfaces for Client/Server DOD parity.
 * These define the memory layout for entity components and snapshot serialization.
 * 
 * CRITICAL: Do NOT change field types or ordering - it affects byte-offsets!
 */

import type { TropicalHorrorArchetypeId } from './archetypes';

/**
 * Vector3 type for position, rotation, velocity
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * PlayerState - Full entity state for players on SERVER
 * This represents a player's complete runtime state including movement, health, equipment.
 * 
 * CRITICAL: Field ordering and types must remain stable for CRC32 determinism!
 * 
 * NOTE: Some fields like currentInput, activeMovementStatuses, and statusMovementModifier
 * are typed as Record<string, unknown> or any to avoid import conflicts with
 * environment-specific definitions (each environment may have its own PlayerInputState shape).
 */
export interface PlayerState {
  id: string;
  name: string;
  appearance?: Record<string, unknown> | null;
  archetypeId: TropicalHorrorArchetypeId;
  archetypeName: string;
  position: Vec3;
  rotation: Vec3;
  velocity: Vec3;
  isCrouching: boolean;
  isAirborne: boolean;
  groundHeight: number;
  jumpHeld: boolean;
  currentInput: any; // PlayerInputState (environment-specific shape)
  jumpBufferRemaining: number;
  coyoteTimeRemaining: number;
  pendingMovementIntent?: any | null; // PlayerMovementIntent (environment-specific)
  activeMovementStatuses?: any[]; // PlayerMovementStatus[] (environment-specific)
  statusMovementModifier?: any | null; // PlayerStatusMovementModifier (environment-specific)
  debugStatusOverride?: any | null; // PlayerDebugStatusOverride (environment-specific)
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  mana: number;
  maxMana: number;
  damageReduction: number;
  damageMultiplier: number;
  attackSpeed: number;
  dead: boolean;
  lastUpdate: number;
  lastInputSeq: number;
  lastProcessedInputSeq: number;
  lastProcessedInputTick: number;
  lastMoveCommandAt: number;
  kills: number;
  deaths: number;
  level: number;
  exp: number;
  ping: number;
  equipment: string[];
  respawnAt: number | null;
  ws?: any; // WebSocket reference (server-only)
}

/**
 * EntityState - Generic entity representation for snapshot serialization
 * This includes world objects, players, and other replicated entities.
 * 
 * CRITICAL: Field ordering and types must remain stable for CRC32 determinism!
 */
export interface EntityState {
  id: string;
  type: string;
  position: Vec3;
  rotation: Vec3;
  velocity?: Vec3;
  isCrouching?: boolean;
  isGrounded?: boolean;
  isAirborne?: boolean;
  health?: number;
  maxHealth?: number;
  shield?: number;
  maxShield?: number;
  mana?: number;
  maxMana?: number;
  state?: string;
  dead?: boolean;
  name?: string;
  kills?: number;
  deaths?: number;
  level?: number;
  exp?: number;
  ping?: number;
  archetypeId?: string;
  archetypeName?: string;
  equipment?: string[];
  activeWeaponId?: string;
  currentAmmo?: number;
  reserveAmmo?: number;
  isReloading?: boolean;
  statusMovementModifier?: any | null; // PlayerStatusMovementModifier (environment-specific)
  IS_PLAYER_CONTROLLED?: boolean;
  [key: string]: unknown;
}

/**
 * PlayerPrefabDefinition - Static prefab loaded from JSON for spawn system
 * Defines default component values for a player archetype.
 */
export interface PlayerPrefabDefinition {
  id: string;
  entityType: string;
  flags?: {
    isPlayerControlled?: boolean;
  };
  dodComponents?: {
    health?: {
      hp?: number;
      maxHp?: number;
    };
    inventory?: {
      loadout?: string[];
      equipped?: string;
    };
  };
}

/**
 * PlayerSpawnResult - Return value from spawn system
 */
export interface PlayerSpawnResult {
  player: PlayerState;
  entity: EntityState;
}
