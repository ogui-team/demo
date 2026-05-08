import type {
  Entity,
  EntityManager,
  EntityRenderer,
  SystemCapabilities,
  SystemContext,
  Vector3,
} from '@engine/1-kernel/core/public-api';
import { cancelAIControllerPath, type AIControllerComponent } from '../game/components/AIControllerComponent';
import type { SpatialGridSystem } from './SpatialGridSystem';
import { setEntityRuntimeLifecycleState } from './RuntimeLifecycle';

interface SimulationActivationOptions {
  spatialGrid: SpatialGridSystem;
  entityManager: EntityManager;
  entityRenderer?: EntityRenderer | null;
  getFocusPosition: () => Vector3 | null;
  activationRadius?: number;
  updateInterval?: number;
}

const CELL_DIAGONAL_FACTOR = Math.SQRT2 * 0.5;

export class SimulationActivationSystem {
  private readonly spatialGrid: SpatialGridSystem;
  private readonly entityManager: EntityManager;
  private readonly entityRenderer: EntityRenderer | null;
  private readonly getFocusPosition: () => Vector3 | null;
  private readonly updateInterval: number;
  private activationRadius: number;
  private enabled = true;
  private timer = 0;
  private systemContext: SystemContext | null = null;
  private readonly activeEntities = new Map<string, boolean>();
  private lastActiveEntities = 0;
  private lastSleepingEntities = 0;
  private lastSleepingAiEntities = 0;
  private lastAiTickCount = 0;
  private totalAiTicks = 0;

