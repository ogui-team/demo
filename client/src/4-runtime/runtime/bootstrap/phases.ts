/**
 * BOOTSTRAP PHASES - Unified Exports
 * 
 * This module re-exports all bootstrap phases from their individual files.
 * Phases are now decoupled into separate modules for independent testing.
 * 
 * Phase 1: Core Runtime - SystemRegistry, state management, basic systems
 * Phase 2: Rendering Runtime - Three.js pipeline, scene graph, camera
 * Phase 3: Gameplay Runtime - Physics, gameplay logic, input
 * Phase 4: Networking Runtime - Multiplayer client, replication, sync
 * Phase 5: UI Runtime - Panels, HUD, mode selector
 * Phase 6: Coordinators - Wire all phases together
 */

// Re-export from decoupled phase modules
export { bootstrapPhase1_CoreRuntime, type BootstrapPhaseContext } from './phase1-core';
export { bootstrapPhase2_RenderingRuntime } from './phase2-rendering';
export { Phase3_GameplayRuntime, type PhaseResult } from './phase3-gameplay';
export { Phase4_NetworkingRuntime } from './phase4-networking';
export { Phase5_UIRuntime } from './phase5-ui';
export { bootstrapPhase6_CoordinatorWiring } from './phase6CoordinatorWiring';
