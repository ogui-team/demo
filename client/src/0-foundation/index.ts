/**
 * ============================================================================
 * 0-foundation/index.ts - FOUNDATION DOMAIN TYPES
 * ============================================================================
 * 
 * Central location for foundation-layer interfaces and types.
 * These define the contracts that all systems must implement.
 * 
 * Phase 1.2: Temporary export location (will be moved to public-api.ts in Phase 3)
 */

// ============================================================
// SYSTEM INTERFACES
// ============================================================

/**
 * Network replication system
 */
export interface INetworkReplicator {
  replicate?(): Promise<void>;
  subscribe?(callback: (data: unknown) => void): void;
}

/**
 * Gameplay state provider
 */
export interface IGameplayStateProvider {
  getState?(): unknown;
  setState?(state: unknown): void;
}

/**
 * Weapon system rules interface
 */
export interface IWeaponRules {
  damage?: number;
  fireRate?: number;
}

/**
 * Player state manager
 */
export interface IPlayerStateManager {
  getHealth?(): number;
  takeDamage?(amount: number): void;
  heal?(amount: number): void;
}

/**
 * Kernel entity representation
 */
export interface IKernelEntity {
  id?: string;
  position?: { x: number; y: number; z: number };
  transform?: unknown;
}

/**
 * Physics simulation system
 */
export interface IPhysicsSystem {
  step?(deltaTime: number): void;
  addBody?(entity: unknown): void;
  removeBody?(entity: unknown): void;
}

/**
 * Mesh binding system
 */
export interface IMeshBinding {
  bind?(entity: unknown, mesh: unknown): void;
  unbind?(entity: unknown): void;
  update?(deltaTime: number): void;
}

/**
 * Main engine runtime interface
 */
export interface IEngineRuntime {
  boot?(): Promise<void>;
  tick?(deltaTime: number): void;
  shutdown?(): Promise<void>;
}
