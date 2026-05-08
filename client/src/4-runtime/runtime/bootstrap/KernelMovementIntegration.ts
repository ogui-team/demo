import * as THREE from 'three';
import {
  MovementIntegrateSystem,
  SimulationKernel,
  SnapshotReader,
  SnapshotWriter,
  InventorySystem,
  EntityMigrationSystem,
  ComponentMapper,
  TransactionalKernelMode,
  initTransactionalKernel,
  type EntityHandle,
} from '@engine/1-kernel/core/public-api';
import { MeshBindingTable } from '../../../2-systems/render/MeshBindingTable';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { runDOD_HealthBufferTest } from '../../tests/DOD_HealthBufferTest';
import { GameplayCommandBridge } from './GameplayCommandBridge';
import { DamageNumberUISystem } from '../../../2-systems/gameplay/systems/DamageNumberUISystem';
import { DummyEnemySystem } from '../../../2-systems/gameplay/systems/DummyEnemySystem';
import { exposeBaselineCapture } from '../../diagnostics/BaselineCapture';

interface KernelMoveCommand {
  seq: number;
  timestamp: number;
  playerId: string | null;
  moveX: number;
  moveY: number;
  moveZ: number;
  speed: number;
}

interface HUDKernelSnapshot {
  handle: EntityHandle;
  health: number;
  maxHealth: number;
  ammo: number;
}

interface KernelPlayerVitals {
  hp?: number;
  maxHp?: number;
}

export class KernelMovementIntegration {
  private readonly kernel: SimulationKernel;
  private readonly transactional: TransactionalKernelMode;
  private readonly movementSystem: MovementIntegrateSystem;
  private readonly inventorySystem: InventorySystem;
  private readonly migrationSystem: EntityMigrationSystem;
  private readonly snapshotReader: SnapshotReader;
  private readonly snapshotWriter: SnapshotWriter;
  private readonly meshBindingTable: MeshBindingTable;
  private readonly gameplayCommandBridge: GameplayCommandBridge;
  private readonly damageNumberUISystem: DamageNumberUISystem;
  private readonly dummyEnemySystem: DummyEnemySystem;
  private readonly playerHandleById = new Map<string, EntityHandle>();
  private readonly fixedStep = 1 / 60;
  private isReconciling = false;
  private accumulator = 0;
  private tickLogCount = 0;
  private dodStatusAccumulator = 0;

