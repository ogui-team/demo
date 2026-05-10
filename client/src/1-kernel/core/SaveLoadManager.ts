/**
 * Save/Load Manager
 * Handles serialization and deserialization of world state
 * 
 * Serializes:
 * - All entities (id, type, transform, components)
 * - Global engine settings (fog, lighting, camera, atmosphere)
 * 
 * Does NOT serialize:
 * - Three.js scene/camera/renderer objects
 * - UI state
 * - Network connections
 */

import { Entity, EntityData, Transform, Component } from './Entity';
import { SceneGraph } from './SceneGraph';
import { gameBus } from './EventBus';
import type { SystemCapabilities, SystemContext } from './types';

interface SaveLoadEntityManagerAdapter {
  serialize(): EntityData[];
  clear(): void;
  deserialize(entities: EntityData[]): void;
  getEntities(): Entity[];
}

interface SaveLoadStateStoreAdapter {
  getState(path?: string): Record<string, any>;
  snapshot(): Record<string, any>;
  reset(initialState: Record<string, any>): void;
  update(updates: Record<string, unknown>): Record<string, boolean>;
}

export interface SavedEntity {
  id: string;
  type: string;
  active: boolean;
  transform: Transform;
  components: Record<string, any>;
}

export interface SavedWorldState {
  version: string;
  timestamp: number;
  entities: SavedEntity[];
  engineState?: Record<string, any>;
  hierarchy?: Record<string, { parentId: string | null; children: string[] }>;
  systemData?: Record<string, unknown>;
  settings: {
    fog: {
      density: number;
      color: number;
      enabled: boolean;
    };
    lighting: {
      ambientIntensity: number;
      directionalIntensity: number;
    };
    camera: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      fov: number;
    };
    atmosphericEffects: {
      fogPulsing: boolean;
      lightingFlicker: boolean;
      postProcessing: boolean;
      cameraEffects: boolean;
    };
    mode: string;
  };
}

/**
 * SaveLoadManager - Handles world serialization and deserialization
 */
export class SaveLoadManager {
  private entityManager: SaveLoadEntityManagerAdapter;
  private stateManager: SaveLoadStateStoreAdapter;
  private sceneGraph: SceneGraph | null;
  private config: {
    enableLogging: boolean;
    storagePrefix: string;
  };
  private systemDataProviders = new Map<string, () => unknown>();
  private systemDataConsumers = new Map<string, (data: unknown) => void>();
  private systemContext: SystemContext | null = null;

