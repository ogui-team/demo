import * as fs from 'node:fs';
import * as path from 'node:path';

export type RuntimeMetricsScenarioClass = 'baseline' | 'expanded' | 'stress';

export interface RuntimeMetricsSample {
  capturedAt: string;
  sessionId: string | null;
  scenarioClass?: RuntimeMetricsScenarioClass | null;
  performanceMode?: 'dev' | 'capture' | 'stable' | 'release';
  frameTimeAvgMs: number;
  frameTimePeakMs: number;
  cpuFrameAvgMs?: number;
  cpuFramePeakMs?: number;
  worldObjectCount: number;
  visibleRenderables: number;
  snapshotPayloadBytes: number;
  snapshotBytesPerSnapshot: number;
  replicationUpdatesPerTick: number;
  actorReplicationCount: number;
  sampleQuality?: {
    focused?: boolean;
    visible?: boolean;
    valid?: boolean;
    reasons?: string[];
  };
  frameCostBreakdown?: Array<{
    name: string;
    avgMs: number;
    peakMs: number;
    sharePct: number;
  }>;
}

// Persist runtime artifacts outside source folders so dev/watch tooling and
// Windows file locking are less likely to interfere with writes.
const runtimeMetricsDir = path.resolve(__dirname, '..', '..', 'data', 'runtime_metrics');
const latestPath = path.join(runtimeMetricsDir, 'latest.json');
const historyPath = path.join(runtimeMetricsDir, 'history.json');
const sessionHistoryDir = path.join(runtimeMetricsDir, 'sessions');
const MAX_HISTORY_SAMPLES = 120;
const MAX_SESSION_HISTORY_SAMPLES = 240;

