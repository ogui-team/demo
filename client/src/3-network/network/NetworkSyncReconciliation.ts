import { gameBus } from '../../1-kernel/core/EventBus';
import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';
import { applyInput, subtract, dot, magnitude, angleDelta, createMovementRuntimeState } from './NetworkMovementPrediction';
import {
  DEFAULT_MOVEMENT_TUNING_CONFIG,
} from './MovementTuningConfig';
import {
  resolveLastProcessedInputSequence,
  resolveLastProcessedInputTick,
  pruneAcknowledgedInputs,
} from './NetworkSyncRuntime';
import type {
  NetworkSnapshot,
  NetworkReplicatedEntityState,
} from './NetworkRuntimeContracts';

const MOVEMENT_COYOTE_TIME_SECONDS = PHYSICS_CONSTANTS.PLAYER_COYOTE_TIME_SECONDS;
const LOCAL_DESYNC_WARNING_DISTANCE = PHYSICS_CONSTANTS.CLIENT_DESYNC_WARNING_DISTANCE;
const LOCAL_DESYNC_WARNING_STREAK = PHYSICS_CONSTANTS.CLIENT_DESYNC_WARNING_STREAK;
const CORRECTION_THRESHOLD = PHYSICS_CONSTANTS.CLIENT_CORRECTION_THRESHOLD;
const POSITION_ERROR_DECAY_MS = PHYSICS_CONSTANTS.CLIENT_POSITION_ERROR_DECAY_MS;

