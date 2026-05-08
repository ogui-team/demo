import type { Entity, Vector3 } from '../../../1-kernel/core/Entity';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { DEFAULT_MOVEMENT_TUNING_CONFIG } from '../../../3-network/network/MovementTuningConfig';

interface NetworkSyncAdapter {
  setAuthorityMode(mode: 'local' | 'remote'): void;
  setRemotePredictionMode(mode: 'full' | 'rotation-only'): void;
  setCommandSink(sink: ((command: {
    seq: number;
    timestamp: number;
    input: {
      forward?: boolean;
      backward?: boolean;
      left?: boolean;
      right?: boolean;
      jump?: boolean;
      sprint?: boolean;
      crouch?: boolean;
      movementIntent?: {
        jump?: boolean;
        crouch?: boolean;
      };
      yaw?: number;
      pitch?: number;
    };
  }) => void) | null): void;
  bindLocalPlayer(playerId: string, entity: Entity, options: {
    movementSpeed: number;
    acceleration: number;
    collisionRadius: number;
    networkEntityId: string;
  }): void;
  forceLocalState(position: Vector3, rotation: Vector3, velocity: Vector3): void;
  hasConfirmedNetworkHandle(playerId: string): boolean;
}

interface CollisionAuthorityAdapter {
  canPredictMovement(mode: 'remote'): boolean;
}

export interface LocalPlayerAuthorityCoordinatorConfig {
  getLocalPlayerEntity: () => Entity | null;
  createLocalPlayerEntity: (playerId: string, color: number) => Entity | null;
  networkSyncSystem: NetworkSyncAdapter;
  collisionAuthority: CollisionAuthorityAdapter;
  sendMovementCommand: (command: {
    seq: number;
    ts: number;
    input: {
      forward: boolean;
      backward: boolean;
      left: boolean;
      right: boolean;
      jump: boolean;
      sprint: boolean;
      crouch: boolean;
      movementIntent: {
        jump: boolean;
        crouch: boolean;
      };
      yaw: number;
      pitch: number;
    };
  }) => void;
  bindPlayController: (entityId: string | null) => void;
  emitForceRebind: (payload: { playerId: string; entityId: string; cause: string }) => void;
  setCameraFollowEntity: (entityId: string) => void;
  bindLocalPlayerModel: (playerId: string, entity: Entity) => void;
  ensure2DScene: () => void;
  setLocalPlayerDebugVisualVisible: (visible: boolean, reason: string) => void;
  resolveKernelHandleByPlayerId: (playerId: string) => number | null;
  ensureMeshBindingForHandle: (entityId: string, handle: number) => boolean;
  hasMeshBindingForHandle: (handle: number) => boolean;
  canEnableInputForPlayer: (playerId: string) => boolean;
  onEntityCreated?: (entity: Entity) => void;
}

export class LocalPlayerAuthorityCoordinator {
  private readonly config: LocalPlayerAuthorityCoordinatorConfig;
  private readonly missingMeshBindingHandles = new Set<number>();
  private readonly pendingMeshRetryKeys = new Set<string>();
  private isBindingLocked = false;
  private bindingLockedReason = '';
  private bindingLockTimeoutId: number | null = null;
  private authorityValidatedPlayerId: string | null = null;
  private lastExecutedBinding: { playerId: string; entityId: string; authorityMode: 'local' | 'remote' } | null = null;
  private lastMeshReadyRebindKey: string | null = null;
  private lastFullSyncSignature: string | null = null;

  // ─ DEFERRED BINDING: Queue pending bindings until authority confirmed
  private pendingBindings: Array<{
    playerId: string;
    authorityMode: 'local' | 'remote';
    enqueuedAt: number;
  }> = [];
  private isProcessingPendingBindings = false;

