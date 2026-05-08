import { gameBus } from '@engine/1-kernel/core/public-api';
// TODO: Add performance budget constants

export interface ServerTransportDiagnostics {
  allowedOrigins?: string[];
  wsMaxPayloadBytes?: number;
  httpJsonLimit?: string;
}

export interface ServerSessionDiagnostics {
  sessionId?: string;
  tickRate?: number;
  worldObjectCount?: number;
  actorRuntime?: { actorCount?: number } | null;
  playerCount?: number;
  entityCount?: number;
  eventCount?: number;
  lastSnapshotBytes?: number;
  averageSnapshotBytes?: number;
  peakSnapshotBytes?: number;
  lastBytesPerSnapshot?: number;
  averageBytesPerSnapshot?: number;
  peakBytesPerSnapshot?: number;
  lastDeltaEntities?: number;
  averageDeltaEntities?: number;
  peakDeltaEntities?: number;
  lastFanoutDurationMs?: number;
  averageFanoutDurationMs?: number;
  peakFanoutDurationMs?: number;
  forcedRefreshes?: number;
  snapshotsSent?: number;
  lastUpdatedAt?: number;
}

export interface ServerStatusResponse {
  clients?: number;
  sessions?: number;
  sessionDiagnostics?: ServerSessionDiagnostics[];
  transport?: ServerTransportDiagnostics;
  runtimeMetrics?: Record<string, unknown> | null;
}

export interface RuntimeDiagnosticsState {
  baseUrl: string;
  clients: number | null;
  sessions: number | null;
  transport: ServerTransportDiagnostics | null;
  session: ServerSessionDiagnostics | null;
  lastUpdatedAt: number;
  error: string | null;
  inFlight: boolean;
}

interface MultiplayerDiagnosticsClient {
  connected: boolean;
  roomId: string;
  getServerHttpBaseUrl(): string | null | undefined;
  getProtocolDiagnostics(): {
    recentIncoming: Array<{ parseOk?: boolean }>;
  };
}

interface StateManagerAdapter {
  set(path: string, value: unknown): void;
}

interface RenderingDiagnosticsProvider {
  getDiagnostics(): Record<string, unknown>;
}

interface RuntimeDiagnosticsCoordinatorConfig {
  defaultBaseUrl: string;
  metricsBaseUrlOverride: string | null;
  multiplayerClient: MultiplayerDiagnosticsClient;
  stateManager?: StateManagerAdapter | null;
  renderingDiagnostics: RenderingDiagnosticsProvider;
  shouldPoll: () => boolean;
}

export class RuntimeDiagnosticsCoordinator {
  // ─── Performance Budget Constants (Temporary fallback) ────────────────────
  // TODO (Phase 2): Move these to core/PerformanceBudgets.ts and export via public-api
  private static readonly NETWORK_PERFORMANCE_BUDGETS = {
    statusStaleWarnMs: 5000,           // 5 sec: server status considered stale
    snapshotFanoutWarnMs: 100,         // 100 ms: fanout taking too long
    snapshotPayloadWarnBytes: 1024,    // 1 KB: single snapshot too large
  };

  private static readonly RENDER_PERFORMANCE_BUDGETS = {
    cullPassWarnMs: 50, // 50 ms: culling pass taking too long
  };

  private readonly defaultBaseUrl: string;
  private readonly metricsBaseUrlOverride: string | null;
  private readonly multiplayerClient: MultiplayerDiagnosticsClient;
  private readonly stateManager: StateManagerAdapter | null;
  private readonly renderingDiagnostics: RenderingDiagnosticsProvider;
  private readonly shouldPoll: () => boolean;
  private pollAccumulator = 0;

  private readonly serverStatus: RuntimeDiagnosticsState;

  constructor(config: RuntimeDiagnosticsCoordinatorConfig) {
    this.defaultBaseUrl = config.defaultBaseUrl;
    this.metricsBaseUrlOverride = config.metricsBaseUrlOverride;
    this.multiplayerClient = config.multiplayerClient;
    this.stateManager = config.stateManager ?? null;
    this.renderingDiagnostics = config.renderingDiagnostics;
    this.shouldPoll = config.shouldPoll;
    this.serverStatus = {
      baseUrl: this.defaultBaseUrl,
      clients: null,
      sessions: null,
      transport: null,
      session: null,
      lastUpdatedAt: 0,
      error: null,
      inFlight: false,
    };
  }

