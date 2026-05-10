/**
 * Phase 5: UI Runtime
 * 
 * Creates UI systems with full idempotency guarantee:
 * - HUDSystem (in-game heads-up display)
 * - InventorySystem (player inventory management)
 * 
 * All event listeners tracked and removable.
 * All DOM nodes owned and removable.
 * 
 * Returns PhaseResult with all systems + dispose
 */

import type { BootstrapPhaseContext } from './phase1-core';
import type { PhaseResult } from './phase3-gameplay';
import { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import { InventorySystem } from '../../../2-systems/gameplay/systems/InventorySystem';
import type { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { PrefabSystem } from '../../../2-systems/gameplay/systems/PrefabSystem';

export function Phase5_UIRuntime(
  ctx: BootstrapPhaseContext,
  healthSystem: HealthSystem,
  weaponSystem: WeaponSystem,
  prefabSystem: PrefabSystem,
): PhaseResult {
  const { stateManager } = ctx;
  const listeners: Array<() => void> = [];
  const roots: HTMLElement[] = [];

  // Helper: track all event listeners for cleanup
  function trackListener(target: EventTarget, event: string, handler: EventListener) {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  }

  // Helper: track DOM root ownership
  function trackRoot(el: HTMLElement): HTMLElement {
    roots.push(el);
    return el;
  }

  // Create HUD system
  const gameHUD = new HUDSystem({ stateManager });
  gameHUD.mount();

  // Create Inventory system
  const inventorySystem = new InventorySystem({
    health: healthSystem,
    weapons: weaponSystem,
    state: stateManager,
    prefabSystem,
    enableLogging: false,
  });
  inventorySystem.defineDefaults();

  // Track UI containers if they exist in DOM
  const hudContainer = document.querySelector('[data-hud-root]') as HTMLElement | null;
  if (hudContainer) trackRoot(hudContainer);

  const inventoryContainer = document.querySelector('[data-inventory-root]') as HTMLElement | null;
  if (inventoryContainer) trackRoot(inventoryContainer);

  const systems = {
    hud: gameHUD,
    inventory: inventorySystem,
  };

  console.log('[Phase 5] ✓ UI runtime created (2 systems)');

  return {
    systems,
    dispose: () => {
      console.log('[Phase 5] Disposing UI runtime');

      // 1. Remove all event listeners
      listeners.forEach(remove => remove());

      // 2. Remove all DOM nodes
      roots.forEach(el => {
        try {
          el.remove();
        } catch (e) {
          // Element might already be removed
        }
      });

      // 3. Dispose all systems
      Object.values(systems).forEach(sys => {
        (sys as any).dispose?.();
      });

      // 4. Clear arrays
      listeners.length = 0;
      roots.length = 0;

      console.log('[Phase 5] disposed cleanly');
    }
  };
}