export function saveRuntimeMetrics(sample: RuntimeMetricsSample): RuntimeMetricsSample[] {
  try {
    fs.mkdirSync(runtimeMetricsDir, { recursive: true });
    fs.mkdirSync(sessionHistoryDir, { recursive: true });
  } catch (e) {
    // Directory creation may fail - continue anyway
  }
  
  const normalized = normalizeSample(sample);
  const history = getRuntimeMetricsHistory();
  history.push(normalized);
  const trimmed = history.slice(-MAX_HISTORY_SAMPLES);
  
  try {
    fs.writeFileSync(latestPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  } catch (e) {
    // Metrics write may fail - log but don't crash
    console.warn('[RuntimeMetrics] Failed to write latest metrics:', e);
  }
  
  try {
    fs.writeFileSync(historyPath, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  } catch (e) {
    // History write may fail - log but don't crash
    console.warn('[RuntimeMetrics] Failed to write metrics history:', e);
  }
  
  if (normalized.sessionId) {
    try {
      const sessionHistory = getRuntimeMetricsSessionHistory(normalized.sessionId);
      sessionHistory.push(normalized);
      fs.writeFileSync(
        getSessionHistoryPath(normalized.sessionId),
        `${JSON.stringify(sessionHistory.slice(-MAX_SESSION_HISTORY_SAMPLES), null, 2)}\n`,
        'utf8',
      );
    } catch (e) {
      // Session history write may fail - log but don't crash
      console.warn('[RuntimeMetrics] Failed to write session metrics:', e);
    }
  }
  return trimmed;
}

export function getLatestRuntimeMetrics(): RuntimeMetricsSample | null {
  const sample = readJsonFile(latestPath, null as RuntimeMetricsSample | null);
  return sample ? normalizeSample(sample) : null;
}

export function getRuntimeMetricsHistory(): RuntimeMetricsSample[] {
  return readJsonFile(historyPath, [] as RuntimeMetricsSample[]).map((sample) => normalizeSample(sample));
}

export function getRuntimeMetricsSessionHistory(sessionId: string): RuntimeMetricsSample[] {
  return readJsonFile(getSessionHistoryPath(sessionId), [] as RuntimeMetricsSample[])
    .map((sample) => normalizeSample(sample));
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function normalizeSample(sample: RuntimeMetricsSample): RuntimeMetricsSample {
  const rawSessionId = sample.sessionId ?? null;
  const scenarioClass = normalizeScenarioClass(sample.scenarioClass);
  const sessionId = getStoredSessionId(rawSessionId, scenarioClass);
  const isCanonicalReleaseCapture = isCanonicalReleaseSessionId(sessionId);
  const normalizedPerformanceMode = sample.performanceMode === 'dev'
    || sample.performanceMode === 'capture'
    || sample.performanceMode === 'stable'
    || sample.performanceMode === 'release'
    ? sample.performanceMode
    : 'stable';

  return {
    capturedAt: sample.capturedAt,
    sessionId,
    scenarioClass,
    performanceMode: isCanonicalReleaseCapture ? 'capture' : normalizedPerformanceMode,
    frameTimeAvgMs: Number.isFinite(sample.frameTimeAvgMs) ? sample.frameTimeAvgMs : 0,
    frameTimePeakMs: Number.isFinite(sample.frameTimePeakMs) ? sample.frameTimePeakMs : 0,
    cpuFrameAvgMs: Number.isFinite(sample.cpuFrameAvgMs) ? sample.cpuFrameAvgMs : 0,
    cpuFramePeakMs: Number.isFinite(sample.cpuFramePeakMs) ? sample.cpuFramePeakMs : 0,
    worldObjectCount: Number.isFinite(sample.worldObjectCount) ? sample.worldObjectCount : 0,
    visibleRenderables: Number.isFinite(sample.visibleRenderables) ? sample.visibleRenderables : 0,
    snapshotPayloadBytes: Number.isFinite(sample.snapshotPayloadBytes) ? sample.snapshotPayloadBytes : 0,
    snapshotBytesPerSnapshot: Number.isFinite(sample.snapshotBytesPerSnapshot) ? sample.snapshotBytesPerSnapshot : 0,
    replicationUpdatesPerTick: Number.isFinite(sample.replicationUpdatesPerTick) ? sample.replicationUpdatesPerTick : 0,
    actorReplicationCount: Number.isFinite(sample.actorReplicationCount) ? sample.actorReplicationCount : 0,
    sampleQuality: {
      focused: sample.sampleQuality?.focused ?? false,
      visible: sample.sampleQuality?.visible ?? false,
      valid: sample.sampleQuality?.valid ?? false,
      reasons: Array.isArray(sample.sampleQuality?.reasons) ? sample.sampleQuality?.reasons ?? [] : [],
    },
    frameCostBreakdown: Array.isArray(sample.frameCostBreakdown)
      ? sample.frameCostBreakdown
          .filter((entry) => entry && typeof entry.name === 'string')
          .map((entry) => ({
            name: entry.name,
            avgMs: Number.isFinite(entry.avgMs) ? entry.avgMs : 0,
            peakMs: Number.isFinite(entry.peakMs) ? entry.peakMs : 0,
            sharePct: Number.isFinite(entry.sharePct) ? entry.sharePct : 0,
          }))
      : [],
  };
}

function normalizeScenarioClass(value: RuntimeMetricsSample['scenarioClass']): RuntimeMetricsScenarioClass | null {
  return value === 'baseline' || value === 'expanded' || value === 'stress'
    ? value
    : null;
}

function getStoredSessionId(sessionId: string | null, scenarioClass: RuntimeMetricsScenarioClass | null): string | null {
  if (!sessionId) return null;
  if (!scenarioClass || scenarioClass === 'baseline') return sessionId;
  const scenarioSuffix = `:${scenarioClass}`;
  return sessionId.endsWith(scenarioSuffix) ? sessionId : `${sessionId}${scenarioSuffix}`;
}

function isCanonicalReleaseSessionId(sessionId: string | null): boolean {
  return sessionId === 'freeplay:release_freeplay'
    || sessionId === 'multiplayer:release_representative';
}

function getSessionHistoryPath(sessionId: string): string {
  return path.join(sessionHistoryDir, `${encodeURIComponent(sessionId)}.json`);
}