export function applyAuthoritativeSnapshot(context: any, snapshot: NetworkSnapshot): void {
  context.lastAppliedSnapshotTick = snapshot.tick;
  context.lastServerTick = snapshot.tick;
  const appliedIds: string[] = [];
  const expectedLocalPlayerId = context.networkManager.getLocalPlayerId();
  if (expectedLocalPlayerId && context.localPlayerId !== expectedLocalPlayerId) {
    context.localPlayerId = expectedLocalPlayerId;
  }

  if (snapshot.entities.length === 0) {
    const localBinding = context.localPlayerId ? context.bindings.get(context.localPlayerId) : undefined;
    if (!localBinding) {
      console.warn('[SYNC_WARNING] Local player missing in snapshot', {
        tick: snapshot.tick,
        ackInputSeq: snapshot.ackInputSeq,
        timestamp: snapshot.timestamp,
        reason: 'Empty snapshot received; preserving current entity state',
      });
    }
    return;
  }

  context.processPendingAuthorityBindings(snapshot);

  const controlledSnapshot = snapshot.entities.find(
    (entitySnapshot) => entitySnapshot.replicated?.isPlayerControlled === true,
  );

  if (controlledSnapshot) {
    const controlledPlayerId = expectedLocalPlayerId ?? context.localPlayerId ?? controlledSnapshot.entityId;
    if (!context.localPlayerId && controlledPlayerId) {
      context.localPlayerId = controlledPlayerId;
    }

    const localEntity = context.entityManager.getEntities().find((candidate: any) => candidate.hasComponent('localPlayer'));
    const currentNetworkEntityId = context.networkEntityIdsByPlayer.get(controlledPlayerId);
    if (localEntity && currentNetworkEntityId && currentNetworkEntityId !== controlledSnapshot.entityId) {
      context.bindLocalPlayer(controlledPlayerId, localEntity, {
        movementSpeed: DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
        acceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
        collisionRadius: 0.8,
        networkEntityId: controlledSnapshot.entityId,
      });
    }

    if (!context.bindings.has(controlledPlayerId)) {
      const hasRequiredData = context.isSnapshotDataComplete(controlledSnapshot);
      if (!hasRequiredData) {
        context.queuePendingAuthorityBinding(controlledPlayerId, controlledSnapshot.entityId);
        console.log('[AwaitReady] Queued pending authority - waiting for complete snapshot', {
          playerId: controlledPlayerId,
          networkEntityId: controlledSnapshot.entityId,
          tick: snapshot.tick,
        });
        return;
      }

      if (localEntity) {
        context.bindLocalPlayer(controlledPlayerId, localEntity, {
          movementSpeed: DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
          acceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
          collisionRadius: 0.8,
          networkEntityId: controlledSnapshot.entityId,
        });
        console.log('[AwaitReady] Binding successful - data verified', {
          playerId: controlledPlayerId,
          networkEntityId: controlledSnapshot.entityId,
          tick: snapshot.tick,
          hasPosition: !!controlledSnapshot.transform?.position,
          hasHealth: !!controlledSnapshot.replicated?.health,
        });
      }
    }
  }

  const localBinding = context.localPlayerId ? context.bindings.get(context.localPlayerId) : undefined;

  if (!context.hasEmittedFullSyncData && localBinding) {
    context.hasEmittedFullSyncData = true;
    gameBus.emit('FULL_SYNC_DATA', {
      playerId: context.localPlayerId,
      tick: snapshot.tick,
      entityCount: snapshot.entities.length,
      timestamp: snapshot.timestamp,
      localPlayerId: context.localPlayerId,
      entities: snapshot.entities.map((entity: any) => ({
        id: entity.entityId,
        networkEntityId: entity.entityId,
        isPlayerControlled: entity.replicated?.isPlayerControlled === true,
        IS_PLAYER_CONTROLLED: entity.replicated?.isPlayerControlled === true,
      })),
    });
    if (localBinding.networkEntityId) {
      gameBus.emit('SYNC_VERIFIED', {
        playerId: context.localPlayerId,
        tick: snapshot.tick,
        networkEntityId: localBinding.networkEntityId,
        timestamp: snapshot.timestamp,
        reason: 'Initial snapshot binding complete with verified data',
      });
      console.log('[AwaitReady] SYNC_VERIFIED emitted - ready for hydration', {
        playerId: context.localPlayerId,
        tick: snapshot.tick,
      });
    }
  }

  const localNetworkEntityId = controlledSnapshot?.entityId
    ?? (context.localPlayerId ? context.networkEntityIdsByPlayer.get(context.localPlayerId) : undefined);
  const localSnapshots: NetworkReplicatedEntityState[] = [];
  const remoteSnapshots: NetworkReplicatedEntityState[] = [];

  gameBus.emit('SNAPSHOT_RECEIVED', {
    tick: snapshot.tick,
    ackInputSeq: snapshot.ackInputSeq,
    lastProcessedInput: resolveLastProcessedInputSequence(snapshot),
    timestamp: snapshot.timestamp,
    entityIds: snapshot.entities.map((entity) => entity.entityId),
  });

  for (const entitySnapshot of snapshot.entities) {
    if (entitySnapshot.entityId === localNetworkEntityId) {
      localSnapshots.push(entitySnapshot);
    } else {
      remoteSnapshots.push(entitySnapshot);
    }
  }

  if (context.authorityMode === 'remote' && !localBinding && snapshot.entities.length > 0) {
    console.warn('[SpawnDiagnostics] PLAYER SPAWN REQUEST', {
      source: 'network_sync_snapshot_before_local_bind',
      tick: snapshot.tick,
      localPlayerId: context.localPlayerId,
      snapshotEntityIds: snapshot.entities.map((entity) => entity.entityId),
    });
  }

  appliedIds.push(...context.replicationSystem.applySnapshots(remoteSnapshots));

  if (localBinding && localSnapshots[0]) {
    context.lastLocalSnapshotTick = snapshot.tick;
    const authoritative = localSnapshots[0];

    if (context.authorityMode === 'local') {
      context.setStatusMovementModifier(
        localBinding.playerId,
        context.parseStatusMovementModifier(authoritative.replicated?.statusMovementModifier),
      );
    } else {
      context.setStatusMovementModifier(
        localBinding.playerId,
        context.parseStatusMovementModifier(authoritative.replicated?.statusMovementModifier),
      );
      const before = localBinding.entity.getPosition();
      const beforeRotation = localBinding.entity.getRotation();
      const correctionDistance = authoritative.transform
        ? magnitude(subtract(authoritative.transform.position, before))
        : 0;
      const rotationCorrection = authoritative.transform
        ? Math.max(
            Math.abs(angleDelta(authoritative.transform.rotation.x, beforeRotation.x)),
            Math.abs(angleDelta(authoritative.transform.rotation.y, beforeRotation.y)),
            Math.abs(angleDelta(authoritative.transform.rotation.z, beforeRotation.z)),
          )
        : 0;
      const requiresPositionCorrection = correctionDistance > CORRECTION_THRESHOLD && !!authoritative.transform;
      const preserveRotation = context.authorityMode === 'remote' || rotationCorrection <= 0.025;

      if (!context.localReconciliationEnabled) {
        context.replicationSystem.applySnapshot(authoritative, {
          preservePosition: true,
          preserveRotation: true,
        });

        const currentPosition = before;
        const runtime = context.movementState.get(localBinding.playerId) ?? {
          ...createMovementRuntimeState(context.tick),
          groundHeight: currentPosition.y,
          lastCorrectionTick: snapshot.tick,
        };

        runtime.positionError = { x: 0, y: 0, z: 0 };
        runtime.positionErrorDecayRemaining = 0;
        runtime.lastCorrectionTick = snapshot.tick;
        context.applyAuthoritativeMovementState(runtime, authoritative, currentPosition);
        context.movementState.set(localBinding.playerId, runtime);

        const ackSequence = resolveLastProcessedInputSequence(snapshot);
        const ackTick = resolveLastProcessedInputTick(snapshot);
        pruneAcknowledgedInputs(
          context,
          localBinding.playerId,
          ackSequence,
          ackTick,
        );

        appliedIds.push(authoritative.entityId);
        if (appliedIds.length > 0) {
          gameBus.emit('replicationSnapshotApplied', {
            tick: snapshot.tick,
            entityIds: appliedIds,
          });
        }
        return;
      }

      if (requiresPositionCorrection) {
        gameBus.emit('RECONCILIATION_BEGIN', {
          playerId: localBinding.playerId,
          tick: snapshot.tick,
          timestamp: Engine.time.now(),
        });
      }

      context.replicationSystem.applySnapshot(authoritative, {
        preservePosition: true,
        preserveRotation,
      });

      const after = localBinding.entity.getPosition();
      const runtime = context.movementState.get(localBinding.playerId) ?? {
        ...createMovementRuntimeState(context.tick),
        groundHeight: after.y,
        lastCorrectionTick: snapshot.tick,
      };

      if (correctionDistance > 100) {
        console.warn('[DESYNC_CRITICAL] Massive position correction!', {
          playerId: localBinding.playerId,
          tick: snapshot.tick,
          correctionDistance: correctionDistance.toFixed(2),
          clientPos: {
            x: after.x.toFixed(2),
            y: after.y.toFixed(2),
            z: after.z.toFixed(2),
          },
          serverPos: authoritative.transform ? {
            x: authoritative.transform.position.x.toFixed(2),
            y: authoritative.transform.position.y.toFixed(2),
            z: authoritative.transform.position.z.toFixed(2),
          } : null,
          clientVel: {
            x: runtime?.velocity?.x?.toFixed(2) ?? '?',
            y: runtime?.velocity?.y?.toFixed(2) ?? '?',
            z: runtime?.velocity?.z?.toFixed(2) ?? '?',
          },
          serverVel: authoritative.velocity ? {
            x: authoritative.velocity.x.toFixed(2),
            y: authoritative.velocity.y.toFixed(2),
            z: authoritative.velocity.z.toFixed(2),
          } : null,
        });
      }

      if (requiresPositionCorrection && authoritative.transform) {
        const authoritativePos = authoritative.transform.position;
        runtime.positionError = {
          x: authoritativePos.x - after.x,
          y: authoritativePos.y - after.y,
          z: authoritativePos.z - after.z,
        };
        runtime.positionErrorDecayRemaining = POSITION_ERROR_DECAY_MS;
        runtime.lastReconciliationTime = Engine.time.now();
        console.log('[INPUT_REPLAY] Correction Applied', {
          playerId: localBinding.playerId,
          correctionDistance,
          errorVector: {
            x: runtime.positionError.x.toFixed(4),
            y: runtime.positionError.y.toFixed(4),
            z: runtime.positionError.z.toFixed(4),
          },
          decayMs: POSITION_ERROR_DECAY_MS,
        });
      } else {
        runtime.positionError = { x: 0, y: 0, z: 0 };
        runtime.positionErrorDecayRemaining = 0;
      }

      if (authoritative.velocity) {
        runtime.velocity = {
          x: authoritative.velocity.x,
          y: authoritative.velocity.y,
          z: authoritative.velocity.z,
        };
        const velMagnitude = Math.hypot(authoritative.velocity.x, authoritative.velocity.z);
        if (velMagnitude > 10) {
          console.log('[VEL_DEBUG] Massive velocity from server', {
            playerId: localBinding.playerId,
            velocity: {
              x: authoritative.velocity.x.toFixed(2),
              y: authoritative.velocity.y.toFixed(2),
              z: authoritative.velocity.z.toFixed(2),
            },
            magnitude: velMagnitude.toFixed(2),
          });
        }
      }

      if (context.authorityMode === 'remote') {
        runtime.jumpRequested = false;
        runtime.jumpBufferRemaining = 0;
        runtime.lastJumpImpulse = 0;
      }

      context.applyAuthoritativeMovementState(runtime, authoritative, after);
      runtime.lastCorrectionDistance = correctionDistance;
      runtime.lastCorrectionTick = snapshot.tick;
      runtime.sustainedHighDriftFrames = correctionDistance >= LOCAL_DESYNC_WARNING_DISTANCE
        ? runtime.sustainedHighDriftFrames + 1
        : 0;

      runtime.jumpRequested = false;
      runtime.jumpBufferRemaining = 0;

      context.movementState.set(localBinding.playerId, runtime);

      if (requiresPositionCorrection) {
        gameBus.emit('SMOOTHNESS_SAMPLE', {
          source: 'network_sync_local_reconciliation',
          playerId: localBinding.playerId,
          tick: snapshot.tick,
          correctionDistance,
          lerpFactor: 0.15,
          threshold: context.reconciliationThreshold,
        });
      }

      if (
        runtime.sustainedHighDriftFrames >= LOCAL_DESYNC_WARNING_STREAK
        && runtime.sustainedHighDriftFrames % LOCAL_DESYNC_WARNING_STREAK === 0
      ) {
        console.warn('[PERF_WARNING] Physics Desync Detected', {
          playerId: localBinding.playerId,
          tick: snapshot.tick,
          correctionDistance,
          threshold: context.reconciliationThreshold,
          lerpFactor: 0.15,
          ackInputSeq: resolveLastProcessedInputSequence(snapshot),
          lastProcessedInput: resolveLastProcessedInputSequence(snapshot),
          lastProcessedInputTick: resolveLastProcessedInputTick(snapshot),
          sustainedFrames: runtime.sustainedHighDriftFrames,
        });
      }

      const ackSequence = resolveLastProcessedInputSequence(snapshot);
      const ackTick = resolveLastProcessedInputTick(snapshot);
      const remaining = pruneAcknowledgedInputs(
        context,
        localBinding.playerId,
        ackSequence,
        ackTick,
      );

      const MAX_REPLAY_INPUTS = 120;
      const replayCount = Math.min(remaining.length, MAX_REPLAY_INPUTS);

      if (remaining.length > 0) {
        if (remaining.length > MAX_REPLAY_INPUTS) {
          console.warn('[INPUT_REPLAY] Input buffer overflowed!', {
            playerId: localBinding.playerId,
            tick: snapshot.tick,
            pendingInputCount: remaining.length,
            maxAllowed: MAX_REPLAY_INPUTS,
            dropped: remaining.length - MAX_REPLAY_INPUTS,
            ackSequence,
            ackTick,
          });
        }

        console.log('[INPUT_REPLAY] Starting replay', {
          playerId: localBinding.playerId,
          tick: snapshot.tick,
          pendingInputCount: replayCount,
          totalBuffered: remaining.length,
          ackSequence,
          ackTick,
        });
      }

      for (let i = 0; i < replayCount; i += 1) {
        applyInput({
          binding: localBinding,
          input: remaining[i].input,
          dt: context.fixedStep,
          currentTick: context.tick,
          movementState: context.movementState,
          collisionResolver: context.collisionResolver,
          movementFeelDebugConfigs: context.movementFeelDebugConfigs,
          resolvedMovementTuningScratch: context.resolvedMovementTuningScratch,
          pendingMovementIntent: context.pendingMovementIntent,
          resolveStatusMovementModifier: (playerId: string) => context.resolveStatusMovementModifier(playerId),
          localPlayerId: context.localPlayerId,
          spatialPartition: context.spatialPartition,
        });
      }

      if (remaining.length > 0) {
        const posAfterReplay = localBinding.entity.getPosition();
        console.log('[INPUT_REPLAY] Replay complete', {
          playerId: localBinding.playerId,
          replayed: replayCount,
          overflowed: remaining.length > MAX_REPLAY_INPUTS,
          positionAfter: {
            x: posAfterReplay.x.toFixed(3),
            y: posAfterReplay.y.toFixed(3),
            z: posAfterReplay.z.toFixed(3),
          },
        });
      }

      if (requiresPositionCorrection) {
        gameBus.emit('RECONCILIATION_END', {
          playerId: localBinding.playerId,
          tick: snapshot.tick,
          replayedInputCount: remaining.length,
          timestamp: Engine.time.now(),
        });
      }

      appliedIds.push(authoritative.entityId);
      gameBus.emit('ENTITY_RECONCILED', {
        playerId: localBinding.playerId,
        entityId: authoritative.entityId,
        tick: snapshot.tick,
        correctionDistance: runtime.lastCorrectionDistance,
        authoritativePosition: after,
      });
    }
  }

  if (appliedIds.length > 0) {
    gameBus.emit('replicationSnapshotApplied', {
      tick: snapshot.tick,
      entityIds: appliedIds,
    });
  }
}