  constructor(entityManager: SaveLoadEntityManagerAdapter, stateManager: SaveLoadStateStoreAdapter, sceneGraph: SceneGraph | null = null, options: { enableLogging?: boolean } = {}) {
    this.entityManager = entityManager;
    this.stateManager = stateManager;
    this.sceneGraph = sceneGraph;
    this.config = {
      enableLogging: options.enableLogging ?? false,
      storagePrefix: 'world_',
    };

    if (this.config.enableLogging) {
      console.log('[SaveLoadManager] Initialized');
    }
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (ctx.entityManager) {
      this.entityManager = ctx.entityManager as SaveLoadEntityManagerAdapter;
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        providerCount: this.systemDataProviders.size,
        consumerCount: this.systemDataConsumers.size,
        hasSceneGraph: this.sceneGraph !== null,
        entityCount: this.entityManager.getEntities().length,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  /**
   * Serialize current world state to JSON
   */
  serializeWorld(): SavedWorldState {
    const entitiesData = this.entityManager.serialize();
    const state = this.stateManager.getState();
    const hierarchy = this.sceneGraph
      ? Object.fromEntries([...this.sceneGraph.getAllNodes().entries()].map(([id, node]) => [id, { parentId: node.parentId ?? null, children: [...node.children] }]))
      : undefined;
    const systemData: Record<string, unknown> = {};
    for (const [key, provider] of this.systemDataProviders) {
      systemData[key] = provider();
    }

    const saved: SavedWorldState = {
      version: '2.0',
      timestamp: Engine.time.now(),
      entities: entitiesData.map((entityData) => ({
        id: entityData.id,
        type: entityData.type,
        active: entityData.active,
        transform: entityData.transform,
        components: this.serializeEntityComponents(entityData),
      })),
      engineState: this.stateManager.snapshot(),
      hierarchy,
      systemData,
      settings: {
        fog: {
          density: state.fog?.density ?? 0.015,
          color: state.fog?.color ?? 0x1a1a1a,
          enabled: state.fog?.enabled ?? true,
        },
        lighting: {
          ambientIntensity: state.lighting?.ambientIntensity ?? 0.4,
          directionalIntensity: state.lighting?.directionalIntensity ?? 0.8,
        },
        camera: {
          position: state.camera?.position ?? { x: 0, y: 5, z: 10 },
          rotation: state.camera?.rotation ?? { x: 0, y: 0, z: 0 },
          fov: state.camera?.fov ?? 75,
        },
        atmosphericEffects: {
          fogPulsing: state.atmosphericEffects?.fogPulsing ?? true,
          lightingFlicker: state.atmosphericEffects?.lightingFlicker ?? true,
          postProcessing: state.atmosphericEffects?.postProcessing ?? true,
          cameraEffects: state.atmosphericEffects?.cameraEffects ?? true,
        },
        mode: state.mode ?? 'editor',
      },
    };

    if (this.config.enableLogging) {
      console.log(`[SaveLoadManager] Serialized world: ${saved.entities.length} entities`);
    }

    gameBus.emit('persistenceLifecycle', {
      action: 'serialize',
      success: true,
      entitiesCreated: saved.entities.length,
    });

    return saved;
  }

  /**
   * Serialize entity components (remove functions, keep data)
   */
  private serializeEntityComponents(entityData: EntityData): Record<string, any> {
    const components: Record<string, any> = {};

    for (const [componentName, component] of Object.entries(entityData.components)) {
      components[componentName] = this.serializeComponent(component as Component);
    }

    return components;
  }

  /**
   * Serialize a component (remove functions, keep data)
   */
  private serializeComponent(component: Component): any {
    const serialized: any = {};

    for (const [key, value] of Object.entries(component.data)) {
      // Skip functions and Three.js objects
      if (typeof value === 'function' || (value !== null && typeof value === 'object' && value instanceof Window)) {
        continue;
      }

      // Check if it's a Three.js object
      if (value !== null && typeof value === 'object' && 'isVector3' in value) {
        // Skip Three.js objects
        continue;
      }

      serialized[key] = value;
    }

    return serialized;
  }

  /**
   * Deserialize world state and recreate entities/settings
   * NOTE: This rebuilds entities and state, but does NOT recreate Three.js meshes
   * Call entityRenderer.syncEntity() after loading to create rendering
   */
  deserializeWorld(saved: SavedWorldState): { entitiesCreated: number; settingsApplied: number } {
    let entitiesCreated = 0;
    let settingsApplied = 0;

    try {
      // Clear existing entities
      this.entityManager.clear();

      if (saved.engineState) {
        this.stateManager.reset(saved.engineState);
      }

      // Recreate entities
      this.entityManager.deserialize(saved.entities as unknown as EntityData[]);
      entitiesCreated = saved.entities.length;

      if (this.sceneGraph && saved.hierarchy) {
        for (const [entityId, node] of Object.entries(saved.hierarchy)) {
          if (node.parentId) {
            this.sceneGraph.reparent(entityId, node.parentId);
          }
        }
      }

      // Apply global settings
      const updates: Record<string, any> = {
        'fog.density': saved.settings.fog.density,
        'fog.color': saved.settings.fog.color,
        'fog.enabled': saved.settings.fog.enabled,
        'lighting.ambientIntensity': saved.settings.lighting.ambientIntensity,
        'lighting.directionalIntensity': saved.settings.lighting.directionalIntensity,
        'camera.position': saved.settings.camera.position,
        'camera.rotation': saved.settings.camera.rotation,
        'camera.fov': saved.settings.camera.fov,
        'atmosphericEffects.fogPulsing': saved.settings.atmosphericEffects.fogPulsing,
        'atmosphericEffects.lightingFlicker': saved.settings.atmosphericEffects.lightingFlicker,
        'atmosphericEffects.postProcessing': saved.settings.atmosphericEffects.postProcessing,
        'atmosphericEffects.cameraEffects': saved.settings.atmosphericEffects.cameraEffects,
        'mode': saved.settings.mode,
      };

      this.stateManager.update(updates);
      settingsApplied = Object.keys(updates).length;

      for (const [key, consumer] of this.systemDataConsumers) {
        consumer(saved.systemData?.[key]);
      }

      if (this.config.enableLogging) {
        console.log(`[SaveLoadManager] Deserialized world: ${entitiesCreated} entities, ${settingsApplied} settings`);
      }

      gameBus.emit('persistenceLifecycle', {
        action: 'deserialize',
        success: true,
        entitiesCreated,
        settingsApplied,
      });

      return { entitiesCreated, settingsApplied };
    } catch (error) {
      console.error('[SaveLoadManager] Failed to deserialize world:', error);
      gameBus.emit('persistenceLifecycle', {
        action: 'deserialize',
        success: false,
      });
      throw error;
    }
  }

  registerSystemDataHandler(key: string, provider: () => unknown, consumer: (data: unknown) => void): void {
    this.systemDataProviders.set(key, provider);
    this.systemDataConsumers.set(key, consumer);
  }

  /**
   * Save world to localStorage with a name
   */
  saveMap(name: string): boolean {
    try {
      const key = this.config.storagePrefix + name;
      const serialized = this.serializeWorld();
      const json = JSON.stringify(serialized);

      localStorage.setItem(key, json);

      if (this.config.enableLogging) {
        console.log(`[SaveLoadManager] Saved map: "${name}" (${(json.length / 1024).toFixed(2)} KB)`);
      }

      gameBus.emit('persistenceLifecycle', {
        action: 'save',
        name,
        success: true,
      });

      return true;
    } catch (error) {
      console.error('[SaveLoadManager] Failed to save map:', error);
      gameBus.emit('persistenceLifecycle', {
        action: 'save',
        name,
        success: false,
      });
      return false;
    }
  }

  /**
   * Load world from localStorage by name
   * Returns { success, entitiesCreated, settingsApplied }
   */
  loadMap(name: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
    try {
      const key = this.config.storagePrefix + name;
      const json = localStorage.getItem(key);

      if (!json) {
        console.warn(`[SaveLoadManager] Map not found: "${name}"`);
        return { success: false, entitiesCreated: 0, settingsApplied: 0 };
      }

      const saved: SavedWorldState = JSON.parse(json);
      const result = this.deserializeWorld(saved);

      if (this.config.enableLogging) {
        console.log(`[SaveLoadManager] Loaded map: "${name}"`);
      }

      gameBus.emit('persistenceLifecycle', {
        action: 'load',
        name,
        success: true,
        entitiesCreated: result.entitiesCreated,
        settingsApplied: result.settingsApplied,
      });

      return { success: true, ...result };
    } catch (error) {
      console.error('[SaveLoadManager] Failed to load map:', error);
      gameBus.emit('persistenceLifecycle', {
        action: 'load',
        name,
        success: false,
      });
      return { success: false, entitiesCreated: 0, settingsApplied: 0 };
    }
  }

  /**
   * List all saved maps
   */
  listMaps(): string[] {
    const maps: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.config.storagePrefix)) {
        const mapName = key.substring(this.config.storagePrefix.length);
        maps.push(mapName);
      }
    }

