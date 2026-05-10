import { gameBus } from '../../1-kernel/core/EventBus';
import { DEFAULT_MOVEMENT_TUNING_CONFIG } from './MovementTuningConfig';
import type {
  NetworkSnapshot,
  NetworkReplicatedEntityState,
} from './NetworkRuntimeContracts';

export function isSnapshotDataComplete(context: any, entitySnapshot: NetworkReplicatedEntityState): boolean {
  if (!entitySnapshot.transform?.position) {
    return false;
  }
  if (!entitySnapshot.replicated) {
    return false;
  }
  return true;
}

export function queuePendingAuthorityBinding(context: any, playerId: string, networkEntityId: string): void {
  if (context.pendingAuthorityBindings.has(playerId)) {
    return;
  }
  context.pendingAuthorityBindings.set(playerId, {
    playerId,
    networkEntityId,
    queuedAt: Engine.time.now(),
    lastCheckAt: Engine.time.now(),
    checkCount: 0,
  });
}

export function processPendingAuthorityBindings(context: any, snapshot: NetworkSnapshot): void {
  if (context.pendingAuthorityBindings.size === 0) {
    return;
  }

  const now = Engine.time.now();
  const pendingIds = Array.from(context.pendingAuthorityBindings.keys()) as string[];

  for (const playerId of pendingIds) {
    const pending = context.pendingAuthorityBindings.get(playerId);
    if (!pending) continue;

    const matchingEntity = snapshot.entities.find((e) => e.entityId === pending.networkEntityId);
    if (!matchingEntity) {
      pending.lastCheckAt = now;
      pending.checkCount += 1;
      if (pending.checkCount > 60) {
        console.warn('[AwaitReady] Timeout waiting for complete snapshot', {
          playerId,
          networkEntityId: pending.networkEntityId,
          queuedForMs: now - pending.queuedAt,
          checkCount: pending.checkCount,
        });
        context.pendingAuthorityBindings.delete(playerId);
      }
      continue;
    }

    if (!isSnapshotDataComplete(context, matchingEntity)) {
      pending.lastCheckAt = now;
      pending.checkCount += 1;
      continue;
    }

    const localEntity = context.entityManager.getEntities().find((candidate: any) => candidate.hasComponent('localPlayer'));
    if (localEntity) {
      context.bindLocalPlayer(playerId, localEntity, {
        movementSpeed: DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
        acceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
        collisionRadius: 0.8,
        networkEntityId: pending.networkEntityId,
      });

      console.log('[AwaitReady] Pending authority binding complete', {
        playerId,
        networkEntityId: pending.networkEntityId,
        waitedMs: now - pending.queuedAt,
        checkCount: pending.checkCount,
        tick: snapshot.tick,
      });

      gameBus.emit('SYNC_VERIFIED', {
        playerId,
        tick: snapshot.tick,
        networkEntityId: pending.networkEntityId,
        timestamp: snapshot.timestamp,
        reason: 'Pending snapshot data received - binding verified',
      });
      context.pendingAuthorityBindings.delete(playerId);
    }
  }
}
