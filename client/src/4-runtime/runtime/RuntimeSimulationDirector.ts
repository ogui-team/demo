import { gameBus, type SystemCapabilities, type SystemContext, type Vector3 } from '@engine/1-kernel/core/public-api';
import type { RuntimeEventSink } from './RuntimeEventQueue';
import type {
  EncounterOwnership,
  IChunkRuntimeView,
  IEncounterRuntime,
  ISpatialRuntimeView,
  RuntimeDeterminismTraceSink,
  SpatialRuntimeCellSnapshot,
} from './RuntimeSimulationContracts';

type SimulationBudgetMode = 'foreground' | 'balanced' | 'throttled';
type BackgroundJobType = 'chunk' | 'encounter';

interface RuntimeSimulationDirectorConfig {
  spatialRuntimeView: ISpatialRuntimeView;
  chunkRuntimeView: IChunkRuntimeView | null;
  encounterRuntime: IEncounterRuntime;
  runtimeEventSink: RuntimeEventSink;
  runtimeTrace: RuntimeDeterminismTraceSink;
}

interface ChunkSimulationState {
  cellId: string;
  loaded: boolean;
  visible: boolean;
  active: boolean;
  priority: number;
  distanceToFocus: number;
  lastSeenFrame: number;
  lastBackgroundTickAt: number;
  backgroundAccumulator: number;
  backgroundTicks: number;
  lastOwnershipLane: number;
}

interface BackgroundSimulationJob {
  type: BackgroundJobType;
  key: string;
  chunkId: string | null;
  encounterKey: string | null;
  dt: number;
  priority: number;
  lane: number;
  epoch: number;
  cancelled: boolean;
}

interface RuntimeSimulationBudget {
  mode: SimulationBudgetMode;
  foregroundEncounterInterval: number;
  backgroundEncounterInterval: number;
  lowFrequencyChunkInterval: number;
  audioInterval: number;
  jobsPerPump: number;
}

const FOREGROUND_BUDGET: RuntimeSimulationBudget = {
  mode: 'foreground',
  foregroundEncounterInterval: 1 / 60,
  backgroundEncounterInterval: 0.2,
  lowFrequencyChunkInterval: 0.2,
  audioInterval: 1 / 30,
  jobsPerPump: 4,
};

const BALANCED_BUDGET: RuntimeSimulationBudget = {
  mode: 'balanced',
  foregroundEncounterInterval: 1 / 30,
  backgroundEncounterInterval: 0.35,
  lowFrequencyChunkInterval: 0.45,
  audioInterval: 1 / 20,
  jobsPerPump: 2,
};

const THROTTLED_BUDGET: RuntimeSimulationBudget = {
  mode: 'throttled',
  foregroundEncounterInterval: 1 / 20,
  backgroundEncounterInterval: 0.6,
  lowFrequencyChunkInterval: 0.9,
  audioInterval: 1 / 12,
  jobsPerPump: 1,
};

export class RuntimeSimulationDirector {
  private readonly spatialRuntimeView: ISpatialRuntimeView;
  private readonly chunkRuntimeView: IChunkRuntimeView | null;
  private readonly encounterRuntime: IEncounterRuntime;
  private readonly runtimeEventSink: RuntimeEventSink;
  private readonly runtimeTrace: RuntimeDeterminismTraceSink;
  private readonly chunkStates = new Map<string, ChunkSimulationState>();
  private readonly jobQueue: BackgroundSimulationJob[] = [];
  private readonly queuedJobs = new Map<string, BackgroundSimulationJob>();
  private readonly topPriorityChunks: string[] = [];
  private readonly eventDisposers: Array<() => void> = [];
  private systemContext: SystemContext | null = null;
  private frameIndex = 0;
  private simulationTimeMs = 0;
  private focusCellId: string | null = null;
  private loadedChunkCount = 0;
  private visibleLoadedChunkCount = 0;
  private dormantChunkCount = 0;
  private backgroundEligibleChunkCount = 0;
  private asyncJobsProcessed = 0;
  private asyncJobsLastPump = 0;
  private backgroundQueuePeak = 0;
  private backgroundTicks = 0;
  private backgroundEncounterTicks = 0;
  private zoneTransitions = 0;
  private streamingPressure = 0;
  private currentBudget: RuntimeSimulationBudget = FOREGROUND_BUDGET;
  private lastBudgetMode: SimulationBudgetMode = FOREGROUND_BUDGET.mode;
  private encounterAccumulator = 0;
  private backgroundEncounterAccumulator = 0;
  private encounterEpoch = 0;
  private encounterOwnership: EncounterOwnership = 'inactive';
  private activeEncounterKey: string | null = null;
  private activeEncounterCount = 0;
  private frameJobExecutionOrder = 0;
  private lastUpdateCostMs = 0;

