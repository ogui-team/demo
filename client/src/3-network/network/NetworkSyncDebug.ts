import { DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG, hasMovementFeelDebugOverride, sanitizeMovementFeelDebugConfig } from './MovementTuningConfig';
import {
  buildBaseMovementTuning,
  resolveMovementTuning,
  resolveStatusMovementModifier,
  toStatusMovementModifier,
} from './NetworkMovementPrediction';
import type {
  MovementAuthorityDebugState,
  MovementTuningDebugState,
  NetworkSyncBinding,
  NetworkMovementIntent,
  NetworkSyncConfig,
} from './NetworkSyncSystemImpl';
import type { MovementFeelDebugConfig, MovementTuningConfig, ResolvedMovementTuningConfig } from './MovementTuningConfig';
import type { StatusMovementModifier } from './MovementModifierContracts';

export function resetRuntimeState(context: any): void {
  for (const networkEntityId of new Set(context.networkEntityIdsByPlayer.values())) {
    context.replicationSystem.unregisterBinding(networkEntityId);
  }
  context.bindings.clear();
  context.networkEntityIdsByPlayer.clear();
  context.pendingInputs.clear();
  context.liveInputs.clear();
  context.authoritativeInputQueue.length = 0;
  context.historyBuffer.length = 0;
  context.lastProcessedInputSeq.clear();
  context.pendingNetworkMappings.clear();
  context.pendingAuthorityBindings.clear();
  context.movementState.clear();
  context.pendingMovementIntent.clear();
  context.statusMovementModifiers.clear();
  context.derivedStatusMovementModifiers.clear();
  context.debugStatusMovementModifiers.clear();
  context.movementFeelDebugConfigs.clear();
  context.localPlayerId = null;
  context.lastAppliedSnapshotTick = null;
  context.lastLocalSnapshotTick = null;
  context.fixedAccumulator = 0;
  context.localStepAccumulator = 0;
  context.playerInitReady = false;
  context.hasEmittedFullSyncData = false;
}

export function setStatusMovementModifier(context: any, playerId: string, modifier: StatusMovementModifier | null): void {
  const normalized = normalizeStatusMovementModifier(modifier);
  if (!normalized) {
    context.statusMovementModifiers.delete(playerId);
    return;
  }
  context.statusMovementModifiers.set(playerId, normalized);
}

export function setDerivedStatusMovementModifier(context: any, playerId: string, modifier: StatusMovementModifier | null): void {
  const normalized = normalizeStatusMovementModifier(modifier);
  if (!normalized) {
    context.derivedStatusMovementModifiers.delete(playerId);
    return;
  }
  context.derivedStatusMovementModifiers.set(playerId, normalized);
}

export function setDebugStatusMovementModifier(context: any, playerId: string, modifier: StatusMovementModifier | null): void {
  const normalized = normalizeStatusMovementModifier(modifier);
  if (!normalized) {
    context.debugStatusMovementModifiers.delete(playerId);
    return;
  }
  context.debugStatusMovementModifiers.set(playerId, normalized);
}

export function setMovementFeelDebugConfig(context: any, playerId: string, config: MovementFeelDebugConfig | null): void {
  if (!config) {
    context.movementFeelDebugConfigs.delete(playerId);
    return;
  }
  context.movementFeelDebugConfigs.set(playerId, sanitizeMovementFeelDebugConfig(config));
}