  constructor(config: LocalPlayerAuthorityCoordinatorConfig) {
    this.config = config;
    
    // ─ AUTHORITY-BASED BINDING: Listen for server authority confirmation
    gameBus.on('SPAWN_AUTHORITY_VALIDATED', ({ playerId, entityId, authority }: any) => {
      console.log('[Authority] SPAWN_AUTHORITY_VALIDATED received', {
        playerId,
        entityId,
        authority,
        hasPendingBindings: this.pendingBindings.length,
        timestamp: Date.now(),
      });
      
      this.authorityValidatedPlayerId = playerId;
      
      // ─ DEFERRED BINDING: Process pending bindings now that authority is confirmed
      this.processPendingBindings();
    });

    // ─ FALLBACK: Also listen for FULL_SYNC_READY as backup authority signal
    gameBus.on('FULL_SYNC_READY', () => {
      console.log('[Authority] FULL_SYNC_READY received (backup authority signal)', {
        hasPendingBindings: this.pendingBindings.length,
        authorityValidatedPlayerId: this.authorityValidatedPlayerId,
        timestamp: Date.now(),
      });
      
      // If we haven't validated authority yet through SPAWN_AUTHORITY, accept it now
      if (this.authorityValidatedPlayerId === null) {
        this.authorityValidatedPlayerId = 'confirmed_by_full_sync';
      }
      
      // Process any pending bindings
      this.processPendingBindings();
    });
    
    // ─ PERMANENT-BINDING-GUARD: Lock bindings when rebind occurs ─
    gameBus.on('ENTITY_REBOUND', ({ entityId, oldHandle, newHandle, reason }: any) => {
      const localEntityId = this.config.getLocalPlayerEntity()?.id ?? null;
      if (!localEntityId || entityId !== localEntityId) {
        return;
      }

      this.isBindingLocked = true;
      this.bindingLockedReason = reason;
      this.lastExecutedBinding = null;
      this.lastMeshReadyRebindKey = null;
      if (this.bindingLockTimeoutId !== null) {
        window.clearTimeout(this.bindingLockTimeoutId);
        this.bindingLockTimeoutId = null;
      }
      this.bindingLockTimeoutId = window.setTimeout(() => {
        this.isBindingLocked = false;
        this.bindingLockedReason = '';
        this.bindingLockTimeoutId = null;
        console.log('[LocalPlayerAuthorityCoordinator] Binding lock auto-released after local ENTITY_REBOUND', {
          entityId,
          reason,
          timestamp: Date.now(),
        });
      }, 500);

      console.log('[LocalPlayerAuthorityCoordinator] Binding lock engaged on ENTITY_REBOUND', {
        entityId,
        oldHandle,
        newHandle,
        reason,
        timestamp: Date.now(),
      });
    });
    
    // ─ PERMANENT-BINDING-GUARD: Unlock bindings when full sync or reset ─
    gameBus.on('FORCE_FULL_SYNC', () => {
      this.isBindingLocked = false;
      this.bindingLockedReason = '';
      if (this.bindingLockTimeoutId !== null) {
        window.clearTimeout(this.bindingLockTimeoutId);
        this.bindingLockTimeoutId = null;
      }
      this.lastExecutedBinding = null;
      this.lastMeshReadyRebindKey = null;
      console.log('[LocalPlayerAuthorityCoordinator] Binding lock released on FORCE_FULL_SYNC');
    });
    
    gameBus.on('RUNTIME_RESET', () => {
      this.isBindingLocked = false;
      this.bindingLockedReason = '';
      if (this.bindingLockTimeoutId !== null) {
        window.clearTimeout(this.bindingLockTimeoutId);
        this.bindingLockTimeoutId = null;
      }
      this.authorityValidatedPlayerId = null;
      this.lastExecutedBinding = null;
      this.lastMeshReadyRebindKey = null;
      this.lastFullSyncSignature = null;
      this.pendingMeshRetryKeys.clear();
      this.pendingBindings = [];
      this.isProcessingPendingBindings = false;
      console.log('[LocalPlayerAuthorityCoordinator] Binding lock released on RUNTIME_RESET, pending bindings cleared');
    });

    // ─ MULTIPLAYER SYNC FIX: Validate snapshot contains local player entity ─
    gameBus.on('FULL_SYNC_DATA', ({ playerId, localPlayerId, entities, tick }: any) => {
      const eventPlayerId = typeof playerId === 'string' ? playerId : null;
      const eventLocalPlayerId = typeof localPlayerId === 'string' ? localPlayerId : null;
      const resolvedPlayerId = eventPlayerId ?? eventLocalPlayerId;
      const signature = `${resolvedPlayerId ?? 'unknown'}:${typeof tick === 'number' ? tick : 'na'}:${Array.isArray(entities) ? entities.length : 0}`;

      if (signature === this.lastFullSyncSignature) {
        return;
      }
      this.lastFullSyncSignature = signature;

      if (eventPlayerId && eventLocalPlayerId && eventPlayerId !== eventLocalPlayerId) {
        console.warn('[LocalPlayerAuthorityCoordinator] FULL_SYNC_DATA identity mismatch; preferring playerId', {
          playerId: eventPlayerId,
          localPlayerId: eventLocalPlayerId,
          timestamp: Date.now(),
        });
      }

      console.log('[LocalPlayerAuthorityCoordinator] FULL_SYNC_DATA received - validating snapshot entities', {
        playerId: resolvedPlayerId,
        entityCount: entities?.length ?? 0,
        timestamp: Date.now(),
      });

      if (!resolvedPlayerId) {
        console.error('[LocalPlayerAuthorityCoordinator] FULL_SYNC_DATA missing local player identity', {
          playerId,
          localPlayerId,
          timestamp: Date.now(),
        });
        return;
      }

      if (!entities || entities.length === 0) {
        console.error('[LocalPlayerAuthorityCoordinator] FULL_SYNC_DATA contains empty entities array', {
          playerId: resolvedPlayerId,
          timestamp: Date.now(),
        });
        return;
      }

      // ─ Query: Find entity matching localPlayerId ─
      const localPlayerEntity = entities.find((entity: any) =>
        entity.id === resolvedPlayerId ||
        entity.networkEntityId === resolvedPlayerId ||
        entity.isPlayerControlled === true ||
        (entity as any).IS_PLAYER_CONTROLLED === true
      );

      if (localPlayerEntity) {
        console.log('[LocalPlayerAuthorityCoordinator] ✅ Snapshot Entity für Player gefunden', {
          playerId: resolvedPlayerId,
          entityId: localPlayerEntity.id,
          entityHandle: localPlayerEntity.networkEntityId || localPlayerEntity.id,
          entityType: localPlayerEntity.type,
          isPlayerControlled: localPlayerEntity.isPlayerControlled ?? localPlayerEntity.IS_PLAYER_CONTROLLED,
          timestamp: Date.now(),
        });

        // ─ MULTIPLAYER SYNC FIX: Mark as validated for input release ─
        this.authorityValidatedPlayerId = resolvedPlayerId;
        console.log('[LocalPlayerAuthorityCoordinator] Authority marked as validated from FULL_SYNC_DATA', {
          playerId: resolvedPlayerId,
          timestamp: Date.now(),
        });
      } else {
        console.error('[LocalPlayerAuthorityCoordinator] ❌ Snapshot Entity für Player NICHT gefunden', {
          playerId: resolvedPlayerId,
          availableEntityIds: entities.map((e: any) => ({
            id: e.id,
            networkEntityId: e.networkEntityId,
            type: e.type,
            isPlayerControlled: e.isPlayerControlled,
            legacyIsPlayerControlled: e.IS_PLAYER_CONTROLLED,
          })),
          timestamp: Date.now(),
        });
      }
    });
  }

