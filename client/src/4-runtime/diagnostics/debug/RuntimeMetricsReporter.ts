import { runtimeFrameCostProfiler, type FrameCostSample } from './FrameCostProfiler';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';

export type RuntimeMetricsScenarioClass = 'baseline' | 'expanded' | 'stress';

export interface RuntimeSampleQuality {
  focused: boolean;
  visible: boolean;
  valid: boolean;
  reasons: string[];
}

export interface RuntimeMetricsSample {
  capturedAt: string;
  sessionId: string | null;
  scenarioClass: RuntimeMetricsScenarioClass | null;
  performanceMode: RuntimePerformanceMode;
  frameTimeAvgMs: number;
  frameTimePeakMs: number;
  cpuFrameAvgMs: number;
  cpuFramePeakMs: number;
  worldObjectCount: number;
  visibleRenderables: number;
  snapshotPayloadBytes: number;
  snapshotBytesPerSnapshot: number;
  replicationUpdatesPerTick: number;
  actorReplicationCount: number;
  sampleQuality: RuntimeSampleQuality;
  frameCostBreakdown: FrameCostSample[];
}

export interface RuntimeMetricsReporterConfig {
  getBaseUrl: () => string | null;
  getSessionId: () => string | null;
  getMetrics: () => Omit<RuntimeMetricsSample, 'capturedAt' | 'sessionId' | 'scenarioClass' | 'performanceMode' | 'frameTimeAvgMs' | 'frameTimePeakMs' | 'cpuFrameAvgMs' | 'cpuFramePeakMs' | 'sampleQuality' | 'frameCostBreakdown'>;
  isEnabled: () => boolean;
  intervalSeconds?: number;
}

export class RuntimeMetricsReporter {
  private readonly config: RuntimeMetricsReporterConfig;
  private readonly intervalSeconds: number;
  private readonly scenarioClass: RuntimeMetricsScenarioClass | null;
  private frameAccumulatorMs = 0;
  private framePeakMs = 0;
  private frameSamples = 0;
  private flushAccumulator = 0;
  private inFlight = false;
  private lastSample: RuntimeMetricsSample | null = null;
  private focusedFrames = 0;
  private visibleFrames = 0;
  private visibilityProbeCounter = 0;
  private cachedVisible = true;
  private cachedFocused = true;

  constructor(config: RuntimeMetricsReporterConfig) {
    this.config = config;
    this.scenarioClass = readRuntimeMetricsScenarioClass();
    // STABLE uses the normal 3s cadence so gate validation can converge quickly
    // without waiting through long desktop-focus drift windows.
    this.intervalSeconds = Math.max(1, config.intervalSeconds ?? 3);
  }

  update(dt: number): void {
    const mode = getEffectiveRuntimePerformanceMode();
    // RELEASE mode: no metrics collection at all
    if (mode === RuntimePerformanceMode.RELEASE) return;
    if (!this.config.isEnabled()) return;

    const frameMs = Math.max(0, dt * 1000);
    this.frameAccumulatorMs += frameMs;
    this.framePeakMs = Math.max(this.framePeakMs, frameMs);
    this.frameSamples += 1;
    this.flushAccumulator += dt;

    // Probe document visibility/focus every 30th frame instead of every frame
    this.visibilityProbeCounter += 1;
    if (this.visibilityProbeCounter >= 30) {
      this.visibilityProbeCounter = 0;
      if (typeof document !== 'undefined') {
        this.cachedVisible = document.visibilityState === 'visible';
        this.cachedFocused = document.hasFocus();
      }
    }
    if (this.cachedVisible) this.visibleFrames += 1;
    if (this.cachedFocused) this.focusedFrames += 1;

    if (this.flushAccumulator < this.intervalSeconds || this.inFlight || this.frameSamples <= 0) {
      return;
    }

    const visibilityRatio = this.frameSamples > 0 ? this.visibleFrames / this.frameSamples : 0;
    const focusRatio = this.frameSamples > 0 ? this.focusedFrames / this.frameSamples : 0;
    const qualityReasons: string[] = [];
    const requireFocus = mode === RuntimePerformanceMode.DEV;
    if (visibilityRatio < 0.95) {
      qualityReasons.push(`visibility ${(visibilityRatio * 100).toFixed(1)}% < 95%`);
    }
    if (requireFocus && focusRatio < 0.9) {
      qualityReasons.push(`focus ${(focusRatio * 100).toFixed(1)}% < 90%`);
    }
    const frameCostSnapshot = runtimeFrameCostProfiler.consumeBreakdown();

    const payload: RuntimeMetricsSample = {
      capturedAt: new Date().toISOString(),
      sessionId: this.config.getSessionId(),
      scenarioClass: this.scenarioClass,
      ...this.config.getMetrics(),
      performanceMode: mode,
      frameTimeAvgMs: Number((this.frameAccumulatorMs / this.frameSamples).toFixed(3)),
      frameTimePeakMs: Number(this.framePeakMs.toFixed(3)),
      cpuFrameAvgMs: frameCostSnapshot.cpuFrameAvgMs,
      cpuFramePeakMs: frameCostSnapshot.cpuFramePeakMs,
      sampleQuality: {
        focused: focusRatio >= 0.9,
        visible: visibilityRatio >= 0.95,
        valid: qualityReasons.length === 0,
        reasons: qualityReasons,
      },
      frameCostBreakdown: frameCostSnapshot.breakdown,
    };
    this.lastSample = payload;
    this.flushAccumulator = 0;
    this.frameAccumulatorMs = 0;
    this.framePeakMs = 0;
    this.frameSamples = 0;
    this.focusedFrames = 0;
    this.visibleFrames = 0;
    void this.publish(payload);
  }

  getLastSample(): RuntimeMetricsSample | null {
    return this.lastSample ? { ...this.lastSample } : null;
  }

  private async publish(payload: RuntimeMetricsSample): Promise<void> {
    const baseUrl = this.config.getBaseUrl();
    if (!baseUrl) return;

    this.inFlight = true;
    try {
      await fetch(`${baseUrl}/runtime-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort diagnostics reporting only.
    } finally {
      this.inFlight = false;
    }
  }
}

function getEffectiveRuntimePerformanceMode(): RuntimePerformanceMode {
  const runtimeMode = getRuntimePerformanceMode();
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return runtimeMode;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const param = params.get('perfMode')?.toLowerCase();
    const metricsSessionId = params.get('metricsSessionId')?.toLowerCase();
    if (param === RuntimePerformanceMode.DEV) return RuntimePerformanceMode.DEV;
    if (param === RuntimePerformanceMode.CAPTURE) return RuntimePerformanceMode.CAPTURE;
    if (param === RuntimePerformanceMode.STABLE) return RuntimePerformanceMode.STABLE;
    if (param === RuntimePerformanceMode.RELEASE) return RuntimePerformanceMode.RELEASE;
    if (metricsSessionId === 'release_freeplay' || metricsSessionId === 'release_representative') {
      return RuntimePerformanceMode.CAPTURE;
    }
  } catch {
    return runtimeMode;
  }

  return runtimeMode;
}

function readRuntimeMetricsScenarioClass(): RuntimeMetricsScenarioClass | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return null;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('metricsScenarioClass')?.toLowerCase();
    if (value === 'baseline' || value === 'expanded' || value === 'stress') {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