    return maps;
  }

  /**
   * Delete a saved map
   */
  deleteMap(name: string): boolean {
    try {
      const key = this.config.storagePrefix + name;
      const existed = localStorage.getItem(key) !== null;

      if (existed) {
        localStorage.removeItem(key);

        if (this.config.enableLogging) {
          console.log(`[SaveLoadManager] Deleted map: "${name}"`);
        }
      }

      gameBus.emit('persistenceLifecycle', {
        action: 'delete',
        name,
        success: existed,
      });

      return existed;
    } catch (error) {
      console.error('[SaveLoadManager] Failed to delete map:', error);
      return false;
    }
  }

  /**
   * Export current world as JSON string
   * Optionally save to localStorage with a name
   */
  exportMap(name?: string): string {
    try {
      const serialized = this.serializeWorld();
      const json = JSON.stringify(serialized, null, 2);

      if (name) {
        localStorage.setItem(this.config.storagePrefix + name, JSON.stringify(serialized));

        if (this.config.enableLogging) {
          console.log(`[SaveLoadManager] Exported and saved map: "${name}"`);
        }
      } else {
        if (this.config.enableLogging) {
          console.log(`[SaveLoadManager] Exported map as JSON (${(json.length / 1024).toFixed(2)} KB)`);
        }
      }

      return json;
    } catch (error) {
      console.error('[SaveLoadManager] Failed to export map:', error);
      gameBus.emit('persistenceLifecycle', {
        action: 'export',
        name,
        success: false,
      });
      return '';
    }
  }

  /**
   * Import world from JSON string
   * Optionally save to localStorage with a name
   */
  importMap(json: string, name?: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
    try {
      const saved: SavedWorldState = JSON.parse(json);

      // Validate format
      if (!saved.version || !saved.entities || !saved.settings) {
        throw new Error('Invalid world format');
      }

      const result = this.deserializeWorld(saved);

      // Optionally save to localStorage
      if (name) {
        localStorage.setItem(this.config.storagePrefix + name, JSON.stringify(saved));

        if (this.config.enableLogging) {
          console.log(`[SaveLoadManager] Imported and saved map: "${name}"`);
        }
      } else {
        if (this.config.enableLogging) {
          console.log(`[SaveLoadManager] Imported map from JSON`);
        }
      }

      gameBus.emit('persistenceLifecycle', {
        action: 'import',
        name,
        success: true,
        entitiesCreated: result.entitiesCreated,
        settingsApplied: result.settingsApplied,
      });

      return { success: true, ...result };
    } catch (error) {
      console.error('[SaveLoadManager] Failed to import map:', error);
      gameBus.emit('persistenceLifecycle', {
        action: 'import',
        name,
        success: false,
      });
      return { success: false, entitiesCreated: 0, settingsApplied: 0 };
    }
  }

  /**
   * Get map info
   */
  getMapInfo(name: string): SavedWorldState | null {
    try {
      const key = this.config.storagePrefix + name;
      const json = localStorage.getItem(key);

      if (!json) {
        return null;
      }

      return JSON.parse(json) as SavedWorldState;
    } catch (error) {
      console.error('[SaveLoadManager] Failed to get map info:', error);
      return null;
    }
  }
}
