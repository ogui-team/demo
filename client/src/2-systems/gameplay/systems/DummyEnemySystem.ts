/**
 * DummyEnemySystem.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * v0.2.0 Gameplay: Spawn dummy enemies that take damage
 * 
 * - Call spawnDummy(position) to create individual dummies
 * - Call spawnArmyFromBlob(count) for FROSTBITE zero-allocation batch spawning
 * - Enemies have health backed by kernel buffer
 * - Enemies can be damaged via damage events
 * - Enemies die when health reaches 0
 * - Enemies are rendered as 2D sprites in the game world
 */

import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { EntityHandle, SimulationKernel } from '@engine/1-kernel/core/public-api';
import { createAIControllerComponent } from '../game/components/AIControllerComponent';
import { createBoxCollider } from '../game/components/ColliderComponent';
import { BinaryEntityTemplate } from './BinaryEntityTemplate';
import type { SpriteComponentData } from '../../../4-runtime/ui/2d/TwoDTypes';
import type { Vector3 as Vec3 } from '@shared/contracts';

interface DummyHealthSystemAdapter {
  get(entityId: string): { hp: number; maxHp: number; isDead?: boolean } | undefined;
  register(entityId: string, config?: { maxHp?: number; revivable?: boolean }): { hp: number; maxHp: number };
  syncVitals?(entityId: string, vitals: { hp?: number; maxHp?: number }): void;
  unregister?(entityId: string): void;
  applyDamage?(targetId: string, opts: { amount: number; type?: string; sourceId?: string }): number;
}

interface DummyPhysicsBodyAdapter {
  position: { x: number; y: number; z: number };
}

interface DummyPhysicsSystemAdapter {
  addBody(id: string, config: { shape: 'aabb' | 'sphere'; halfExtents?: { x: number; y: number; z: number }; radius?: number; layer?: string; isStatic?: boolean; isTrigger?: boolean; isSensor?: boolean }): void;
  getBody(id: string): DummyPhysicsBodyAdapter | undefined;
  removeBody(id: string): void;
}

interface DummyPathfindingAdapter {
  findPath(start: Vec3, end: Vec3): Vec3[];
  isWalkableWorld?(position: Vec3): boolean;
}

interface DummyCollisionAuthorityAdapter {
  batchUpsertDynamicColliders(entries: Array<{ id: string; position: Vec3; halfExtents: Vec3 }>): void;
  removeDynamicCollider(id: string): void;
}

export type DummyEnemyVariantId = 'decay-husk' | 'canopy-stalker' | 'rot-mask';

interface DummyEnemyVariantDefinition {
  maxHealth: number;
  moveSpeed: number;
  renderColor: number;
  emissive: number;
  emissiveIntensity: number;
  hitFlash: number;
  scale: { x: number; y: number; z: number };
  geometry: { width: number; height: number; depth: number };
  projectileColor?: number;
  projectileEmissive?: number;
}

const DUMMY_ENEMY_VARIANTS: Record<DummyEnemyVariantId, DummyEnemyVariantDefinition> = {
  'decay-husk': {
    maxHealth: 58,
    moveSpeed: 2.18,
    renderColor: 0x6d7f58,
    emissive: 0x23311f,
    emissiveIntensity: 0.56,
    hitFlash: 0xd7efad,
    scale: { x: 1.05, y: 1.08, z: 1.05 },
    geometry: { width: 0.44, height: 1.1, depth: 0.34 },
  },
  'canopy-stalker': {
    maxHealth: 64,
    moveSpeed: 2.68,
    renderColor: 0x3f7d4f,
    emissive: 0x173621,
    emissiveIntensity: 0.66,
    hitFlash: 0xbde7a4,
    scale: { x: 0.96, y: 1.02, z: 0.96 },
    geometry: { width: 0.39, height: 1.02, depth: 0.3 },
  },
  'rot-mask': {
    maxHealth: 72,
    moveSpeed: 0,
    renderColor: 0x848b5b,
    emissive: 0x2f4528,
    emissiveIntensity: 0.82,
    hitFlash: 0xe1f1b8,
    scale: { x: 1.08, y: 1.08, z: 1.08 },
    geometry: { width: 0.46, height: 1.0, depth: 0.24 },
    projectileColor: 0xd0dc78,
    projectileEmissive: 0x7ea84b,
  },
};

function getDummyEnemyVariant(variantId: DummyEnemyVariantId): DummyEnemyVariantDefinition {
  return DUMMY_ENEMY_VARIANTS[variantId] ?? DUMMY_ENEMY_VARIANTS['decay-husk'];
}

export interface DummyEnemy {
  handle: EntityHandle;
  denseIndex: number;
  position: [number, number, number];
  baseY: number; // Base Y position for idle-bob calculations (CRITICAL FIX)
  isDead: boolean;
  createdAt: number;
  hitFlashTimer: number;
  deathTimer: number;
  corpseBlockerTimer?: number;
  visualEntityId?: string | null;
  visualEntity?: any; // Reference to entityManager entity
  enemyType: 'default' | 'flyingMask';
  variantId: DummyEnemyVariantId;
  orbitPhase?: number;
  orbitRadius?: number;
  shootTimer?: number;
  shotEffectEntityId?: string | null;
  meleeCooldown?: number; // seconds until next melee hit
  armL?: any;            // left arm pivot (THREE.Object3D) for animation
  armR?: any;            // right arm pivot (THREE.Object3D) for animation
  path?: Vec3[];         // current A* waypoints
  pathIndex?: number;    // index into path array
  pathRefreshTimer?: number; // countdown until next path recalculation
  pendingCleanup?: boolean;
}

export class DummyEnemySystem {
  private kernel: SimulationKernel;
  private dummies: Map<EntityHandle, DummyEnemy> = new Map();
  private pendingKernelCleanupHandles: EntityHandle[] = [];
  private projectileEffects: Array<{
    entityId: string;
    age: number;
    lifetime: number;
    start: [number, number, number];
    end: [number, number, number];
    targetPlayerId: string | null;
    sourceId: string;
    impactRadius: number;
  }> = [];
  private idleBobTime: number = 0; // Accumulator for sine-wave bobbing
  private idleBobActive: boolean = false; // Enable/disable bobbing
  private readonly IDLE_BOB_FREQUENCY = 2.0; // Hz (cycles per second)
  private readonly IDLE_BOB_AMPLITUDE = 0.5; // World units vertical bob
  private readonly FLYING_MASK_ORBIT_SPEED = Math.PI * 0.28; // radians per second (one orbit ~22 s)
  private readonly FLYING_MASK_BASE_HEIGHT = 2.15; // above player
  private readonly FLYING_MASK_SHOOT_INTERVAL_MIN = 1.4;
  private readonly FLYING_MASK_SHOOT_INTERVAL_MAX = 2.0;
  private readonly FLYING_MASK_DAMAGE = 14;
  private readonly FLYING_MASK_PROJECTILE_LIFETIME = 0.92;
  private entityManager: any = null; // Reference to EntityManager for rendering
  private healthSystem: DummyHealthSystemAdapter | null = null;
  private physicsSystem: DummyPhysicsSystemAdapter | null = null;
  private kernelInitialized: boolean = false; // WATCHDOG: Track kernel readiness
  localPlayerId: string | null = null; // Authoritative playerId key used by HealthSystem (public for debug menu)
  private localPlayerIdResolver: (() => string | null) | null = null; // Fallback resolver for active player ID
  private pathfindingSystem: DummyPathfindingAdapter | null = null;
  private collisionAuthoritySystem: DummyCollisionAuthorityAdapter | null = null;