  getLocalPlayerEntity(): Entity | null {
    return this.config.getLocalPlayerEntity();
  }

  ensureLocalPlayerEntity(playerId: string): Entity {
    let localPlayerEntity = this.config.getLocalPlayerEntity();
    if (localPlayerEntity) return localPlayerEntity;

    localPlayerEntity = this.config.createLocalPlayerEntity(playerId, 0xffff00);
    if (!localPlayerEntity) {
      throw new Error('LocalPlayer entity could not be created');
    }
    this.config.onEntityCreated?.(localPlayerEntity);
    return localPlayerEntity;
  }

  bind(playerId: string, authorityMode: 'local' | 'remote'): Entity {
    // ─ PERMANENT-BINDING-GUARD: Prevent binding while rebind is occurring ─
    if (this.isBindingLocked) {
      console.warn('[LocalPlayerAuthorityCoordinator] Binding skipped - lock active', {
        playerId,
        authorityMode,
        reason: this.bindingLockedReason,
        timestamp: Date.now(),
      });
      const localPlayerEntity = this.config.getLocalPlayerEntity();
      if (localPlayerEntity) {
        return localPlayerEntity;
      }
      throw new Error('LocalPlayer entity not found and binding is locked');
    }

    // ─ DEFERRED BINDING: In multiplayer, if authority not yet validated, queue the binding and allow early remote bind when the local player entity is already present ─
    if (authorityMode === 'remote' && this.authorityValidatedPlayerId === null) {
      console.log('[Authority] Binding pending authority validation', {
        playerId,
        authorityMode,
        validatedPlayerId: this.authorityValidatedPlayerId,
        pendingQueue: this.pendingBindings.length,
        enqueuedAt: Date.now(),
      });

      const isDuplicate = this.pendingBindings.some(
        (binding) => binding.playerId === playerId && binding.authorityMode === authorityMode,
      );
      if (!isDuplicate) {
        this.pendingBindings.push({
          playerId,
          authorityMode,
          enqueuedAt: Date.now(),
        });
      }

      const existingLocalEntity = this.config.getLocalPlayerEntity();
      if (existingLocalEntity) {
        console.log('[Authority] Performing early remote bind while awaiting handshake', {
          playerId,
          entityId: existingLocalEntity.id,
        });
        return this._executeBind(playerId, authorityMode);
      }

      return this.ensureLocalPlayerEntity(playerId);
    }

    // ─ BINDING EXECUTION: Authority confirmed (or local mode), execute full binding ─
    return this._executeBind(playerId, authorityMode);
  }

