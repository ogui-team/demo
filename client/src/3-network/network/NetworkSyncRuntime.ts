import { gameBus } from '../../1-kernel/core/EventBus';
import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';
import { applyInput, applyRotation, normalize, subtract, dot, magnitude } from './NetworkMovementPrediction';
import {
  NetworkHitValidationResult,
  NetworkHitValidationRequest,
  NetworkAbilityRequest,
  NetworkAbilityValidation,
  NetworkSnapshot,
  NetworkReplicatedEntityState,
  NetworkInputCommand,
} from './NetworkRuntimeContracts';

export function processAuthoritativeInputs(context: any): void {
  context.authoritativeInputQueue.sort((left: NetworkInputCommand, right: NetworkInputCommand) => left.seq - right.seq);
  while (context.authoritativeInputQueue.length > 0) {
    const command = context.authoritativeInputQueue.shift()!;
    const binding = context.bindings.get(command.playerId);
    if (!binding) continue;
    context.movementDebugState.lastProcessedAuthoritativeInput = command;
    context.movementDebugState.lastInputSource = 'authoritative_input';
    context.movementDebugState.timestamp = Date.now();
    applyInput({
      binding,
      input: command.input,
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
    context.lastProcessedInputSeq.set(command.playerId, command.seq);
    context.spatialPartition.markUsed(binding.entity.id, command.timestamp);
  }
}

export function applyLiveLocalInput(context: any, dt: number): void {
  const localPlayerId = context.localPlayerId;
  if (!localPlayerId) return;
  const binding = context.bindings.get(localPlayerId);
  if (!binding) return;

  const liveInput = context.liveInputs.get(localPlayerId) ?? {
    yaw: binding.entity.getRotation().y,
    pitch: binding.entity.getRotation().x,
  };

  context.movementDebugState.lastLiveInput = { ...liveInput };
  context.movementDebugState.lastLiveInputDt = dt;
  context.movementDebugState.lastInputSource = 'applyLiveLocalInput';
  context.movementDebugState.timestamp = Date.now();

  try {
    if (context.remotePredictionMode === 'rotation-only') {
      applyRotation({
        binding,
        input: liveInput,
        movementState: context.movementState,
        currentTick: context.tick,
      });
    } else {
      applyInput({
        binding,
        input: liveInput,
        dt,
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
  } catch (error) {
    console.error('[NetworkSyncSystem] applyLiveLocalInput crash', { playerId: binding.playerId, input: liveInput, error });
  }
}

export function broadcastSnapshot(context: any): void {
  const localBinding = context.localPlayerId ? context.bindings.get(context.localPlayerId) : undefined;
  const focusPosition = localBinding?.entity.getPosition();
  const relevantEntityIds = focusPosition
    ? context.spatialPartition.getRelevantEntityIds(focusPosition, context.relevanceRadius)
    : [...context.bindings.values()].map((binding: any) => binding.entity.id);
  const relevantNetworkIds = [...context.bindings.values()]
    .filter((binding: any) => relevantEntityIds.includes(binding.entity.id))
    .map((binding: any) => context.networkEntityIdsByPlayer.get(binding.playerId) ?? binding.playerId);
  const snapshots = context.replicationSystem.captureSnapshots(
    relevantNetworkIds.length > 0 ? relevantNetworkIds : undefined,
    context.tick,
    true,
  );
  if (snapshots.length === 0 && !context.localPlayerId) return;
  context.networkManager.sendSnapshot({
    tick: context.tick,
    timestamp: Date.now(),
    ackInputSeq: context.localPlayerId ? (context.lastProcessedInputSeq.get(context.localPlayerId) ?? 0) : 0,
    ...(context.localPlayerId && { lastProcessedInput: context.lastProcessedInputSeq.get(context.localPlayerId) ?? 0 }),
    entities: snapshots,
  });
}

export function resolveLastProcessedInputSequence(snapshot: NetworkSnapshot): number | undefined {
  if (typeof snapshot.lastProcessedInput === 'number' && Number.isFinite(snapshot.lastProcessedInput)) {
    return snapshot.lastProcessedInput;
  }
  if (typeof snapshot.ackInputSeq === 'number' && Number.isFinite(snapshot.ackInputSeq)) {
    return snapshot.ackInputSeq;
  }
  return undefined;
}

export function resolveLastProcessedInputTick(snapshot: NetworkSnapshot): number | undefined {
  if (typeof snapshot.lastProcessedInputTick === 'number' && Number.isFinite(snapshot.lastProcessedInputTick)) {
    return snapshot.lastProcessedInputTick;
  }
  return undefined;
}

export function pruneAcknowledgedInputs(
  context: any,
  playerId: string,
  lastProcessedSequence: number | undefined,
  lastProcessedTick: number | undefined,
): NetworkInputCommand[] {
  const queue = context.pendingInputs.get(playerId) ?? [];
  if (queue.length === 0) {
    return queue;
  }

  let writeIndex = 0;
  for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
    const command = queue[readIndex];
    const acknowledged = lastProcessedSequence !== undefined
      ? command.seq <= lastProcessedSequence
      : lastProcessedTick !== undefined
        ? command.tick <= lastProcessedTick
        : false;
    if (!acknowledged) {
      queue[writeIndex] = command;
      writeIndex += 1;
    }
  }

  queue.length = writeIndex;
  context.pendingInputs.set(playerId, queue);
  return queue;
}

export function captureHistoryFrame(context: any): void {
  const fullSnapshots = context.replicationSystem.captureSnapshots(undefined, context.tick, false);
  context.historyBuffer.push({
    tick: context.tick,
    timestamp: Date.now(),
    entities: new Map(fullSnapshots.map((snapshot: any) => [snapshot.entityId, snapshot])),
  });
  const maxFrames = Math.max(1, Math.ceil(context.historySeconds * context.tickRate));
  while (context.historyBuffer.length > maxFrames) {
    context.historyBuffer.shift();
  }
}

export function validateHitscan(context: any, request: NetworkHitValidationRequest): void {
  const frame = findHistoryFrame(context, request.timestamp);
  const direction = normalize(request.direction);
  let best: { entityId: string; distance: number } | null = null;

  for (const [playerId, binding] of context.bindings.entries()) {
    if (playerId === request.shooterId) continue;
    if (request.ignoreEntityIds?.includes(binding.entity.id)) continue;
    const snapshotKey = context.networkEntityIdsByPlayer.get(playerId) ?? binding.entity.id;
    const snapshot = frame?.entities.get(snapshotKey);
    const position = snapshot?.transform?.position ?? binding.entity.getPosition();
    const radius = binding.collisionRadius ?? 0.8;
    const toTarget = subtract(position, request.origin);
    const projection = dot(toTarget, direction);
    if (projection < 0 || projection > request.range) continue;
    const closestPoint = {
      x: request.origin.x + direction.x * projection,
      y: request.origin.y + direction.y * projection,
      z: request.origin.z + direction.z * projection,
    };
    const dx = position.x - closestPoint.x;
    const dy = position.y - closestPoint.y;
    const dz = position.z - closestPoint.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > radius * radius) continue;
    if (!best || projection < best.distance) {
      best = { entityId: binding.entity.id, distance: projection };
    }
  }

  const result: NetworkHitValidationResult = {
    shooterId: request.shooterId,
    shotId: request.shotId,
    timestamp: request.timestamp,
    hitEntityId: best?.entityId ?? null,
    rewindTick: frame?.tick,
  };
  context.networkManager.sendHitValidationResult(result);
}

export function validateAbilityRequest(context: any, request: NetworkAbilityRequest): void {
  const verdict = context.abilityValidator?.(request) ?? true;
  const accepted = verdict === true;
  const validation: NetworkAbilityValidation = {
    playerId: request.playerId,
    abilityId: request.abilityId,
    accepted,
    reason: accepted ? undefined : String(verdict),
    timestamp: Date.now(),
    payload: request.payload,
  };
  context.networkManager.sendAbilityValidation(validation);
}

export function handleAbilityValidation(context: any, validation: NetworkAbilityValidation): void {
  if (!validation.accepted) return;
  gameBus.emit('abilityCast', {
    entityId: validation.playerId,
    abilityId: validation.abilityId,
  });
}

export function findHistoryFrame(context: any, timestamp: number): any {
  let best: any | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const frame of context.historyBuffer) {
    const delta = Math.abs(frame.timestamp - timestamp);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}
