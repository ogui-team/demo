/**
 * SYSTEM REGISTRY (Dependency Inversion Layer)
 * 
 * Phase 0: Runtime Service Locator
 * 
 * Pattern:
 *  - Each system registers itself on boot
 *  - Other systems request via registry.get<T>(key)
 *  - Enables swapping implementations without code changes
 *  - Complements public-api.ts compile-time boundaries
 * 
 * Usage:
 *   // On boot:
 *   const weaponSystem = new WeaponSystem();
 *   registry.register('WeaponSystem', weaponSystem);
 *   
 *   // In another system:
 *   const weapons = registry.get<IWeaponRules>('WeaponSystem');
 *   weapons.fireWeapon(playerId, weaponId);
 * 
 * Benefits:
 *   ✅ No direct imports (loose coupling)
 *   ✅ Can mock for testing
 *   ✅ Can hot-swap implementations
 *   ✅ Enforces interface usage (not concrete classes)
 */

import type {
  INetworkReplicator,
  IGameplayStateProvider,
  IWeaponRules,
  IPlayerStateManager,
  IKernelEntity,
  IPhysicsSystem,
  IMeshBinding,
  IEngineRuntime,
  // TODO (Phase 3): Create @engine/0-foundation/public-api and import foundation types
} from '@engine/1-kernel/core/public-api'; // Temporary: core re-exports some foundation interfaces

// ============================================================
// TYPES
// ============================================================

export type SystemKey =
  | 'NetworkReplicator'
  | 'GameplayStateProvider'
  | 'WeaponSystem'
  | 'PlayerHealthSystem'
  | 'AbilitySystem'
  | 'PhysicsSystem'
  | 'EntityRegistry'
  | 'EntityRenderer'
  | 'PlayerModelSystem'
  | 'MeshBindingTable'
  | 'HUDSystem'
  | 'GameSession'
  | 'RuntimeAssembler'
  | (string & {}); // Allow runtime keys

export interface ISystemRegistry {
  /**
   * Register a system instance
   */
  register<T = any>(key: SystemKey, instance: T): void;

  /**
   * Retrieve a system by key
   * Throws if not found and required=true
   */
  get<T = any>(key: SystemKey, required?: boolean): T | null;

  /**
   * Check if system is registered
   */
  has(key: SystemKey): boolean;

  /**
   * Unregister a system
   */
  unregister(key: SystemKey): void;

  /**
   * Clear all systems
   */
  clear(): void;

  /**
   * Get all registered keys
   */
  keys(): SystemKey[];

  /**
   * Debug: print registry state
   */
  debug(): void;
}

// ============================================================
// IMPLEMENTATION
// ============================================================

/** @deprecated Runtime execution uses Engine.getSystemRegistry() from the kernel registry. */
export class SystemRegistry implements ISystemRegistry {
  private systems = new Map<SystemKey, any>();
  private registrationLog: { key: SystemKey; time: number; type: string }[] = [];

  register<T = any>(key: SystemKey, instance: T): void {
    if (this.systems.has(key)) {
      if ((globalThis as any).DEBUG_SYSTEMS) {
        console.warn(`[SystemRegistry] Overwriting existing system: ${key}`);
      }
    }

    this.systems.set(key, instance);
    this.registrationLog.push({
      key,
      time: Date.now(),
      type: instance?.constructor?.name || typeof instance,
    });

    if ((globalThis as any).DEBUG_SYSTEMS) {
      console.log(
        `[SystemRegistry] Registered: ${key} (${instance?.constructor?.name})`
      );
    }
  }

  get<T = any>(key: SystemKey, required: boolean = true): T | null {
    const instance = this.systems.get(key);

    if (!instance && required) {
      throw new Error(
        `[SystemRegistry] FATAL: System not found: "${key}"\nAvailable: ${Array.from(this.systems.keys()).join(', ')}`
      );
    }

    return instance ?? null;
  }

  has(key: SystemKey): boolean {
    return this.systems.has(key);
  }