  private _executeBind(playerId: string, authorityMode: 'local' | 'remote'): Entity {
    const localPlayerEntity = this.ensureLocalPlayerEntity(playerId);
    const bindingSignature = {
      playerId,
      entityId: localPlayerEntity.id,
      authorityMode,
    } as const;
    const isRepeatedBinding = this.lastExecutedBinding?.playerId === bindingSignature.playerId
      && this.lastExecutedBinding.entityId === bindingSignature.entityId
      && this.lastExecutedBinding.authorityMode === bindingSignature.authorityMode;

    this.config.networkSyncSystem.setAuthorityMode(authorityMode);
    this.config.networkSyncSystem.setRemotePredictionMode(
      authorityMode === 'remote' && !this.config.collisionAuthority.canPredictMovement('remote')
        ? 'rotation-only'
        : 'full',
    );
    this.config.networkSyncSystem.setCommandSink(
      authorityMode === 'remote'
        ? (command) => {
            this.config.sendMovementCommand({
              seq: command.seq,
              ts: command.timestamp,
              input: {
                forward: !!command.input.forward,
                backward: !!command.input.backward,
                left: !!command.input.left,
                right: !!command.input.right,
                jump: !!command.input.jump,
                sprint: !!command.input.sprint,
                crouch: !!command.input.crouch,
                movementIntent: {
                  jump: command.input.movementIntent?.jump === true || command.input.jump === true,
                  crouch: command.input.movementIntent?.crouch === true || command.input.crouch === true,
                },
                yaw: typeof command.input.yaw === 'number' ? command.input.yaw : 0,
                pitch: typeof command.input.pitch === 'number' ? command.input.pitch : 0,
              },
            });
          }
        : null,
    );
    this.config.networkSyncSystem.bindLocalPlayer(playerId, localPlayerEntity, {
      movementSpeed: DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
      acceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
      collisionRadius: 0.8,
      networkEntityId: playerId,
    });

    if (!this.config.networkSyncSystem.hasConfirmedNetworkHandle(playerId)) {
      console.warn('[LocalPlayerAuthorityCoordinator] Continuing local bind before handle confirmation', {
        playerId,
        entityId: localPlayerEntity.id,
        reason: 'degraded_handle_confirmation',
      });
    }

    if (!isRepeatedBinding) {
      this.config.bindPlayController(localPlayerEntity.id);
      gameBus.emit('CONTROLLER_BOUND', {
        playerId,
        entityId: localPlayerEntity.id,
        timestamp: Date.now(),
      });
      this.config.emitForceRebind({
        playerId,
        entityId: localPlayerEntity.id,
        cause: `bind_local_player:${authorityMode}`,
      });
      this.config.setCameraFollowEntity(localPlayerEntity.id);
      this.config.bindLocalPlayerModel(playerId, localPlayerEntity);
      this.config.ensure2DScene();
      this.config.setLocalPlayerDebugVisualVisible(false, `bind_local_player:${authorityMode}`);
    }

    this.lastExecutedBinding = bindingSignature;

    return localPlayerEntity;
  }