  constructor(options: SimulationActivationOptions) {
    this.spatialGrid = options.spatialGrid;
    this.entityManager = options.entityManager;
    this.entityRenderer = options.entityRenderer ?? null;
    this.getFocusPosition = options.getFocusPosition;
    this.activationRadius = Math.max(1, options.activationRadius ?? 50);
    this.updateInterval = Math.max(0.02, options.updateInterval ?? 0.1);
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setActivationRadius(radius: number): void {
    this.activationRadius = Math.max(1, radius);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.timer += dt;
    if (this.timer < this.updateInterval) return;
    this.timer = 0;

    const focus = this.getFocusPosition();
    if (!focus) return;

    const paddedRadius = this.activationRadius + (this.spatialGrid.getCellSize() * CELL_DIAGONAL_FACTOR);
    const paddedRadiusSq = paddedRadius * paddedRadius;

    let activeCount = 0;
    let sleepingCount = 0;
    let sleepingAiCount = 0;
    let aiTickCount = 0;

    for (const cell of this.spatialGrid.getCells()) {
      const centerX = (cell.bounds.minX + cell.bounds.maxX) * 0.5;
      const centerZ = (cell.bounds.minZ + cell.bounds.maxZ) * 0.5;
      const dx = centerX - focus.x;
      const dz = centerZ - focus.z;
      const cellActive = (dx * dx) + (dz * dz) <= paddedRadiusSq;
      this.spatialGrid.setCellActive(cell.id, cellActive);

      for (const entityId of cell.entities) {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity) {
          this.activeEntities.delete(entityId);
          continue;
        }

        const shouldBeActive = this.isAlwaysActiveEntity(entity) ? true : cellActive;
        this.applyActivationState(entity, shouldBeActive);
        if (this.isAiEntity(entity) && shouldBeActive) {
          aiTickCount += 1;
        }
        if (this.isAiEntity(entity) && !shouldBeActive) {
          sleepingAiCount += 1;
        }
        if (shouldBeActive) activeCount += 1;
        else sleepingCount += 1;
      }
    }

    this.lastActiveEntities = activeCount;
    this.lastSleepingEntities = sleepingCount;
    this.lastSleepingAiEntities = sleepingAiCount;
    this.lastAiTickCount = aiTickCount;
    this.totalAiTicks += aiTickCount;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      activationRadius: this.activationRadius,
      trackedEntities: this.activeEntities.size,
      activeEntities: this.lastActiveEntities,
      sleepingEntities: this.lastSleepingEntities,
      sleepingAiEntities: this.lastSleepingAiEntities,
      aiTickCount: this.lastAiTickCount,
      totalAiTicks: this.totalAiTicks,
      updateInterval: this.updateInterval,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: this.getDiagnostics(),
    };
  }

  dispose(): void {
    this.activeEntities.clear();
    this.enabled = false;
  }

  private isAlwaysActiveEntity(entity: Entity): boolean {
    const type = entity.type.toLowerCase();
    return type.includes('player') || entity.hasComponent('localPlayer');
  }

  private isAiEntity(entity: Entity): boolean {
    return entity.hasComponent('ai') || entity.hasComponent('enemyAI') || entity.hasComponent('aiController');
  }

  private applyActivationState(entity: Entity, active: boolean): void {
    const previous = this.activeEntities.get(entity.id);
    if (previous === active) return;

    setEntityRuntimeLifecycleState(entity, active ? 'loaded' : 'dormant', {
      chunkId: this.spatialGrid.getCellForEntity(entity.id) ?? null,
      reason: active ? 'activation_enter' : 'activation_sleep',
    });
    this.activeEntities.set(entity.id, active);

    const ai = entity.getComponent('ai') ?? entity.getComponent('enemyAI');
    if (ai?.data) {
      ai.data.sleeping = !active;
      ai.data.active = active;
    }

    const animation = entity.getComponent('animation') ?? entity.getComponent('animator');
    if (animation?.data) {
      animation.data.paused = !active;
    }

    const physics = entity.getComponent('physics') ?? entity.getComponent('rigidbody');
    if (physics?.data) {
      physics.data.sleeping = !active;
      physics.data.active = active;
    }

    const aiController = entity.getComponent('aiController')?.data as AIControllerComponent | undefined;
    if (aiController && !active) {
      cancelAIControllerPath(aiController, 'dormant');
    }

    this.applySleepingVisual(entity, !active);
  }

  private applySleepingVisual(entity: Entity, sleeping: boolean): void {
    const mesh = this.entityRenderer?.getMeshForEntity(entity.id);
    if (!mesh) return;

    mesh.userData.spatialSleeping = sleeping;
    mesh.traverse((child) => {
      const meshChild = child as {
        material?: unknown;
        userData: Record<string, unknown>;
      };
      const material = meshChild.material as
        | { color?: { getHex: () => number; setHex: (value: number) => void }; emissiveIntensity?: number }
        | Array<{ color?: { getHex: () => number; setHex: (value: number) => void }; emissiveIntensity?: number }>
        | undefined;
      if (!material) return;

      const applyToMaterial = (entry: { color?: { getHex: () => number; setHex: (value: number) => void }; emissiveIntensity?: number }) => {
        if (!entry.color) return;
        if (meshChild.userData.spatialBaseColorHex === undefined) {
          meshChild.userData.spatialBaseColorHex = entry.color.getHex();
        }
        if (meshChild.userData.spatialBaseEmissiveIntensity === undefined) {
          meshChild.userData.spatialBaseEmissiveIntensity = typeof entry.emissiveIntensity === 'number' ? entry.emissiveIntensity : 0;
        }

        if (sleeping) {
          const base = Number(meshChild.userData.spatialBaseColorHex) | 0;
          const r = (base >> 16) & 0xff;
          const g = (base >> 8) & 0xff;
          const b = base & 0xff;
          const darkened = ((Math.floor(r * 0.55) & 0xff) << 16)
            | ((Math.floor(g * 0.55) & 0xff) << 8)
            | (Math.floor(b * 0.55) & 0xff);
          entry.color.setHex(darkened);
          if (typeof entry.emissiveIntensity === 'number') {
            entry.emissiveIntensity = Number(meshChild.userData.spatialBaseEmissiveIntensity) * 0.35;
          }
        } else {
          entry.color.setHex(Number(meshChild.userData.spatialBaseColorHex));
          if (typeof entry.emissiveIntensity === 'number') {
            entry.emissiveIntensity = Number(meshChild.userData.spatialBaseEmissiveIntensity);
          }
        }
      };

      if (Array.isArray(material)) {
        material.forEach(applyToMaterial);
      } else {
        applyToMaterial(material);
      }
    });
  }
}
