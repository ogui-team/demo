/**
 * ============================================================================
 * 2-systems/public-api.ts - GAMEPLAY DOMAIN PUBLIC API
 * ============================================================================
 * 
 * Status: PHASE 2 PLACEHOLDER
 * 
 * This barrel file will grow during Phase 2 as gameplay systems are extracted
 * from monolithic files into focused, testable modules.
 * 
 * Current exports: NONE (Phase 1 focused on Core domain)
 * Phase 2 will add: WeaponSystem, HealthSystem, AbilitySystem, EntityRenderer, etc.
 * 
 * Rules (enforced by DependencyValidator.ts):
 *   ✅ Other domains import ONLY from this file: import { X } from '@engine/2-systems/public-api'
 *   ❌ Direct subdir imports forbidden: import { X } from '@engine/2-systems/gameplay/weapons/X'
 * 
 * ============================================================================
 */

// Phase 2 Placeholder - no exports yet
// Exports will be added as systems are extracted during Phase 2 refactoring

// ============================================================
// VALIDATION COMMENT
// ============================================================

/**
 * DependencyValidator.ts will check:
 * 
 * ✅ ALLOWED imports in other domains:
 *    import { WeaponSystem } from '@engine/2-systems/public-api'
 *    import type { IWeaponRules } from '@engine/0-foundation/public-api'
 * 
 * ❌ FORBIDDEN imports (caught by validator):
 *    import { WeaponSystemInternal } from '@engine/2-systems/weapons/internal.ts'
 *    import { SpawnValidator } from '@engine/2-systems/gameplay/player-state/validators.ts'
 * 
 * Exception (whitelisted):
 * - Imports within same domain (2-systems/* imports from 2-systems/*)
 * - Imports in test files (*.spec.ts)
 * - Imports from parent public-api (allowed via composition)
 */