  constructor(kernel: SimulationKernel, entityManager?: any) {
    this.kernel = kernel;
    this.entityManager = entityManager || null;
    this.kernelInitialized = !!kernel && !!kernel.positions && !!kernel.velocities; // WATCHDOG CHECK

    // CRITICAL: Expose system globally so EntityRenderer can discover the kernel
    // This enables lazy-loading of kernel reference in the render loop
    (globalThis as any).__dummyEnemySystem = this;

    // Capture the authoritative player ID as soon as the local player is actualized.
    // HealthSystem registers entities under playerId, not entityId, so we must use this key.
    gameBus.on('LOCAL_PLAYER_ACTUALIZED', ({ playerId }) => {
      if (playerId) this.localPlayerId = playerId;
    });

    // Subscribe to damage events to track deaths
    (gameBus as any).on('ENTITY_TOOK_DAMAGE', (payload: any) => {
      this.onEntityTookDamage(payload);
    });
    (gameBus as any).on('healthChanged', (payload: any) => {
      this.onHealthChanged(payload);
    });
    (gameBus as any).on('ENTITY_HIT', (payload: any) => {
      this.onEntityHit(payload);
    });
    (gameBus as any).on('hordeClearEnemiesRequested', () => {
      this.clearAll();
    });

    console.log('[DummyEnemySystem] Initialized', { kernelInitialized: this.kernelInitialized });
  }

  setEntityManager(entityManager: any): void {
    this.entityManager = entityManager || null;
    if (!this.entityManager) {
      return;
    }

    for (const dummy of this.dummies.values()) {
      if (!dummy.visualEntity) {
        this.createVisualEntity(dummy, dummy.handle, dummy.denseIndex);
      }
    }
  }

  setHealthSystem(healthSystem: DummyHealthSystemAdapter | null): void {
    this.healthSystem = healthSystem ?? null;
    if (!this.healthSystem) {
      return;
    }

    for (const dummy of this.dummies.values()) {
      this.registerDummyCombatState(dummy);
    }
  }

  setPhysicsSystem(physicsSystem: DummyPhysicsSystemAdapter | null): void {
    this.physicsSystem = physicsSystem ?? null;
    if (!this.physicsSystem) {
      return;
    }

    for (const dummy of this.dummies.values()) {
      this.ensureDummyPhysicsBody(dummy);
    }
  }

  setPathfindingSystem(ps: DummyPathfindingAdapter | null): void {
    this.pathfindingSystem = ps ?? null;
  }

  setCollisionAuthoritySystem(cas: DummyCollisionAuthorityAdapter | null): void {
    this.collisionAuthoritySystem = cas ?? null;
  }

  clearAll(): void {
    for (const dummy of this.dummies.values()) {
      this.disposeDummyVisuals(dummy);
      if (this.kernel.entities.getDenseIndex(dummy.handle) >= 0) {
        this.kernel.destroyEntity(dummy.handle);
      }
    }

    for (const effect of this.projectileEffects) {
      this.entityManager?.destroyEntity?.(effect.entityId);
    }

    this.projectileEffects = [];
    this.pendingKernelCleanupHandles = [];
    this.dummies.clear();
  }

  /**
   * Provide a fallback resolver for the active player ID.
   * Called when LOCAL_PLAYER_ACTUALIZED has not yet fired (e.g. early frames).
   */
  setLocalPlayerIdResolver(resolver: () => string | null): void {
    this.localPlayerIdResolver = resolver;
  }

  /** Resolve the health-system key for the local player. */
  private resolveLocalPlayerId(): string | null {
    return this.localPlayerId ?? this.localPlayerIdResolver?.() ?? null;
  }