export function getMovementTuningDebugState(context: any, playerId?: string): MovementTuningDebugState {
  const resolvedPlayerId = playerId ?? context.localPlayerId ?? null;
  if (!resolvedPlayerId) {
    return {
      playerId: null,
      base: null,
      live: null,
      hasDebugOverride: false,
      hooks: null,
    };
  }

  const binding: NetworkSyncBinding | undefined = context.bindings.get(resolvedPlayerId);
  const runtime = context.movementState.get(resolvedPlayerId) ?? context.createMovementRuntimeState();
  const base = buildBaseMovementTuning(binding);
  const debugConfig = context.movementFeelDebugConfigs.get(resolvedPlayerId) ?? DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG;

  return {
    playerId: resolvedPlayerId,
    base,
    live: resolveMovementTuning(binding, context.movementFeelDebugConfigs, context.resolvedMovementTuningScratch),
    hasDebugOverride: hasMovementFeelDebugOverride(debugConfig),
    hooks: {
      jumpPrepared: true,
      sprintPrepared: true,
      airControlPrepared: true,
      jumpRequested: runtime.jumpRequested,
      sprintRequested: runtime.sprintRequested,
      airborne: runtime.isAirborne,
      airControlEnabled: runtime.airControlEnabled,
      lastJumpImpulse: runtime.lastJumpImpulse,
    },
  };
}

export function getMovementAuthorityDebugState(context: any, playerId?: string): MovementAuthorityDebugState {
  const resolvedPlayerId = playerId ?? context.localPlayerId ?? null;
  if (!resolvedPlayerId) {
    return {
      playerId: null,
      entityId: null,
      networkEntityId: null,
      currentPosition: null,
      movementIntent: null,
      statusMovementModifier: null,
      derivedStatusMovementModifier: null,
      debugStatusMovementModifier: null,
      effectiveStatusMovementModifier: null,
    };
  }

  const binding: NetworkSyncBinding | undefined = context.bindings.get(resolvedPlayerId);
  return {
    playerId: resolvedPlayerId,
    entityId: binding?.entity.id ?? null,
    networkEntityId: context.networkEntityIdsByPlayer.get(resolvedPlayerId) ?? null,
    currentPosition: binding?.entity.getPosition() ?? null,
    movementIntent: context.pendingMovementIntent.get(resolvedPlayerId) ?? null,
    statusMovementModifier: context.statusMovementModifiers.get(resolvedPlayerId) ?? null,
    derivedStatusMovementModifier: context.derivedStatusMovementModifiers.get(resolvedPlayerId) ?? null,
    debugStatusMovementModifier: context.debugStatusMovementModifiers.get(resolvedPlayerId) ?? null,
    effectiveStatusMovementModifier: toStatusMovementModifier(resolveStatusMovementModifier(
      resolvedPlayerId,
      context.statusMovementModifiers,
      context.derivedStatusMovementModifiers,
      context.debugStatusMovementModifiers,
    )),
  };
}

export function getAllMovementAuthorityDebugStates(context: any): MovementAuthorityDebugState[] {
  const playerIds = [...context.bindings.keys()].sort((left: string, right: string) => {
    if (left === context.localPlayerId) return -1;
    if (right === context.localPlayerId) return 1;
    return left.localeCompare(right);
  });
  if (playerIds.length === 0) {
    return [getMovementAuthorityDebugState(context)].filter((state) => state.playerId !== null) as MovementAuthorityDebugState[];
  }
  return playerIds.map((playerId: string) => getMovementAuthorityDebugState(context, playerId));
}

function normalizeStatusMovementModifier(modifier: StatusMovementModifier | null | undefined): StatusMovementModifier | null {
  if (!modifier) return null;

  const normalized: StatusMovementModifier = {};
  if (typeof modifier.speedMultiplier === 'number' && Number.isFinite(modifier.speedMultiplier)) {
    normalized.speedMultiplier = Math.max(0, modifier.speedMultiplier);
  }
  if (modifier.blockMovement === true) {
    normalized.blockMovement = true;
  }

  const impulseOverride = modifier.impulseOverride;
  if (impulseOverride
    && typeof impulseOverride.x === 'number'
    && typeof impulseOverride.y === 'number'
    && typeof impulseOverride.z === 'number') {
    normalized.impulseOverride = {
      x: impulseOverride.x,
      y: impulseOverride.y,
      z: impulseOverride.z,
    };
  }

  return normalized.speedMultiplier !== undefined
    || normalized.blockMovement === true
    || normalized.impulseOverride !== undefined
    ? normalized
    : null;
}
