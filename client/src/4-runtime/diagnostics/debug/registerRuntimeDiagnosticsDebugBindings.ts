import type { DebugManager } from './DebugManager';
import type { RuntimeDiagnosticsCoordinator } from './RuntimeDiagnosticsCoordinator';

interface CullingDiagnosticsBinding {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

interface RuntimeDiagnosticsDebugBindingsOptions {
  debugManager: DebugManager;
  runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  liveCullingSystem: CullingDiagnosticsBinding;
  getAutoHealthChannelSync(): boolean;
  setAutoHealthChannelSync(enabled: boolean): void;
  syncHealthChannels(): void;
  getHealthChannelHpSummary(): string;
  getHealthChannelShieldSummary(): string;
  getHealthChannelGasSummary(): string;
  getRuntimeReplicationSampleSummary(): string;
  getRuntimeReplicationCorrelationSummary(): string;
}

export function registerRuntimeDiagnosticsDebugBindings(options: RuntimeDiagnosticsDebugBindingsOptions): void {
  const {
    debugManager,
    runtimeDiagnosticsCoordinator,
    liveCullingSystem,
    getAutoHealthChannelSync,
    setAutoHealthChannelSync,
    syncHealthChannels,
    getHealthChannelHpSummary,
    getHealthChannelShieldSummary,
    getHealthChannelGasSummary,
    getRuntimeReplicationSampleSummary,
    getRuntimeReplicationCorrelationSummary,
  } = options;

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_refresh_status',
    name: 'Refresh Server Status',
    type: 'button',
    get: () => '',
    set: () => {
      void runtimeDiagnosticsCoordinator.refresh();
    },
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_status_summary',
    name: 'Server Status',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getStatusSummary(),
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_transport_limits',
    name: 'Transport Limits',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getTransportSummary(),
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_snapshot_bytes',
    name: 'Snapshot Bytes',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getSnapshotBytesSummary(),
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_fanout_cost',
    name: 'Fanout Cost',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getFanoutCostSummary(),
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_delta_entities',
    name: 'Replication Shape',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getReplicationShapeSummary(),
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_health_warnings',
    name: 'Health Warnings',
    type: 'input',
    get: () => {
      const warnings = runtimeDiagnosticsCoordinator.getNetworkHealthWarnings();
      return warnings.length > 0 ? warnings.join(' | ') : 'ok';
    },
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_runtime_sample',
    name: 'Runtime Sample',
    type: 'input',
    get: () => getRuntimeReplicationSampleSummary(),
    set: () => {},
  });

  debugManager.addParameter('Network Diagnostics', {
    id: 'network_replication_correlation',
    name: 'Replication Correlation',
    type: 'input',
    get: () => getRuntimeReplicationCorrelationSummary(),
    set: () => {},
  });

  debugManager.addParameter('Rendering Diagnostics', {
    id: 'render_culling_enabled',
    name: 'Live Culling Enabled',
    type: 'checkbox',
    get: () => liveCullingSystem.isEnabled(),
    set: (value) => {
      liveCullingSystem.setEnabled(Boolean(value));
    },
  });

  debugManager.addParameter('Rendering Diagnostics', {
    id: 'render_culling_counts',
    name: 'Culling Counts',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getRenderingCountsSummary(),
    set: () => {},
  });

  debugManager.addParameter('Rendering Diagnostics', {
    id: 'render_culling_cost',
    name: 'Cull Cost',
    type: 'input',
    get: () => runtimeDiagnosticsCoordinator.getRenderingCostSummary(),
    set: () => {},
  });

  debugManager.addParameter('Rendering Diagnostics', {
    id: 'render_culling_warnings',
    name: 'Cull Health',
    type: 'input',
    get: () => {
      const warnings = runtimeDiagnosticsCoordinator.getRenderingHealthWarnings();
      return warnings.length > 0 ? warnings.join(' | ') : 'ok';
    },
    set: () => {},
  });

  debugManager.addParameter('Health Channels', {
    id: 'health_auto_sync',
    name: 'Auto Sync GAS -> Health',
    type: 'checkbox',
    get: () => getAutoHealthChannelSync(),
    set: (value) => {
      setAutoHealthChannelSync(Boolean(value));
    },
  });

  debugManager.addParameter('Health Channels', {
    id: 'health_sync_now',
    name: 'Sync Now (GAS -> Health)',
    type: 'button',
    get: () => '',
    set: () => {
      syncHealthChannels();
      debugManager.refreshUI();
    },
  });

  debugManager.addParameter('Health Channels', {
    id: 'health_channel_hp',
    name: 'HealthSystem HP',
    type: 'input',
    get: () => getHealthChannelHpSummary(),
    set: () => {},
  });

  debugManager.addParameter('Health Channels', {
    id: 'health_channel_shield',
    name: 'HealthSystem Shield',
    type: 'input',
    get: () => getHealthChannelShieldSummary(),
    set: () => {},
  });

  debugManager.addParameter('Health Channels', {
    id: 'health_channel_gas',
    name: 'GAS Vitals',
    type: 'input',
    get: () => getHealthChannelGasSummary(),
    set: () => {},
  });
}