  constructor(config: RuntimeSimulationDirectorConfig) {
    this.spatialRuntimeView = config.spatialRuntimeView;
    this.chunkRuntimeView = config.chunkRuntimeView;
    this.encounterRuntime = config.encounterRuntime;
    this.runtimeEventSink = config.runtimeEventSink;
    this.runtimeTrace = config.runtimeTrace;
    this.installEventListeners();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  beginFrame(dt: number): void {
    const frameStart = typeof performance !== 'undefined' ? performance.now() : 0;
    this.frameIndex += 1;
    this.frameJobExecutionOrder = 0;
    this.simulationTimeMs += Math.max(0, dt * 1000);
    this.runtimeTrace.recordFrameDt(this.frameIndex, dt);
    this.refreshChunkStates(dt);
    this.scheduleBackgroundChunkTicks();
    this.runEncounterCadence(dt);
    const frameEnd = typeof performance !== 'undefined' ? performance.now() : frameStart;
    this.lastUpdateCostMs = Math.max(0, frameEnd - frameStart);
  }

  update(_dt: number): void {
    // Intentionally no-op: background work is drained from the gameplay frame.
  }

  drainQueuedWork(): void {
    this.flushBackgroundJobs(this.currentBudget.jobsPerPump);
  }

  getRecommendedAudioInterval(): number {
    return this.currentBudget.audioInterval;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      budgetMode: this.currentBudget.mode,
      focusCellId: this.focusCellId,
      loadedChunks: this.loadedChunkCount,
      visibleLoadedChunks: this.visibleLoadedChunkCount,
      dormantChunks: this.dormantChunkCount,
      backgroundEligibleChunks: this.backgroundEligibleChunkCount,
      backgroundQueueSize: this.jobQueue.length,
      backgroundQueuePeak: this.backgroundQueuePeak,
      asyncJobsProcessed: this.asyncJobsProcessed,
      asyncJobsLastPump: this.asyncJobsLastPump,
      backgroundTicks: this.backgroundTicks,
      backgroundEncounterTicks: this.backgroundEncounterTicks,
      activeEncounters: this.activeEncounterCount,
      streamingPressure: this.streamingPressure,
      zoneTransitions: this.zoneTransitions,
      topPriorityChunks: [...this.topPriorityChunks],
      lastUpdateCostMs: this.lastUpdateCostMs,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.currentBudget.mode,
      active: true,
      metrics: {
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  dispose(): void {
    for (const dispose of this.eventDisposers) {
      dispose();
    }
    this.eventDisposers.length = 0;
    this.resetRuntimeState();
  }

  resetRuntimeState(): void {
    for (const job of this.jobQueue) {
      job.cancelled = true;
    }
    this.jobQueue.length = 0;
    this.queuedJobs.clear();
    this.encounterAccumulator = 0;
    this.backgroundEncounterAccumulator = 0;
    this.encounterEpoch += 1;
    this.encounterOwnership = 'inactive';
    this.activeEncounterKey = null;
  }

  private installEventListeners(): void {
    this.eventDisposers.push(
      gameBus.on('CHUNK_UNLOADED', ({ cellId }) => {
        const state = this.chunkStates.get(cellId);
        if (state) {
          state.loaded = false;
          state.visible = false;
          state.active = false;
          state.backgroundAccumulator = 0;
        }
        this.invalidateQueuedJob(this.buildBackgroundJobKey('chunk', cellId));
      }),
    );
  }

  private refreshChunkStates(dt: number): void {
    const focusPosition = this.spatialRuntimeView.getFocusPosition();
    const nextFocusCellId = this.spatialRuntimeView.getFocusCellId();

    if (focusPosition && nextFocusCellId && nextFocusCellId !== this.focusCellId) {
      this.focusCellId = nextFocusCellId;
      this.zoneTransitions += 1;
      this.runtimeEventSink.enqueue('PLAYER_ENTERED_ZONE', {
        cellId: nextFocusCellId,
        position: {
          x: focusPosition.x,
          y: focusPosition.y,
          z: focusPosition.z,
        },
        timestamp: Math.round(this.simulationTimeMs),
      }, { chunkId: nextFocusCellId, tier: 'gameplay' });
    } else if (!nextFocusCellId) {
      this.focusCellId = null;
    }

    this.loadedChunkCount = 0;
    this.visibleLoadedChunkCount = 0;
    this.dormantChunkCount = 0;
    this.backgroundEligibleChunkCount = 0;
    this.streamingPressure = this.chunkRuntimeView?.getStreamingQueueSize() ?? 0;
    this.topPriorityChunks.length = 0;

    for (const state of this.chunkStates.values()) {
      state.loaded = false;
      state.visible = false;
      state.active = false;
      state.priority = 0;
      state.distanceToFocus = Number.POSITIVE_INFINITY;
    }

    this.chunkRuntimeView?.forEachLoadedChunkCell((cellId) => {
      const state = this.getOrCreateChunkState(cellId);
      state.loaded = true;
      state.lastSeenFrame = this.frameIndex;
    });

    this.spatialRuntimeView.forEachCell((cell) => {
      const state = this.getOrCreateChunkState(cell.id);
      state.lastSeenFrame = this.frameIndex;
      state.visible = cell.visible;
      state.active = cell.active;
      state.backgroundAccumulator += dt;
      state.distanceToFocus = this.computeCellDistance(cell, focusPosition);
      state.priority = this.computeChunkPriority(state);
      state.lastOwnershipLane = hashLane(cell.id);

      if (state.loaded) {
        this.loadedChunkCount += 1;
        if (state.visible) {
          this.visibleLoadedChunkCount += 1;
        } else {
          this.backgroundEligibleChunkCount += 1;
        }
        if (!state.active) {
          this.dormantChunkCount += 1;
        }
      }

      this.insertPriorityCell(cell.id, state.priority);
    });

    const nextBudget = this.chooseBudget();
    if (nextBudget.mode !== this.lastBudgetMode) {
      this.lastBudgetMode = nextBudget.mode;
      this.runtimeEventSink.enqueue('RUNTIME_SIMULATION_BUDGET', {
        mode: nextBudget.mode,
        loadedChunks: this.loadedChunkCount,
        visibleLoadedChunks: this.visibleLoadedChunkCount,
        backgroundQueueSize: this.jobQueue.length,
        streamingPressure: this.streamingPressure,
        asyncJobs: this.jobQueue.length,
        timestamp: Math.round(this.simulationTimeMs),
      }, { tier: 'telemetry_debug' });
    }
    this.currentBudget = nextBudget;
  }

  private runEncounterCadence(dt: number): void {
    const diagnostics = this.encounterRuntime.getRuntimeState();
    this.activeEncounterCount = diagnostics.activeEncounterCount;
    const nextOwnership = this.resolveEncounterOwnership(diagnostics.active);
    this.reconcileEncounterOwnership(nextOwnership, diagnostics.key);

    if (nextOwnership === 'inactive') {
      return;
    }

    if (nextOwnership === 'foreground') {
      this.encounterAccumulator += dt;
      if (this.encounterAccumulator >= this.currentBudget.foregroundEncounterInterval) {
        const tickDt = this.encounterAccumulator;
        this.encounterAccumulator = 0;
        this.encounterRuntime.stepForeground(tickDt);
      }
      return;
    }

    this.backgroundEncounterAccumulator += dt;
    if (diagnostics.key && this.backgroundEncounterAccumulator >= this.currentBudget.backgroundEncounterInterval) {
      const scheduledDt = this.backgroundEncounterAccumulator;
      const retained = this.enqueueBackgroundJob('encounter', diagnostics.key, scheduledDt, 1000, this.encounterEpoch);
      if (retained) {
        this.backgroundEncounterAccumulator = 0;
      }
    }
  }

  private scheduleBackgroundChunkTicks(): void {
    for (const state of this.chunkStates.values()) {
      if (!state.loaded || state.visible || state.backgroundAccumulator < this.currentBudget.lowFrequencyChunkInterval) {
        continue;
      }
      const retained = this.enqueueBackgroundJob('chunk', state.cellId, state.backgroundAccumulator, state.priority, 0);
      if (retained) {
        state.backgroundAccumulator = 0;
      }
    }
  }

  private enqueueBackgroundJob(
    type: BackgroundJobType,
    keyTarget: string | null,
    dt: number,
    priority: number,
    epoch: number,
  ): boolean {
    const key = this.buildBackgroundJobKey(type, keyTarget);
    const existing = this.queuedJobs.get(key);
    if (existing && !existing.cancelled) {
      existing.dt += dt;
      existing.priority = Math.max(existing.priority, priority);
      existing.epoch = epoch;
      existing.lane = hashLane(keyTarget ?? key);
      this.jobQueue.sort(compareJobsByPriority);
      return true;
    }

    const job: BackgroundSimulationJob = {
      type,
      key,
      chunkId: type === 'chunk' ? keyTarget : null,
      encounterKey: type === 'encounter' ? keyTarget : null,
      dt,
      priority,
      lane: hashLane(keyTarget ?? key),
      epoch,
      cancelled: false,
    };
    this.queuedJobs.set(key, job);
    this.jobQueue.push(job);
    this.backgroundQueuePeak = Math.max(this.backgroundQueuePeak, this.jobQueue.length);
    this.jobQueue.sort(compareJobsByPriority);
    return true;
  }

  private flushBackgroundJobs(limit: number): void {
    let processed = 0;
    while (this.jobQueue.length > 0 && processed < limit) {
      const job = this.jobQueue.shift();
      if (!job || job.cancelled) {
        continue;
      }

      const liveJob = this.queuedJobs.get(job.key);
      if (liveJob !== job) {
        continue;
      }
      this.queuedJobs.delete(job.key);
      processed += 1;
      this.asyncJobsProcessed += 1;

      if (job.type === 'encounter') {
        if (
          job.epoch !== this.encounterEpoch
          || this.encounterOwnership !== 'background'
          || job.encounterKey !== this.activeEncounterKey
        ) {
          continue;
        }
        this.encounterRuntime.stepBackground(job.dt);
        this.backgroundEncounterTicks += 1;
        this.recordQueuedJobExecution(job);
        continue;
      }

      if (!job.chunkId) {
        continue;
      }

      const state = this.chunkStates.get(job.chunkId);
      if (!state || !state.loaded) {
        continue;
      }

      state.backgroundTicks += 1;
      this.backgroundTicks += 1;
      this.recordQueuedJobExecution(job);
    }

    this.asyncJobsLastPump = processed;
  }

  private chooseBudget(): RuntimeSimulationBudget {
    if (this.streamingPressure > 0 || this.backgroundEligibleChunkCount > Math.max(2, this.visibleLoadedChunkCount + 2)) {
      return THROTTLED_BUDGET;
    }
    if (this.backgroundEligibleChunkCount > 0 || this.loadedChunkCount > Math.max(3, this.visibleLoadedChunkCount)) {
      return BALANCED_BUDGET;
    }
    return FOREGROUND_BUDGET;
  }

  private getOrCreateChunkState(cellId: string): ChunkSimulationState {
    const existing = this.chunkStates.get(cellId);
    if (existing) {
      return existing;
    }

    const created: ChunkSimulationState = {
      cellId,
      loaded: false,
      visible: false,
      active: false,
      priority: 0,
      distanceToFocus: Number.POSITIVE_INFINITY,
      lastSeenFrame: this.frameIndex,
      lastBackgroundTickAt: 0,
      backgroundAccumulator: 0,
      backgroundTicks: 0,
      lastOwnershipLane: hashLane(cellId),
    };
    this.chunkStates.set(cellId, created);
    return created;
  }

  private computeCellDistance(cell: SpatialRuntimeCellSnapshot, focusPosition: Vector3 | null): number {
    if (!focusPosition) {
      return Number.POSITIVE_INFINITY;
    }

    const centerX = (cell.bounds.minX + cell.bounds.maxX) * 0.5;
    const centerZ = (cell.bounds.minZ + cell.bounds.maxZ) * 0.5;
    const dx = centerX - focusPosition.x;
    const dz = centerZ - focusPosition.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private computeChunkPriority(state: ChunkSimulationState): number {
    let priority = 0;
    if (state.loaded) priority += 200;
    if (state.visible) priority += 150;
    if (state.active) priority += 75;
    if (Number.isFinite(state.distanceToFocus)) {
      priority -= Math.min(256, Math.floor(state.distanceToFocus));
    }
    return priority;
  }

  private insertPriorityCell(cellId: string, priority: number): void {
    if (this.topPriorityChunks.length === 0) {
      this.topPriorityChunks.push(cellId);
      return;
    }

    for (let index = 0; index < this.topPriorityChunks.length; index += 1) {
      const current = this.chunkStates.get(this.topPriorityChunks[index]);
      if (!current || priority > current.priority) {
        this.topPriorityChunks.splice(index, 0, cellId);
        if (this.topPriorityChunks.length > 4) {
          this.topPriorityChunks.length = 4;
        }
        return;
      }
    }

    if (this.topPriorityChunks.length < 4) {
      this.topPriorityChunks.push(cellId);
    }
  }

  private resolveEncounterOwnership(isEncounterActive: boolean): EncounterOwnership {
    if (!isEncounterActive) {
      return 'inactive';
    }

    const nearbyCombatActive = this.focusCellId !== null && this.topPriorityChunks[0] === this.focusCellId;
    return nearbyCombatActive && this.currentBudget.mode !== 'throttled'
      ? 'foreground'
      : 'background';
  }

  private reconcileEncounterOwnership(nextOwnership: EncounterOwnership, nextEncounterKey: string | null): void {
    if (nextOwnership === this.encounterOwnership && nextEncounterKey === this.activeEncounterKey) {
      return;
    }

    const previousOwnership = this.encounterOwnership;
    const previousEncounterKey = this.activeEncounterKey;
    this.encounterOwnership = nextOwnership;
    this.encounterEpoch += 1;
    this.activeEncounterKey = nextEncounterKey;
    this.runtimeTrace.recordEncounterOwnershipTransition({
      encounterKey: nextEncounterKey,
      previous: previousOwnership,
      next: nextOwnership,
      epoch: this.encounterEpoch,
    });

    if (nextOwnership !== 'foreground') {
      this.encounterAccumulator = 0;
    }

    if (previousEncounterKey && previousEncounterKey !== nextEncounterKey) {
      this.invalidateQueuedJob(this.buildBackgroundJobKey('encounter', previousEncounterKey));
    }

    if (nextOwnership !== 'background') {
      this.backgroundEncounterAccumulator = 0;
      if (nextEncounterKey) {
        this.invalidateQueuedJob(this.buildBackgroundJobKey('encounter', nextEncounterKey));
      }
    }
  }

  private buildBackgroundJobKey(type: BackgroundJobType, chunkId: string | null): string {
    if (type === 'encounter') {
      return `encounter:${chunkId ?? 'none'}`;
    }
    return `chunk:${chunkId ?? 'world'}`;
  }

  private invalidateQueuedJob(key: string): void {
    const job = this.queuedJobs.get(key);
    if (!job) {
      return;
    }
    job.cancelled = true;
    this.queuedJobs.delete(key);
  }

  private recordQueuedJobExecution(job: BackgroundSimulationJob): void {
    this.frameJobExecutionOrder += 1;
    this.runtimeTrace.recordQueuedJobExecution({
      frameIndex: this.frameIndex,
      order: this.frameJobExecutionOrder,
      jobKey: job.key,
      jobType: job.type,
      chunkId: job.chunkId,
      encounterKey: job.encounterKey,
      dt: job.dt,
      priority: job.priority,
      epoch: job.epoch,
    });
  }
}

function hashLane(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % 4;
}

function compareJobsByPriority(left: BackgroundSimulationJob, right: BackgroundSimulationJob): number {
  if (right.priority !== left.priority) {
    return right.priority - left.priority;
  }
  if (left.lane !== right.lane) {
    return left.lane - right.lane;
  }
  return right.dt - left.dt;
}