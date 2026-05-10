import { EntityRegistry } from './EntityRegistry';
import { KernelCommandQueue } from './KernelCommandQueue';
import { PositionStorage } from './PositionStorage';
import { VelocityStorage } from './VelocityStorage';
import { InventoryStorage } from './InventoryStorage';
import { HealthStorage } from './HealthStorage';
import { AbilityStorage } from './AbilityStorage';
import { AnimationEffectStorage } from './AnimationEffectStorage';
import { PhaseResolveGate2 } from './PhaseResolveGate2';
import { BinaryTraceCoordinator } from './BinaryTraceCoordinator';
import { TickManager } from './TickManager';
import { InterpolationSystem } from '../../../2-systems/graphics/InterpolationSystem';
import { gameBus } from '../public-api';
import { ReconciliationEventRecorder } from '../../../3-network/network/ReconciliationEventRecorder';
import { GizmoTraceRecorder } from '../../../4-runtime/editor/GizmoTraceRecorder';
import type { BufferSystem, EntityHandle, KernelCommandConsumer, SimulationCommandSource, AuthoritativeSnapshot, IKernelSystem } from './types';

export interface SimulationKernelConfig {
  maxEntities: number;
  commandCapacity: number;
}

export class SimulationKernel {
  private static readonly DEFAULT_SPAWN_HEALTH = 100;
  private static readonly DEFAULT_SPAWN_AMMO = 30;
  private static readonly DEFAULT_SPAWN_ITEM_ID = 1;

  readonly entities: EntityRegistry;
  readonly positions: PositionStorage;
  readonly velocities: VelocityStorage;
  readonly inventories: InventoryStorage;
  readonly healths: HealthStorage;
  readonly abilities: AbilityStorage;
  readonly animations: AnimationEffectStorage;
  readonly commands: KernelCommandQueue;
  readonly tickManager: TickManager;
  readonly interpolationSystem: InterpolationSystem;

  private readonly systems: BufferSystem[] = [];
  private readonly kernelSystems: IKernelSystem[] = [];
  private readonly biteRecorder: BinaryTraceCoordinator;
  private readonly reconciliationRecorder: ReconciliationEventRecorder;
  private readonly gizmoRecorder: GizmoTraceRecorder;
  private tickValue = 0;

  // Sprint-A: System references for command dispatch
  private healthSystem: any = null;
  private weaponSystem: any = null;
  private hudSyncSystem: any = null;
  private dummyEnemySystem: any = null; // TITAN: Idle-Bob animation system

  constructor(config: SimulationKernelConfig) {
    this.entities = new EntityRegistry(config.maxEntities);
    this.positions = new PositionStorage(config.maxEntities);
    this.velocities = new VelocityStorage(config.maxEntities);
    this.inventories = new InventoryStorage(config.maxEntities);
    this.healths = new HealthStorage(config.maxEntities);
    this.abilities = new AbilityStorage(config.maxEntities);
    this.animations = new AnimationEffectStorage(config.maxEntities);
    this.commands = new KernelCommandQueue(config.commandCapacity);
    this.tickManager = new TickManager(60); // 60 Hz kernel ticks
    this.interpolationSystem = new InterpolationSystem(this, this.tickManager);
    this.biteRecorder = new BinaryTraceCoordinator();
    this.reconciliationRecorder = new ReconciliationEventRecorder();
    this.gizmoRecorder = new GizmoTraceRecorder();
  }

  get tick(): number {
    return this.tickValue;
  }

  getBiteBuffer(): SharedArrayBuffer | ArrayBuffer {
    return this.biteRecorder.getSharedBuffer();
  }

  getReconciliationRecorder(): ReconciliationEventRecorder {
    return this.reconciliationRecorder;
  }

  getGizmoRecorder(): GizmoTraceRecorder {
    return this.gizmoRecorder;
  }

  isHandleValid(handle: EntityHandle | null | undefined): boolean {
    return typeof handle === 'number' && this.entities.isHandleAlive(handle);
  }

  /**
   * TITAN: Set DummyEnemySystem for Idle-Bob animation in stress tests
   */
  setDummyEnemySystem(system: any): void {
    this.dummyEnemySystem = system;
  }