  getBaseUrl(): string {
    return this.multiplayerClient.getServerHttpBaseUrl() ?? this.metricsBaseUrlOverride ?? this.defaultBaseUrl;
  }

  getServerStatus(): RuntimeDiagnosticsState {
    return this.serverStatus;
  }

  getSessionDiagnostics(): ServerSessionDiagnostics | null {
    return this.serverStatus.session;
  }

  update(dt: number): void {
    if (!this.shouldPoll()) return;
    this.pollAccumulator += dt;
    if (this.serverStatus.lastUpdatedAt === 0 || this.pollAccumulator >= 2) {
      this.pollAccumulator = 0;
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (this.serverStatus.inFlight) return;
    this.serverStatus.inFlight = true;
    const baseUrl = this.getBaseUrl();
    this.serverStatus.baseUrl = baseUrl;

    try {
      const response = await fetch(`${baseUrl}/status`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json() as ServerStatusResponse;
      this.serverStatus.clients = typeof payload.clients === 'number' ? payload.clients : null;
      this.serverStatus.sessions = typeof payload.sessions === 'number' ? payload.sessions : null;
      this.serverStatus.transport = payload.transport ?? null;
      this.serverStatus.session = this.selectServerSessionDiagnostics(payload);
      this.serverStatus.lastUpdatedAt = Date.now();
      this.serverStatus.error = null;
      this.publishServerStatus();
      gameBus.emit('stateMutation', {
        source: 'runtimeDiagnosticsCoordinator',
        path: 'diagnostics.network.serverStatus',
        changedCount: 1,
      });
    } catch (error) {
      this.serverStatus.error = error instanceof Error ? error.message : String(error);
      this.publishServerStatus();
    } finally {
      this.serverStatus.inFlight = false;
    }
  }

  getNetworkHealthWarnings(): string[] {
    const warnings: string[] = [];
    const session = this.serverStatus.session;
    const protocolDiagnostics = this.multiplayerClient.getProtocolDiagnostics();
    if (this.serverStatus.error) {
      warnings.push(`Server status unavailable: ${this.serverStatus.error}`);
    }
    if (this.serverStatus.lastUpdatedAt > 0 && Date.now() - this.serverStatus.lastUpdatedAt > RuntimeDiagnosticsCoordinator.NETWORK_PERFORMANCE_BUDGETS.statusStaleWarnMs) {
      warnings.push('Server status diagnostics are stale');
    }
    if (session?.lastFanoutDurationMs && session.lastFanoutDurationMs > RuntimeDiagnosticsCoordinator.NETWORK_PERFORMANCE_BUDGETS.snapshotFanoutWarnMs) {
      warnings.push(`Snapshot fanout is expensive (${session.lastFanoutDurationMs.toFixed(2)} ms)`);
    }
    if (session?.lastBytesPerSnapshot && session.lastBytesPerSnapshot > RuntimeDiagnosticsCoordinator.NETWORK_PERFORMANCE_BUDGETS.snapshotPayloadWarnBytes) {
      warnings.push(`Snapshot payload is large (${this.formatByteCount(session.lastBytesPerSnapshot)} per snapshot)`);
    }
    if (session?.forcedRefreshes && session.forcedRefreshes > 0) {
      warnings.push(`Forced player refreshes occurred this tick (${session.forcedRefreshes})`);
    }
    if (protocolDiagnostics.recentIncoming.some((entry) => !entry.parseOk)) {
      warnings.push('Recent incoming packets had JSON parse failures');
    }
    return warnings;
  }

  getRenderingHealthWarnings(): string[] {
    const warnings: string[] = [];
    const diagnostics = this.renderingDiagnostics.getDiagnostics() as Record<string, unknown>;
    const cullEntries = typeof diagnostics.cullEntries === 'number' ? diagnostics.cullEntries : 0;
    const culledCount = typeof diagnostics.culledCount === 'number' ? diagnostics.culledCount : 0;
    const lastCullDurationMs = typeof diagnostics.lastCullDurationMs === 'number' ? diagnostics.lastCullDurationMs : 0;
    if (cullEntries === 0) {
      warnings.push('No geometry is currently registered with the culling service');
    }
    if (cullEntries > 0 && culledCount === 0) {
      warnings.push('Culling is active but not rejecting any tracked geometry');
    }
    if (lastCullDurationMs > RuntimeDiagnosticsCoordinator.RENDER_PERFORMANCE_BUDGETS.cullPassWarnMs) {
      warnings.push(`Cull pass is expensive (${lastCullDurationMs.toFixed(2)} ms)`);
    }
    return warnings;
  }

  getStatusSummary(): string {
    if (this.serverStatus.error) {
      return `error: ${this.serverStatus.error}`;
    }
    return `${this.serverStatus.clients ?? 0} clients | ${this.serverStatus.sessions ?? 0} sessions | ${this.formatAgeMs(this.serverStatus.lastUpdatedAt)}`;
  }

  getTransportSummary(): string {
    const transport = this.serverStatus.transport;
    if (!transport) return `base ${this.serverStatus.baseUrl}`;
    return `WS ${this.formatByteCount(transport.wsMaxPayloadBytes ?? null)} | HTTP ${transport.httpJsonLimit ?? 'n/a'}`;
  }

  getSnapshotBytesSummary(): string {
    const session = this.serverStatus.session;
    if (!session) return 'n/a';
    return `fanout ${this.formatByteCount(session.lastSnapshotBytes)} | per snapshot ${this.formatByteCount(session.lastBytesPerSnapshot)} | peak ${this.formatByteCount(session.peakBytesPerSnapshot)}`;
  }

  getFanoutCostSummary(): string {
    const session = this.serverStatus.session;
    if (!session) return 'n/a';
    return `last ${this.formatDurationMs(session.lastFanoutDurationMs)} | avg ${this.formatDurationMs(session.averageFanoutDurationMs)} | peak ${this.formatDurationMs(session.peakFanoutDurationMs)}`;
  }

  getReplicationShapeSummary(): string {
    const session = this.serverStatus.session;
    if (!session) return 'n/a';
    const actorRuntime = session.actorRuntime as { actorCount?: number } | undefined;
    return `updates ${session.lastDeltaEntities ?? 0} | actors ${actorRuntime?.actorCount ?? 0} | forced ${session.forcedRefreshes ?? 0}`;
  }

  getRenderingCountsSummary(): string {
    const diagnostics = this.renderingDiagnostics.getDiagnostics() as Record<string, unknown>;
    return `tracked ${String(diagnostics.cullEntries ?? 0)} | visible ${String(diagnostics.visibleCount ?? 0)} | culled ${String(diagnostics.culledCount ?? 0)}`;
  }

  getRenderingCostSummary(): string {
    const diagnostics = this.renderingDiagnostics.getDiagnostics() as Record<string, unknown>;
    return `last ${this.formatDurationMs(diagnostics.lastCullDurationMs as number | undefined)} | avg ${this.formatDurationMs(diagnostics.averageCullDurationMs as number | undefined)} | peak ${this.formatDurationMs(diagnostics.peakCullDurationMs as number | undefined)}`;
  }

  getStatusAgeSummary(): string {
    return this.formatAgeMs(this.serverStatus.lastUpdatedAt);
  }

  private publishServerStatus(): void {
    if (!this.stateManager) return;
    if (this.serverStatus.error) {
      this.stateManager.set('diagnostics.network.serverStatus', {
        baseUrl: this.serverStatus.baseUrl,
        error: this.serverStatus.error,
        lastUpdatedAt: this.serverStatus.lastUpdatedAt,
      });
      return;
    }

    this.stateManager.set('diagnostics.network.serverStatus', {
      baseUrl: this.serverStatus.baseUrl,
      clients: this.serverStatus.clients,
      sessions: this.serverStatus.sessions,
      transport: this.serverStatus.transport,
      session: this.serverStatus.session,
      lastUpdatedAt: this.serverStatus.lastUpdatedAt,
    });
  }

  private selectServerSessionDiagnostics(payload: ServerStatusResponse): ServerSessionDiagnostics | null {
    const sessions = Array.isArray(payload.sessionDiagnostics) ? payload.sessionDiagnostics : [];
    if (sessions.length === 0) return null;
    if (!this.multiplayerClient.roomId) return null;
    return sessions.find((entry) => entry.sessionId === this.multiplayerClient.roomId) ?? null;
  }

  private formatByteCount(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  private formatDurationMs(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return `${value.toFixed(2)} ms`;
  }

  private formatAgeMs(timestamp: number): string {
    if (timestamp <= 0) return 'n/a';
    return `${Date.now() - timestamp} ms ago`;
  }
}
