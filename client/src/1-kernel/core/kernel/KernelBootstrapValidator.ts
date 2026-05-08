/**
 * KernelBootstrapValidator.ts
 * 
 * Runs the GameplayDomainIntegrationCheck on kernel startup.
 * If the check fails, prevents kernel from entering gameplay.
 * 
 * Usage:
 *   const validator = new KernelBootstrapValidator(kernel);
 *   const result = await validator.validateBeforeGameplay();
 *   if (!result.passed) {
 *     console.error('Kernel validation failed:', result.errors);
 *     // Do not start game
 *     return;
 *   }
 */

import { SimulationKernel } from './SimulationKernel';
import { GameplayDomainIntegrationCheck, type IntegrationCheckResult } from './GameplayDomainIntegrationCheck';

export class KernelBootstrapValidator {
  private kernel: SimulationKernel;

  constructor(kernel: SimulationKernel) {
    this.kernel = kernel;
  }

  /**
   * Run the integration check before gameplay starts.
   * Returns true only if all checks pass.
   */
  async validateBeforeGameplay(): Promise<IntegrationCheckResult> {
    console.log('[KernelBootstrapValidator] Starting Gameplay Domain validation...');

    const check = new GameplayDomainIntegrationCheck(this.kernel);
    const result = await check.validate();

    if (!result.passed) {
      console.error('[KernelBootstrapValidator] FATAL: Kernel validation failed');
      console.error('[KernelBootstrapValidator] Errors:');
      for (const error of result.errors) {
        console.error(`  [FATAL] ${error}`);
      }
      throw new Error(
        `Kernel bootstrap validation failed with ${result.errors.length} error(s). See console for details.`
      );
    }

    console.log('[KernelBootstrapValidator] ✓ All checks passed. Kernel ready for gameplay.');
    return result;
  }
}