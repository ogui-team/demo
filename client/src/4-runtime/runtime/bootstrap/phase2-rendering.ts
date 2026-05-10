/**
 * Phase 2: Rendering Runtime
 * 
 * Validates rendering pipeline is ready (Three.js scene, camera, renderer).
 * Does not initialize anything - rendering was already setup in kernel.
 */

import * as Engine from '../../../0-foundation/foundation/Engine';
import type { BootstrapPhaseContext } from './phase1-core';

export function bootstrapPhase2_RenderingRuntime(ctx: BootstrapPhaseContext): void {
  const scene = Engine.getEngineScene();
  if (!scene) {
    throw new Error('[Phase 2] Engine scene not initialized');
  }

  const camera = Engine.getEngineCamera();
  if (!camera) {
    throw new Error('[Phase 2] Engine camera not initialized');
  }

  const renderer = Engine.getEngineRenderer();
  if (!renderer) {
    throw new Error('[Phase 2] Engine renderer not initialized');
  }

  const cullingSystem = Engine.getCullingSystem();
  if (!cullingSystem) {
    throw new Error('[Phase 2] CullingSystem not initialized');
  }

  console.log('[Phase 2] ✓ Rendering runtime validated (scene, camera, renderer, culling)');
}