  private processPendingBindings(): void {
    if (this.isProcessingPendingBindings) {
      console.warn('[Authority] Process pending bindings already in progress, skipping');
      return;
    }

    if (this.pendingBindings.length === 0) {
      return;
    }

    this.isProcessingPendingBindings = true;
    console.log('[Authority] Processing pending bindings', {
      count: this.pendingBindings.length,
      authorityValidatedPlayerId: this.authorityValidatedPlayerId,
      timestamp: Date.now(),
    });

    try {
      for (const pending of this.pendingBindings) {
        const deferredMs = Date.now() - pending.enqueuedAt;
        console.log('[Authority] Executing deferred binding', {
          playerId: pending.playerId,
          authorityMode: pending.authorityMode,
          deferredMs,
        });

        try {
          this._executeBind(pending.playerId, pending.authorityMode);
          console.log('[Authority] Deferred binding succeeded', {
            playerId: pending.playerId,
            deferredMs,
          });
        } catch (error) {
          console.error('[Authority] Deferred binding failed', {
            playerId: pending.playerId,
            error: error instanceof Error ? error.message : String(error),
            deferredMs,
          });
        }
      }

      this.pendingBindings = [];
    } finally {
      this.isProcessingPendingBindings = false;
      console.log('[Authority] Pending bindings processing complete', {
        timestamp: Date.now(),
      });
    }
  }

  forceAuthoritativeState(
    playerId: string,
    authorityMode: 'local' | 'remote',
    position: Vector3,
    rotation: Vector3,
  ): Entity {
    const entity = this.bind(playerId, authorityMode);
    this.config.networkSyncSystem.forceLocalState(position, rotation, { x: 0, y: 0, z: 0 });
    return entity;
  }

