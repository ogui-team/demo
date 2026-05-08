/**
 * ============================================================================
 * 1-kernel/public-api.ts - KERNEL DOMAIN PUBLIC API
 * ============================================================================
 * 
 * Phase 2B kernel systems:
 * - Core kernel execution and command management
 * - Snapshot serialization and state reconciliation
 * - Movement integration and DOD weapon/HUD systems
 * 
 * STABILITY NOTE: These systems are Phase 2B. Import with awareness that
 * API stability is not yet guaranteed. For Phase 1 systems, use @engine/core.
 * 
 * ============================================================================
 */

// ─── Phase 2B Systems (Experimental) ───────────────────────────────
// These are exported from core/public-api.ts during Phase 2a/b transition
// Re-export here to support @engine/1-kernel imports
export { KernelCommandQueue } from './core/kernel/KernelCommandQueue';
export { SnapshotReader } from './core/kernel/SnapshotReader';
export { MovementIntegrateSystem } from './core/kernel/MovementIntegrateSystem';
export { DODWeaponSystem } from './core/kernel/DODWeaponSystem';
export { HUDSyncSystem } from './core/kernel/HUDSyncSystem';

// Future Phase 2b/c exports:
// - PhysicsSystem
// - ProjectileSystem
// - SpawnSystem
// - AnimationSystem
