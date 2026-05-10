export interface SystemValidatorDeps {
  getPlayControllerBoundEntityId: () => string | null;
  hasEntity: (entityId: string) => boolean;
  getHudPlayerId: () => string | null;
  getMultiplayerPlayerId: () => string | null;
  getSelectionEntityId: () => string | null;
  clearSelection: () => void;
}

export interface SystemMemoryValidatorDeps {
  getActiveEntityIds: () => string[];
  getEntityDiagnostics: () => Record<string, unknown> | null;
  getEntityLeakMetadata: (entityId: string) => {
    type: string;
    createdAt: number;
    createdStack: string | null;
    pooled: boolean;
  } | null;
  getPhysicsBodyIds: () => string[];
  now?: () => number;
}

export interface SystemValidationReport {
  ok: boolean;
  playController: {
    boundEntityId: string | null;
    entityExists: boolean;
  };
  hud: {
    hudPlayerId: string | null;
    multiplayerPlayerId: string | null;
    matches: boolean;
  };
  selection: {
    selectedEntityId: string | null;
    entityExists: boolean;
    autoReset: boolean;
  };
}

export interface SystemMemoryValidationReport {
  ok: boolean;
  attention: boolean;
  entityManager: {
    activeEntityCount: number;
    pooledEntityCount: number;
    totalTrackedCount: number;
  };
  physics: {
    bodyCount: number;
    staleBodyIds: string[];
  };
  unpairedEntities: {
    count: number;
    sampleIds: string[];
  };
  suspectedLeaks: Array<{
    entityId: string;
    entityType: string;
    pooled: boolean;
    ageMs: number;
    createdAt: number;
    createdStack: string | null;
  }>;
}

function readNestedNumber(value: Record<string, unknown> | null, path: string[], fallback = 0): number {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return fallback;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'number' ? current : fallback;
}

export function validateEngineRuntime(deps: SystemValidatorDeps): SystemValidationReport {
  const boundEntityId = deps.getPlayControllerBoundEntityId();
  const playControllerEntityExists = !!boundEntityId && deps.hasEntity(boundEntityId);

  const hudPlayerId = deps.getHudPlayerId();
  const multiplayerPlayerId = deps.getMultiplayerPlayerId();

  const selectedEntityId = deps.getSelectionEntityId();
  const selectedEntityExists = !!selectedEntityId && deps.hasEntity(selectedEntityId);
  const shouldAutoResetSelection = !!selectedEntityId && !selectedEntityExists;
  if (shouldAutoResetSelection) {
    deps.clearSelection();
  }

  const report: SystemValidationReport = {
    ok: (!!boundEntityId ? playControllerEntityExists : true)
      && (hudPlayerId === multiplayerPlayerId)
      && !shouldAutoResetSelection,
    playController: {
      boundEntityId,
      entityExists: !!boundEntityId ? playControllerEntityExists : false,
    },
    hud: {
      hudPlayerId,
      multiplayerPlayerId,
      matches: hudPlayerId === multiplayerPlayerId,
    },
    selection: {
      selectedEntityId,
      entityExists: !!selectedEntityId ? selectedEntityExists : false,
      autoReset: shouldAutoResetSelection,
    },
  };

  console.groupCollapsed(`[SystemValidator] ${report.ok ? 'OK' : 'ATTENTION'}`);
  console.table({
    playControllerBoundEntityId: report.playController.boundEntityId ?? 'none',
    playControllerEntityExists: report.playController.entityExists,
    hudPlayerId: report.hud.hudPlayerId ?? 'none',
    multiplayerPlayerId: report.hud.multiplayerPlayerId ?? 'none',
    hudMatches: report.hud.matches,
    selectedEntityId: report.selection.selectedEntityId ?? 'none',
    selectionEntityExists: report.selection.entityExists,
    selectionAutoReset: report.selection.autoReset,
  });
  console.groupEnd();

  return report;
}

export function validateEngineMemory(deps: SystemMemoryValidatorDeps): SystemMemoryValidationReport {
  const now = deps.now?.() ?? Engine.time.now();
  const activeEntityIds = deps.getActiveEntityIds();
  const physicsBodyIds = deps.getPhysicsBodyIds();
  const activeEntityIdSet = new Set(activeEntityIds);
  const physicsBodyIdSet = new Set(physicsBodyIds);
  const entityDiagnostics = deps.getEntityDiagnostics();

  const staleBodyIds = physicsBodyIds.filter((entityId) => !activeEntityIdSet.has(entityId));
  const unpairedEntityIds = activeEntityIds.filter((entityId) => !physicsBodyIdSet.has(entityId));
  const suspectedLeaks = unpairedEntityIds
    .map((entityId) => {
      const metadata = deps.getEntityLeakMetadata(entityId);
      if (!metadata) return null;
      return {
        entityId,
        entityType: metadata.type,
        pooled: metadata.pooled,
        ageMs: Math.max(0, now - metadata.createdAt),
        createdAt: metadata.createdAt,
        createdStack: metadata.createdStack,
      };
    })
    .filter((entry): entry is {
      entityId: string;
      entityType: string;
      pooled: boolean;
      ageMs: number;
      createdAt: number;
      createdStack: string | null;
    } => entry !== null)
    .sort((left, right) => right.ageMs - left.ageMs)
    .slice(0, 10);

  const report: SystemMemoryValidationReport = {
    ok: staleBodyIds.length === 0,
    attention: staleBodyIds.length > 0 || unpairedEntityIds.length > 0,
    entityManager: {
      activeEntityCount: readNestedNumber(entityDiagnostics, ['metrics', 'activeEntities'], activeEntityIds.length),
      pooledEntityCount: readNestedNumber(entityDiagnostics, ['metrics', 'pooledEntities']),
      totalTrackedCount: readNestedNumber(entityDiagnostics, ['metrics', 'totalTrackedEntities'], activeEntityIds.length),
    },
    physics: {
      bodyCount: physicsBodyIds.length,
      staleBodyIds,
    },
    unpairedEntities: {
      count: unpairedEntityIds.length,
      sampleIds: unpairedEntityIds.slice(0, 10),
    },
    suspectedLeaks,
  };

  console.groupCollapsed(`[SystemValidator:memory] ${report.ok && !report.attention ? 'OK' : 'ATTENTION'}`);
  console.table({
    activeEntityCount: report.entityManager.activeEntityCount,
    pooledEntityCount: report.entityManager.pooledEntityCount,
    totalTrackedCount: report.entityManager.totalTrackedCount,
    physicsBodyCount: report.physics.bodyCount,
    staleBodyCount: report.physics.staleBodyIds.length,
    unpairedEntityCount: report.unpairedEntities.count,
    suspectedLeakCount: report.suspectedLeaks.length,
  });
  if (report.physics.staleBodyIds.length > 0) {
    console.warn('[SystemValidator:memory] stale physics bodies', report.physics.staleBodyIds);
  }
  if (report.suspectedLeaks.length > 0) {
    console.warn('[SystemValidator:memory] oldest unpaired entities', report.suspectedLeaks);
  }
  console.groupEnd();

  return report;
}