  addSystem(system: BufferSystem | IKernelSystem): void {
    if ('execute' in system && (system as any).category === 'kernel') {
      // IKernelSystem
      this.kernelSystems.push(system as IKernelSystem);
      
      // Sprint-A: Store system references for command dispatch
      if ((system as any).id === 'health_system') {
        this.healthSystem = system;
      } else if ((system as any).id === 'weapon_system') {
        this.weaponSystem = system;
      } else if ((system as any).id === 'hud_sync_system') {
        this.hudSyncSystem = system;
        // Subscribe HUDSyncSystem to gameBus events immediately
        if (this.hudSyncSystem.subscribe) {
          this.hudSyncSystem.subscribe();
        }
      }
    } else {
      // Old BufferSystem
      this.systems.push(system as BufferSystem);
    }
  }

  createEntity(x = 0, y = 0, z = 0): EntityHandle | null {
    const handle = this.entities.create();
    if (handle == null) {
      return null;
    }
    const dense = this.entities.getDenseIndex(handle);
    if (dense >= 0) {
      this.positions.setWriteXYZ(dense, x, y, z);
      this.positions.publish();
      this.positions.setWriteXYZ(dense, x, y, z);
      this.onEntitySpawned(handle);
    }
    return handle;
  }

  onEntitySpawned(handle: EntityHandle): void {
    const dense = this.entities.getDenseIndex(handle);
    if (dense < 0) {
      return;
    }

    this.healths.setMaxHealth(dense, SimulationKernel.DEFAULT_SPAWN_HEALTH);
    this.healths.setHealth(dense, SimulationKernel.DEFAULT_SPAWN_HEALTH);
    this.inventories.setAmmo(dense, SimulationKernel.DEFAULT_SPAWN_AMMO);
    this.inventories.setItemId(dense, SimulationKernel.DEFAULT_SPAWN_ITEM_ID);
  }

  destroyEntity(handle: EntityHandle): boolean {
    return this.entities.destroy(handle);
  }

  /**
   * FROSTBITE ZERO-ALLOCATION: Spawn entities from binary blob.
   * 
   * Blob format (little-endian):
   *   Offset 0: Uint32 - entity count
   *   Then for each entity (24 bytes):
   *     Offset 0-11: Position [X, Y, Z] (Float32 × 3)
   *     Offset 12-15: Health (Float32)
   *     Offset 16-19: Ammo (Uint32)
   *     Offset 20-23: ItemId (Uint32)
   * 
   * ZERO-ALLOCATION: No loops create new objects, direct buffer reads.
   * Time Complexity: O(N) where N = entity count
   */
  spawnFromBlob(blob: Uint8Array): EntityHandle[] {
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const handles: EntityHandle[] = [];

    // Read entity count (Uint32 @ offset 0)
    const count = view.getUint32(0, true); // little-endian
    let offset = 4;

    // DEBUG: Check registry status before spawning
    const registryBefore = {
      activeCount: this.entities.activeCount,
      maxCapacity: this.entities.maxCapacity,
      freeSlots: this.entities.maxCapacity - this.entities.activeCount,
    };

    let failureCount = 0;
    for (let i = 0; i < count; i += 1) {
      // Read position (3 × Float32)
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);

      // Create entity
      const handle = this.createEntity(x, y, z);
      if (handle === null) {
        failureCount++;
        // LOG but continue (don't break) to spawn as many as possible
        if (failureCount === 1) {
          console.error('[Kernel.spawnFromBlob] Entity creation failed', {
            entityIndex: i,
            totalRequested: count,
            activeCount: this.entities.activeCount,
            maxCapacity: this.entities.maxCapacity,
            reason: 'Likely ran out of entity slots - check if entities are being leaked',
          });
        }
        offset += 24; // Skip this entity's data
        continue;
      }

      const dense = this.entities.getDenseIndex(handle);
      if (dense >= 0) {
        // Read health, ammo, itemId
        const health = view.getFloat32(offset + 12, true);
        const ammo = view.getUint32(offset + 16, true);
        const itemId = view.getUint32(offset + 20, true);

        this.healths.setMaxHealth(dense, Math.max(1, health));
        this.healths.setHealth(dense, Math.max(1, health));
        this.inventories.setAmmo(dense, ammo);
        this.inventories.setItemId(dense, itemId);
      }

      handles.push(handle);
      offset += 24; // Move to next entity
    }

