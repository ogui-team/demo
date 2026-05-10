import { NetworkSyncBinding, cloneVector } from './NetworkSyncSystemTypes';
import { DEFAULT_MOVEMENT_TUNING_CONFIG } from './MovementTuningConfig';
import { createMovementRuntimeState } from './NetworkMovementPrediction';
import { Vector3 } from '../../1-kernel/core/Entity';

export function ensureLocalPlayerBinding(context: any): string | null {
  if (context.localPlayerId && context.bindings.has(context.localPlayerId)) {
    return context.localPlayerId;
  }

  const entity = context.entityManager.getEntities().find((candidate: any) => candidate.hasComponent('localPlayer'));
  if (!entity) return null;
  const fallbackPlayerId = context.networkManager.getLocalPlayerId();
  context.bindLocalPlayer(fallbackPlayerId, entity, {
    movementSpeed: DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
    acceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
    collisionRadius: 0.8,
    networkEntityId: fallbackPlayerId,
  });
  context.localPlayerId = fallbackPlayerId;
  return fallbackPlayerId;
}

export function tryRegisterNetworkEntityMapping(context: any, playerId: string, networkEntityId: string): boolean {
  const registrar = context.networkEntityIdRegistrar;
  if (!registrar) {
    context.pendingNetworkMappings.set(playerId, networkEntityId);
    return false;
  }

  const registered = registrar.registerNetworkEntityIdMapping(playerId, networkEntityId);
  if (registered) {
    context.pendingNetworkMappings.delete(playerId);
    return true;
  }

  context.pendingNetworkMappings.set(playerId, networkEntityId);
  return false;
}

export function flushPendingNetworkMappings(context: any): void {
  if (context.pendingNetworkMappings.size === 0) {
    return;
  }

  for (const [playerId, networkEntityId] of [...context.pendingNetworkMappings.entries()]) {
    context.tryRegisterNetworkEntityMapping(playerId, networkEntityId);
  }
}

export function getVelocity(context: any, playerId: string): Vector3 {
  return cloneVector(context.movementState.get(playerId)?.velocity);
}

export function getLocalPlayerTransform(context: any): { position: Vector3; rotation: Vector3; velocity: Vector3 } | null {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return null;
  const binding = context.bindings.get(localPlayerId);
  if (!binding) return null;
  return {
    position: binding.entity.getPosition(),
    rotation: binding.entity.getRotation(),
    velocity: context.getVelocity(localPlayerId),
  };
}

export function getLocalResolvedMovementState(context: any): { isCrouching: boolean; isAirborne: boolean; groundHeight: number; velocity: Vector3 } | null {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) return null;
  const runtime = context.movementState.get(localPlayerId);
  if (!runtime) return null;
  return {
    isCrouching: runtime.isCrouching,
    isAirborne: runtime.isAirborne,
    groundHeight: runtime.groundHeight,
    velocity: cloneVector(runtime.velocity),
  };
}

export function getLocalBindingStatus(context: any): {
  playerId: string | null;
  entityId: string | null;
  networkEntityId: string | null;
  isBound: boolean;
} {
  const localPlayerId = context.ensureLocalPlayerBinding();
  if (!localPlayerId) {
    return {
      playerId: null,
      entityId: null,
      networkEntityId: null,
      isBound: false,
    };
  }

  const binding = context.bindings.get(localPlayerId);
  return {
    playerId: localPlayerId,
    entityId: binding?.entity.id ?? null,
    networkEntityId: context.networkEntityIdsByPlayer.get(localPlayerId) ?? null,
    isBound: !!binding,
  };
}

export function dropNetworkEntityCache(context: any, networkEntityId: string, reason = 'unspecified'): void {
  context.replicationSystem.unregisterBinding(networkEntityId);

  for (const [playerId, mappedNetworkEntityId] of [...context.networkEntityIdsByPlayer.entries()]) {
    if (mappedNetworkEntityId !== networkEntityId) {
      continue;
    }
    context.networkEntityIdsByPlayer.delete(playerId);
    context.pendingNetworkMappings.delete(playerId);
  }

  for (const [playerId, pendingNetworkEntityId] of [...context.pendingNetworkMappings.entries()]) {
    if (pendingNetworkEntityId === networkEntityId) {
      context.pendingNetworkMappings.delete(playerId);
    }
  }

  console.warn('[NetworkSyncSystem] Cleared stale network entity cache', {
    networkEntityId,
    reason,
    timestamp: Engine.time.now(),
  });
}
