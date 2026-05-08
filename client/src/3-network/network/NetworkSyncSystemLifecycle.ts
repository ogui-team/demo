import { gameBus } from '../../1-kernel/core/EventBus';
import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';
import { Vector3 } from '../../1-kernel/core/Entity';
import type { SystemContext } from '../../1-kernel/core/types';
import type { NetworkSyncConfig } from './NetworkSyncSystemTypes';
import type {
  NetworkInputCommand,
  NetworkSnapshot,
  NetworkAbilityRequest,
  NetworkHitValidationRequest,
  NetworkHitValidationResult,
  NetworkAbilityValidation,
} from './NetworkRuntimeContracts';

export function initializeNetworkSyncSystem(context: any, config: NetworkSyncConfig): void {
  context.networkManager = config.networkManager;
  context.entityManager = config.entityManager;
  context.replicationSystem = config.replicationSystem;
  context.spatialPartition = config.spatialPartition;
  context.tickRate = config.tickRate ?? 60;
  context.fixedStep = 1 / context.tickRate;
  context.localInputFixedStep = Math.min(context.fixedStep, 1 / 60);
  context.historySeconds = config.historySeconds ?? 1;
  context.relevanceRadius = config.relevanceRadius ?? 64;
  context.simulateAuthority = config.simulateAuthority ?? true;

  context.networkManager.onInputCommand((command: NetworkInputCommand) => {
    if (context.authorityMode === 'local' && context.simulateAuthority) {
      context.authoritativeInputQueue.push(command);
    }
  });

  context.networkManager.onSnapshot((snapshot: NetworkSnapshot) => {
    if (context.authorityMode === 'local') {
      return;
    }
    context.applyAuthoritativeSnapshot(snapshot);
  });

  context.networkManager.onHitValidationResult((result: NetworkHitValidationResult) => {
    gameBus.emit('entityHit', {
      shooterId: result.shooterId,
      targetId: result.hitEntityId,
      shotId: result.shotId,
      timestamp: result.timestamp,
    });
  });

  context.networkManager.onHitValidationRequest((request: NetworkHitValidationRequest) => {
    if (context.authorityMode === 'local' && context.simulateAuthority) {
      context.validateHitscan(request);
    }
  });

  context.networkManager.onAbilityRequest((request: NetworkAbilityRequest) => {
    if (context.authorityMode === 'local' && context.simulateAuthority) {
      context.validateAbilityRequest(request);
    }
  });

  context.networkManager.onAbilityValidation((validation: NetworkAbilityValidation) => {
    context.handleAbilityValidation(validation);
  });

  gameBus.on('playerMovementInputCaptured', (payload: any) => {
    if (payload.entityId) {
      if (
        payload.reconciliationActive === true
        && payload.reconciliationPositionOverride
        && context.localPlayerId
        && context.reconciliationOverrideEnabled
      ) {
        const binding = context.bindings.get(context.localPlayerId);
        if (binding && binding.entity.id === payload.entityId) {
          const currentPos = binding.entity.getPosition();
          const overridePos = payload.reconciliationPositionOverride as Vector3;
          const distance = Math.hypot(
            currentPos.x - overridePos.x,
            currentPos.y - overridePos.y,
            currentPos.z - overridePos.z,
          );
          if (distance > PHYSICS_CONSTANTS.CLIENT_CORRECTION_THRESHOLD * 2) {
            binding.entity.setPosition(overridePos);
          }
        }
      }
      context.setLiveLocalInput({
        forward: payload.forward,
        backward: payload.backward,
        left: payload.left,
        right: payload.right,
        jump: payload.jump,
        sprint: payload.sprint,
        crouch: payload.crouch,
        movementIntent: payload.movementIntent,
        yaw: payload.yaw,
        pitch: payload.pitch,
      });
    }
  });

  gameBus.on('FORCE_SNAPSHOT', ({ snapshot, source }) => {
    if (!snapshot || !Array.isArray(snapshot.entities)) {
      return;
    }
    if (
      source === 'full_sync_data'
      && context.lastAppliedSnapshotTick !== null
      && snapshot.tick <= context.lastAppliedSnapshotTick
    ) {
      return;
    }
    context.applyAuthoritativeSnapshot(snapshot);
    if (source !== 'full_sync_data') {
      console.log('[NetworkSyncSystem] forceSnapshot applied', {
        source,
        tick: snapshot.tick,
        entityCount: snapshot.entities.length,
      });
    }
  });

  gameBus.on('FULL_SYNC_READY', ({ tick }) => {
    context.enforceLocalIdentityRebind('full_sync_ready', tick);
  });

  gameBus.on('STALE_SNAPSHOT_ENTITY_DROPPED', ({ netId, entityType }) => {
    if (!netId) {
      return;
    }
    context.dropNetworkEntityCache(netId, `stale_prefab:${entityType}`);
  });
}

export function initNetworkSyncSystem(context: any, ctx: SystemContext): void {
  context.systemContext = ctx;
  if (ctx.entityManager) {
    context.entityManager = ctx.entityManager as any;
  }
  const replicationSystem = ctx.systems.replicationSystem as any | null | undefined;
  if (replicationSystem) {
    context.replicationSystem = replicationSystem;
  }
  const spatialPartition = ctx.systems.spatialPartitionSystem as any | null | undefined;
  if (spatialPartition) {
    context.spatialPartition = spatialPartition;
  }
}
