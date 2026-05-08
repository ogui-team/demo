/**
 * ============================================================================
 * 0-foundation/public-api.ts - FOUNDATION DOMAIN PUBLIC API
 * ============================================================================
 * 
 * Public API barrel for the Foundation domain.
 * 
 * Foundation layer defines core interfaces and contracts that all systems
 * must implement. These are foundational types used across the engine.
 * 
 * All exports from the foundation domain MUST go through this file.
 * Other domains MUST use:
 *   import type { INetworkReplicator } from '@engine/0-foundation/public-api'
 * 
 * NOT:
 *   import type { INetworkReplicator } from '@engine/0-foundation/index'
 * 
 * ============================================================================
 */

// Re-export all foundation types from the foundation index
export type {
  INetworkReplicator,
  IGameplayStateProvider,
  IWeaponRules,
  IPlayerStateManager,
  IKernelEntity,
  IPhysicsSystem,
  IMeshBinding,
  IEngineRuntime,
} from './index';
