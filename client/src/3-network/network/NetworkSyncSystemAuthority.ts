import { DEFAULT_MOVEMENT_TUNING_CONFIG } from './MovementTuningConfig';

export function enforceLocalIdentityRebind(context: any, source: string, tick: number): void {
  const localPlayerId = context.localPlayerId ?? context.networkManager.getLocalPlayerId();
  if (!localPlayerId) {
    console.error('CRITICAL_REBIND_FAILURE', { source, tick, reason: 'missing_local_player_id' });
    return;
  }

  const localEntity = context.entityManager.getEntities().find((candidate: any) => candidate.hasComponent('localPlayer'));
  if (!localEntity) {
    console.error('CRITICAL_REBIND_FAILURE', { source, tick, playerId: localPlayerId, reason: 'missing_local_entity' });
    return;
  }

  const networkEntityId = context.networkEntityIdsByPlayer.get(localPlayerId) ?? localPlayerId;
  context.bindLocalPlayer(localPlayerId, localEntity, {
    movementSpeed: DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
    acceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
    collisionRadius: 0.8,
    networkEntityId,
  });

  const binding = context.bindings.get(localPlayerId);
  if (!binding) {
    console.error('CRITICAL_REBIND_FAILURE', { source, tick, playerId: localPlayerId, reason: 'binding_not_created' });
    return;
  }

  if (!context.tryRegisterNetworkEntityMapping(localPlayerId, networkEntityId)) {
    console.error('CRITICAL_REBIND_FAILURE', {
      source,
      tick,
      playerId: localPlayerId,
      reason: 'handle_not_confirmed',
      networkEntityId,
    });
  }
}

export function hasConfirmedNetworkHandle(context: any, playerId: string): boolean {
  const networkEntityId = context.networkEntityIdsByPlayer.get(playerId) ?? playerId;
  return context.networkEntityIdRegistrar?.hasHandleForNetworkEntityId(networkEntityId) ?? false;
}
