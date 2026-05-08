import { WebSocket } from 'ws';
import type { TropicalHorrorArchetypeId } from '@shared/contracts';
import { PHYSICS_CONSTANTS } from '../PhysicsConstants';
import { AuthoritativeActorRuntime } from '../actor/AuthoritativeActorRuntime';
import { isActorPositionUsable, resolveActorMovement } from '../actor/ActorRuntimeSupport';
import { CollisionAuthoritySystem, CollisionHistoryFrame } from '../collision/CollisionAuthoritySystem';
import { SNAPSHOT_DELTA_MODE, SNAPSHOT_SCHEMA_VERSION } from '../snapshot/SnapshotContract';
import { type LobbyRoom, type RoundState, type Vec3 } from '../sessionContracts';
import {
  ABILITY_VALIDATION_PROFILES,
  type PlayerDebugStatusOverride,
  type PlayerMovementStatus,
  type PlayerStatusMovementModifier,
} from '../rules/AbilityRules';
import { type GameplayEvent, type PlayerMovementIntent } from '../gameplay/GameplayTypes';
import { executeLegacySessionAction, shouldIgnoreLegacyAction } from '../gameplay/LegacySessionActions';
import {
  applyPlayerMovementStep,
  sanitizePlayerInput,
  type PlayerInputState,
} from '../movement/MovementRuntime';
import { broadcastWorldDelta, createInitialSnapshotDiagnostics, type SnapshotDiagnostics } from '../snapshot/SnapshotBroadcast';
import {
  cloneStatusMovementModifier,
  refreshPlayerStatusMovementModifier,
  statusMovementModifiersEqual,
} from '../gameplay/StatusRuntime';
import { executeGameplayCommand, mapLegacyGameplayAction, type GameplayCommand } from '../gameplay/GameplayCommands';
import { applyAbilityMovementStatuses } from '../gameplay/StatusEffects';
import { getWeaponRule, sanitizeWeaponId } from '../rules/WeaponRules';
import { ensureWeaponState, resetWeaponState, updateWeaponRuntime, type WeaponRuntimeState } from '../rules/WeaponRuntime';
import { createWorldObjectFromRequest, getWorldObjectHalfExtents, nextWorldObjectId, type WorldObjectState } from '../world/WorldObjects';
import { captureEntityHistoryFrame, findClosestHistoryFrame, type EntityHistoryFrame, validatePlayerRayTarget } from '../session/combatValidationRuntime';
import { processPlayerInput } from '../session/playerInputRuntime';
import { syncJoinedPlayerState } from '../session/playerJoinRuntime';
import { applyPlayerDamage, processRespawns, respawnPlayer, scheduleRespawn } from '../session/playerLifecycleRuntime';
import { applyPlayerArchetypeState, createPlayerState, getPlayerSpawnPoint, resetPlayerRuntimeState } from '../session/playerSessionRuntime';
import { SpawnPointRegistry } from '../session/SpawnPointRegistry';
import { isEntityAllowedForSnapshot, isWorldObjectAllowedForSnapshot } from '../session/SnapshotFilter';
import { SpawnSystem } from '../session/SpawnSystem';
import { activateRoundState, advanceActiveRoundClock, buildPlayerScoreSummary, completeRoundState, createScheduledRoundState, selectRoundWinner } from '../session/roundLifecycle';
import { applyActivePlayerMovement } from '../session/tickRuntime';
import { DiagnosticsHelper } from '../session/DiagnosticsHelper';
import { CollisionHelpers } from '../session/CollisionHelpers';
import {
  sanitizeAngle, sanitizePitch, sanitizeOptionalVec3, sanitizeOrigin, sanitizeDirection, sanitizeTimestamp,
  readFiniteNumber, clamp01, distance, normalizePlanarDirection, validateHitscan, validatePlayerRayTargetFn,
  validateAbilityUse, buildAbilityMovementIntent,
} from '../session/playerValidationRuntime';
import { broadcastAll, broadcastOthers, sendTo } from '../session/broadcastRuntime';

export interface PlayerState {
  id: string;
  name: string;
  appearance?: Record<string, unknown> | null;
  archetypeId: TropicalHorrorArchetypeId;
  archetypeName: string;
  position: Vec3;
  rotation: Vec3;
  velocity: Vec3;
  isCrouching: boolean;
  isAirborne: boolean;
  groundHeight: number;
  jumpHeld: boolean;
  currentInput: PlayerInputState;
  jumpBufferRemaining: number;
  coyoteTimeRemaining: number;
  pendingMovementIntent?: PlayerMovementIntent | null;
  activeMovementStatuses?: PlayerMovementStatus[];
  statusMovementModifier?: PlayerStatusMovementModifier | null;
  debugStatusOverride?: PlayerDebugStatusOverride | null;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  mana: number;
  maxMana: number;
  damageReduction: number;
  damageMultiplier: number;
  attackSpeed: number;
  dead: boolean;
  lastUpdate: number;
  lastInputSeq: number;
  lastProcessedInputSeq: number;
  lastProcessedInputTick: number;
  lastMoveCommandAt: number;
  kills: number;
  deaths: number;
  level: number;
  exp: number;
  ping: number;
  equipment: string[];
  respawnAt: number | null;
  ws?: WebSocket;
}

export interface EntityState {
  id: string;
  type: string;
  position: Vec3;
  rotation: Vec3;
  velocity?: Vec3;
  isCrouching?: boolean;
  isGrounded?: boolean;
  isAirborne?: boolean;
  health?: number;
  maxHealth?: number;
  shield?: number;
  maxShield?: number;
  mana?: number;
  maxMana?: number;
  state?: string;
  dead?: boolean;
  name?: string;
  kills?: number;
  deaths?: number;
  level?: number;
  exp?: number;
  ping?: number;
  archetypeId?: string;
  archetypeName?: string;
  equipment?: string[];
  activeWeaponId?: string;
  currentAmmo?: number;
  reserveAmmo?: number;
  isReloading?: boolean;
  statusMovementModifier?: PlayerStatusMovementModifier | null;
  IS_PLAYER_CONTROLLED?: boolean;
  [key: string]: unknown;
}

export function sanitizePlayerAppearancePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  if (candidate.modelVariant === 'operator' || candidate.modelVariant === 'scout' || candidate.modelVariant === 'heavy') {
    sanitized.modelVariant = candidate.modelVariant;
  }
  if (candidate.textureStyle === 'flat' || candidate.textureStyle === 'checker' || candidate.textureStyle === 'stripes' || candidate.textureStyle === 'digital') {
    sanitized.textureStyle = candidate.textureStyle;
  }

  const numericKeys = ['bodyColor', 'accentColor', 'skinColor', 'legColor', 'scaleX', 'scaleY', 'scaleZ', 'heightScale', 'widthScale'] as const;
  for (const key of numericKeys) {
    const next = candidate[key];
    if (typeof next === 'number' && Number.isFinite(next)) {
      sanitized[key] = next;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

const PLAYER_MOVE_SPEED = PHYSICS_CONSTANTS.PLAYER_MOVE_SPEED;
const PLAYER_MOVE_ACCELERATION = PHYSICS_CONSTANTS.PLAYER_MOVE_ACCELERATION;
const PLAYER_COLLISION_RADIUS = PHYSICS_CONSTANTS.PLAYER_COLLISION_RADIUS;
const PLAYER_EYE_HEIGHT = PHYSICS_CONSTANTS.PLAYER_EYE_HEIGHT;
const PLAYER_CROUCH_HALF_HEIGHT = PHYSICS_CONSTANTS.PLAYER_CROUCH_HALF_HEIGHT;
const PLAYER_JUMP_IMPULSE = PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE;
const PLAYER_GRAVITY = PHYSICS_CONSTANTS.PLAYER_GRAVITY;
const PLAYER_JUMP_BUFFER_SECONDS = PHYSICS_CONSTANTS.PLAYER_JUMP_BUFFER_SECONDS;
const PLAYER_COYOTE_TIME_SECONDS = PHYSICS_CONSTANTS.PLAYER_COYOTE_TIME_SECONDS;
const PLAYER_AIR_CONTROL_FACTOR = PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR;
const ROUND_START_DELAY_MS = 1200;
const SHIELD_DASH_HORIZONTAL_IMPULSE = PHYSICS_CONSTANTS.SHIELD_DASH_HORIZONTAL_IMPULSE;
const ALLOW_DEBUG_STATUS_HOOKS = process.env.NODE_ENV !== 'production' && process.env.DISABLE_DEBUG_STATUS_HOOKS !== '1';
const SNAPSHOT_RELEVANCE_RADIUS = 72;
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player']);


export class GameSession {
  readonly sessionId: string;

  private room: LobbyRoom;
  private players: Map<string, PlayerState> = new Map();
  private entities: Map<string, EntityState> = new Map();
  private wsToId: Map<WebSocket, string> = new Map();
  private snapshots: Map<string, Map<string, Record<string, unknown>>> = new Map();
  private worldObjects: Map<string, WorldObjectState> = new Map();
  private weaponStates: Map<string, WeaponRuntimeState> = new Map();
  private entityHistoryFrames: EntityHistoryFrame[] = [];
  private collisionHistoryFrames: CollisionHistoryFrame[] = [];
  private pendingGameplayEvents: GameplayEvent[] = [];
  private abilityCooldowns: Map<string, Map<string, number>> = new Map();
  private activeSummons: Map<string, Array<{ abilityId: string; expiresAt: number }>> = new Map();
  private worldObjectSequence = 0;
  private readonly collisionAuthority: CollisionAuthoritySystem;
  private readonly actorRuntime: AuthoritativeActorRuntime;
  private readonly spawnSystem: SpawnSystem;
  private readonly spawnPointRegistry: SpawnPointRegistry;
  private snapshotDiagnostics: SnapshotDiagnostics = createInitialSnapshotDiagnostics();

  private tick = 0;
  private tickRate = 60; // FIXED: Increased from 20 Hz to 60 Hz to match client frame rate (fixes rubberbanding)
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private roundStartTimer: ReturnType<typeof setTimeout> | null = null;
  private hordeStartBroadcasted = false;

  private roundState: RoundState;

  constructor(room: LobbyRoom, tickRate = 60) { // FIXED: Default param changed from 20 to 60
    this.sessionId = room.id;
    this.room = room;
    this.tickRate = tickRate;
    this.spawnPointRegistry = new SpawnPointRegistry();
    this.collisionAuthority = new CollisionAuthoritySystem(room.selectedMap, room.id);


    this.roundState = {
      mode: room.selectedMode,
      status: 'warmup',
      phase: 'waiting',
      roundNumber: 0,
      killLimit: room.killLimit,
      timeRemainingMs: room.roundDurationSec * 1000,
      startedAt: 0,
      endsAt: 0,
      winnerId: null,
      reason: null,
    };
    this.actorRuntime = new AuthoritativeActorRuntime({
      sessionId: this.sessionId,
      hasActiveActors: () => this.players.size > 0,
      resolveMovement: (actor, desiredStep, halfExtents, collisionRadius) => resolveActorMovement({
        actor,
        desiredStep,
        halfExtents,
        collisionRadius,
        isActorPositionUsable: (position, nextCollisionRadius) => this._isActorPositionUsable(position, nextCollisionRadius),
        removeDynamicCollider: (objectId) => this.collisionAuthority.removeDynamicCollider(objectId),
        upsertDynamicCollider: (objectId, position, nextHalfExtents) => this.collisionAuthority.upsertDynamicCollider(objectId, position, nextHalfExtents),
      }),
      upsertWorldObject: (object, halfExtents) => {
        // ─ ENTITY EXORCISM: Block any attempt to create Prefab_EnemyGrunt ─
        const normalizedType = (object.entityType ?? '').toLowerCase();
        const isGrunt = normalizedType === 'prefab_enemygrunt' 
          || normalizedType.includes('grunt')
          || object.entityType === 'Prefab_EnemyGrunt'
          || object.id?.includes?.('npc_enemy_grunt');
        
        if (isGrunt) {
          console.error('[SERVER_SPAWN_BLOCK] GRUNT SPAWN PREVENTED', {
            objectId: object.id,
            entityType: object.entityType,
            normalizedType,
            action: 'SPAWN_REJECTED',
            timestamp: Date.now(),
          });
          return false; // Reject spawn
        }
        
        const hadExisting = this.worldObjects.has(object.id);
        this.worldObjects.set(object.id, object as WorldObjectState);
        this.collisionAuthority.upsertDynamicCollider(object.id, object.position, halfExtents);
        return hadExisting;
      },
      removeWorldObject: (id) => {
        const removed = this.worldObjects.delete(id);
        if (removed) {
          this.collisionAuthority.removeDynamicCollider(id);
        }
        return removed;
      },
      broadcastWorldObjectPlacedOrUpdated: (object, existed) => {
        this._broadcastAll(existed
          ? { type: 'WORLD_OBJECT_UPDATE', object }
          : { type: 'WORLD_OBJECT_PLACE', object });
      },
      broadcastWorldObjectRemoved: (id) => {
        this._broadcastAll({ type: 'WORLD_OBJECT_REMOVE', id });
      },
    });
    this.spawnSystem = new SpawnSystem();
    this.purgeDisallowedReplicatedObjects('session_init');
    
    // ─ STATIC COLLIDER DEBUG ENTITIES: Create visual representations ─
    const staticLayout = this.collisionAuthority.getStaticLayout();
    for (const box of staticLayout.boxes) {
      const colliderEntity: WorldObjectState = {
        id: box.id,
        entityType: 'static_collider',
        position: {
          x: box.position.x,
          y: box.position.y,
          z: box.position.z,
        },
        rotation: {
          x: 0,
          y: 0,
          z: 0,
        },
        renderData: {
          meshType: 'box',
          color: 0x888888,
          geometry: {
            width: box.halfExtents.x * 2,
            height: box.halfExtents.y * 2,
            depth: box.halfExtents.z * 2,
          },
        },
      };
      this.worldObjects.set(box.id, colliderEntity);
    }
  }

  start(): void {
    if (!this.tickInterval) {
      this.tickInterval = setInterval(() => this._gameTick(), 1000 / this.tickRate);
    }
    this.startRound();
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.roundStartTimer) {
      clearTimeout(this.roundStartTimer);
      this.roundStartTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  addPlayer(
    ws: WebSocket,
    id: string,
    name: string,
    appearance?: Record<string, unknown> | null,
    archetypeId?: TropicalHorrorArchetypeId | null,
  ): PlayerState {
    const existing = this.players.get(id);
    const spawn = this._resolvePlayerSpawnPoint(this.players.size, id);
    const player: PlayerState = existing ?? createPlayerState({
      id,
      name,
      appearance,
      archetypeId,
      spawn,
      now: Date.now(),
    });

    if (existing) {
      applyPlayerArchetypeState(player, archetypeId, player.equipment);
    }

    player.ws = ws;
    player.name = name;
    player.appearance = appearance ? { ...appearance } : (player.appearance ?? null);
    const spawnResult = this.spawnSystem.spawnPlayer(player, 'player_v1', spawn);
    resetPlayerRuntimeState(spawnResult.player, spawn);

    this.players.set(id, player);
    this.wsToId.set(ws, id);
    const weaponState = ensureWeaponState(this.weaponStates, id, player.equipment[0] ?? 'pistol');
    weaponState.isReloading = false;
    weaponState.reloadEndsAt = 0;
    weaponState.lastShotAt = 0;
    this.entities.set(id, spawnResult.entity);
    
    // ─ SERVER AUTHORITY: Confirm player entity added to activeEntities ─
    console.log('[SERVER_SPAWN]', {
      playerId: id,
      action: 'Player entity registered',
      activeEntitiesCount: this.entities.size,
      playersConnected: this.players.size,
      timestamp: Date.now(),
    });
    this._syncPlayerEntity(id);
    if (!this.entities.has(id)) {
      console.error('FATAL: Player entity registration failed after addPlayer()', {
        playerId: id,
        playersSize: this.players.size,
        entityCount: this.entities.size,
        timestamp: Date.now(),
      });
    } else {
      console.log('[ServerWorldState] Player entity registered', {
        playerId: id,
        entityType: this.entities.get(id)?.type ?? null,
        entityCount: this.entities.size,
        timestamp: Date.now(),
      });
    }
    this._broadcastScoreUpdate();
    this.purgeDisallowedReplicatedObjects('player_join');

    syncJoinedPlayerState({
      ws,
      playerId: id,
      hostPlayerId: this.room.hostId,
      mapId: this.room.selectedMap,
      sessionId: this.sessionId,
      spawnPosition: player.position,
      playerAppearance: player.appearance,
      worldObjects: Array.from(this.worldObjects.values()).filter((worldObject) => isWorldObjectAllowedForSnapshot(worldObject)),
      players: this.players.values(),
      broadcastOthers: (excludePlayerId, message) => this._broadcastOthers(excludePlayerId, message),
    });

    this._sendTo(ws, {
      type: 'ROUND_START',
      round: this.roundState,
    });

    // Push an immediate bootstrap packet so late joiners do not depend on the
    // client-side FULL_SYNC_REQ winning a race against early empty deltas.
    setImmediate(() => {
      this.handleFullSyncRequest(ws);
      const targetPlayer = this.players.get(id);
      if (targetPlayer) {
        DiagnosticsHelper.forceFullSnapshot(id, { ws: targetPlayer.ws }, this.tick, Array.from(this.entities.values()), this.roundState);
      }
    });

    return player;
  }

  removePlayer(ws: WebSocket): void {
    const id = this.wsToId.get(ws);
    if (!id) return;

    // ─ SPATIAL SPAWNING: Unregister spawn index when player leaves
    this.spawnPointRegistry.unregisterPlayerSpawn(id);

    this.wsToId.delete(ws);
    this.players.delete(id);
    this.entities.delete(id);
    this.snapshots.delete(id);
    this.weaponStates.delete(id);
    this.abilityCooldowns.delete(id);
    this.activeSummons.delete(id);
    this._broadcastScoreUpdate();

    if (this.roundState.status === 'active' && this.players.size <= 1) {
      this.endRound('manual');
    }
  }

  getPlayerById(id: string): PlayerState | undefined {
    return this.players.get(id);
  }

  getPlayerByWs(ws: WebSocket): PlayerState | undefined {
    const id = this.wsToId.get(ws);
    return id ? this.players.get(id) : undefined;
  }

  processInput(ws: WebSocket, seq: number, _clientTs: number, input: Record<string, unknown>): void {
    processPlayerInput({
      player: this.getPlayerByWs(ws),
      seq,
      now: Date.now(),
      currentTick: this.tick,
      tickRate: this.tickRate,
      isRoundActive: this.roundState.status === 'active',
      jumpBufferSeconds: PLAYER_JUMP_BUFFER_SECONDS,
      sanitizeInput: (currentRotation) => sanitizePlayerInput({
        input,
        currentRotation,
        readFiniteNumber: (value: unknown) => readFiniteNumber(value),
        sanitizeAngle: (value: number | undefined, fallback: number) => sanitizeAngle(value, fallback),
        sanitizePitch: (value: number | undefined, fallback: number) => sanitizePitch(value, fallback),
      }),
    });
  }

  handleGameplayCommand(ws: WebSocket, command: string, data: Record<string, unknown>): void {
    const actor = this.getPlayerByWs(ws);
    if (!actor) return;

    // Track command for authoritative broadcast
    const commandId = `${actor.id}:${command}:${Date.now()}`;
    const commandTs = Date.now();

    executeGameplayCommand({
      actor,
      command: command as GameplayCommand,
      data,
      weaponStates: this.weaponStates,
      canUseWeapons: (nextActor) => this._canUseWeapons(nextActor),
      syncPlayerEntity: (playerId) => this._syncPlayerEntity(playerId),
      pushGameplayEvent: (event) => { this.pendingGameplayEvents.push(event); },
      dispatchGameplayCommand: (nextCommand, nextData) => this.handleGameplayCommand(ws, nextCommand, nextData),
      sanitizeOrigin: (nextActor, raw) => sanitizeOrigin(nextActor, raw),
      sanitizeDirection: (raw) => sanitizeDirection(raw),
      sanitizeTimestamp: (raw) => sanitizeTimestamp(raw),
      validateHitscan: (playerId, weaponId, origin, direction, timestamp) => validateHitscan(playerId, weaponId, origin, direction, timestamp, {
        collisionAuthority: this.collisionAuthority,
        gameSession: {
          findEntityHistoryFrame: (ts) => this._findEntityHistoryFrame(ts),
          findCollisionHistoryFrame: (ts) => this._findCollisionHistoryFrame(ts),
          players: this.players,
          entities: this.entities,
          abilityCooldowns: this.abilityCooldowns,
          activeSummons: this.activeSummons,
        },
      }),
      applyDamage: (targetId, amount, sourceId) => this.applyDamage(targetId, amount, sourceId),
      validateAbilityUse: (nextActor, abilityId, nextData, now) => validateAbilityUse(nextActor, abilityId, nextData, now, {
        collisionAuthority: this.collisionAuthority,
        gameSession: {
          findEntityHistoryFrame: (ts) => this._findEntityHistoryFrame(ts),
          findCollisionHistoryFrame: (ts) => this._findCollisionHistoryFrame(ts),
          players: this.players,
          entities: this.entities,
          abilityCooldowns: this.abilityCooldowns,
          activeSummons: this.activeSummons,
        },
      }),
      resolveAbilityProjectileTarget: (playerId, origin, direction, range, timestamp) => validatePlayerRayTargetFn(playerId, origin, direction, range, timestamp, {
        collisionAuthority: this.collisionAuthority,
        gameSession: {
          findEntityHistoryFrame: (ts) => this._findEntityHistoryFrame(ts),
          findCollisionHistoryFrame: (ts) => this._findCollisionHistoryFrame(ts),
          players: this.players,
          entities: this.entities,
          abilityCooldowns: this.abilityCooldowns,
          activeSummons: this.activeSummons,
        },
      }),
      buildAbilityMovementIntent: (nextActor, abilityId, nextData) => buildAbilityMovementIntent(nextActor, abilityId, nextData),
      applyAbilityMovementStatuses: (nextActor, abilityId, nextData, now) => applyAbilityMovementStatuses({
        actor: nextActor,
        abilityId,
        data: nextData,
        now,
        players: this.players.values(),
        playerCollisionRadius: PLAYER_COLLISION_RADIUS,
        sanitizeOrigin: (effectActor: PlayerState, raw: unknown) => sanitizeOrigin(effectActor, raw),
        sanitizeDirection: (raw: unknown) => sanitizeDirection(raw),
        distance: (left: Vec3, right: Vec3) => distance(left, right),
        validatePlayerRayTarget: (playerId: string, origin: Vec3, direction: Vec3, range: number, timestamp: number) => validatePlayerRayTargetFn(playerId, origin, direction, range, timestamp, {
          collisionAuthority: this.collisionAuthority,
          gameSession: {
            findEntityHistoryFrame: (ts) => this._findEntityHistoryFrame(ts),
            findCollisionHistoryFrame: (ts) => this._findCollisionHistoryFrame(ts),
            players: this.players,
            entities: this.entities,
            abilityCooldowns: this.abilityCooldowns,
            activeSummons: this.activeSummons,
          },
        }),
        getPlayerById: (playerId: string) => this.players.get(playerId),
        syncPlayerEntity: (playerId: string) => this._syncPlayerEntity(playerId),
      }),
      readFiniteNumber: (value) => readFiniteNumber(value),
      clamp01: (value) => clamp01(value),
      allowDebugStatusHooks: ALLOW_DEBUG_STATUS_HOOKS,
    });

    // **AUTHORITATIVE BROADCAST**: Send validated command back to ALL clients
    // This ensures the command sender sees the server's validation result
    this._broadcastAll({
      type: 'COMMAND_AUTHORIZED',
      commandId,
      playerId: actor.id,
      command,
      data,
      timestamp: commandTs,
      status: 'executed',
    });
  }

  handleAction(ws: WebSocket, action: string, data: Record<string, unknown>): void {
    const actor = this.getPlayerByWs(ws);
    if (!actor) return;

    if (action === 'HORDE_START_REQUEST') {
      const roundMode = String(this.roundState.mode ?? '').toLowerCase();
      const roomMode = String(this.room.selectedMode ?? '').toLowerCase();
      const modeIsHorde = roundMode === 'horde' || roomMode === 'horde';
      if (!modeIsHorde || this.hordeStartBroadcasted) {
        return;
      }

      this.hordeStartBroadcasted = true;
      this._broadcastAll({
        type: 'HORDE_START_CONFIRMED',
        playerId: actor.id,
        timestamp: Date.now(),
      });
      return;
    }

    const mappedGameplayAction = mapLegacyGameplayAction(action);
    if (mappedGameplayAction) {
      this.handleGameplayCommand(ws, mappedGameplayAction, data);
      return;
    }

    if (shouldIgnoreLegacyAction(action)) {
      return;
    }

    executeLegacySessionAction({
      action,
      actor,
      data,
      readFiniteNumber: (value: unknown) => this._readFiniteNumber(value),
      sanitizePlayerAppearancePayload,
      applyDamage: (targetId: string, amount: number, sourceId: string) => this.applyDamage(targetId, amount, sourceId),
      respawnPlayer: (playerId: string) => this._respawnPlayer(playerId),
      createWorldObjectFromRequest: (nextData: Record<string, unknown>, actorId: string) => this._createWorldObjectFromRequest(nextData, actorId),
      getWorldObject: (id: string) => this.worldObjects.get(id),
      setWorldObject: (id: string, object: WorldObjectState) => {
        this.worldObjects.set(id, object);
      },
      deleteWorldObject: (id: string) => {
        this.worldObjects.delete(id);
      },
      upsertWorldObjectCollider: (id: string, position: Vec3, halfExtents: Vec3) => {
        this.collisionAuthority.upsertDynamicCollider(id, position, halfExtents);
      },
      removeWorldObjectCollider: (id: string) => {
        this.collisionAuthority.removeDynamicCollider(id);
      },
      getWorldObjectHalfExtents: (object: WorldObjectState) => this._getWorldObjectHalfExtents(object),
      broadcastAll: (message: unknown) => this._broadcastAll(message),
      broadcastOthers: (excludePlayerId: string, message: unknown) => this._broadcastOthers(excludePlayerId, message),
      syncPlayerEntity: (playerId: string) => this._syncPlayerEntity(playerId),
    });
  }

  /**
   * DEV COMMAND HANDLER (COMBAT & GEOMETRY SUPREMACY: Phase 3)
   * 
   * Handles dev-only commands for testing/profiling:
   * - /spawn_army N : Spawn N dummy entities in grid pattern
   * - /flush_geometry : Clear residual collision data
   */
  handleDevCommand(ws: WebSocket, command: string, data: Record<string, unknown>): void {
    const actor = this.getPlayerByWs(ws);
    if (!actor) {
      console.warn('[DevCommand] Rejected: actor not found');
      return;
    }

    // Only allow dev commands in non-production
    if (process.env.NODE_ENV === 'production') {
      console.warn('[DevCommand] Rejected: production environment');
      this._sendTo(ws, { type: 'ERROR', message: 'Dev commands disabled in production' });
      return;
    }

    console.log('[DevCommand] Processing:', { command, actor: actor.id, data });

    switch (command.toLowerCase()) {
      case 'spawn_army': {
        // Spawn N dummy entities
        const count = Math.min(parseInt(data.count as string) || 50, 256); // Cap at 256
        const centerX = parseInt(data.x as string) || 16;
        const centerZ = parseInt(data.z as string) || 16;
        const spacing = parseFloat(data.spacing as string) || 2.0;

        const gridSize = Math.ceil(Math.sqrt(count));
        let spawned = 0;

        console.log('[DevCommand] Spawning army:', { count, gridSize, centerX, centerZ, spacing });

        for (let gx = 0; gx < gridSize && spawned < count; gx++) {
          for (let gz = 0; gz < gridSize && spawned < count; gz++) {
            const dummyId = `dummy_${Date.now()}_${spawned}`;
            const x = centerX + (gx - gridSize / 2) * spacing;
            const z = centerZ + (gz - gridSize / 2) * spacing;

            const entity: EntityState = {
              id: dummyId,
              type: 'dummy_enemy',
              position: { x, y: 1, z },
              rotation: { x: 0, y: 0, z: 0 },
              velocity: { x: 0, y: 0, z: 0 },
              health: 50,
              maxHealth: 50,
              equipment: [],
              activeWeaponId: 'pistol',
              isPlayerControlled: false,
              IS_PLAYER_CONTROLLED: false,
            };

            this.entities.set(dummyId, entity);
            spawned++;
          }
        }

        // Broadcast spawn event
        this._broadcastAll({
          type: 'DUMMY_ARMY_SPAWNED',
          count: spawned,
          timestamp: Date.now(),
        });

        this._sendTo(ws, {
          type: 'DEV_COMMAND_RESULT',
          command,
          success: true,
          message: `Spawned ${spawned} dummy entities`,
          details: { gridSize, spacing, totalSpawned: spawned },
        });

        console.log('[DevCommand] Army spawned:', { spawned, totalEntities: this.entities.size });
        break;
      }

      case 'flush_geometry': {
        // Clear all residual collision data
        console.log('[DevCommand] Flushing collision geometry...');
        this.collisionAuthority.clearDynamicColliders();
        this._broadcastAll({
          type: 'GEOMETRY_FLUSHED',
          timestamp: Date.now(),
        });
        this._sendTo(ws, {
          type: 'DEV_COMMAND_RESULT',
          command,
          success: true,
          message: 'Collision geometry flushed',
        });
        break;
      }

      default: {
        this._sendTo(ws, {
          type: 'ERROR',
          message: `Unknown dev command: ${command}`,
        });
        break;
      }
    }
  }

  setEntity(entity: EntityState): void {
    this.entities.set(entity.id, entity);
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  setPlayerPing(ws: WebSocket, ping: number): void {
    const player = this.getPlayerByWs(ws);
    if (!player) return;
    player.ping = ping;
    this._syncPlayerEntity(player.id);
  }

  handleFullSyncRequest(ws: WebSocket): void {
    const player = this.getPlayerByWs(ws);
    if (!player) return;

    this.purgeDisallowedReplicatedObjects('full_sync_request');

    const allEntities = Array.from(this.entities.values());
    const entitiesToBroadcast = allEntities
      .filter((entity) => isEntityAllowedForSnapshot(entity))
      .map((entity) => ({
        ...entity,
        isPlayerControlled: entity.type === 'player' && entity.id === player.id,
        IS_PLAYER_CONTROLLED: entity.type === 'player' && entity.id === player.id,
      }));

    DiagnosticsHelper.logSnapshotAudit('full_sync_request', this.tick, allEntities, entitiesToBroadcast, player.id);

    this._sendTo(ws, {
      type: 'FULL_SYNC_DATA',
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      deltaMode: SNAPSHOT_DELTA_MODE,
      localPlayerId: player.id,
      tick: this.tick,
      ack: player.lastProcessedInputSeq,
      lastProcessedInput: player.lastProcessedInputSeq,
      lastProcessedInputTick: player.lastProcessedInputTick,
      timestamp: Date.now(),
      entities: entitiesToBroadcast,
      round: this.roundState,
      events: [],
    });
  }

  startRound(): void {
    const now = Date.now();
    const roundDurationMs = this.room.roundDurationSec * 1000;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.roundStartTimer) {
      clearTimeout(this.roundStartTimer);
      this.roundStartTimer = null;
    }
    this.roundState = createScheduledRoundState(this.room, this.roundState.roundNumber, now, ROUND_START_DELAY_MS);

    let spawnIndex = 0;
    for (const player of this.players.values()) {
      const spawn = this._resolvePlayerSpawnPoint(spawnIndex++, player.id);
      resetPlayerRuntimeState(player, spawn);
      player.kills = 0;
      player.deaths = 0;
      this.abilityCooldowns.delete(player.id);
      this.activeSummons.delete(player.id);
      const weaponState = ensureWeaponState(this.weaponStates, player.id, player.equipment[0] ?? 'pistol');
      weaponState.isReloading = false;
      weaponState.reloadEndsAt = 0;
      weaponState.lastShotAt = 0;
      resetWeaponState(this.weaponStates, player.id, player.equipment[0] ?? 'pistol');
      this._syncPlayerEntity(player.id);
    }

    this._broadcastAll({ type: 'ROUND_START', round: this.roundState });
    this._broadcastScoreUpdate();

    this.roundStartTimer = setTimeout(() => {
      this.roundStartTimer = null;
      const startedAt = Date.now();
      this.roundState = activateRoundState(this.roundState, startedAt, roundDurationMs);
      this._broadcastAll({ type: 'ROUND_START', round: this.roundState });
      this._broadcastScoreUpdate();
    }, ROUND_START_DELAY_MS);
  }

  endRound(reason: 'timer' | 'kill_limit' | 'manual'): void {
    if (this.roundState.status === 'ended') return;
    if (this.roundStartTimer) {
      clearTimeout(this.roundStartTimer);
      this.roundStartTimer = null;
    }

    const winner = selectRoundWinner(this.players.values());
    this.roundState = completeRoundState(this.roundState, winner?.id ?? null, reason);

    this._broadcastAll({
      type: 'ROUND_END',
      round: this.roundState,
      winner: winner ? buildPlayerScoreSummary(winner) : null,
    });
    this._broadcastScoreUpdate();

    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.restartRound(), 5000);
  }

  restartRound(): void {
    this.startRound();
  }

  applyDamage(targetId: string, amount: number, sourceId: string): void {
    const sourcePlayer = this.players.get(sourceId);
    const scaledAmount = sourcePlayer
      ? Math.max(0, Math.round(amount * sourcePlayer.damageMultiplier * 100) / 100)
      : amount;
    applyPlayerDamage({
      players: this.players,
      targetId,
      amount: scaledAmount,
      sourceId,
      killLimit: this.roundState.killLimit,
      now: Date.now(),
      getRespawnDelayMs: () => this._getRespawnDelayMs(),
      syncPlayerEntity: (playerId) => this._syncPlayerEntity(playerId),
      broadcastAll: (message) => this._broadcastAll(message),
      broadcastScoreUpdate: () => this._broadcastScoreUpdate(),
      scheduleRespawn: (playerId) => this._scheduleRespawn(playerId),
      onKillLimitReached: () => this.endRound('kill_limit'),
      sendDamageTaken: (player, payload) => {
        if (player.ws) {
          this._sendTo(player.ws, {
            type: 'DAMAGE_TAKEN',
            ...payload,
          });
        }
      },
    });
  }

  private _gameTick(): void {
    this.tick += 1;
    const now = Date.now();
    const step = 1 / this.tickRate;

    // Broadcast tick sync every frame so clients can sync interpolation timing
    this._broadcastAll({
      type: 'TICK_SYNC',
      tick: this.tick,
      timestamp: now,
      targetTickRate: this.tickRate,
    });

    if (this.roundState.status === 'active') {
      const activeRound = advanceActiveRoundClock(this.roundState, now);
      this.roundState = activeRound.roundState;
      if (activeRound.timedOut) {
        this.endRound('timer');
      }
    }

    for (const playerId of updateWeaponRuntime(this.weaponStates, now)) {
      this._syncPlayerEntity(playerId);
    }
    this._updatePlayerStatusMovementModifiers(now);
    this._processRespawns();
    if (this.roundState.status === 'active') {
      applyActivePlayerMovement({
        players: this.players.values(),
        step,
        now,
        tick: this.tick,
        config: {
          playerMoveSpeed: PLAYER_MOVE_SPEED,
          playerMoveAcceleration: PLAYER_MOVE_ACCELERATION,
          playerJumpImpulse: PLAYER_JUMP_IMPULSE,
          playerGravity: PLAYER_GRAVITY,
          playerJumpBufferSeconds: PLAYER_JUMP_BUFFER_SECONDS,
          playerCoyoteTimeSeconds: PLAYER_COYOTE_TIME_SECONDS,
          playerAirControlFactor: PLAYER_AIR_CONTROL_FACTOR,
          playerCollisionRadius: PLAYER_COLLISION_RADIUS,
          playerCrouchHalfHeight: PLAYER_CROUCH_HALF_HEIGHT,
          playerEyeHeight: PLAYER_EYE_HEIGHT,
        },
        resolveMovement: (playerId: string, position: Vec3, desiredMovement: Vec3, radius: number, playerHalfHeight: number) => CollisionHelpers.resolveMovement(playerId, position, desiredMovement, radius, this.collisionAuthority, playerHalfHeight),
        refreshPlayerStatusMovementModifier: (nextPlayer: PlayerState, nextNow: number) => {
          refreshPlayerStatusMovementModifier(nextPlayer, nextNow);
        },
        syncPlayerEntity: (playerId: string) => this._syncPlayerEntity(playerId),
      });
    }
    this.purgeDisallowedReplicatedObjects('tick');
    this._captureHistoryFrame(now);
    this._broadcastWorldDelta();
  }

  private _processRespawns(): void {
    processRespawns({
      players: this.players.values(),
      now: Date.now(),
      isRoundActive: () => this.roundState.status === 'active',
      respawnPlayer: (playerId) => this._respawnPlayer(playerId),
    });
  }

  private _scheduleRespawn(playerId: string): void {
    scheduleRespawn({
      playerId,
      getPlayer: (id) => this.players.get(id),
      isRoundActive: () => this.roundState.status === 'active',
      respawnPlayer: (id) => this._respawnPlayer(id),
    });
  }

  private _respawnPlayer(playerId: string): void {
    respawnPlayer({
      playerId,
      players: this.players,
      weaponStates: this.weaponStates,
      resolveSpawnPoint: (index, excludePlayerId) => this._resolvePlayerSpawnPoint(index, excludePlayerId),
      syncPlayerEntity: (id) => this._syncPlayerEntity(id),
      broadcastAll: (message) => this._broadcastAll(message),
      broadcastScoreUpdate: () => this._broadcastScoreUpdate(),
    });
  }

  private _broadcastWorldDelta(): void {
    this.purgeDisallowedReplicatedObjects('world_delta');

    const timestamp = Date.now();
    const events = this.pendingGameplayEvents.splice(0, this.pendingGameplayEvents.length);
    const allEntities = Array.from(this.entities.values());
    const entitiesToBroadcast = allEntities.filter((entity) => isEntityAllowedForSnapshot(entity));
    
    // ─ SERVER AUTHORITY AUDIT: Dump world state before broadcasting ─
    DiagnosticsHelper.dumpWorldState(this.tick, this.entities, this.players, this.worldObjects, 'PRE_BROADCAST');
    
    // ─ SERVER AUTHORITY AUDIT: Log snapshot preparation ─
    const playerEntities = allEntities.filter((e) => (e as any).type === 'player');
    const filteredOutEntities = allEntities.filter((entity) => !isEntityAllowedForSnapshot(entity));
    
    console.log('[SERVER_SNAPSHOT_PREPARE]', {
      tick: this.tick,
      playersConnected: this.players.size,
      playerEntitiesInState: playerEntities.length,
      totalEntitiesInState: allEntities.length,
      entitiesToBroadcast: entitiesToBroadcast.length,
      filteredOutCount: filteredOutEntities.length,
      filteredOutTypes: Array.from(new Set(filteredOutEntities.map(e => e.type))),
      timestamp: Date.now(),
    });
    
    // ─ SERVER ASSERTION: Never broadcast 0 entities when players with valid entities exist ─
    if (entitiesToBroadcast.length === 0 && playerEntities.length > 0) {
      console.error('[SERVER_ASSERTION_ERROR] SNAPSHOT WOULD HAVE 0 ENTITIES BUT PLAYERS EXIST', {
        tick: this.tick,
        playersConnected: this.players.size,
        playerEntitiesInState: playerEntities.length,
        totalEntitiesInState: allEntities.length,
        entitiesToBroadcast: entitiesToBroadcast.length,
        playerEntityTypes: playerEntities.map(e => ({ id: e.id, type: e.type })),
        timestamp: Date.now(),
      });
    }
    
    // ─ PER-PLAYER SNAPSHOT VALIDATION: Ensure each player gets self ─
    for (const player of this.players.values()) {
      const playerEntity = allEntities.find(e => e.id === player.id && (e as any).type === 'player');
      if (playerEntity && !isEntityAllowedForSnapshot(playerEntity)) {
        console.error('[SERVER_ENTITY_FILTER_BUG] PLAYER ENTITY FILTERED OUT', {
          playerId: player.id,
          entityId: playerEntity.id,
          entityType: playerEntity.type,
          tick: this.tick,
          timestamp: Date.now(),
        });
      }
    }
    
    DiagnosticsHelper.logSnapshotAudit('world_delta', this.tick, allEntities, entitiesToBroadcast);

    this.snapshotDiagnostics = broadcastWorldDelta({
      tick: this.tick,
      timestamp,
      round: this.roundState,
      events,
      players: this.players.values(),
      entities: entitiesToBroadcast,
      snapshots: this.snapshots,
      snapshotDiagnostics: this.snapshotDiagnostics,
      relevanceRadius: SNAPSHOT_RELEVANCE_RADIUS,
      canSendToPlayer: (player) => player.ws?.readyState === WebSocket.OPEN,
      sendToPlayer: (player, payload) => {
        if (player.ws) {
          player.ws.send(payload);
        }
      },
      lastProcessedInputSeqForPlayer: (player) => player.lastProcessedInputSeq,
      lastProcessedInputTickForPlayer: (player) => player.lastProcessedInputTick,
      cloneStatusMovementModifier: (modifier) => cloneStatusMovementModifier(modifier as PlayerStatusMovementModifier),
      statusMovementModifiersEqual: (left, right) => statusMovementModifiersEqual(
        (left as PlayerStatusMovementModifier | null | undefined) ?? null,
        (right as PlayerStatusMovementModifier | null | undefined) ?? null,
      ),
    });
  }

  private purgeDisallowedReplicatedObjects(source: string): void {
    const removedEntityIds: string[] = [];
    for (const [entityId, entity] of [...this.entities.entries()]) {
      if (isEntityAllowedForSnapshot(entity)) {
        continue;
      }
      
      // ─ CRITICAL SAFETY: Never purge player entities while player is connected ─
      if (this.players.has(entityId)) {
        console.error('[SERVER_ASSERTION_ERROR] Attempted to purge connected player entity', {
          source,
          playerId: entityId,
          entityType: entity.type,
          isAllowed: isEntityAllowedForSnapshot(entity),
          timestamp: Date.now(),
        });
        continue;
      }
      
      this.entities.delete(entityId);
      removedEntityIds.push(entityId);
    }

    const removedWorldObjectIds: string[] = [];
    for (const [objectId, worldObject] of [...this.worldObjects.entries()]) {
      if (isWorldObjectAllowedForSnapshot(worldObject)) {
        continue;
      }
      this.worldObjects.delete(objectId);
      this.collisionAuthority.removeDynamicCollider(objectId);
      removedWorldObjectIds.push(objectId);
    }

    if (removedEntityIds.length === 0 && removedWorldObjectIds.length === 0) {
      return;
    }

    for (const entityId of removedEntityIds) {
      this._broadcastAll({ type: 'ENTITY_DESTROY', entityId });
    }

    for (const objectId of removedWorldObjectIds) {
      this._broadcastAll({ type: 'ENTITY_DESTROY', entityId: objectId });
      this._broadcastAll({ type: 'WORLD_OBJECT_REMOVE', id: objectId });
    }

    console.warn('[ServerSnapshotPurge] Removed disallowed replicated objects', {
      source,
      removedEntityIds,
      removedWorldObjectIds,
      allowedTypes: [...SNAPSHOT_ALLOWED_ENTITY_TYPES],
      timestamp: Date.now(),
    });
  }

  private _broadcastScoreUpdate(): void {
    this._broadcastAll({
      type: 'SCORE_UPDATE',
      players: Array.from(this.players.values()).map((player) => buildPlayerScoreSummary(player)),
    });
  }

  private _isActorPositionUsable(position: Vec3, collisionRadius: number): boolean {
    return isActorPositionUsable(
      position,
      collisionRadius,
      (candidate, nextCollisionRadius) => this.collisionAuthority.isPositionValid(candidate, nextCollisionRadius),
      this.players.values(),
      PLAYER_COLLISION_RADIUS,
    );
  }

  private _updatePlayerStatusMovementModifiers(now: number): void {
    for (const player of this.players.values()) {
      if (refreshPlayerStatusMovementModifier(player, now)) {
        this._syncPlayerEntity(player.id);
      }
    }
  }

  private _toEntityState(player: PlayerState): EntityState {
    const weaponState = this.weaponStates.get(player.id);
    return {
      id: player.id,
      type: 'player',
      position: { ...player.position },
      rotation: { ...player.rotation },
      velocity: { ...player.velocity },
      isCrouching: player.isCrouching,
      isGrounded: !player.isAirborne,
      isAirborne: player.isAirborne,
      health: player.health,
      maxHealth: player.maxHealth,
      shield: player.armor,
      maxShield: player.maxArmor,
      mana: player.mana,
      maxMana: player.maxMana,
      dead: player.dead,
      name: player.name,
      archetypeId: player.archetypeId,
      archetypeName: player.archetypeName,
      kills: player.kills,
      deaths: player.deaths,
      level: player.level,
      exp: player.exp,
      ping: player.ping,
      equipment: [...player.equipment],
      activeWeaponId: weaponState?.equippedWeaponId ?? player.equipment[0] ?? 'pistol',
      currentAmmo: weaponState?.currentAmmo,
      reserveAmmo: weaponState?.reserveAmmo,
      isReloading: weaponState?.isReloading,
      statusMovementModifier: player.statusMovementModifier ? cloneStatusMovementModifier(player.statusMovementModifier) : null,
      IS_PLAYER_CONTROLLED: true,
    };
  }

  private _canUseWeapons(player: PlayerState): boolean {
    return !player.dead && this.roundState.status === 'active';
  }

  private _syncPlayerEntity(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.entities.set(playerId, this._toEntityState(player));
  }

  private _readFiniteNumber(value: unknown): number | undefined {
    return readFiniteNumber(value);
  }

  private _captureHistoryFrame(timestamp: number): void {
    this.entityHistoryFrames.push(captureEntityHistoryFrame(this.entities, this.tick, timestamp));
    this.collisionHistoryFrames.push(this.collisionAuthority.captureCollisionHistoryFrame(this.tick, timestamp));
    const maxFrames = Math.max(1, this.tickRate * 2);
    while (this.entityHistoryFrames.length > maxFrames) {
      this.entityHistoryFrames.shift();
    }
    while (this.collisionHistoryFrames.length > maxFrames) {
      this.collisionHistoryFrames.shift();
    }
  }

  private _findEntityHistoryFrame(timestamp: number): EntityHistoryFrame | null {
    return findClosestHistoryFrame(this.entityHistoryFrames, timestamp);
  }

  private _findCollisionHistoryFrame(timestamp: number): CollisionHistoryFrame | null {
    return findClosestHistoryFrame(this.collisionHistoryFrames, timestamp);
  }

  private _validateHitscan(playerId: string, weaponId: string, origin: Vec3, direction: Vec3, timestamp: number): string | null {
    return validateHitscan(playerId, weaponId, origin, direction, timestamp, {
      collisionAuthority: this.collisionAuthority,
      gameSession: {
        findEntityHistoryFrame: (ts) => this._findEntityHistoryFrame(ts),
        findCollisionHistoryFrame: (ts) => this._findCollisionHistoryFrame(ts),
        players: this.players,
        entities: this.entities,
        abilityCooldowns: this.abilityCooldowns,
        activeSummons: this.activeSummons,
      },
    });
  }

  private _getWorldObjectHalfExtents(worldObject: WorldObjectState): Vec3 {
    return getWorldObjectHalfExtents(worldObject, (value: unknown) => readFiniteNumber(value));
  }

  private _createWorldObjectFromRequest(data: Record<string, unknown>, actorId: string): WorldObjectState | null {
    return createWorldObjectFromRequest(
      data,
      actorId,
      (nextActorId: string) => this._nextWorldObjectId(nextActorId),
      (value: unknown) => readFiniteNumber(value),
    );
  }

  private _nextWorldObjectId(actorId: string): string {
    this.worldObjectSequence += 1;
    return nextWorldObjectId(this.sessionId, this.worldObjectSequence, actorId);
  }



  private _broadcastOthers(excludePlayerId: string, message: unknown): void {
    broadcastOthers(excludePlayerId, message, { players: this.players });
  }

  private _broadcastAll(message: unknown): void {
    broadcastAll(message, { players: this.players });
  }

  private _sendTo(ws: WebSocket, message: unknown): void {
    sendTo(ws, message);
  }

  private _resolvePlayerSpawnPoint(index: number, excludePlayerId?: string): Vec3 {
    // ─ SPATIAL SPAWNING: Use SpawnPointRegistry for deterministic offsets ─
    const registeredIndex = this.spawnPointRegistry.registerPlayerSpawn(excludePlayerId || `player_${index}`);
    
    // Get base spawn point from standard algorithm
    const baseSpawn = getPlayerSpawnPoint({
      startIndex: index,
      spawnPoints: this.room.spawnPoints,
      selectedMap: this.room.selectedMap,
      players: this.players.entries(),
      excludePlayerId,
      isPositionValid: (position, radius) => this.collisionAuthority.isPositionValid(position, radius),
      playerCollisionRadius: PLAYER_COLLISION_RADIUS,
    });

    // Apply deterministic offset based on registry index
    const offsetSpawn = this.spawnPointRegistry.calculateDeterministicOffset(registeredIndex, baseSpawn);
    
    console.log('[SpawnPointRegistry] Resolved spawn point', {
      playerId: excludePlayerId,
      registeredIndex,
      baseSpawn,
      offsetSpawn,
      timestamp: Date.now(),
    });
    
    // Verify offset position is usable; fall back to base if not
    if (this.collisionAuthority.isPositionValid(offsetSpawn, PLAYER_COLLISION_RADIUS)) {
      return offsetSpawn;
    }
    
    return baseSpawn;
  }

  private _getRespawnDelayMs(): number {
    return 2000 + Math.floor(Math.random() * 3000);
  }

  getProtocolHandshake(): { collisionAuthority: { version: number; checksum: string }; snapshotSchemaVersion: number } {
    return {
      collisionAuthority: this.collisionAuthority.getHandshake(),
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    };
  }

  getNetworkDiagnostics(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      tickRate: this.tickRate,
      worldObjectCount: this.worldObjects.size,
      actorRuntime: this.actorRuntime.getDiagnostics(),
      ...this.snapshotDiagnostics,
    };
  }

  getPlayerCount(): number { return this.players.size; }
  getEntityCount(): number { return this.entities.size; }
  getRoundState(): RoundState { return { ...this.roundState }; }
}