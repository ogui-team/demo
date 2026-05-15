/**
 * PlayerModelSystem
 * Spawns and synchronises low-poly PS1-style player models for all players.
 *
 * Responsibilities:
 *  - Spawn a model mesh for every remote player that joins.
 *  - Keep position/rotation in sync from network update payloads.
 *  - Distinguish local vs remote: local player has no visible body (FPS camera).
 *  - Reuse shared geometry/material via a single prototype group so no model is
 *    duplicated per player in GPU memory.
 *  - Provide lifecycle helpers: spawn, update, remove, clear.
 *
 * Integration:
 *  - Driven entirely from StateManager/EntityManager; no logic inside the mesh.
 *  - Called from index.ts via syncRemotePlayers for authoritative snapshot payloads.
 *  - The local player is represented only by the camera — call setLocalPlayerId()
 *    so the system skips that ID when building models.
 *
 * Usage:
 *  const pms = new PlayerModelSystem(scene, entityManager, entityRenderer, stateManager);
 *  pms.setLocalPlayerId(mpClient.playerId);
 *  // on authoritative_snapshot:
 *  pms.syncFromPayload(payload.entities);
 *  // on player_leave:
 *  pms.removePlayer(playerId);
 *  // on match end:
 *  pms.clearAll();
 */

import * as THREE from 'three';
import { Entity, Vector3 } from '../../../1-kernel/core/Entity';
import { setRaycastLayersRecursive } from '../../../1-kernel/core/RaycastLayers';
import { gameBus } from '../../../1-kernel/core/EventBus';
import type { SystemCapabilities, SystemContext } from '../../../1-kernel/core/types';
import {
  AVATAR_ROOT_OFFSET_Y,
  AvatarAppearance,
  AvatarRig,
  createAvatarGroup,
  disposeAvatarGroup,
  normalizeAvatarAppearance,
} from './AvatarBuilder';
import { CharacterDashboardPanel, type CharacterDashboardSource } from '../../../4-runtime/diagnostics/debug/CharacterDashboardPanel';
import type { StatusMovementModifier } from '../../../3-network/network/MovementModifierContracts';

interface PlayerModelEntityManagerAdapter {
  createEntity(type: string, initialData?: { position?: Vector3; rotation?: Vector3 }): Entity;
  destroyEntity(entity: Entity): void;
  /** Player Initialization Contract: mark a phase ready for the given player. */
  markPlayerPhaseReady?: (playerId: string, phase: import('../../../1-kernel/core/EntityManager').PlayerInitPhase) => void;
}

interface PlayerModelRendererAdapter {
  syncEntity(entity: Entity): void;
  getMeshForEntity?(entityId: string): THREE.Object3D | undefined;
}

interface PlayerModelStateStoreAdapter {
  set(path: string, value: unknown): void;
  /** Read a single value — mirrors StateManager.get(). May return undefined. */
  get(path: string): unknown;
  /**
   * Subscribe to changes on a path. Returns an unsubscribe function.
   * Mirrors StateManager.subscribe().
   */
  subscribe(path: string, callback: (next: unknown, prev: unknown) => void): () => void;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NetworkPlayerPayload {
  id?: string;
  type?: string;
  prefabId?: string;
  archetype?: string;
  position?: Vector3;
  rotation?: Vector3;
  velocity?: Vector3;
  isCrouching?: boolean;
  isAirborne?: boolean;
  health?: number;
  dead?: boolean;
  name?: string;
  statusMovementModifier?: StatusMovementModifier;
}

function vectorDistance(left: Vector3, right: Vector3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function rotationDistance(left: Vector3, right: Vector3): number {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.z - right.z),
  );
}

interface BufferedRemoteSnapshot {
  position: Vector3;
  rotation: Vector3;
  dead: boolean;
  timestamp: number;
}

type PlayerModelBindingState = 'pending' | 'initializing' | 'bound';

interface EntityRegistryEntry {
  playerId: string;
  entityId: string;
  state: PlayerModelBindingState;
  lastSeenAt: number;
}

/** Per-player runtime record managed by this system. */
interface PlayerRecord {
  /** EntityManager entity that drives the three.js mesh. */
  entity: Entity;
  /** Snapshot of the last position we applied — used for interpolation. */
  prevPos: Vector3;
  prevRot: Vector3;
  /** Target state from the latest server packet. */
  targetPos: Vector3;
  targetRot: Vector3;
  /** Interpolation alpha in [0, 1]. Incremented each update(). */
  alpha: number;
  /** Whether this player is currently marked dead. */
  dead: boolean;
  /** Last visual X position used to derive planar speed for presentation. */
  lastVisualX: number;
  /** Last visual Z position used to derive planar speed for presentation. */
  lastVisualZ: number;
  /** Animation phase accumulator for lightweight procedural swing. */
  animationTime: number;
  /** Latest replicated status movement modifier from the authoritative snapshot. */
  statusMovementModifier: StatusMovementModifier | null;
  /** Latest authoritative crouch locomotion state from the snapshot. */
  isCrouching: boolean;
  /** Latest authoritative airborne locomotion state from the snapshot. */
  isAirborne: boolean;
  /** Buffered remote snapshots used for a fixed interpolation delay. */
  pendingSnapshots: BufferedRemoteSnapshot[];
  /** Timestamp of the latest delayed snapshot applied to interpolation. */
  lastQueuedSnapshotTimestamp: number;
  /** Latest authoritative snapshot timestamp where this remote player was observed. */
  lastSeenSnapshotTimestamp: number;
}

// Material palette — one material per player colour slot; reused across model parts.
const DEAD_COLOR           = 0x555555;
const WALK_SPEED_THRESHOLD = 0.08;
const WALK_SPEED_NORMALIZER = 3.5;
const LIMB_SWING_FREQUENCY = 8;
const ARM_SWING_AMPLITUDE = 0.55;
const LEG_SWING_AMPLITUDE = 0.7;
const LIMB_RESET_SPEED = 10;
const CROUCH_BLEND_SPEED = 12;
const CROUCH_TORSO_DROP = 0.22;
const CROUCH_HEAD_DROP = 0.28;
const CROUCH_ARM_DROP = 0.14;
const CROUCH_LEG_BEND = 0.45;
const CROUCH_ARM_BEND = 0.18;
const AIRBORNE_BLEND_SPEED = 10;
const AIRBORNE_ARM_RAISE = 0.35;
const AIRBORNE_LEG_TUCK = 0.28;
const LOBBY_LOCAL_APPEARANCE_PATH = 'lobby.localPlayer.appearance';
const LEGACY_LOCAL_APPEARANCE_PATH = 'player.local.appearance';
const REMOTE_POSITION_DEADBAND = 0.035;
const REMOTE_ROTATION_DEADBAND = 0.02;
const REMOTE_IDLE_VELOCITY_EPSILON = 0.05;
const REMOTE_STALE_PRUNE_MS = 2000;