  constructor() {
    const { kernel, transactional } = initTransactionalKernel({
      maxEntities: 2048,
      commandCapacity: 4096,
    });
    this.kernel = kernel;
    this.transactional = transactional;

    // [PHASE 0] Expose kernel for baseline capture
    exposeBaselineCapture(this.kernel);

    // [v0.1.4] Wire health buffer test to run once on startup
    this.scheduleHealthBufferTest();

    this.movementSystem = new MovementIntegrateSystem({
      entityRegistry: this.kernel.entities,
      velocityStorage: this.kernel.velocities,
      resolveHandleByPlayerId: (playerId: string) => this.playerHandleById.get(playerId) ?? null,
      isReconciling: () => this.isReconciling,
      defaultSpeed: 6,
    });

    this.inventorySystem = new InventorySystem({
      entityRegistry: this.kernel.entities,
      inventoryStorage: this.kernel.inventories,
      resolveHandleByPlayerId: (playerId: string) => this.playerHandleById.get(playerId) ?? null,
    });

    const componentMapper = new ComponentMapper({
      positions: this.kernel.positions,
      velocities: this.kernel.velocities,
      inventories: this.kernel.inventories,
      healths: this.kernel.healths,
      abilities: this.kernel.abilities,
    });

    this.migrationSystem = new EntityMigrationSystem({
      entityRegistry: this.kernel.entities,
      componentMapper,
      createEntityForPrefab: (prefabName) => {
        // Mock: create entity with default values
        return this.kernel.createEntity(0, 0, 0);
      },
    });

    // ─ ATOMIC BINDING WATCHDOG: Pass EntityRegistry + PositionStorage to MeshBindingTable ─
    this.meshBindingTable = new MeshBindingTable(this.kernel.entities, this.kernel.positions);

    this.kernel.addSystem(this.movementSystem);
    this.snapshotReader = new SnapshotReader(this.kernel);

    // [v0.1.7] Initialize snapshot writer
    this.snapshotWriter = new SnapshotWriter();

    // [v0.1.6] Initialize gameplay command bridge
    this.gameplayCommandBridge = new GameplayCommandBridge(this.kernel, this.transactional);

    // [v0.1.5] Initialize damage number UI system
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    this.damageNumberUISystem = new DamageNumberUISystem(canvas);

    // [v0.1.6] Initialize dummy enemy system
    this.dummyEnemySystem = new DummyEnemySystem(this.kernel);

    // Listen for migration events
    gameBus.on('MIGRATE_COMPLETE', (payload: any) => {
      const { oldEntityId, newEntityId, prefabName, oldHandle, newHandle } = payload;
      
      // ─ HANDLE REBOUND: When entity handle changes, migrate mesh binding ─
      if (oldHandle != null && newHandle != null) {
        const success = this.meshBindingTable.rebind(oldHandle, newHandle);
        if (success) {
          console.log('[KernelMovementIntegration] Mesh rebind successful on migration', {
            oldEntityId,
            newEntityId,
            oldHandle,
            newHandle,
            prefabName,
          });
        } else {
          console.warn('[KernelMovementIntegration] Mesh rebind failed on migration', {
            oldEntityId,
            newEntityId,
            oldHandle,
            newHandle,
            prefabName,
          });
        }
      } else if (oldEntityId !== newEntityId) {
        // Fallback: entity ID changed, update handle mapping
        const newHandle = this.kernel.entities.getHandleByNetworkId(newEntityId);
        if (newHandle) {
          this.meshBindingTable.updateHandle(oldEntityId, newHandle);
        }
      }
    });

    gameBus.on('RECONCILIATION_BEGIN', ({ playerId, tick }) => {
      this.isReconciling = true;
      console.log('[KernelMovementIntegration] reconciliation lock enabled', {
        playerId,
        tick,
        timestamp: Date.now(),
      });
    });

    gameBus.on('RECONCILIATION_END', ({ playerId, tick, replayedInputCount }) => {
      this.isReconciling = false;
      console.log('[KernelMovementIntegration] reconciliation lock released', {
        playerId,
        tick,
        replayedInputCount,
        timestamp: Date.now(),
      });
    });
  }

  ensurePlayerHandle(playerId: string, x = 0, y = 0, z = 0): EntityHandle | null {
    const existing = this.playerHandleById.get(playerId);
    if (existing != null) {
      return existing;
    }
    const handle = this.kernel.createEntity(x, y, z);
    if (handle == null) {
      return null;
    }
    this.playerHandleById.set(playerId, handle);
    return handle;
  }

  reservePlayerHandle(playerId: string): boolean {
    const existing = this.playerHandleById.get(playerId);
    if (existing != null) {
      return true;
    }
    return this.ensurePlayerHandle(playerId, 0, 0, 0) != null;
  }

  /**
   * Register networkEntityId mapping for a player.
   * Called by NetworkSyncSystem to link networkEntityId to kernel handle.
   * Critical for SnapshotReconciler to find existing entities (prevents ghosting).
   */
  registerNetworkEntityIdMapping(playerId: string, networkEntityId: number | string, kernelHandle?: EntityHandle): boolean {
    let handle = kernelHandle;
    if (!handle) {
      // Try to get existing handle for this playerId
      handle = this.playerHandleById.get(playerId);
    }

    if (handle != null) {
      // Register the mapping in EntityRegistry
      this.kernel.entities.setNetworkId(handle, networkEntityId);
      
      if (this.playerHandleById.get(playerId) === undefined) {
        this.playerHandleById.set(playerId, handle);
      }

      console.log(
        `[KernelMovementIntegration] Registered networkEntityId="${networkEntityId}" → handle=${handle} for playerId="${playerId}"`
      );
      gameBus.emit('NETWORK_ENTITY_HANDLE_MAPPED', {
        playerId,
        networkEntityId,
        handle,
        timestamp: Date.now(),
      });
      return true;
    } else {
      console.warn(
        `[KernelMovementIntegration] Cannot register networkEntityId: no handle for playerId="${playerId}"`
      );
      return false;
    }
  }