  unregister(key: SystemKey): void {
    this.systems.delete(key);
    if ((globalThis as any).DEBUG_SYSTEMS) {
      console.log(`[SystemRegistry] Unregistered: ${key}`);
    }
  }

  clear(): void {
    this.systems.clear();
    this.registrationLog = [];
    if ((globalThis as any).DEBUG_SYSTEMS) {
      console.log('[SystemRegistry] Cleared all systems');
    }
  }

  keys(): SystemKey[] {
    return Array.from(this.systems.keys());
  }

  debug(): void {
    console.log('\n=== SYSTEM REGISTRY DEBUG ===');
    console.log('Registered systems:');
    for (const [key, instance] of this.systems.entries()) {
      console.log(
        `  ${key}: ${instance?.constructor?.name || typeof instance}`
      );
    }

    console.log('\nRegistration timeline:');
    this.registrationLog.forEach((entry) => {
      const ago = Date.now() - entry.time;
      console.log(`  ${entry.key} (${entry.type}) - ${ago}ms ago`);
    });

    console.log('=============================\n');
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

/**
 * Global registry instance
 * Used throughout the engine
 */
let globalRegistry: SystemRegistry | null = null;

export function getRegistry(): SystemRegistry {
  if (!globalRegistry) {
    console.warn('[SystemRegistry] Legacy runtime registry accessed. Prefer Engine.getSystemRegistry().');
    globalRegistry = new SystemRegistry();
  }
  return globalRegistry;
}

export function resetRegistry(): void {
  if (globalRegistry) {
    globalRegistry.clear();
  }
  globalRegistry = null;
}

// ============================================================
// CONVENIENCE GETTERS (Typed access)
// ============================================================

/**
 * Typed convenience methods to avoid casting
 */
export class RegistryGetters {
  static getNetworkReplicator(): INetworkReplicator {
    return getRegistry().get<INetworkReplicator>(
      'NetworkReplicator',
      true
    ) as INetworkReplicator;
  }

  static getGameplayStateProvider(): IGameplayStateProvider {
    return getRegistry().get<IGameplayStateProvider>(
      'GameplayStateProvider',
      true
    ) as IGameplayStateProvider;
  }

  static getWeaponSystem(): IWeaponRules {
    return getRegistry().get<IWeaponRules>('WeaponSystem', true) as IWeaponRules;
  }

  static getPlayerHealthSystem(): IPlayerStateManager {
    return getRegistry().get<IPlayerStateManager>(
      'PlayerHealthSystem',
      true
    ) as IPlayerStateManager;
  }

  static getPhysicsSystem(): IPhysicsSystem {
    return getRegistry().get<IPhysicsSystem>('PhysicsSystem', true) as IPhysicsSystem;
  }

  static getMeshBindingTable(): IMeshBinding {
    return getRegistry().get<IMeshBinding>(
      'MeshBindingTable',
      true
    ) as IMeshBinding;
  }
}

// ============================================================
// LIFECYCLE HOOKS (For testing)
// ============================================================

export interface RegistryLifecycleHook {
  onRegisterSystem?(key: SystemKey, instance: any): void;
  onUnregisterSystem?(key: SystemKey): void;
  onClear?(): void;
}

/**
 * Extend SystemRegistry with hooks for testing/debugging
 */
export class HookedSystemRegistry extends SystemRegistry {
  private hooks: RegistryLifecycleHook[] = [];

  addHook(hook: RegistryLifecycleHook): void {
    this.hooks.push(hook);
  }

  register<T = any>(key: SystemKey, instance: T): void {
    super.register(key, instance);
    this.hooks.forEach((h) => h.onRegisterSystem?.(key, instance));
  }

  unregister(key: SystemKey): void {
    super.unregister(key);
    this.hooks.forEach((h) => h.onUnregisterSystem?.(key));
  }

  clear(): void {
    super.clear();
    this.hooks.forEach((h) => h.onClear?.());
  }
}