// ─── PlayerModelSystem ───────────────────────────────────────────────────────

export class PlayerModelSystem implements CharacterDashboardSource {
  private scene:          THREE.Scene;
  private entityManager:  PlayerModelEntityManagerAdapter;
  private entityRenderer: PlayerModelRendererAdapter;
  private stateManager:   PlayerModelStateStoreAdapter;
  private systemContext:  SystemContext | null = null;

  private localPlayerId:  string = '';
  private localPlayerEntity: Entity | null = null;
  private localAvatarGroup: THREE.Group | null = null;
  private localAvatarVisible = false;
  private localAppearance: AvatarAppearance = normalizeAvatarAppearance();
  private characterDashboardPanel: CharacterDashboardPanel | null = null;
  private players:        Map<string, PlayerRecord> = new Map();
  private playerGroups:   Map<string, THREE.Group>  = new Map(); // THREE.Group per player
  private readonly entityRegistry: Map<string, EntityRegistryEntry> = new Map();
  /** StateManager unsubscribe callbacks keyed by remote playerId. */
  private appearanceUnsubs: Map<string, () => void> = new Map();
  /** Unsubscribe for the LOCAL player's appearance StateManager subscription. */
  private localAppearanceUnsub: (() => void) | null = null;
  private localAvatarAnimationTime = 0;
  private localAvatarLastX = 0;
  private localAvatarLastZ = 0;
  private localAvatarMotionInitialized = false;
  private localPresentationMovementState = { isCrouching: false, isAirborne: false };
  private lastUpdateDt = 1 / 60;
  private snapshotInterpolationDelayMs = 50;

  /** Expected snapshot cadence in milliseconds (calculated from server tick rate). */
  private expectedSnapshotIntervalMs = 1000 / 60; // 60 Hz = ~16.67ms

  /** How fast positions interpolate toward target per second (0-1 range). */
  private readonly INTERP_SPEED = 8;

