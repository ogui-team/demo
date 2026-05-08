import type { NetworkSyncBinding } from './NetworkSyncSystemImpl';
import type { MovementTuningConfig, ResolvedMovementTuningConfig } from './MovementTuningConfig';
import type { StatusMovementModifier } from './MovementModifierContracts';

export function getDiagnostics(context: any): Record<string, unknown> {
  return {
    tick: context.tick,
    authorityMode: context.authorityMode,
    localPlayerId: context.localPlayerId,
    localBinding: context.getLocalBindingStatus(),
    lastAppliedSnapshotTick: context.lastAppliedSnapshotTick,
    lastLocalSnapshotTick: context.lastLocalSnapshotTick,
    pendingInputs: Object.fromEntries([...context.pendingInputs.entries()].map(([playerId, queue]) => [playerId, queue.length])),
    bindings: [...context.bindings.entries()].map(([playerId, binding]: [string, NetworkSyncBinding]) => ({
      playerId,
      entityId: binding.entity.id,
      networkEntityId: context.networkEntityIdsByPlayer.get(playerId),
      position: binding.entity.getPosition(),
      rotation: binding.entity.getRotation(),
      velocity: context.getVelocity(playerId),
      correctionDistance: context.movementState.get(playerId)?.lastCorrectionDistance ?? 0,
      statusMovementModifier: context.statusMovementModifiers.get(playerId) ?? null,
      derivedStatusMovementModifier: context.derivedStatusMovementModifiers.get(playerId) ?? null,
      debugStatusMovementModifier: context.debugStatusMovementModifiers.get(playerId) ?? null,
      effectiveStatusMovementModifier: context.toStatusMovementModifier(context.resolveStatusMovementModifier(playerId)),
    })),
    historyFrames: context.historyBuffer.length,
    predictionEnabled: context.predictionEnabled,
    reconciliationThreshold: context.reconciliationThreshold,
    softReconciliationThreshold: context.softReconciliationThreshold,
    bufferSize: context.getBufferedInputCount(),
  };
}