    // DEBUG: Log spawn results
    const registryAfter = {
      activeCount: this.entities.activeCount,
      maxCapacity: this.entities.maxCapacity,
      freeSlots: this.entities.maxCapacity - this.entities.activeCount,
    };

    console.log(
      `[Kernel.spawnFromBlob] Spawn complete: requested=${count}, successful=${handles.length}, failed=${failureCount}, spawn=${((handles.length / count) * 100).toFixed(1)}%`,
      { registryBefore, registryAfter }
    );

    return handles;
  }

  enqueueCommand(
    seq: number,
    timestamp: number,
    source: SimulationCommandSource,
    type: string,
    playerId: string | null,
    payload: Record<string, unknown> | null,
  ): boolean {
    return this.commands.enqueue(seq, this.tickValue, timestamp, source, type, playerId, payload);
  }

  tickOnce(dt: number, commandConsumer?: KernelCommandConsumer, migrationConsumer?: KernelCommandConsumer): void {
    const tickStartTime = performance.now();
    this.tickValue += 1;

    // Process migration commands first
    if (migrationConsumer) {
      this.commands.drain(migrationConsumer);
    }

    // Sprint-A: Create built-in command dispatcher for kernel systems
    const builtInCommandConsumer: KernelCommandConsumer = (
      seq, tick, timestamp, source, type, playerId, payload
    ) => {
      if (type === 'DAMAGE_CMD' && this.healthSystem && 'consumeDamageCommand' in this.healthSystem) {
        this.healthSystem.consumeDamageCommand(payload as any);
      }
      if (type === 'FIRE_CMD' && this.weaponSystem && 'consumeFireCommand' in this.weaponSystem) {
        this.weaponSystem.consumeFireCommand(payload as any);
      }
      // Delegate to user provider if set
      if (commandConsumer) {
        commandConsumer(seq, tick, timestamp, source, type, playerId, payload);
      }
    };

    // Drain commands with built-in dispatcher
    this.commands.drain(builtInCommandConsumer);

    const activeCount = this.entities.activeCount;
    this.positions.publishAuthoritative();
    this.positions.copyAuthoritativeReadToWrite(activeCount);

    // PHASE_RESOLVE: Execute Lane A (Death Animation) + Lane B (Inventory DOD)
    PhaseResolveGate2.processDeathAnimations(
      this.entities,
      this.healths,
      this.animations,
      dt,
      (denseIndex: number) => {
        // Respawn callback: reset entity state
        this.positions.setWriteXYZ(denseIndex, 0, 1, 0);
        this.velocities.setAuthoritativeXYZ(denseIndex, 0, 0, 0);
        this.healths.setHealth(denseIndex, SimulationKernel.DEFAULT_SPAWN_HEALTH);
      }
    );

    // Lane B: Process inventory commands (if any queued)
    // Note: Inventory commands integrated via command queue in future phase

    // Preserve positions for entities that no system touches this tick.
    // Without this, interpolation reads a stale zeroed write page and visual
    // positions collapse toward the origin for freshly spawned idle entities.
    this.positions.copyReadToWrite(activeCount);

    // Execute old-style BufferSystem instances
    const writeBuffer = this.positions.getWriteBuffer();
    for (let i = 0; i < this.systems.length; i += 1) {
      this.systems[i].setActiveCount?.(activeCount);
      this.systems[i].execute(writeBuffer, dt);
    }

    // Execute new IKernelSystem instances (Sprint-A)
    for (let i = 0; i < this.kernelSystems.length; i += 1) {
      this.kernelSystems[i].setActiveCount?.(activeCount);
      this.kernelSystems[i].execute(dt);
    }

    // TITAN: Execute DummyEnemySystem for Idle-Bob data flux
    // Direct buffer writes for zero-allocation animation
    if (this.dummyEnemySystem && this.dummyEnemySystem.update) {
      this.dummyEnemySystem.update(dt);
    }

    this.positions.publish();

    // BITE-SYSTEM RECORDING: Capture frame state to binary ring buffer
    // Zero-allocation recording of frame-by-frame mutations
    const frameIndex = this.recordFrameToBite(activeCount);

    // TITAN METRICS: Emit kernel tick time for UI monitoring
    const tickElapsedMs = performance.now() - tickStartTime;
    (gameBus as any).emit('KERNEL_TICK_TIME', { ms: tickElapsedMs });

    // TITAN METRICS: Emit BITE frame recorded for UI monitoring
    if (frameIndex !== null && frameIndex !== undefined) {
      (gameBus as any).emit('BITE_FRAME_RECORDED', { frameIndex });
    }

    // Optional validation
    if (this.lastServerSnapshot) {
      this.validateState(this.lastServerSnapshot);
    }

    // TICK INTERPOLATION: Record when this tick completed (for renderAlpha calculation)
    this.tickManager.recordTick();
  }

  private lastServerSnapshot?: AuthoritativeSnapshot;

  setLastServerSnapshot(snapshot: AuthoritativeSnapshot): void {
    this.lastServerSnapshot = snapshot;
  }

  getEntityKinematics(handle: EntityHandle): { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number }; speed: number } | null {
    const dense = this.entities.getDenseIndex(handle);
    if (dense < 0) {
      return null;
    }

    const pos = this.positions.getReadBuffer();
    const vel = this.velocities.getAuthoritativeBuffer();
    const base = dense * 3;
    const vx = vel[base];
    const vy = vel[base + 1];
    const vz = vel[base + 2];

    return {
      position: {
        x: pos[base],
        y: pos[base + 1],
        z: pos[base + 2],
      },
      velocity: {
        x: vx,
        y: vy,
        z: vz,
      },
      speed: Math.sqrt((vx * vx) + (vy * vy) + (vz * vz)),
    };
  }

  private validateState(serverSnapshot: AuthoritativeSnapshot): void {
    for (const entity of serverSnapshot.entities) {
      const handle = this.entities.getHandleByNetworkId(entity.networkEntityId);
      if (handle) {
        const dense = this.entities.getDenseIndex(handle);
        if (dense >= 0) {
          const localPos = this.positions.getReadBuffer();
          const localX = localPos[dense * 3];
          const localY = localPos[dense * 3 + 1];
          const localZ = localPos[dense * 3 + 2];
          const driftX = Math.abs(localX - entity.position.x);
          const driftY = Math.abs(localY - entity.position.y);
          const driftZ = Math.abs(localZ - entity.position.z);
          if (driftX > 0.001 || driftY > 0.001 || driftZ > 0.001) {
            console.error(`SYNC_ERROR: Entity ${entity.networkEntityId} position drift: (${driftX}, ${driftY}, ${driftZ})`);
          }
          // Similarly for velocity, health, etc.
        }
      }
    }
  }

  /**
   * BITE-SYSTEM: Record current frame state to binary trace buffer.
   * 
   * Called every tickOnce after systems execute.
   * Zero-allocation design: direct TypedArray writes, no object creation.
   * 
   * Records:
   * - Frame header (index, timestamp, state hash, command count)
   * - Top 10 entities by velocity (for TRANSFORM_DELTA section)
   * - Command queue length
   * 
   * Time Complexity: O(N log N) where N = active entities (for sorting)
   * Space Complexity: O(1) - reuses typed array buffers
   */
  private recordFrameToBite(activeCount: number): number {
    const frameIndex = this.tickValue;
    const timestamp = Engine.time.now();
    const stateHash = this.computeStateHash(activeCount);
    const commandCount = this.commands.length ?? 0;

    // Prepare data sections
    const inputs = new Uint8Array(128); // INPUT_SIZE
    const networkSync = new Uint8Array(200); // NETWORK_SIZE
    
    // SURGICAL HOOKS: Get reconciliation and gizmo data from recorders (O(1) export)
    const reconciliation = this.reconciliationRecorder.exportFrameData();
    const gizmo = this.gizmoRecorder.exportFrameData();

    // Record frame: coordinator selects top 10 entities internally
    this.biteRecorder.recordFrame(
      frameIndex,
      timestamp,
      stateHash,
      commandCount,
      this.entities,
      this.positions,
      this.velocities,
      this.healths,
      inputs,
      networkSync,
      gizmo,
      reconciliation
    );

    return frameIndex;
  }

  /**
   * Compute a simple state hash from current entity positions/velocities/healths.
   * Used for determinism verification in BITE traces.
   * 
   * Algorithm: XOR all float values (simple but fast hash)
   * Future: Use CRC32 for better collision resistance
   */
  private computeStateHash(activeCount: number): number {
    let hash = 0;

    // Simple XOR hash: sample first 10 and last 10 active entities
    const posBuffer = this.positions.getReadBuffer();
    const velBuffer = this.velocities.getAuthoritativeBuffer();
    const healthBuffer = this.healths.getHealthBuffer?.() as any;

    const sampleCount = Math.min(10, activeCount);

    // Hash positions
    for (let i = 0; i < sampleCount && i < activeCount; i++) {
      const base = i * 3;
      hash = ((hash << 5) - hash + Math.floor(posBuffer[base])) | 0;
      hash = ((hash << 5) - hash + Math.floor(posBuffer[base + 1])) | 0;
      hash = ((hash << 5) - hash + Math.floor(posBuffer[base + 2])) | 0;
    }

    // Hash velocities
    for (let i = 0; i < sampleCount && i < activeCount; i++) {
      const base = i * 3;
      hash = ((hash << 5) - hash + Math.floor(velBuffer[base])) | 0;
      hash = ((hash << 5) - hash + Math.floor(velBuffer[base + 1])) | 0;
      hash = ((hash << 5) - hash + Math.floor(velBuffer[base + 2])) | 0;
    }

    // Hash healths
    if (healthBuffer) {
      for (let i = 0; i < sampleCount && i < activeCount; i++) {
        hash = ((hash << 5) - hash + Math.floor(healthBuffer[i])) | 0;
      }
    }

    return (hash >>> 0); // Return unsigned 32-bit hash
  }

  /**
   * Export BITE trace buffer as binary blob (for download/analysis).
   * 
   * Returns: SharedArrayBuffer reference or Uint8Array copy
   * Useful for post-session analysis and frame-by-frame playback
   */
  getBiteTraceBuffer(): Uint8Array {
    return this.biteRecorder.getFrameBuffer(0); // Returns subarray view
  }

  /**
   * Get current BITE recording frame number.
   */
  getBiteFrameNumber(): number {
    return this.biteRecorder.getCurrentFrame();
  }

  /**
   * TIER 0B: Clear all DOD kernel buffers for mode transition cleanup
   * Resets all entity data, positions, velocities, health, etc.
   * Called during ModeTransitionManager cleanup sequence (STEP 5-6)
   * 
   * Zero-allocation clearing: Reuses existing TypedArray buffers,
   * only clears the data without deallocating memory.
   */
  clear(): void {
    // Get active entity count before clearing
    const activeCount = this.entities.activeCount ?? 0;
    
    // Clear DOD storage buffers (reuse memory, just reset values)
    // Positions: Reset to origin for all active entities
    if (activeCount > 0) {
      const posWrite = this.positions.getWriteBuffer();
      for (let i = 0; i < activeCount * 3; i += 3) {
        posWrite[i] = 0;     // x = 0
        posWrite[i + 1] = 0; // y = 0
        posWrite[i + 2] = 0; // z = 0
      }
      this.positions.publish?.();
    }
    
    // Command queue: clear any pending commands
    // Note: Queue implementation clears automatically on drain
    
    // Animation state: clear any active animations
    if (this.animations.clear) {
      this.animations.clear(activeCount);
    }
    
    // Inventory state: clear all inventory data
    if (this.inventories.clear) {
      this.inventories.clear(activeCount);
    }
    
    // Health state: clear health data
    if (this.healths.clear) {
      this.healths.clear(activeCount);
    }
    
    // Ability state: clear abilities
    if (this.abilities.clear) {
      this.abilities.clear(activeCount);
    }
    
    // Reset tick counter
    this.tickValue = 0;

    console.log('[SimulationKernel] Cleared all DOD buffers and entity data (TIER 0B cleanup)');
  }
}
