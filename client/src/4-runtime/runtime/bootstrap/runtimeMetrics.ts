import type { RuntimeDiagnosticsCoordinator } from '../../diagnostics/debug/RuntimeDiagnosticsCoordinator';
import type { RuntimeMetricsReporter } from '../../diagnostics/debug/RuntimeMetricsReporter';
import type { CullingSystem } from '../../../2-systems/gameplay/systems/CullingSystem';
import type { SessionLifecycleCoordinator } from '../../../2-systems/gameplay/game/SessionLifecycleCoordinator';
import type { ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import type { MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';

interface BootstrapRuntimeMetricsReporterOptions {
  runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  sessionLifecycleCoordinator: SessionLifecycleCoordinator;
  liveCullingSystem: CullingSystem;
  worldRuntime: ClientWorldRuntimeCoordinator;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  setRuntimeMetricsReporter: (reporter: RuntimeMetricsReporter) => void;
}

export function bootstrapRuntimeMetricsReporter(options: BootstrapRuntimeMetricsReporterOptions): void {
  const runtimeMetricsReporterConfig = {
    getBaseUrl: () => options.runtimeDiagnosticsCoordinator.getBaseUrl(),
    getSessionId: () => options.sessionLifecycleCoordinator.getRuntimeMetricsSessionId(),
    isEnabled: () => options.sessionLifecycleCoordinator.shouldCaptureRuntimeMetrics(),
    getMetrics: () => {
      const cullingDiagnostics = options.liveCullingSystem.getDiagnostics() as Record<string, unknown>;
      const authorityDiagnostics = options.worldRuntime.getWorldObjectAuthorityDiagnostics();
      const sessionDiagnostics = options.runtimeDiagnosticsCoordinator.getSessionDiagnostics();
      const actorRuntimeDiagnostics = sessionDiagnostics?.actorRuntime as { actorCount?: number } | undefined;
      return {
        worldObjectCount: typeof authorityDiagnostics.mappedWorldObjects === 'number' ? authorityDiagnostics.mappedWorldObjects : 0,
        visibleRenderables: typeof cullingDiagnostics.visibleCount === 'number' ? cullingDiagnostics.visibleCount : 0,
        snapshotPayloadBytes: typeof sessionDiagnostics?.lastSnapshotBytes === 'number' ? sessionDiagnostics.lastSnapshotBytes : 0,
        snapshotBytesPerSnapshot: typeof sessionDiagnostics?.lastBytesPerSnapshot === 'number' ? sessionDiagnostics.lastBytesPerSnapshot : 0,
        replicationUpdatesPerTick: typeof sessionDiagnostics?.lastDeltaEntities === 'number' ? sessionDiagnostics.lastDeltaEntities : 0,
        actorReplicationCount: typeof actorRuntimeDiagnostics?.actorCount === 'number' ? actorRuntimeDiagnostics.actorCount : 0,
      };
    },
  };

  void import('../../diagnostics/debug/RuntimeMetricsReporter')
    .then(({ RuntimeMetricsReporter }) => {
      const runtimeMetricsReporter = new RuntimeMetricsReporter(runtimeMetricsReporterConfig);
      options.setRuntimeMetricsReporter(runtimeMetricsReporter);
      options.multiplayerRuntime.setRuntimeMetricsReporter(runtimeMetricsReporter);
    })
    .catch((error) => {
      console.warn('[App] Failed to load runtime metrics reporter', error);
    });
}