  constructor(
    scene: THREE.Scene,
    entityManager: PlayerModelEntityManagerAdapter,
    entityRenderer: PlayerModelRendererAdapter,
    stateManager: PlayerModelStateStoreAdapter,
  ) {
    this.scene          = scene;
    this.entityManager  = entityManager;
    this.entityRenderer  = entityRenderer;
    this.stateManager   = stateManager;
    this.localAppearance = this.readPendingLocalAppearance();
    this.bindLocalAppearanceSubscription();
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
      status: 'ok',
      active: true,
      metrics: {
        trackedPlayers: this.players.size,
        activeModels: this.playerGroups.size,
        localPlayerId: this.localPlayerId || null,
        localPlayerEntityId: this.localPlayerEntity?.id ?? null,
        localAvatarVisible: this.localAvatarVisible,
        hasSystemContext: this.systemContext !== null,
        entityRegistrySize: this.entityRegistry.size,
        samplePlayerIds: [...this.players.keys()].slice(0, 12),
      },
      localAppearance: this.localAppearance,
      localPresentationMovementState: { ...this.localPresentationMovementState },
    };
  }

  getMovementDebugStates(): Array<{
    playerId: string;
    entityId: string;
    networkEntityId: string;
    currentPosition: Vector3;
    movementIntent: null;
    isCrouching: boolean;
    isAirborne: boolean;
    animationState: {
      crouching: boolean;
      airborne: boolean;
    };
    statusMovementModifier: StatusMovementModifier | null;
    derivedStatusMovementModifier: null;
    debugStatusMovementModifier: null;
    effectiveStatusMovementModifier: StatusMovementModifier | null;
  }> {
    return [...this.players.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, record]) => ({
        playerId,
        entityId: record.entity.id,
        networkEntityId: playerId,
        currentPosition: record.entity.getPosition(),
        movementIntent: null,
        isCrouching: record.isCrouching,
        isAirborne: record.isAirborne,
        animationState: {
          crouching: record.isCrouching,
          airborne: record.isAirborne,
        },
        statusMovementModifier: record.statusMovementModifier,
        derivedStatusMovementModifier: null,
        debugStatusMovementModifier: null,
        effectiveStatusMovementModifier: record.statusMovementModifier,
      }));
  }

  getLocalPresentationMovementState(): { isCrouching: boolean; isAirborne: boolean } {
    return { ...this.localPresentationMovementState };
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  setLocalPlayerId(id: string): void {
    if (id && this.players.has(id)) {
      this.removePlayer(id);
    }
    this.localPlayerId = id;

    this.localAppearance = this.readPendingLocalAppearance();
    this.bindLocalAppearanceSubscription();

    this.persistLocalAppearance();
    this.characterDashboardPanel?.sync();
  }

  bindLocalPlayerEntity(entity: Entity | null): void {
    this.localPlayerEntity = entity;
    if (!entity) {
      this.disposeLocalAvatarGroup();
      this.localAvatarMotionInitialized = false;
      this.characterDashboardPanel?.sync();
      return;
    }

    if (entity.hasComponent('render')) {
      entity.removeComponent('render');
      this.entityRenderer.syncEntity(entity);
    }

    this.rebuildLocalAvatarGroup();
    // Mark the 'avatar' phase ready on EntityManager to advance the Player
    // Initialization Contract.  The local player model is now live.
    if (this.localPlayerId) {
      this.entityManager.markPlayerPhaseReady?.(this.localPlayerId, 'avatar');
    }
    this.characterDashboardPanel?.sync();
  }

  setLocalAvatarVisible(visible: boolean): void {
    this.localAvatarVisible = visible;
    if (this.localAvatarGroup) {
      this.localAvatarGroup.visible = visible;
    }
    this.characterDashboardPanel?.sync();
  }

  syncVisualTransformsNow(): void {
    for (const [playerId, record] of this.players.entries()) {
      const group = this.playerGroups.get(playerId);
      if (!group) {
        continue;
      }

      const position = record.entity.getPosition();
      const rotation = record.entity.getRotation();
      record.prevPos = { ...position };
      record.targetPos = { ...position };
      record.prevRot = { ...rotation };
      record.targetRot = { ...rotation };
      record.alpha = 1;
      record.lastVisualX = position.x;
      record.lastVisualZ = position.z;

      group.position.set(position.x, this.toVisualGroundY(position.y), position.z);
      group.rotation.set(0, rotation.y, 0);
    }

    this.syncLocalAvatarTransform();
  }

  setLocalPresentationMovementState(state: { isCrouching: boolean; isAirborne: boolean } | null): void {
    this.localPresentationMovementState = state
      ? {
          isCrouching: state.isCrouching === true,
          isAirborne: state.isAirborne === true,
        }
      : { isCrouching: false, isAirborne: false };
  }

  setSnapshotInterpolationDelayMs(delayMs: number): void {
    this.snapshotInterpolationDelayMs = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
  }

  /**
   * Receive server tick synchronization events to calibrate snapshot timing expectations.
   * Called on every TICK_SYNC broadcast from the server (60 Hz by default).
   * Helps the interpolation system predict when snapshots will arrive.
   */
  onServerTickSync(tickRate: number): void {
    if (tickRate > 0 && Number.isFinite(tickRate)) {
      this.expectedSnapshotIntervalMs = 1000 / tickRate;
    }
  }

  getLocalAppearance(): AvatarAppearance {
    return { ...this.localAppearance };
  }

  setLocalAppearance(next: Partial<AvatarAppearance>): void {
    this.localAppearance = normalizeAvatarAppearance({ ...this.localAppearance, ...next });
    this.persistLocalAppearance();
    this.rebuildLocalAvatarGroup();
    this.characterDashboardPanel?.sync();
    // Broadcast change so MultiplayerRuntimeCoordinator can replicate it.
    gameBus.emit('PLAYER_APPEARANCE_CHANGED', {
      playerId: this.localPlayerId || 'local',
      appearance: { ...this.localAppearance },
    });
  }

  getLocalBindingSummary(): { playerId: string | null; entityId: string | null; liveAvatarVisible: boolean; bound: boolean } {
    return {
      playerId: this.localPlayerId || null,
      entityId: this.localPlayerEntity?.id ?? null,
      liveAvatarVisible: this.localAvatarVisible,
      bound: this.localPlayerEntity !== null,
    };
  }

  getLocalAvatarMesh(): THREE.Mesh | null {
    if (!this.localAvatarGroup) {
      return null;
    }
    let nestedMesh: THREE.Mesh | null = null;
    this.localAvatarGroup.traverse((child) => {
      if (!nestedMesh && child instanceof THREE.Mesh) {
        nestedMesh = child;
      }
    });
    return nestedMesh;
  }

  getPlayerWorldPosition(playerId: string): Vector3 | null {
    if (!playerId) {
      return null;
    }

    if (playerId === this.localPlayerId) {
      const localEntity = this.localPlayerEntity;
      return localEntity ? { ...localEntity.getPosition() } : null;
    }

    const record = this.players.get(playerId);
    return record ? { ...record.entity.getPosition() } : null;
  }

  getDebugPanel(requestRefresh: () => void): HTMLElement | null {
    if (!this.characterDashboardPanel) {
      this.characterDashboardPanel = new CharacterDashboardPanel(this, requestRefresh);
    }
    this.characterDashboardPanel.sync();
    return this.characterDashboardPanel.getElement();
  }

  // ─── Spawn ─────────────────────────────────────────────────────────────────

  isEntityRegistryEmpty(): boolean {
    return this.entityRegistry.size === 0;
  }

  isEntityRegistryReady(playerId: string | null | undefined): boolean {
    if (!playerId) {
      return false;
    }
    const entry = this.entityRegistry.get(playerId);
    return !!entry && entry.state === 'bound';
  }

  private upsertEntityRegistryEntry(playerId: string, entityId: string, state: PlayerModelBindingState): EntityRegistryEntry {
    const now = Engine.time.now();
    const existing = this.entityRegistry.get(playerId);
    const next: EntityRegistryEntry = {
      playerId,
      entityId,
      state,
      lastSeenAt: now,
    };
    if (existing && existing.state === 'bound' && state !== 'bound') {
      next.state = 'bound';
      next.entityId = existing.entityId;
    }
    this.entityRegistry.set(playerId, next);
    return next;
  }

  private deriveManifestEntityId(payload: NetworkPlayerPayload): string | null {
    if (typeof payload.id === 'string' && payload.id.length > 0) {
      return payload.id;
    }
    return null;
  }

  private refreshEntityRegistryFromSnapshot(entities: NetworkPlayerPayload[], snapshotTimestamp: number): void {
    for (const payload of entities) {
      if (payload.type && payload.type !== 'player') {
        continue;
      }
      const playerId = typeof payload.id === 'string' ? payload.id : null;
      if (!playerId || playerId === this.localPlayerId) {
        continue;
      }
      const manifestEntityId = this.deriveManifestEntityId(payload);
      if (!manifestEntityId) {
        continue;
      }
      const state: PlayerModelBindingState = this.players.has(playerId) ? 'bound' : 'pending';
      const entry = this.upsertEntityRegistryEntry(playerId, manifestEntityId, state);
      entry.lastSeenAt = snapshotTimestamp;
      this.entityRegistry.set(playerId, entry);
    }
  }

  /**
   * Spawn a fully assembled low-poly character model for a remote player.
   * Does nothing if this playerId is the local player or already spawned.
   */
  spawnPlayer(playerId: string, position: Vector3, rotation: Vector3): void {
    if (playerId === this.localPlayerId) return;
    if (this.players.has(playerId))     return;

    const registryEntry = this.entityRegistry.get(playerId);
    if (!registryEntry) {
      return;
    }
    if (registryEntry.state === 'pending') {
      this.upsertEntityRegistryEntry(playerId, registryEntry.entityId, 'initializing');
    }

    console.log('[SpawnDiagnostics] PLAYER SPAWN REQUEST', {
      source: 'player_model_system',
      playerId,
      position,
      rotation,
    });

    // Create the EntityManager entity (data layer)
    const entity = this.entityManager.createEntity('RemotePlayer', {
      position,
      rotation,
    });

    // Attach a render component so EntityRenderer creates an anchor mesh.
    // We use a very small invisible box as the ECS "root" — the visual model
    // is built into a THREE.Group attached to the same Object3D in the scene.
    entity.addComponent({
      name: 'render',
      data: {
        meshType:  'box',
        color:     0x000000,
        geometry:  { width: 0.01, height: 0.01, depth: 0.01 },
      },
    });
    this.entityRenderer.syncEntity(entity);

    // Build the visual THREE.Group from authoritative/state appearance only.
    const savedAppearance = this.stateManager.get(`player.${playerId}.appearance`);
    if (!savedAppearance || typeof savedAppearance !== 'object') {
      this.upsertEntityRegistryEntry(playerId, registryEntry.entityId, 'pending');
      return;
    }
    const spawnAppearance: Partial<AvatarAppearance> = savedAppearance as Partial<AvatarAppearance>;
    const group = createAvatarGroup(spawnAppearance);
    group.position.set(position.x, this.toVisualGroundY(position.y), position.z);
    group.rotation.set(0, rotation.y, 0);
    // Stamp the network player ID on the group so raycasters can identify the target
    group.userData.playerId = playerId;
    group.userData.isPlayerModel = true;
    setRaycastLayersRecursive(group, 'player');
    this.scene.add(group);
    this.playerGroups.set(playerId, group);

    const record: PlayerRecord = {
      entity,
      prevPos:   { ...position },
      prevRot:   { ...rotation },
      targetPos: { ...position },
      targetRot: { ...rotation },
      alpha:     1,
      dead:      false,
      lastVisualX: position.x,
      lastVisualZ: position.z,
      animationTime: 0,
      statusMovementModifier: null,
      isCrouching: false,
      isAirborne: false,
      pendingSnapshots: [],
      lastQueuedSnapshotTimestamp: 0,
      lastSeenSnapshotTimestamp: Engine.time.now(),
    };
    this.players.set(playerId, record);
    this.upsertEntityRegistryEntry(playerId, registryEntry.entityId, 'bound');
    console.log('[SpawnDiagnostics] ENTITY CREATED', {
      source: 'player_model_system',
      playerId,
      entityId: entity.id,
      entityType: entity.type,
    });

    // Store in StateManager so Save/Load and network layers can see alive players
    this.stateManager.set(`players.${playerId}.entityId`, entity.id);
    this.stateManager.set(`players.${playerId}.type`, 'remote');
    // Subscribe to appearance changes for this remote player so we can
    // rebuild their mesh in real-time if a PLAYER_APPEARANCE message arrives
    // after initial spawn.
    const unsub = this.stateManager.subscribe(
      `player.${playerId}.appearance`,
      (next) => {
        if (next && typeof next === 'object') {
          this._applyAppearanceToRemoteGroup(playerId, next as Partial<AvatarAppearance>);
        }
      },
    );
    this.appearanceUnsubs.set(playerId, unsub);
    gameBus.emit('playerModelSpawned', {
      playerId,
      entityId: entity.id,
      position: { ...position },
    });
    console.log('[SpawnDiagnostics] MODEL ATTACHED', {
      playerId,
      entityId: entity.id,
      groupChildren: group.children.length,
    });

    console.log(`[PlayerModelSystem] Spawned remote player: ${playerId} (entity ${entity.id})`);
  }

  // ─── Sync / update from network ────────────────────────────────────────────

  /**
  * Process a batch of authoritative snapshot entity payloads.
   * Spawns players that don't exist yet, queues transform updates for those that do.
   */
  syncFromPayload(entities: NetworkPlayerPayload[], snapshotTimestamp = Engine.time.now()): void {
    this.refreshEntityRegistryFromSnapshot(entities, snapshotTimestamp);
    const seenRemotePlayerIds = new Set<string>();
    for (const we of entities) {
      try {
        if (!we.id) continue;
        if (we.id === this.localPlayerId) continue;
        if (we.type && we.type !== 'player') {
          const details = {
            source: 'player_model_system_sync',
            playerId: we.id,
            receivedType: we.type,
            reason: 'unexpected_non_player_type',
          };
          console.error('[SpawnDiagnostics] FATAL_PREFAB_MISSING', details);
          throw new Error(`FATAL_PREFAB_MISSING: invalid player payload type (${String(we.type)})`);
        }

        const registryEntry = this.entityRegistry.get(we.id);
        if (!registryEntry) {
          continue;
        }

        const existing = this.players.get(we.id);
        if (!existing) {
          if (!we.position || !we.rotation) continue;
          if (registryEntry.state === 'pending') {
            this.upsertEntityRegistryEntry(we.id, registryEntry.entityId, 'initializing');
          }
          const pos: Vector3 = we.position;
          const rot: Vector3 = we.rotation;
          this.spawnPlayer(we.id, pos, rot);
          const created = this.players.get(we.id);
          seenRemotePlayerIds.add(we.id);
          if (created && Object.prototype.hasOwnProperty.call(we, 'statusMovementModifier')) {
            created.statusMovementModifier = we.statusMovementModifier ?? null;
          }
          if (created && Object.prototype.hasOwnProperty.call(we, 'isCrouching')) {
            created.isCrouching = we.isCrouching === true;
          }
          if (created && Object.prototype.hasOwnProperty.call(we, 'isAirborne')) {
            created.isAirborne = we.isAirborne === true;
          }
          if (created) {
            created.lastSeenSnapshotTimestamp = snapshotTimestamp;
            this.upsertEntityRegistryEntry(we.id, registryEntry.entityId, 'bound');
          }
        } else {
          seenRemotePlayerIds.add(we.id);
          this.upsertEntityRegistryEntry(we.id, registryEntry.entityId, 'bound');
          existing.lastSeenSnapshotTimestamp = snapshotTimestamp;
          if (Object.prototype.hasOwnProperty.call(we, 'statusMovementModifier')) {
            existing.statusMovementModifier = we.statusMovementModifier ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(we, 'isCrouching')) {
            existing.isCrouching = we.isCrouching === true;
          }
          if (Object.prototype.hasOwnProperty.call(we, 'isAirborne')) {
            existing.isAirborne = we.isAirborne === true;
          }
          const currentGroup = this.playerGroups.get(we.id);
          const pos: Vector3 = we.position
            ?? existing.targetPos
              ?? (currentGroup
                ? {
                    x: currentGroup.position.x,
                    y: this.fromVisualGroundY(currentGroup.position.y),
                    z: currentGroup.position.z,
                  }
                : { x: 0, y: 0, z: 0 });
          const rot: Vector3 = we.rotation
            ?? existing.targetRot
            ?? (currentGroup ? { x: currentGroup.rotation.x, y: currentGroup.rotation.y, z: currentGroup.rotation.z } : { x: 0, y: 0, z: 0 });
          const velocity = we.velocity ?? { x: 0, y: 0, z: 0 };
          const positionDelta = vectorDistance(pos, existing.targetPos);
          const rotationDelta = rotationDistance(rot, existing.targetRot);
          const planarSpeed = Math.hypot(velocity.x, velocity.z);

          if (positionDelta <= REMOTE_POSITION_DEADBAND && rotationDelta <= REMOTE_ROTATION_DEADBAND) {
            if (planarSpeed <= REMOTE_IDLE_VELOCITY_EPSILON) {
              existing.prevPos = { ...pos };
              existing.targetPos = { ...pos };
              existing.prevRot = { ...rot };
              existing.targetRot = { ...rot };
              existing.alpha = 1;
              if (currentGroup) {
                currentGroup.position.set(pos.x, this.toVisualGroundY(pos.y), pos.z);
                currentGroup.rotation.set(0, rot.y, 0);
              }
              existing.entity.setPosition({ ...pos });
              existing.entity.setRotation({ x: 0, y: rot.y, z: 0 });
            }
            continue;
          }
          this.queueDelayedTransformUpdate(we.id, pos, rot, we.dead ?? false, snapshotTimestamp);
        }
      } catch (error) {
        console.error(`[PlayerModelSystem] Skipping snapshot sync for "${we.id ?? 'unknown'}"`, error);
      }
    }

    if (seenRemotePlayerIds.size > 0) {
      const now = Math.max(snapshotTimestamp, Engine.time.now());
      for (const [playerId, record] of this.players.entries()) {
        if (seenRemotePlayerIds.has(playerId)) {
          continue;
        }
        if (now - record.lastSeenSnapshotTimestamp < REMOTE_STALE_PRUNE_MS) {
          continue;
        }
        this.removePlayer(playerId);
      }
    }
  }

  private queueDelayedTransformUpdate(
    playerId: string,
    position: Vector3,
    rotation: Vector3,
    dead: boolean,
    snapshotTimestamp: number,
  ): void {
    const rec = this.players.get(playerId);
    if (!rec) {
      return;
    }

    if (this.snapshotInterpolationDelayMs <= 0) {
      this._queueTransformUpdate(playerId, position, rotation, dead);
      return;
    }

    rec.pendingSnapshots.push({
      position: { ...position },
      rotation: { ...rotation },
      dead,
      timestamp: snapshotTimestamp,
    });

    const maxBufferedSnapshots = 8;
    while (rec.pendingSnapshots.length > maxBufferedSnapshots) {
      rec.pendingSnapshots.shift();
    }
  }

  private flushDelayedSnapshot(playerId: string, rec: PlayerRecord, now: number): void {
    if (rec.pendingSnapshots.length === 0) {
      return;
    }

    const targetTime = now - this.snapshotInterpolationDelayMs;
    let selected: BufferedRemoteSnapshot | null = null;

    while (rec.pendingSnapshots.length > 0 && rec.pendingSnapshots[0].timestamp <= targetTime) {
      selected = rec.pendingSnapshots.shift() ?? null;
    }

    if (!selected || selected.timestamp <= rec.lastQueuedSnapshotTimestamp) {
      return;
    }

    rec.lastQueuedSnapshotTimestamp = selected.timestamp;
    this._queueTransformUpdate(playerId, selected.position, selected.rotation, selected.dead);
  }

  /**
   * Queue a smooth transform target for the next update() call.
   * Keeps the previous snapshot for interpolation.
   */
  private _queueTransformUpdate(
    playerId: string,
    position: Vector3,
    rotation: Vector3,
    dead: boolean,
  ): void {
    const rec = this.players.get(playerId);
    if (!rec) return;

    // Snapshot the *current visual* position as interpolation start so there
    // is no backward jump when a new delta arrives mid-interpolation.
    const currentGroup = this.playerGroups.get(playerId);
    if (currentGroup) {
      rec.prevPos = {
        x: currentGroup.position.x,
        y: this.fromVisualGroundY(currentGroup.position.y),
        z: currentGroup.position.z,
      };
      rec.prevRot = { x: currentGroup.rotation.x, y: currentGroup.rotation.y, z: currentGroup.rotation.z };
    } else {
      rec.prevPos = { ...rec.targetPos };
      rec.prevRot = { ...rec.targetRot };
    }
    rec.targetPos = { ...position };
    rec.targetRot = { ...rotation };
    rec.alpha = 0;

    // Handle dead state visually
    if (dead !== rec.dead) {
      rec.dead = dead;
      this._applyDeadState(playerId, dead);
    }
  }

  /**
   * Run per-frame interpolation for all remote player groups.
   * Call this from the game loop (Engine.onUpdate).
   */
  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.1);
    const now = Engine.time.now();
    this.lastUpdateDt = Math.max(dt, 1 / 240);

    for (const [playerId, rec] of this.players.entries()) {
      try {
        const group = this.playerGroups.get(playerId);
        if (!group) continue;

        this.flushDelayedSnapshot(playerId, rec, now);

        // Advance interpolation
        rec.alpha = Math.min(1, rec.alpha + dt * this.INTERP_SPEED);
        const t = rec.alpha;

        const ix = rec.prevPos.x + (rec.targetPos.x - rec.prevPos.x) * t;
        const iy = rec.prevPos.y + (rec.targetPos.y - rec.prevPos.y) * t;
        const iz = rec.prevPos.z + (rec.targetPos.z - rec.prevPos.z) * t;

        const iry = rec.prevRot.y + (rec.targetRot.y - rec.prevRot.y) * t;
        const planarDistance = Math.hypot(ix - rec.lastVisualX, iz - rec.lastVisualZ);
        const planarSpeed = dt > 0 ? planarDistance / dt : 0;
        rec.lastVisualX = ix;
        rec.lastVisualZ = iz;

        // Apply to THREE group (visual layer)
        group.position.set(ix, this.toVisualGroundY(iy), iz);
        group.rotation.y = iry;
        this.applyProceduralAnimation(group, rec, planarSpeed, dt);

        // Sync entity transform (data layer — drives StateManager too)
        rec.entity.setPosition({ x: ix, y: iy, z: iz });
        rec.entity.setRotation({ x: 0, y: iry, z: 0 });
      } catch (error) {
        console.error(`[PlayerModelSystem] Skipping remote player update for "${playerId}"`, error);
      }
    }

    try {
      this.syncLocalAvatarTransform();
    } catch (error) {
      console.error('[PlayerModelSystem] Failed to sync local avatar transform', error);
    }
  }

  // ─── Removal ───────────────────────────────────────────────────────────────

  removePlayer(playerId: string): void {
    const rec = this.players.get(playerId);
    const removedEntityId = rec?.entity.id ?? null;
    if (rec) {
      this.entityManager.destroyEntity(rec.entity);
      this.players.delete(playerId);
    }

    // Cancel the StateManager appearance subscription for this player.
    this.appearanceUnsubs.get(playerId)?.();
    this.appearanceUnsubs.delete(playerId);

    const group = this.playerGroups.get(playerId);
    if (group) {
      this.scene.remove(group);
      this._disposeGroup(group);
      this.playerGroups.delete(playerId);
    }

    // Clean up StateManager entries
    this.stateManager.set(`players.${playerId}`, undefined as any);
    this.entityRegistry.delete(playerId);
    gameBus.emit('playerModelRemoved', {
      playerId,
      entityId: removedEntityId,
    });

    console.log(`[PlayerModelSystem] Removed remote player: ${playerId}`);
  }

  clearAll(): void {
    for (const playerId of [...this.players.keys()]) {
      this.removePlayer(playerId);
    }
    this.disposeLocalAvatarGroup();
  }

  handleRespawn(playerId: string, position: Vector3, rotation: Vector3 = { x: 0, y: 0, z: 0 }): void {
    if (!this.players.has(playerId)) {
      this.upsertEntityRegistryEntry(playerId, playerId, 'initializing');
      this.spawnPlayer(playerId, position, rotation);
      return;
    }

    const record = this.players.get(playerId);
    const group = this.playerGroups.get(playerId);
    if (!record || !group) return;

    record.prevPos = { ...position };
    record.targetPos = { ...position };
    record.prevRot = { ...rotation };
    record.targetRot = { ...rotation };
    record.alpha = 1;
    record.dead = false;
    record.lastVisualX = position.x;
    record.lastVisualZ = position.z;
    record.animationTime = 0;
    record.isCrouching = false;
    record.isAirborne = false;

    group.position.set(position.x, this.toVisualGroundY(position.y), position.z);
    group.rotation.set(0, rotation.y, 0);
    this.applyIdlePose(group, 0);
    this.applyAirbornePose(group, false, 0);
    this.applyCrouchPose(group, false, 0);

    record.entity.setPosition({ ...position });
    record.entity.setRotation({ ...rotation });
    this._applyDeadState(playerId, false);
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  hasPlayer(playerId: string): boolean          { return this.players.has(playerId); }
  getPlayerIds(): string[]                       { return [...this.players.keys()]; }
  getEntity(playerId: string): Entity | undefined { return this.players.get(playerId)?.entity; }
  getGroup(playerId: string): THREE.Group | undefined { return this.playerGroups.get(playerId); }
  getPlayerCount(): number                       { return this.players.size; }

  /**
   * Return the invisible hitbox mesh for a specific player.
   * Use this with THREE.Raycaster for shooting / hit detection.
   */
  getHitbox(playerId: string): THREE.Mesh | null {
    const group = this.playerGroups.get(playerId);
    if (!group) return null;
    let hitbox: THREE.Mesh | null = null;
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.isHitbox) hitbox = obj;
    });
    return hitbox;
  }

  /**
   * Return all hitbox meshes for all remote players — pass this array to
   * Raycaster.intersectObjects() to detect player hits.
   */
  getAllHitboxes(): THREE.Mesh[] {
    const result: THREE.Mesh[] = [];
    for (const playerId of this.players.keys()) {
      const hb = this.getHitbox(playerId);
      if (hb) result.push(hb);
    }
    return result;
  }

  // ─── Dead state ────────────────────────────────────────────────────────────

  private _applyDeadState(playerId: string, dead: boolean): void {
    const group = this.playerGroups.get(playerId);
    if (!group) return;

    group.traverse((obj) => {
      if (obj.userData.isHitbox) return;
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshLambertMaterial;
        if (dead) {
          mat.color.setHex(DEAD_COLOR);
        } else {
          if (typeof obj.userData._baseColor === 'number') {
            mat.color.setHex(obj.userData._baseColor);
          }
        }
      }
    });

    // Lay the model on its side when dead
    group.rotation.z = dead ? Math.PI / 2 : 0;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  private _disposeGroup(group: THREE.Group): void {
    disposeAvatarGroup(group);
  }

  destroy(): void {
    this.clearAll();
    this.localAppearanceUnsub?.();
    this.localAppearanceUnsub = null;
    this.characterDashboardPanel?.destroy();
    this.characterDashboardPanel = null;
  }

  private rebuildLocalAvatarGroup(): void {
    this.disposeLocalAvatarGroup();
    if (!this.localPlayerEntity) return;

    this.localAvatarGroup = createAvatarGroup(this.localAppearance, { includeHitbox: false });
    this.localAvatarGroup.userData.playerId = this.localPlayerId || 'local';
    this.localAvatarGroup.userData.isLocalPlayerAvatar = true;
    this.localAvatarGroup.visible = this.localAvatarVisible;
    this.scene.add(this.localAvatarGroup);
    const transform = this.localPlayerEntity.getTransform();
    this.localAvatarLastX = transform.position.x;
    this.localAvatarLastZ = transform.position.z;
    this.localAvatarAnimationTime = 0;
    this.localAvatarMotionInitialized = true;
    this.applyIdlePose(this.localAvatarGroup, 0);
    this.syncLocalAvatarTransform();
  }

  private disposeLocalAvatarGroup(): void {
    if (!this.localAvatarGroup) return;
    this.scene.remove(this.localAvatarGroup);
    this._disposeGroup(this.localAvatarGroup);
    this.localAvatarGroup = null;
  }

  private syncLocalAvatarTransform(): void {
    if (!this.localAvatarGroup || !this.localPlayerEntity) return;
    const transform = this.localPlayerEntity.getTransform();
    const dx = transform.position.x - this.localAvatarLastX;
    const dz = transform.position.z - this.localAvatarLastZ;
    const planarSpeed = this.localAvatarMotionInitialized ? Math.hypot(dx, dz) / this.lastUpdateDt : 0;
    this.localAvatarGroup.position.set(
      transform.position.x,
      this.toVisualGroundY(transform.position.y),
      transform.position.z,
    );
    this.localAvatarGroup.rotation.set(0, transform.rotation.y, 0);
    this.localAvatarGroup.visible = this.localAvatarVisible;
    this.applyLocalAvatarAnimation(planarSpeed, this.lastUpdateDt);
    this.localAvatarLastX = transform.position.x;
    this.localAvatarLastZ = transform.position.z;
    this.localAvatarMotionInitialized = true;
  }

  private toVisualGroundY(worldY: number): number {
    return worldY - AVATAR_ROOT_OFFSET_Y;
  }

  private fromVisualGroundY(visualY: number): number {
    return visualY + AVATAR_ROOT_OFFSET_Y;
  }

  private applyLocalAvatarAnimation(planarSpeed: number, dt: number): void {
    if (!this.localAvatarGroup) return;
    const { isCrouching, isAirborne } = this.localPresentationMovementState;
    if (!this.localAvatarVisible) {
      this.applyIdlePose(this.localAvatarGroup, dt);
      this.applyAirbornePose(this.localAvatarGroup, isAirborne, dt);
      this.applyCrouchPose(this.localAvatarGroup, isCrouching && !isAirborne, dt);
      return;
    }

    if (isAirborne) {
      this.applyIdlePose(this.localAvatarGroup, dt);
      this.applyAirbornePose(this.localAvatarGroup, true, dt);
      this.applyCrouchPose(this.localAvatarGroup, false, dt);
      return;
    }

    const speedFactor = Math.min(1, planarSpeed / WALK_SPEED_NORMALIZER);
    if (speedFactor <= WALK_SPEED_THRESHOLD) {
      this.applyIdlePose(this.localAvatarGroup, dt);
      this.applyAirbornePose(this.localAvatarGroup, false, dt);
      this.applyCrouchPose(this.localAvatarGroup, isCrouching, dt);
      return;
    }

    this.localAvatarAnimationTime += dt * (0.4 + speedFactor * LIMB_SWING_FREQUENCY);
    this.applyWalkPose(this.localAvatarGroup, this.localAvatarAnimationTime, speedFactor);
    this.applyAirbornePose(this.localAvatarGroup, false, dt);
    this.applyCrouchPose(this.localAvatarGroup, isCrouching, dt);
  }

  private applyProceduralAnimation(group: THREE.Group, record: PlayerRecord, planarSpeed: number, dt: number): void {
    if (record.dead) {
      this.applyIdlePose(group, dt);
      this.applyAirbornePose(group, false, dt);
      this.applyCrouchPose(group, false, dt);
      return;
    }

    if (record.isAirborne) {
      this.applyIdlePose(group, dt);
      this.applyAirbornePose(group, true, dt);
      this.applyCrouchPose(group, false, dt);
      return;
    }

    const speedFactor = Math.min(1, planarSpeed / WALK_SPEED_NORMALIZER);
    if (speedFactor <= WALK_SPEED_THRESHOLD) {
      this.applyIdlePose(group, dt);
      this.applyAirbornePose(group, false, dt);
      this.applyCrouchPose(group, record.isCrouching, dt);
      return;
    }

    record.animationTime += dt * (0.4 + speedFactor * LIMB_SWING_FREQUENCY);
    this.applyWalkPose(group, record.animationTime, speedFactor);
    this.applyAirbornePose(group, false, dt);
    this.applyCrouchPose(group, record.isCrouching, dt);
  }

  private applyWalkPose(group: THREE.Group, animationTime: number, speedFactor: number): void {
    const rig = this.getAvatarRig(group);
    if (!rig) return;

    const swing = Math.sin(animationTime);
    rig.leftArm.rotation.x = swing * ARM_SWING_AMPLITUDE * speedFactor;
    rig.rightArm.rotation.x = -swing * ARM_SWING_AMPLITUDE * speedFactor;
    rig.leftLeg.rotation.x = -swing * LEG_SWING_AMPLITUDE * speedFactor;
    rig.rightLeg.rotation.x = swing * LEG_SWING_AMPLITUDE * speedFactor;
  }

  private applyIdlePose(group: THREE.Group, dt: number): void {
    const rig = this.getAvatarRig(group);
    if (!rig) return;
    const resetFactor = Math.min(1, Math.max(0, dt) * LIMB_RESET_SPEED);
    rig.leftArm.rotation.x += (0 - rig.leftArm.rotation.x) * resetFactor;
    rig.rightArm.rotation.x += (0 - rig.rightArm.rotation.x) * resetFactor;
    rig.leftLeg.rotation.x += (0 - rig.leftLeg.rotation.x) * resetFactor;
    rig.rightLeg.rotation.x += (0 - rig.rightLeg.rotation.x) * resetFactor;
  }

  private getAvatarRig(group: THREE.Group): AvatarRig | null {
    const rig = group.userData.avatarRig as AvatarRig | undefined;
    return rig ?? null;
  }

  private applyCrouchPose(group: THREE.Group, isCrouching: boolean, dt: number): void {
    const rig = this.getAvatarRig(group);
    const restPose = group.userData.avatarRestPose as {
      torsoY: number;
      headY: number;
      leftArmY: number;
      rightArmY: number;
      leftLegY: number;
      rightLegY: number;
    } | undefined;
    if (!rig || !restPose) return;

    const targetBlend = isCrouching ? 1 : 0;
    const currentBlend = typeof group.userData.crouchBlend === 'number' ? group.userData.crouchBlend : 0;
    const blend = currentBlend + (targetBlend - currentBlend) * Math.min(1, Math.max(0, dt) * CROUCH_BLEND_SPEED);
    const blendDelta = blend - currentBlend;
    group.userData.crouchBlend = blend;

    rig.torso.position.y = restPose.torsoY - CROUCH_TORSO_DROP * blend;
    rig.head.position.y = restPose.headY - CROUCH_HEAD_DROP * blend;
    rig.leftArm.position.y = restPose.leftArmY - CROUCH_ARM_DROP * blend;
    rig.rightArm.position.y = restPose.rightArmY - CROUCH_ARM_DROP * blend;
    rig.leftLeg.position.y = restPose.leftLegY;
    rig.rightLeg.position.y = restPose.rightLegY;
    rig.leftLeg.rotation.x += CROUCH_LEG_BEND * blendDelta;
    rig.rightLeg.rotation.x += CROUCH_LEG_BEND * blendDelta;
    rig.leftArm.rotation.x += CROUCH_ARM_BEND * blendDelta;
    rig.rightArm.rotation.x += CROUCH_ARM_BEND * blendDelta;
  }

  private applyAirbornePose(group: THREE.Group, isAirborne: boolean, dt: number): void {
    const rig = this.getAvatarRig(group);
    if (!rig) return;

    const targetBlend = isAirborne ? 1 : 0;
    const currentBlend = typeof group.userData.airborneBlend === 'number' ? group.userData.airborneBlend : 0;
    const factor = Math.min(1, Math.max(0, dt) * AIRBORNE_BLEND_SPEED);
    const blend = currentBlend + (targetBlend - currentBlend) * factor;
    group.userData.airborneBlend = blend;

    const targetArmRotation = -AIRBORNE_ARM_RAISE * blend;
    const targetLegRotation = AIRBORNE_LEG_TUCK * blend;
    rig.leftArm.rotation.x += (targetArmRotation - rig.leftArm.rotation.x) * factor;
    rig.rightArm.rotation.x += (targetArmRotation - rig.rightArm.rotation.x) * factor;
    rig.leftLeg.rotation.x += (targetLegRotation - rig.leftLeg.rotation.x) * factor;
    rig.rightLeg.rotation.x += (targetLegRotation - rig.rightLeg.rotation.x) * factor;
  }

  /**
  * Called when the subscribed local appearance path changes externally.
   * (e.g. EditorMenu APPLY button writes a partial object).  Updates the local
   * avatar in-place without re-writing to StateManager (avoiding a feedback
   * loop) and broadcasts the change via gameBus so multiplayer can replicate it.
   */
  private _onLocalAppearanceStateChange(next: unknown): void {
    if (!next || typeof next !== 'object') return;
    this.localAppearance = normalizeAvatarAppearance({
      ...this.localAppearance,
      ...(next as Partial<AvatarAppearance>),
    });
    this.rebuildLocalAvatarGroup();
    this.characterDashboardPanel?.sync();
    gameBus.emit('PLAYER_APPEARANCE_CHANGED', {
      playerId: this.localPlayerId || 'local',
      appearance: { ...this.localAppearance },
    });
  }

  /**
   * Write the current local appearance to the menu-local path before binding,
   * and to `player.{id}.appearance` once the runtime player id is known.
   */
  private persistLocalAppearance(): void {
    this.stateManager.set(LOBBY_LOCAL_APPEARANCE_PATH, { ...this.localAppearance });
    if (this.localPlayerId) {
      this.stateManager.set(`player.${this.localPlayerId}.appearance`, { ...this.localAppearance });
    }
  }

  private readPendingLocalAppearance(): AvatarAppearance {
    const runtimeAppearance = this.localPlayerId
      ? this.stateManager.get(`player.${this.localPlayerId}.appearance`)
      : undefined;
    const lobbyAppearance = this.stateManager.get(LOBBY_LOCAL_APPEARANCE_PATH);
    const legacyAppearance = this.stateManager.get(LEGACY_LOCAL_APPEARANCE_PATH);
    const source = runtimeAppearance ?? lobbyAppearance ?? legacyAppearance;
    if (!source || typeof source !== 'object') {
      return normalizeAvatarAppearance();
    }
    return normalizeAvatarAppearance(source as Partial<AvatarAppearance>);
  }

  private bindLocalAppearanceSubscription(): void {
    this.localAppearanceUnsub?.();
    const statePath = this.localPlayerId
      ? `player.${this.localPlayerId}.appearance`
      : LOBBY_LOCAL_APPEARANCE_PATH;
    this.localAppearanceUnsub = this.stateManager.subscribe(
      statePath,
      (next) => this._onLocalAppearanceStateChange(next),
    );
  }

  /**
   * Apply a (possibly partial) appearance diff to an already-spawned remote
   * player group without a full dispose-and-rebuild cycle.
   * Called when the StateManager appearance subscription fires.
   */
  private _applyAppearanceToRemoteGroup(
    playerId: string,
    appearance: Partial<AvatarAppearance>,
  ): void {
    const group = this.playerGroups.get(playerId);
    if (!group) return;
    const normalized = normalizeAvatarAppearance(appearance);
    // Recolor existing mesh materials in-place
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData.isHitbox) return;
      const mat = obj.material as THREE.MeshLambertMaterial;
      const base = obj.userData._baseColor as number | undefined;
      if (base === undefined) return;
      // Remap each part to its new colour based on what the base colour was
      // before — torso/arms → bodyColor, legs → legColor, head → skinColor.
      const currentBody = group.userData.avatarAppearance?.bodyColor as number | undefined;
      const currentLeg  = group.userData.avatarAppearance?.legColor  as number | undefined;
      const currentSkin = group.userData.avatarAppearance?.skinColor  as number | undefined;
      if (base === currentBody) {
        mat.color.setHex(normalized.bodyColor);
        obj.userData._baseColor = normalized.bodyColor;
      } else if (base === currentLeg) {
        mat.color.setHex(normalized.legColor);
        obj.userData._baseColor = normalized.legColor;
      } else if (base === currentSkin) {
        mat.color.setHex(normalized.skinColor);
        obj.userData._baseColor = normalized.skinColor;
      }
      mat.needsUpdate = true;
    });
    // Scale the root group
    group.scale.set(normalized.scaleX, normalized.scaleY, normalized.scaleZ);
    // Stamp updated appearance so future partial diffs compare correctly
    group.userData.avatarAppearance = normalized;
  }
}