  hasHandleForNetworkEntityId(networkEntityId: string | number): boolean {
    return this.kernel.entities.getHandleByNetworkId(networkEntityId) != null;
  }

  /**
   * Get a NetworkEntityIdRegistrar adapter for NetworkSyncSystem.
   * Enables NetworkSyncSystem to register networkEntityId mappings.
   */
  getNetworkEntityIdRegistrar() {
    return {
      reserveHandleForPlayer: (playerId: string) => this.reservePlayerHandle(playerId),
      registerNetworkEntityIdMapping: (playerId: string, networkEntityId: number | string, kernelHandle?: EntityHandle) => {
        return this.registerNetworkEntityIdMapping(playerId, networkEntityId, kernelHandle);
      },
      hasHandleForNetworkEntityId: (networkEntityId: string | number) => this.hasHandleForNetworkEntityId(networkEntityId),
    };
  }

  getPlayerHandle(playerId: string): EntityHandle | null {
    return this.playerHandleById.get(playerId) ?? null;
  }

  syncPlayerVitals(playerId: string, vitals: KernelPlayerVitals): boolean {
    const handle = this.getPlayerHandle(playerId);
    if (handle == null) {
      return false;
    }

    const denseIndex = this.kernel.entities.getDenseIndex(handle);
    if (denseIndex < 0) {
      return false;
    }

    if (typeof vitals.maxHp === 'number') {
      this.kernel.healths.setMaxHealth(denseIndex, vitals.maxHp);
    }

    if (typeof vitals.hp === 'number') {
      const maxHealth = this.kernel.healths.getMaxHealth(denseIndex);
      const clampedHealth = Math.max(0, Math.min(maxHealth, vitals.hp));
      this.kernel.healths.setHealth(denseIndex, clampedHealth);
    }

    return true;
  }

  readHUDSnapshot(playerId: string): HUDKernelSnapshot | null {
    const handle = this.getPlayerHandle(playerId);
    if (handle == null) {
      return null;
    }

    const denseIndex = this.kernel.entities.getDenseIndex(handle);
    if (denseIndex < 0) {
      return null;
    }

    return {
      handle,
      health: this.kernel.healths.getHealth(denseIndex),
      maxHealth: this.kernel.healths.getMaxHealth(denseIndex),
      ammo: this.kernel.inventories.getAmmo(denseIndex),
    };
  }

  getHudBindingAdapter() {
    return {
      resolvePlayerHandle: (playerId: string) => this.getPlayerHandle(playerId),
      readSnapshot: (playerId: string) => this.readHUDSnapshot(playerId),
    };
  }

  bindMesh(handle: EntityHandle, mesh: THREE.Mesh): void {
    this.meshBindingTable.bind(`kernel_handle_${handle}`, handle, mesh);
  }

  bindEntityMesh(entityId: string, handle: EntityHandle, mesh: THREE.Mesh): void {
    this.meshBindingTable.bind(entityId, handle, mesh);
  }

  enqueueMoveCommand(command: KernelMoveCommand): boolean {
    return this.kernel.enqueueCommand(
      command.seq,
      command.timestamp,
      'multiplayer',
      'MOVE_CMD',
      command.playerId,
      {
        moveX: command.moveX,
        moveY: command.moveY,
        moveZ: command.moveZ,
        speed: command.speed,
      },
    );
  }