  private resolveLocalDamageTarget(localPlayerEntityId: string | null): string | null {
    const candidates = [this.resolveLocalPlayerId(), localPlayerEntityId];

    for (const candidate of candidates) {
      if (candidate && this.healthSystem?.get(candidate)) {
        return candidate;
      }
    }

    return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0) ?? null;
  }

  getVisualEntityId(handle: EntityHandle): string | null {
    return this.dummies.get(handle)?.visualEntityId ?? null;
  }

  private getKernelPosition(denseIndex: number, fallbackY = 1): [number, number, number] {
    const readBuffer = this.kernel.positions?.getReadBuffer?.();
    if (!readBuffer) {
      return [0, fallbackY, 0];
    }

    const baseIndex = denseIndex * 3;
    return [
      readBuffer[baseIndex] ?? 0,
      readBuffer[baseIndex + 1] ?? fallbackY,
      readBuffer[baseIndex + 2] ?? 0,
    ];
  }

  /**
   * Spawn a dummy enemy at world position
   */
  spawnDummy(
    x: number,
    y: number,
    z: number,
    enemyType: 'default' | 'flyingMask' = 'default',
    variantId: DummyEnemyVariantId = enemyType === 'flyingMask' ? 'rot-mask' : 'decay-husk',
  ): EntityHandle | null {
    // WATCHDOG: Safety check for kernel readiness
    if (!this.kernelInitialized || !this.kernel.positions || !this.kernel.velocities) {
      console.error('[DummyEnemySystem] Kernel not initialized');
      return null;
    }

    // Create entity in kernel
    const handle = this.kernel.createEntity(x, y, z);
    if (handle === null) {
      console.error('[DummyEnemySystem] Failed to create entity');
      return null;
    }

    const denseIndex = this.kernel.entities.getDenseIndex(handle);
  const variant = getDummyEnemyVariant(variantId);

  // Setup dummy health using the selected tropical horror variant.
  this.kernel.healths.setMaxHealth(denseIndex, variant.maxHealth);
  this.kernel.healths.setHealth(denseIndex, variant.maxHealth);

    const dummy: DummyEnemy = {
      handle,
      denseIndex,
      position: [x, y, z],
      baseY: y, // CRITICAL FIX: Track base Y for idle-bob relative positioning
      isDead: false,
      createdAt: Engine.time.now(),
      hitFlashTimer: 0,
      deathTimer: 0,
      corpseBlockerTimer: 0,
      visualEntityId: null,
      enemyType,
      variantId,
      orbitPhase: enemyType === 'flyingMask' ? Engine.random.next() * Math.PI * 2 : undefined,
      orbitRadius: enemyType === 'flyingMask' ? 3.0 + Engine.random.next() * 1.2 : undefined,
      shootTimer: enemyType === 'flyingMask' ? 0.8 + Engine.random.next() * 0.8 : undefined,
      shotEffectEntityId: null,
      meleeCooldown: 0,
      path: [],
      pathIndex: 0,
      pathRefreshTimer: 0,
    };

    this.dummies.set(handle, dummy);

    console.log('[DummyEnemySystem] Dummy spawned:', {
      handle,
      position: [x, y, z],
      baseY: y,
      health: variant.maxHealth,
      variantId,
    });

    // Emit event for visualization
    (gameBus as any).emit('DUMMY_SPAWNED', {
      handle,
      position: [x, y, z],
    });

    if (this.entityManager) {
      this.createVisualEntity(dummy, handle, denseIndex);
    }

    return handle;
  }

  spawnFlyingMask(x: number, y: number, z: number, variantId: DummyEnemyVariantId = 'rot-mask'): EntityHandle | null {
    return this.spawnDummy(x, y, z, 'flyingMask', variantId);
  }

  /**
   * Update all dummy entities with Idle-Bob animation.
   * 
   * ZERO-ALLOCATION DATA FLUX: Direct TypedArray manipulation for 500 XOR-diffs per frame.
   * Applies sine-wave Y-offset and Y-velocity to all entities, forcing position/velocity buffer updates.
   * 
   * This is the "data flux" workload: every frame, every entity's position/velocity changes,
   * triggering maximum BITE buffer churn and reconciliation deltas.
   * 
   * Time Complexity: O(N) where N = active dummy count (max 500)
   * Space Complexity: O(1) - no allocations, direct buffer writes
   * 
   * CRITICAL FIX: Sets FULL position (X, Y, Z) not just Y, preserving spawn grid location
   * 
   * @param dt Delta time in seconds
   */
  update(dt: number): void {
    // WATCHDOG GUARD: Safety check before accessing buffers
    if (!this.kernelInitialized || this.dummies.size === 0) {
      return;
    }

    // Additional safety: verify buffers exist
    if (!this.kernel.positions || !this.kernel.velocities) {
      console.warn('[DummyEnemySystem] Buffers unavailable during update');
      return;
    }

    if (this.idleBobActive) {
      this.idleBobTime += dt;
    }

    const posBuffer = this.kernel.positions.getWriteBuffer();
    const readBuffer = this.kernel.positions.getReadBuffer(); // Read previous positions to preserve X/Z
    const velBuffer = this.kernel.velocities.getBuffer();

    const waveFreq = this.IDLE_BOB_FREQUENCY;
    const waveAmp = this.IDLE_BOB_AMPLITUDE;
    const phase = this.idleBobTime * Math.PI * 2 * waveFreq;

    const yOffset = this.idleBobActive ? Math.sin(phase) * waveAmp : 0;
    const yVelocity = this.idleBobActive ? Math.cos(phase) * waveAmp * 2 * Math.PI * waveFreq : 0;
    const localPlayer = Engine.getEntityManager()?.getEntities().find((entity) => entity.hasComponent('localPlayer')) ?? null;
    const localPlayerPosition = localPlayer?.getPosition() ?? null;

    // Build a snapshot of all living dummy positions for separation calculations.
    const liveDummyPositions: Array<[number, number]> = [];
    for (const d of this.dummies.values()) {
      if (!d.isDead || (d.corpseBlockerTimer ?? 0) > 0) {
        const di = this.kernel.entities.getDenseIndex(d.handle);
        if (di >= 0) {
          const bp = di * 3;
          liveDummyPositions.push([readBuffer[bp], readBuffer[bp + 2]]);
        } else {
          liveDummyPositions.push([d.position[0], d.position[2]]);
        }
      }
    }

    // Batch collision-authority updates (player can't walk through enemies).
    const casEntries: Array<{ id: string; position: Vec3; halfExtents: Vec3 }> = [];

    let updateCount = 0;
    for (const dummy of this.dummies.values()) {
      if (dummy.isDead) {
        this.updateDeathFeedback(dummy, dt);
        continue;
      }

      const denseIndex = this.kernel.entities.getDenseIndex(dummy.handle);
      if (denseIndex < 0) {
        continue;
      }

      dummy.denseIndex = denseIndex;
      const basePos = denseIndex * 3;
      const baseVel = denseIndex * 3;

      if (dummy.enemyType === 'flyingMask') {
        this.updateFlyingMask(dummy, dt, localPlayerPosition, posBuffer, readBuffer, velBuffer, basePos, baseVel, yVelocity);
        // Flying masks still block the player.
        if (dummy.visualEntityId) {
          casEntries.push({ id: dummy.visualEntityId, position: { x: dummy.position[0], y: dummy.position[1], z: dummy.position[2] }, halfExtents: { x: 0.45, y: 0.9, z: 0.45 } });
        }
        updateCount++;
        continue;
      }

      const aiController = dummy.visualEntity?.getComponent?.('aiController')?.data as { targetPosition?: { x: number; y: number; z: number } } | undefined;

      // AI-driven movement: use pathfinding when available, otherwise direct
      const curX = readBuffer[basePos];
      const curZ = readBuffer[basePos + 2];
      let moveVelX = 0;
      let moveVelZ = 0;
      let chaseVelX = 0;
      let chaseVelZ = 0;

      if (localPlayerPosition) {
        if (aiController) aiController.targetPosition = { ...localPlayerPosition };
        const variant = getDummyEnemyVariant(dummy.variantId);

        // Refresh A* path periodically.
        dummy.pathRefreshTimer = (dummy.pathRefreshTimer ?? 0) - dt;
        if ((dummy.pathRefreshTimer ?? 0) <= 0 && this.pathfindingSystem) {
          dummy.path = this.pathfindingSystem.findPath(
            { x: curX, y: dummy.baseY, z: curZ },
            localPlayerPosition,
          );
          dummy.pathIndex = 0;
          dummy.pathRefreshTimer = 0.45 + Engine.random.next() * 0.15;
        }

        // Choose movement target: next waypoint (if path exists) or direct line.
        let targetX = localPlayerPosition.x;
        let targetZ = localPlayerPosition.z;
        const path = dummy.path;
        if (path && path.length > 0 && (dummy.pathIndex ?? 0) < path.length) {
          const wp = path[dummy.pathIndex ?? 0];
          const wpDist = Math.sqrt((wp.x - curX) ** 2 + (wp.z - curZ) ** 2);
          if (wpDist < 0.6) {
            dummy.pathIndex = (dummy.pathIndex ?? 0) + 1;
          }
          const safeIdx = Math.min(dummy.pathIndex ?? 0, path.length - 1);
          targetX = path[safeIdx].x;
          targetZ = path[safeIdx].z;
        }

        const toX = targetX - curX;
        const toZ = targetZ - curZ;
        const dist = Math.sqrt(toX * toX + toZ * toZ);
        if (dist > 1.0) { // stop within melee range
          const spd = variant.moveSpeed;
          chaseVelX = (toX / dist) * spd;
          chaseVelZ = (toZ / dist) * spd;
          moveVelX = chaseVelX;
          moveVelZ = chaseVelZ;
        }
      }

      // Boid-style separation: push away from nearby dummies to prevent stacking.
      const SEP_RADIUS = 0.95;
      const SEP_STRENGTH = 3.5;
      for (const [ox, oz] of liveDummyPositions) {
        const dx = curX - ox;
        const dz = curZ - oz;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < SEP_RADIUS * SEP_RADIUS) {
          const d = Math.sqrt(d2);
          const push = (SEP_RADIUS - d) / SEP_RADIUS * SEP_STRENGTH;
          moveVelX += (dx / d) * push;
          moveVelZ += (dz / d) * push;
        }
      }

      const nextX = curX + moveVelX * dt;
      const nextY = dummy.baseY + yOffset;
      const nextZ = curZ + moveVelZ * dt;

      if (this.pathfindingSystem?.isWalkableWorld) {
        const separatedCandidate = { x: nextX, y: dummy.baseY, z: nextZ };
        if (!this.pathfindingSystem.isWalkableWorld(separatedCandidate)) {
          const chaseOnlyCandidate = { x: curX + chaseVelX * dt, y: dummy.baseY, z: curZ + chaseVelZ * dt };
          if (this.pathfindingSystem.isWalkableWorld(chaseOnlyCandidate)) {
            moveVelX = chaseVelX;
            moveVelZ = chaseVelZ;
          } else {
            moveVelX = 0;
            moveVelZ = 0;
            dummy.pathRefreshTimer = 0;
          }
        }
      }

      const resolvedNextX = curX + moveVelX * dt;
      const resolvedNextZ = curZ + moveVelZ * dt;

      posBuffer[basePos] = resolvedNextX;
      posBuffer[basePos + 1] = nextY;
      posBuffer[basePos + 2] = resolvedNextZ;

      velBuffer[baseVel] = moveVelX;
      velBuffer[baseVel + 1] = yVelocity;
      velBuffer[baseVel + 2] = moveVelZ;

      dummy.position[0] = resolvedNextX;
      dummy.position[1] = nextY;
      dummy.position[2] = resolvedNextZ;
      dummy.hitFlashTimer = Math.max(0, dummy.hitFlashTimer - dt);
      dummy.meleeCooldown = Math.max(0, (dummy.meleeCooldown ?? 0) - dt);

      // Register as a solid obstacle so the player can't walk through this dummy.
      if (dummy.visualEntityId) {
        casEntries.push({ id: dummy.visualEntityId, position: { x: resolvedNextX, y: nextY, z: resolvedNextZ }, halfExtents: { x: 0.45, y: 0.9, z: 0.45 } });
        // Keep physics body in sync so projectile overlap checks find this enemy.
        const physBody = this.physicsSystem?.getBody(dummy.visualEntityId);
        if (physBody) {
          physBody.position = { x: resolvedNextX, y: nextY + 0.38, z: resolvedNextZ };
        }
      }

      // Melee damage: hurt the local player when close enough
      if (localPlayerPosition && dummy.meleeCooldown === 0) {
        const dx = localPlayerPosition.x - resolvedNextX;
        const dz = localPlayerPosition.z - resolvedNextZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < 1.8 * 1.8) {
          const healthTarget = this.resolveLocalDamageTarget(localPlayer?.id ?? null);
          const MELEE_DAMAGE = 8;
          let dealt = 0;
          if (healthTarget && this.healthSystem?.applyDamage) {
            dealt = this.healthSystem.applyDamage(healthTarget, {
              amount: MELEE_DAMAGE,
              type: 'melee',
              sourceId: dummy.visualEntityId ?? 'enemy_zombie',
            });
          } else {
            // Fallback: broadcast damage request so any health listener can process it
            (gameBus as any).emit('APPLY_DAMAGE_REQUESTED', {
              targetId: healthTarget ?? this.resolveLocalPlayerId() ?? localPlayer?.id,
              damageAmount: MELEE_DAMAGE,
              damageType: 'melee',
              sourceId: dummy.visualEntityId ?? 'enemy_zombie',
            });
            dealt = MELEE_DAMAGE;
          }
          dummy.meleeCooldown = 1.2;
          if (dealt > 0 || !healthTarget) {
            (gameBus as any).emit('ENEMY_MELEE_HIT', {
              sourceId: dummy.visualEntityId ?? 'enemy_zombie',
              targetId: healthTarget,
              damage: dealt,
              position: { x: resolvedNextX, y: nextY, z: resolvedNextZ },
            });
          }
          console.log('[DummyEnemySystem] Melee hit → target:', healthTarget, 'dealt:', dealt);
        }
      }

      updateCount++;
    }

    // Publish position changes for BITE recording
    this.kernel.positions.publish();

    // Flush solid-collision entries so the player can't walk through enemies.
    if (this.collisionAuthoritySystem && casEntries.length > 0) {
      this.collisionAuthoritySystem.batchUpsertDynamicColliders(casEntries);
    }

    this.updateProjectileEffects(dt);

    // DEBUG: Log update status
    if (Engine.random.next() < 0.016 && updateCount > 0) {  // ~1/60 frames
      console.log(`[DummyEnemySystem] Updated ${updateCount}/${this.dummies.size} dummies with idle-bob (offset: ${yOffset.toFixed(3)})`);
    }

    // Sync visual entities with kernel positions (with error handling)
    // NOTE: Most dummies won't have visualEntity since entityManager is null,
    // but EntityRenderer.update() will sync all fallback meshes from kernel buffers
    const readPosBuffer = this.kernel.positions.getReadBuffer();
    for (const dummy of this.dummies.values()) {
      if (dummy.isDead || !dummy.visualEntity) continue;

      try {
        const denseIndex = this.kernel.entities.getDenseIndex(dummy.handle);
        if (denseIndex < 0) {
          continue;
        }
        dummy.denseIndex = denseIndex;
        const basePos = denseIndex * 3;

        // Update visual entity position from kernel buffer using transform
        const transform = dummy.visualEntity.getTransform();
        if (transform && transform.position) {
          transform.position.x = readPosBuffer[basePos];
          transform.position.y = readPosBuffer[basePos + 1];
          transform.position.z = readPosBuffer[basePos + 2];

          // Face the local player each frame
          if (localPlayerPosition) {
            const dx = localPlayerPosition.x - readPosBuffer[basePos];
            const dz = localPlayerPosition.z - readPosBuffer[basePos + 2];
            if (!transform.rotation) transform.rotation = { x: 0, y: 0, z: 0 };
            transform.rotation.y = Math.atan2(dx, dz);
          }
          
          // Notify entity of transform change to trigger EntityRenderer update
          dummy.visualEntity.setTransform(transform);
        }
        const body = dummy.visualEntityId && this.physicsSystem
          ? this.physicsSystem.getBody(dummy.visualEntityId)
          : undefined;
        if (body) {
          body.position = {
            x: readPosBuffer[basePos],
            y: readPosBuffer[basePos + 1] + 0.38,
            z: readPosBuffer[basePos + 2],
          };
        }
        this.applyHitFeedback(dummy);

        // Procedural arm animation: reaching-toward-player pose with walk cycle
        if (dummy.enemyType !== 'flyingMask' && (dummy.armL || dummy.armR)) {
          const t = Engine.time.now() / 1000;
          if (dummy.armL) (dummy.armL as any).rotation.x = -Math.PI * 0.75 + Math.sin(t * 3.5) * 0.18;
          if (dummy.armR) (dummy.armR as any).rotation.x = -Math.PI * 0.75 + Math.sin(t * 3.5 + Math.PI) * 0.18;
        }
      } catch (error) {
        // Silently skip failed visual updates to prevent watchdog freeze
      }
    }

    this.flushPendingKernelCleanupHandles();
  }

  /**
   * Enable/disable Idle-Bob animation
   */
  setIdleBobActive(active: boolean): void {
    this.idleBobActive = active;
    if (!active) {
      this.idleBobTime = 0;
    }
  }

  /**
   * Check if Idle-Bob is active
   */
  isIdleBobActive(): boolean {
    return this.idleBobActive;
  }

  /**
   * Called when entity takes damage
   */
  private onEntityTookDamage(payload: any): void {
    const { entityHandle, newHealth } = payload;

    const dummy = this.dummies.get(entityHandle);
    if (!dummy) return; // Not a dummy

    const denseIndex = this.kernel.entities.getDenseIndex(entityHandle);
    const maxHealth = denseIndex >= 0 ? this.kernel.healths.getMaxHealth(denseIndex) : 50;
    this.syncDummyVitals(dummy, Math.max(0, Number(newHealth) || 0), maxHealth);

    console.log('[DummyEnemySystem] Dummy damaged:', {
      handle: entityHandle,
      newHealth,
    });

    // Check if dead
    if (newHealth <= 0) {
      this.killDummy(entityHandle);
    }
  }

  private onHealthChanged(payload: any): void {
    const targetId = typeof payload?.entityId === 'string' ? payload.entityId : null;
    if (!targetId) {
      return;
    }

    const dummy = this.findDummyByVisualEntityId(targetId);
    if (!dummy) {
      return;
    }

    const hp = Math.max(0, Number(payload.hp) || 0);
    const maxHp = Math.max(1, Number(payload.maxHp) || 50);
    this.syncDummyVitals(dummy, hp, maxHp);

    if (hp <= 0) {
      this.killDummy(dummy.handle);
    }
  }

  private onEntityHit(payload: any): void {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId : null;
    if (!targetId) {
      return;
    }

    const dummy = this.findDummyByVisualEntityId(targetId);
    if (!dummy || dummy.isDead) {
      return;
    }

    dummy.hitFlashTimer = 0.16;
  }

  /**
   * Kill dummy (health reached 0)
   */
  private killDummy(handle: EntityHandle): void {
    const dummy = this.dummies.get(handle);
    if (!dummy || dummy.isDead) return;

    dummy.isDead = true;
    dummy.pendingCleanup = false;
    dummy.deathTimer = 0.42;
    dummy.corpseBlockerTimer = 0.75;
    dummy.hitFlashTimer = 0.2;

    console.log('[DummyEnemySystem] Dummy died:', handle);

    const denseIndex = this.kernel.entities.getDenseIndex(handle);
    if (denseIndex >= 0) {
      this.kernel.healths.setHealth(denseIndex, 0);
      const velocityBuffer = this.kernel.velocities.getBuffer();
      const baseVelocity = denseIndex * 3;
      velocityBuffer[baseVelocity] = 0;
      velocityBuffer[baseVelocity + 1] = 0;
      velocityBuffer[baseVelocity + 2] = 0;
    }
    if (dummy.visualEntityId) {
      this.physicsSystem?.removeBody(dummy.visualEntityId);
      this.healthSystem?.syncVitals?.(dummy.visualEntityId, { hp: 0 });
      this.collisionAuthoritySystem?.removeDynamicCollider(dummy.visualEntityId);
    }

    (gameBus as any).emit('DUMMY_DIED', {
      handle,
    });
  }

  /**
   * Get all active dummies
   */
  getActiveDummies(): DummyEnemy[] {
    return Array.from(this.dummies.values()).filter((d) => !d.isDead);
  }

  /**
   * Spawn dummy at random position near player
   */
  spawnRandomDummy(playerX: number, playerY: number): EntityHandle | null {
    const offsetX = (Engine.random.next() - 0.5) * 10;
    const offsetZ = (Engine.random.next() - 0.5) * 10;
    return this.spawnDummy(playerX + offsetX, playerY + 1, offsetZ);
  }

  /**
   * Spawn N dummy enemies in grid formation (COMBAT & GEOMETRY SUPREMACY: The Dummy Army)
   * 
   * FROSTBITE ZERO-ALLOCATION: Uses binary blob spawning for maximum performance.
   * Pre-computes all entity data into a single buffer, then passes to kernel.spawnFromBlob().
   * All entities initialized with Transform + Health in O(N) time, zero intermediate objects.
   * 
   * Grid Distribution:
   * - Arranges dummies in sqrt(N) × sqrt(N) grid around origin
   * - Spacing: 2.0 world units per cell
   * - Health: 50 HP per dummy (matching single-spawn logic)
   * 
   * Returns: Array of spawned EntityHandles for tracking/visualization
   */
  spawnArmy(
    count: number,
    origin: { x: number; y: number; z: number } = { x: 16, y: 1, z: 16 },
    spacing: number = 2.0
  ): EntityHandle[] {
    // WATCHDOG: Safety check before batch spawn
    if (!this.kernelInitialized || !this.kernel.spawnFromBlob) {
      console.error('[DummyEnemySystem] Cannot spawn army: kernel not initialized');
      return [];
    }

    const startTime = performance.now();

    // FROSTBITE: Create binary blob with all entity data pre-computed
    const blob = BinaryEntityTemplate.createGridBlob(
      count,
      origin.x,
      origin.z,
      spacing,
      50 // health
    );

    // ZERO-ALLOCATION SPAWN: Pass entire blob to kernel
    const spawnedHandles = this.kernel.spawnFromBlob(blob);

    // Register all spawned entities for tracking
    for (const handle of spawnedHandles) {
      const denseIndex = this.kernel.entities.getDenseIndex(handle);
      if (denseIndex >= 0) {
        const [spawnX, spawnY, spawnZ] = this.getKernelPosition(denseIndex, origin.y);
        const dummy: DummyEnemy = {
          handle,
          denseIndex,
          position: [spawnX, spawnY, spawnZ],
          baseY: spawnY, // CRITICAL FIX: Track base Y for idle-bob
          isDead: false,
          createdAt: Engine.time.now(),
          hitFlashTimer: 0,
          deathTimer: 0,
          visualEntityId: null,
          enemyType: 'default',
          variantId: 'decay-husk',
          orbitPhase: undefined,
          orbitRadius: undefined,
          shootTimer: undefined,
          shotEffectEntityId: null,
        };
        this.dummies.set(handle, dummy);
        
        // Create visual entity for rendering if entityManager is available
        if (this.entityManager) {
          this.createVisualEntity(dummy, handle, denseIndex);
        }
      }
    }

    const elapsedMs = (performance.now() - startTime).toFixed(2);

    console.log('[DummyEnemySystem] Army spawned (FROSTBITE):', {
      requested: count,
      actual: spawnedHandles.length,
      grid: `${Math.ceil(Math.sqrt(count))}x${Math.ceil(Math.sqrt(count))}`,
      origin,
      spacing,
      elapsedMs: `${elapsedMs}ms`,
      blobSizeBytes: blob.byteLength,
    });

    // Emit batch event for UI/recorder coordination
    (gameBus as any).emit('DUMMY_ARMY_SPAWNED', {
      count: spawnedHandles.length,
      handles: spawnedHandles,
      origin,
      spacing,
      timestamp: Engine.time.now(),
    });

    return spawnedHandles;
  }

  private updateFlyingMask(
    dummy: DummyEnemy,
    dt: number,
    localPlayerPosition: { x: number; y: number; z: number } | null,
    posBuffer: Float32Array,
    readBuffer: Float32Array,
    velBuffer: Float32Array,
    basePos: number,
    baseVel: number,
    yVelocity: number,
  ): void {
    const orbitPhase = (dummy.orbitPhase ?? 0) + dt * this.FLYING_MASK_ORBIT_SPEED;
    dummy.orbitPhase = orbitPhase;
    const radius = dummy.orbitRadius ?? 3.2;

    const targetCenter = localPlayerPosition ?? { x: dummy.position[0], y: dummy.baseY, z: dummy.position[2] };
    const orbitX = targetCenter.x + Math.cos(orbitPhase) * radius;
    const orbitZ = targetCenter.z + Math.sin(orbitPhase) * radius;
    const orbitY = targetCenter.y + this.FLYING_MASK_BASE_HEIGHT + Math.sin(this.idleBobTime * 1.7) * 0.16;

    posBuffer[basePos] = orbitX;
    posBuffer[basePos + 1] = orbitY;
    posBuffer[basePos + 2] = orbitZ;

    velBuffer[baseVel] = 0;
    velBuffer[baseVel + 1] = 0;
    velBuffer[baseVel + 2] = 0;

    dummy.position[0] = orbitX;
    dummy.position[1] = orbitY;
    dummy.position[2] = orbitZ;
    dummy.hitFlashTimer = Math.max(0, dummy.hitFlashTimer - dt);

    if (dummy.shootTimer !== undefined) {
      dummy.shootTimer -= dt;
      if (dummy.shootTimer <= 0 && localPlayerPosition) {
        this.fireFlyingMaskShot(dummy, localPlayerPosition);
        dummy.shootTimer = this.FLYING_MASK_SHOOT_INTERVAL_MIN + Engine.random.next() * (this.FLYING_MASK_SHOOT_INTERVAL_MAX - this.FLYING_MASK_SHOOT_INTERVAL_MIN);
      }
    }
  }

  private fireFlyingMaskShot(dummy: DummyEnemy, localPlayerPosition: { x: number; y: number; z: number }): void {
    const shooterPosition = { x: dummy.position[0], y: dummy.position[1], z: dummy.position[2] };
    const localPlayer = Engine.getEntityManager()?.getEntities().find((entity) => entity.hasComponent('localPlayer')) ?? null;
    const targetPlayerId = this.resolveLocalDamageTarget(localPlayer?.id ?? null);
    const variant = getDummyEnemyVariant(dummy.variantId);

    if (!this.entityManager) {
      if (targetPlayerId) {
        this.applyFlyingMaskImpact(targetPlayerId, dummy.visualEntityId ?? 'enemy_flying_mask');
      }
      return;
    }

    const effectEntity = this.entityManager.createEntity('FlyingMaskShot', {
      position: { ...shooterPosition },
      rotation: { x: 0, y: 0, z: 0 },
    });
    effectEntity.addComponent({
      name: 'render',
      data: {
        meshType: 'sphere',
        color: variant.projectileColor ?? 0xd0dc78,
        emissive: variant.projectileEmissive ?? 0x7ea84b,
        emissiveIntensity: 1.8,
        transparent: true,
        opacity: 0.92,
        flatShading: true,
        geometry: { radius: 0.12, segments: 10 },
      },
    });

    Engine.getEntityRenderer()?.syncEntity(effectEntity as any);

    const effectId = effectEntity.id;
    this.projectileEffects.push({
      entityId: effectId,
      age: 0,
      lifetime: this.FLYING_MASK_PROJECTILE_LIFETIME,
      start: [shooterPosition.x, shooterPosition.y, shooterPosition.z],
      end: [localPlayerPosition.x, localPlayerPosition.y + 0.4, localPlayerPosition.z],
      targetPlayerId,
      sourceId: dummy.visualEntityId ?? 'enemy_flying_mask',
      impactRadius: 1.05,
    });
  }

  private applyFlyingMaskImpact(targetPlayerId: string, sourceId: string): number {
    if (this.healthSystem?.applyDamage) {
      return this.healthSystem.applyDamage(targetPlayerId, {
        amount: this.FLYING_MASK_DAMAGE,
        type: 'magic',
        sourceId,
      });
    }

    (gameBus as any).emit('APPLY_DAMAGE_REQUESTED', {
      targetId: targetPlayerId,
      damageAmount: this.FLYING_MASK_DAMAGE,
      damageType: 'magic',
      sourceId,
    });
    return this.FLYING_MASK_DAMAGE;
  }

  private updateProjectileEffects(dt: number): void {
    if (!this.entityManager || this.projectileEffects.length === 0) {
      return;
    }

    const remaining: typeof this.projectileEffects = [];

    for (const effect of this.projectileEffects) {
      effect.age += dt;
      const t = Math.min(1, effect.age / effect.lifetime);
      const entity = this.entityManager.getEntity(effect.entityId);
      if (!entity) {
        continue;
      }

      const position = {
        x: effect.start[0] + (effect.end[0] - effect.start[0]) * t,
        y: effect.start[1] + (effect.end[1] - effect.start[1]) * t,
        z: effect.start[2] + (effect.end[2] - effect.start[2]) * t,
      };
      entity.setPosition(position);

      if (t >= 1 || effect.age >= effect.lifetime) {
        if (effect.targetPlayerId) {
          const localPlayer = Engine.getEntityManager()?.getEntities().find((entry) => entry.hasComponent('localPlayer')) ?? null;
          const currentPlayerPosition = localPlayer?.getPosition() ?? null;
          const impactRadius = Math.max(0.25, effect.impactRadius);
          const didImpact = currentPlayerPosition
            ? ((currentPlayerPosition.x - effect.end[0]) ** 2 + (currentPlayerPosition.y + 0.4 - effect.end[1]) ** 2 + (currentPlayerPosition.z - effect.end[2]) ** 2) <= impactRadius * impactRadius
            : false;

          if (didImpact) {
            const dealt = this.applyFlyingMaskImpact(effect.targetPlayerId, effect.sourceId);
            console.log('[FlyingMask] Projectile impact hit → targetId:', effect.targetPlayerId, 'damage dealt:', dealt);
          } else {
            console.log('[FlyingMask] Projectile impact missed');
          }
        }

        this.entityManager.destroyEntity(effect.entityId);
        continue;
      }

      remaining.push(effect);
    }

    this.projectileEffects = remaining;
  }
  private createVisualEntity(dummy: DummyEnemy, handle: EntityHandle, denseIndex: number): void {
    try {
      if (!this.entityManager) return;
      const variant = getDummyEnemyVariant(dummy.variantId);

      const visualEntity = this.entityManager.createEntity('DummyEnemy_Visual', {
        position: { x: dummy.position[0], y: dummy.position[1], z: dummy.position[2] },
        rotation: { x: 0, y: 0, z: 0 }
      });

      visualEntity.addComponent({
        name: 'render',
        data: {
          meshType: dummy.enemyType === 'flyingMask' ? 'flyingMaskPrefab' : 'dummyPrefab',
          color: variant.renderColor,
          emissive: variant.emissive,
          emissiveIntensity: variant.emissiveIntensity,
          scale: { ...variant.scale },
          geometry: {
            width: variant.geometry.width,
            height: variant.geometry.height,
            depth: variant.geometry.depth,
          }
        }
      });
      visualEntity.addComponent({
        name: 'health',
        data: {
          current: variant.maxHealth,
          max: variant.maxHealth,
        },
      });
      visualEntity.addComponent({
        name: 'collider',
        data: createBoxCollider(0.7, 1.2, 0.7, {
          offset: { x: 0, y: 0.6, z: 0 },
        }),
      });
      visualEntity.addComponent({
        name: 'aiController',
        data: createAIControllerComponent(
          { x: dummy.position[0], y: dummy.position[1], z: dummy.position[2] },
          {
            speed: variant.moveSpeed,
            repathIntervalMs: 200,
          },
        ),
      });

      Engine.getEntityRenderer()?.syncEntity(visualEntity as any);

      dummy.visualEntity = visualEntity;
      dummy.visualEntityId = visualEntity.id;
      this.registerDummyCombatState(dummy);
      this.ensureDummyPhysicsBody(dummy);

      // Cache arm pivot refs for procedural arm animation
      const mesh = Engine.getEntityRenderer()?.getMeshForEntity(dummy.visualEntityId ?? '');
      if (mesh) {
        dummy.armL = (mesh as any).userData?.leftArmPivot ?? null;
        dummy.armR = (mesh as any).userData?.rightArmPivot ?? null;
      }
    } catch (error) {
      console.warn('[DummyEnemySystem] Failed to create visual entity:', error);
    }
  }

  /**
   * EXPERIMENTAL: Spawn army using circle formation (for variety)
   */
  spawnArmyCircle(
    count: number,
    centerX: number = 0,
    centerZ: number = 0,
    radius: number = 10
  ): EntityHandle[] {
    const blob = BinaryEntityTemplate.createCircleBlob(count, centerX, centerZ, radius, 50);
    const spawnedHandles = this.kernel.spawnFromBlob(blob);

    for (const handle of spawnedHandles) {
      const denseIndex = this.kernel.entities.getDenseIndex(handle);
      if (denseIndex >= 0) {
        const [spawnX, spawnY, spawnZ] = this.getKernelPosition(denseIndex, 1);
        const dummy: DummyEnemy = {
          handle,
          denseIndex,
          position: [spawnX, spawnY, spawnZ],
          baseY: spawnY, // CRITICAL FIX: Track base Y for idle-bob
          isDead: false,
          createdAt: Engine.time.now(),
          hitFlashTimer: 0,
          deathTimer: 0,
          visualEntityId: null,
          enemyType: 'default',
          variantId: 'decay-husk',
          orbitPhase: undefined,
          orbitRadius: undefined,
          shootTimer: undefined,
          shotEffectEntityId: null,
        };
        this.dummies.set(handle, dummy);

        if (this.entityManager) {
          this.createVisualEntity(dummy, handle, denseIndex);
        }
      }
    }

    console.log('[DummyEnemySystem] Army spawned (circle):', {
      count: spawnedHandles.length,
      center: [centerX, centerZ],
      radius,
    });

    return spawnedHandles;
  }

  private registerDummyCombatState(dummy: DummyEnemy): void {
    if (!this.healthSystem || !dummy.visualEntityId) {
      return;
    }

    const denseIndex = this.kernel.entities.getDenseIndex(dummy.handle);
    const kernelHealth = denseIndex >= 0 ? this.kernel.healths.getHealth(denseIndex) : 50;
    const kernelMaxHealth = denseIndex >= 0 ? this.kernel.healths.getMaxHealth(denseIndex) : 50;

    if (!this.healthSystem.get(dummy.visualEntityId)) {
      this.healthSystem.register(dummy.visualEntityId, {
        maxHp: kernelMaxHealth,
        revivable: false,
      });
    }
    this.healthSystem.syncVitals?.(dummy.visualEntityId, {
      hp: kernelHealth,
      maxHp: kernelMaxHealth,
    });
    this.syncDummyHealthComponent(dummy, kernelHealth, kernelMaxHealth);
  }

  private ensureDummyPhysicsBody(dummy: DummyEnemy): void {
    if (!this.physicsSystem || !dummy.visualEntityId) {
      return;
    }

    if (!this.physicsSystem.getBody(dummy.visualEntityId)) {
      this.physicsSystem.addBody(dummy.visualEntityId, {
        shape: 'sphere',
        radius: 0.42,
        layer: 'enemy',
        isStatic: false,
        isTrigger: false,
      });
    }

    const body = this.physicsSystem.getBody(dummy.visualEntityId);
    if (body) {
      body.position = {
        x: dummy.position[0],
        y: dummy.position[1] + 0.38,
        z: dummy.position[2],
      };
    }
  }

  private syncDummyVitals(dummy: DummyEnemy, hp: number, maxHp: number): void {
    const denseIndex = this.kernel.entities.getDenseIndex(dummy.handle);
    if (denseIndex >= 0) {
      dummy.denseIndex = denseIndex;
      this.kernel.healths.setMaxHealth(denseIndex, maxHp);
      this.kernel.healths.setHealth(denseIndex, hp);
    }

    this.syncDummyHealthComponent(dummy, hp, maxHp);
  }

  private syncDummyHealthComponent(dummy: DummyEnemy, hp: number, maxHp: number): void {
    const healthComponent = dummy.visualEntity?.getComponent?.('health');
    if (!healthComponent) {
      return;
    }

    healthComponent.data.current = hp;
    healthComponent.data.max = maxHp;
  }

  private findDummyByVisualEntityId(entityId: string): DummyEnemy | null {
    for (const dummy of this.dummies.values()) {
      if (dummy.visualEntityId === entityId) {
        return dummy;
      }
    }
    return null;
  }

  private applyHitFeedback(dummy: DummyEnemy): void {
    if (!dummy.visualEntityId) {
      return;
    }

    const mesh = Engine.getEntityRenderer()?.getMeshForEntity(dummy.visualEntityId);
    if (!mesh) {
      return;
    }

    const baseScale = mesh.userData.baseScale ?? { x: 1, y: 1, z: 1 };
    const flashAlpha = Math.max(0, Math.min(1, dummy.hitFlashTimer / 0.16));
    const pulse = flashAlpha * 0.18;
  const variant = getDummyEnemyVariant(dummy.variantId);

    mesh.scale.set(
      baseScale.x * (1 + pulse),
      baseScale.y * (1 + pulse * 0.8),
      baseScale.z * (1 + pulse),
    );

    mesh.traverse((child: any) => {
      const material = child?.material;
      if (!material) {
        return;
      }

      const materials = Array.isArray(material) ? material : [material];
      for (const currentMaterial of materials) {
        if (!('emissive' in currentMaterial)) {
          continue;
        }

        const baseEmissive = child.userData.baseEmissive ?? 0x000000;
        currentMaterial.emissive.setHex(flashAlpha > 0 ? variant.hitFlash : baseEmissive);
        currentMaterial.emissiveIntensity = flashAlpha > 0
          ? 0.7 + flashAlpha * 2.2
          : (child.userData.baseEmissiveIntensity ?? currentMaterial.emissiveIntensity ?? 0);
      }
    });
  }

  private updateDeathFeedback(dummy: DummyEnemy, dt: number): void {
    dummy.hitFlashTimer = Math.max(0, dummy.hitFlashTimer - dt);
    dummy.deathTimer -= dt;
    dummy.corpseBlockerTimer = Math.max(0, (dummy.corpseBlockerTimer ?? 0) - dt);

    if (dummy.visualEntityId) {
      const mesh = Engine.getEntityRenderer()?.getMeshForEntity(dummy.visualEntityId);
      if (mesh) {
        const collapse = Math.max(0, dummy.deathTimer / 0.42);
        const baseScale = mesh.userData.baseScale ?? { x: 1, y: 1, z: 1 };
        mesh.position.y = Math.max(0, mesh.position.y - dt * 1.8);
        mesh.scale.set(baseScale.x * collapse, baseScale.y * collapse, baseScale.z * collapse);
      }
    }

    if (dummy.deathTimer > 0) {
      return;
    }

    if (dummy.pendingCleanup) {
      return;
    }

    dummy.pendingCleanup = true;
    this.disposeDummyVisuals(dummy);
    this.pendingKernelCleanupHandles.push(dummy.handle);
  }

  private disposeDummyVisuals(dummy: DummyEnemy): void {
    if (dummy.visualEntityId) {
      this.physicsSystem?.removeBody(dummy.visualEntityId);
      this.collisionAuthoritySystem?.removeDynamicCollider(dummy.visualEntityId);
      this.healthSystem?.unregister?.(dummy.visualEntityId);
      this.entityManager?.destroyEntity?.(dummy.visualEntityId);
      dummy.visualEntityId = null;
      dummy.visualEntity = null;
    }

    if (dummy.shotEffectEntityId) {
      this.entityManager?.destroyEntity?.(dummy.shotEffectEntityId);
      dummy.shotEffectEntityId = null;
    }
  }

  private flushPendingKernelCleanupHandles(): void {
    if (this.pendingKernelCleanupHandles.length === 0) {
      return;
    }

    const handles = this.pendingKernelCleanupHandles;
    this.pendingKernelCleanupHandles = [];

    for (const handle of handles) {
      const dummy = this.dummies.get(handle);
      if (!dummy) {
        continue;
      }

      if (this.kernel.entities.getDenseIndex(handle) >= 0) {
        this.kernel.destroyEntity(handle);
      }
      dummy.denseIndex = -1;

      if ((dummy.corpseBlockerTimer ?? 0) <= 0) {
        this.dummies.delete(handle);
      }
    }
  }
}
