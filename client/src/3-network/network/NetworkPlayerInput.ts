import { gameBus } from '../../1-kernel/core/EventBus';
import { Vector3 } from '../../1-kernel/core/Entity';
import {
  NetworkInputCommand,
  NetworkAbilityRequest,
  NetworkHitValidationRequest,
  NetworkHitValidationResult,
} from './NetworkRuntimeContracts';
import { applyInput, applyRotation } from './NetworkMovementPrediction';
import type { NetworkSyncBinding } from './NetworkSyncSystemImpl';

export function queueLocalInput(context: any, input: Record<string, unknown>): NetworkInputCommand | null {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return null;

  context.liveInputs.set(localPlayerId, { ...input });

  const command: NetworkInputCommand = {
    playerId: localPlayerId,
    seq: context.networkManager.nextInputSequence(),
    tick: context.lastServerTick,
    timestamp: Date.now(),
    input,
  };
  const queue = context.pendingInputs.get(localPlayerId) ?? [];
  queue.push(command);

  const maxBufferedInputs = Math.max(4, Math.ceil(context.tickRate * context.historySeconds * 2));
  while (queue.length > maxBufferedInputs) {
    const dropped = queue.shift();
    console.warn('[NetworkSyncSystem] Input queue overflow, dropped old input', {
      playerId: localPlayerId,
      droppedSeq: dropped?.seq,
      droppedTick: dropped?.tick,
      queueLen: queue.length,
      maxBuffered: maxBufferedInputs,
    });
  }
  context.pendingInputs.set(localPlayerId, queue);

  gameBus.emit('playerInput', { ...command, input: { ...input } });
  gameBus.emit('INPUT_BUFFERED', {
    playerId: localPlayerId,
    seq: command.seq,
    tick: command.tick,
    timestamp: command.timestamp,
    input: { ...input },
  });

  if (context.authorityMode === 'remote' && context.commandSink && context.playerInitReady) {
    context.commandSink(command);
  } else {
    context.networkManager.sendInputCommand(command);
  }

  gameBus.emit('COMMAND_SENT', {
    playerId: localPlayerId,
    seq: command.seq,
    tick: command.tick,
    timestamp: command.timestamp,
    input: { ...input },
  });
  return command;
}

export function stepLocalInput(context: any, input: Record<string, unknown>, dt: number): void {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return;
  context.liveInputs.set(localPlayerId, { ...input });
  const binding = context.bindings.get(localPlayerId);
  if (!binding) return;

  if (context.authorityMode === 'remote' && context.remotePredictionMode === 'rotation-only') {
    applyRotation({
      binding,
      input,
      movementState: context.movementState,
      currentTick: context.tick,
    });
    return;
  }

  const runtime = context.movementState.get(localPlayerId) ?? {
    ...context.createMovementRuntimeState(),
    groundHeight: binding.entity.getPosition().y,
    lastCorrectionTick: context.tick,
  };
  const yaw = typeof input.yaw === 'number' ? input.yaw : binding.entity.getRotation().y;
  const pitch = typeof input.pitch === 'number' ? input.pitch : binding.entity.getRotation().x;
  runtime.isCrouching = input.crouch === true;
  binding.entity.setRotation({
    ...binding.entity.getRotation(),
    x: pitch,
    y: yaw,
  });
  context.movementState.set(localPlayerId, runtime);

  context.localStepAccumulator = Math.min(
    context.localStepAccumulator + Math.max(1 / 240, dt),
    context.localInputFixedStep * 4,
  );

  try {
    while (context.localStepAccumulator >= context.localInputFixedStep) {
      applyInput({
        binding,
        input,
        dt: context.localInputFixedStep,
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
      context.localStepAccumulator -= context.localInputFixedStep;
    }
  } catch (error) {
    console.error('[NetworkSyncSystem] stepLocalInput crash', { playerId: binding.playerId, input, error });
  }

  gameBus.emit('playerInput', {
    playerId: localPlayerId,
    seq: -1,
    tick: context.tick,
    timestamp: Date.now(),
    input: { ...input },
  });
}

export function setLiveLocalInput(context: any, input: Record<string, unknown>): void {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return;
  context.liveInputs.set(localPlayerId, { ...input });
}

export function clearLiveLocalInput(context: any): void {
  const localPlayerId = context.localPlayerId;
  if (!localPlayerId) return;
  context.liveInputs.delete(localPlayerId);
}

export function requestAbilityActivation(context: any, abilityId: string, payload?: Record<string, unknown>): boolean {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return false;
  const request: NetworkAbilityRequest = {
    playerId: localPlayerId,
    abilityId,
    timestamp: Date.now(),
    payload,
  };
  gameBus.emit('abilityActivationRequested', {
    entityId: localPlayerId,
    abilityId,
    payload,
  });
  context.networkManager.sendAbilityRequest(request);
  return true;
}

export function requestHitscanValidation(context: any, request: Omit<NetworkHitValidationRequest, 'shooterId' | 'timestamp'>): boolean {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return false;
  context.networkManager.sendHitValidationRequest({
    ...request,
    shooterId: localPlayerId,
    timestamp: Date.now(),
  });
  return true;
}

export function forceLocalState(
  context: any,
  position: Vector3,
  rotation: Vector3,
  velocity?: Vector3,
  options: { clearPendingInputs?: boolean } = {},
): void {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return;
  const binding = context.bindings.get(localPlayerId);
  if (!binding) return;

  binding.entity.setPosition(position);
  binding.entity.setRotation(rotation);
  const runtime = context.movementState.get(localPlayerId) ?? {
    ...context.createMovementRuntimeState(),
    groundHeight: position.y,
    lastCorrectionTick: context.tick,
  };
  runtime.velocity = velocity ? cloneVector(velocity) : { x: 0, y: 0, z: 0 };
  runtime.groundHeight = position.y;
  context.movementState.set(localPlayerId, runtime);

  if (options.clearPendingInputs !== false) {
    context.pendingInputs.set(localPlayerId, []);
  }

  context.spatialPartition.updateEntry(binding.entity.id, binding.entity.getPosition(), {
    radius: binding.collisionRadius ?? 0.8,
    tags: [binding.entity.type, 'local'],
    isActive: binding.entity.isActive,
    lastUsedTime: binding.entity.lastUsedTime,
  });
}

export function clearPendingInputs(context: any, playerId?: string): void {
  const targetId = playerId ?? context.localPlayerId;
  if (!targetId) return;
  context.pendingInputs.set(targetId, []);
}

function cloneVector(vector: Vector3 | undefined): Vector3 {
  if (!vector) return { x: 0, y: 0, z: 0 };
  return { x: vector.x, y: vector.y, z: vector.z };
}