  tick(dt: number): void {
    this.accumulator += dt;
    this.dodStatusAccumulator += dt;
    while (this.accumulator >= this.fixedStep) {
      this.accumulator -= this.fixedStep;
      this.kernel.tickOnce(this.fixedStep, this.movementSystem.consumeCommand, this.migrationSystem.consumeCommand);

      if (this.tickLogCount < 5 && this.kernel.entities.activeCount > 0) {
        const p = this.snapshotReader.getPositionBuffer();
        console.log('[KernelMovementIntegration] tick', this.snapshotReader.getTick(), {
          x: Number(p[0].toFixed(4)),
          y: Number(p[1].toFixed(4)),
          z: Number(p[2].toFixed(4)),
        });
        this.tickLogCount += 1;
      }

      if (this.dodStatusAccumulator >= 1) {
        this.dodStatusAccumulator = 0;
        const firstPlayerHandle = this.playerHandleById.values().next().value as EntityHandle | undefined;
        if (firstPlayerHandle != null) {
          const kinematics = this.kernel.getEntityKinematics(firstPlayerHandle);
          if (kinematics) {
            const dense = this.kernel.entities.getDenseIndex(firstPlayerHandle);
            const ammo = dense >= 0 ? this.kernel.inventories.getAmmo(dense) : 0;
            const activePhase = typeof window !== 'undefined'
              ? (window as any).lifecycleOrchestrator?.getPhase?.() ?? 'unknown'
              : 'unknown';
            console.log(
              `[DOD_STATUS] Ammo: ${ammo}, Pos: ${kinematics.position.x.toFixed(3)},${kinematics.position.y.toFixed(3)},${kinematics.position.z.toFixed(3)}, Velocity: ${kinematics.speed.toFixed(3)}, ActivePhase: ${String(activePhase)}`,
              {
                velocity: kinematics.velocity,
                handle: firstPlayerHandle,
              },
            );
          }
        }
      }
    }
  }

  syncMeshes(): void {
    this.meshBindingTable.syncFromPositionBuffer(this.snapshotReader.getPositionBuffer(), this.kernel.entities);
  }

  /**
   * Validate mesh bindings for all active entities.
   * Warns about ghost entities (spawned but not rendered).
   * Returns count of entities missing meshes.
   */
  validateMeshBindings(): number {
    let missingMeshCount = 0;
    const activeCount = this.kernel.entities.activeCount;

    for (let i = 0; i < activeCount; i++) {
      const dense = i;
      // Try to find a handle for this dense index
      // Note: This is a simple validation - in production we could map better
      const hasMesh = this.meshBindingTable.hasMeshForHandle(dense as any);
      
      if (!hasMesh && activeCount <= 10) {
        // Only warn for small entity counts to avoid spam
        console.warn(
          `[KernelMovementIntegration] ⚠️ Entity at dense=${dense} has no mesh binding (potential ghost entity)`
        );
        missingMeshCount++;
      }
    }

    if (missingMeshCount > 0) {
      console.warn(
        `[KernelMovementIntegration] ${missingMeshCount}/${activeCount} entities missing mesh bindings`
      );
    }

    return missingMeshCount;
  }

  getSnapshotReader(): SnapshotReader {
    return this.snapshotReader;
  }

  getKernel(): SimulationKernel {
    return this.kernel;
  }

  getTransactionalKernel(): TransactionalKernelMode {
    return this.transactional;
  }

  getMeshBindingTable(): MeshBindingTable {
    return this.meshBindingTable;
  }

  getGameplayCommandBridge(): GameplayCommandBridge {
    return this.gameplayCommandBridge;
  }

  getDamageNumberUISystem(): DamageNumberUISystem {
    return this.damageNumberUISystem;
  }

  getDummyEnemySystem(): DummyEnemySystem {
    return this.dummyEnemySystem;
  }

  getSnapshotWriter(): SnapshotWriter {
    return this.snapshotWriter;
  }

  /**
   * [v0.1.4 STEP 1] Health Buffer Validation Test
   * Runs once on first update to validate DOD kernel infrastructure
   */
  private scheduleHealthBufferTest(): void {
    // Delay test to let systems boot
    setTimeout(() => {
      if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        console.log('[v0.1.4] 🧪 Running Health Buffer Validation Test');
        runDOD_HealthBufferTest(this.kernel, this.transactional);
      }
    }, 500);
  }
}