  injectAuthoritativeSnapshotBinding(
    localPlayerId: string | null,
    entities: Array<{ id: string; isPlayerControlled?: boolean }>,
  ): void {
    // ─ PERMANENT-BINDING-GUARD: Prevent binding while rebind is occurring ─
    if (this.isBindingLocked) {
      console.warn('[LocalPlayerAuthorityCoordinator] Snapshot binding injection skipped - lock active', {
        localPlayerId,
        reason: this.bindingLockedReason,
        timestamp: Date.now(),
      });
      return;
    }
    
    if (!localPlayerId) {
      return;
    }

    const controlled = entities.find((entity) => entity.isPlayerControlled === true)
      ?? entities.find((entity) => entity.id === localPlayerId);

    if (!controlled) {
      return;
    }

    if (controlled.id !== localPlayerId) {
      console.warn('[LocalPlayerAuthorityCoordinator] Controlled snapshot entity uses distinct network identity', {
        localPlayerId,
        controlledEntityId: controlled.id,
        timestamp: Date.now(),
      });
    }

    const localPlayerEntity = this.ensureLocalPlayerEntity(localPlayerId);
    const handle = this.config.resolveKernelHandleByPlayerId(localPlayerId);
    if (handle == null) {
      console.error('[LocalPlayerAuthorityCoordinator] Blocking controller bind until handle confirmed', {
        playerId: localPlayerId,
        entityId: localPlayerEntity.id,
      });
      return;
    }

    if (!this.config.hasMeshBindingForHandle(handle)) {
      this.config.ensureMeshBindingForHandle(localPlayerEntity.id, handle);
    }

    if (!this.config.hasMeshBindingForHandle(handle)) {
      this.lastMeshReadyRebindKey = null;
      if (!this.missingMeshBindingHandles.has(handle)) {
        this.missingMeshBindingHandles.add(handle);
        console.warn('DEBUG_MESH_BINDING_MISSING', {
          playerId: localPlayerId,
          entityId: localPlayerEntity.id,
          localHandle: handle,
          source: 'authoritative_snapshot',
        });
      }
      this.scheduleMeshBindingRetry(localPlayerId, localPlayerEntity.id, handle, 'authoritative_snapshot');
      return;
    }

    this.missingMeshBindingHandles.delete(handle);
    const meshReadyRebindKey = `${localPlayerId}:${localPlayerEntity.id}:${handle}`;
    if (this.lastMeshReadyRebindKey === meshReadyRebindKey) {
      return;
    }

    this.lastMeshReadyRebindKey = meshReadyRebindKey;
    this.config.bindPlayController(localPlayerEntity.id);
    this.config.emitForceRebind({
      playerId: localPlayerId,
      entityId: localPlayerEntity.id,
      cause: 'authoritative_snapshot_mesh_binding_ready',
    });
  }

  isInputReady(playerId: string): boolean {
    return this.config.canEnableInputForPlayer(playerId);
  }

  private scheduleMeshBindingRetry(playerId: string, entityId: string, handle: number, source: string): void {
    const lifecyclePhase = typeof window !== 'undefined'
      ? (window as any).lifecycleOrchestrator?.getPhase?.() ?? null
      : null;
    if (lifecyclePhase !== 'PLAY_ACTIVE') {
      return;
    }

    const retryKey = `${playerId}:${entityId}:${handle}`;
    if (this.pendingMeshRetryKeys.has(retryKey)) {
      return;
    }

    this.pendingMeshRetryKeys.add(retryKey);
    const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));

    schedule(() => {
      this.pendingMeshRetryKeys.delete(retryKey);
      if (this.isBindingLocked) {
        return;
      }

      const currentEntity = this.config.getLocalPlayerEntity() ?? this.ensureLocalPlayerEntity(playerId);
      const meshReady = this.config.hasMeshBindingForHandle(handle)
        || this.config.ensureMeshBindingForHandle(currentEntity.id, handle);
      if (!meshReady) {
        return;
      }

      this.missingMeshBindingHandles.delete(handle);
      this.lastMeshReadyRebindKey = null;
      this.config.bindPlayController(currentEntity.id);
      this.config.emitForceRebind({
        playerId,
        entityId: currentEntity.id,
        cause: `${source}:mesh_retry`,
      });
      console.log('[BINDING_SUCCESS]', {
        playerId,
        entityId: currentEntity.id,
        handle,
        source: `${source}:mesh_retry`,
        timestamp: Date.now(),
      });
    });
  }
}
