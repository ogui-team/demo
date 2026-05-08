import type { ReplayEvent, ReplayRecording, ReplaySystem } from '../../1-kernel/core/ReplaySystem';
import {
  NullRuntimeDeterminismTraceSink,
  type EncounterOwnership,
  type RuntimeDeterminismTraceSink,
  type RuntimeQueuedJobExecutionTrace,
} from './RuntimeSimulationContracts';

export const RUNTIME_DETERMINISM_TRACE_EVENT = 'runtime_determinism_trace';

export type RuntimeDeterminismTraceEntry =
  | { kind: 'frame_dt'; frameIndex: number; dtMicros: number }
  | {
    kind: 'chunk_lifecycle';
    action: 'loaded' | 'unloaded';
    worldId: string;
    chunkId: string;
    cellId: string;
    entityCount: number;
  }
  | {
    kind: 'encounter_ownership';
    encounterKey: string | null;
    previous: EncounterOwnership;
    next: EncounterOwnership;
    epoch: number;
  }
  | {
    kind: 'queued_job_execution';
    frameIndex: number;
    order: number;
    jobKey: string;
    jobType: 'chunk' | 'encounter';
    chunkId: string | null;
    encounterKey: string | null;
    dtMicros: number;
    priority: number;
    epoch: number;
  }
  | {
    kind: 'ai_activation';
    aiKey: string;
    encounterKey: string;
    activated: boolean;
    epoch: number;
  }
  | {
    kind: 'prefab_spawn';
    prefabId: string;
    chunkId: string;
    entityId: string;
    order: number;
    epoch: number;
  }
  | {
    kind: 'streaming_transition';
    transitionType: 'dormant_wake' | 'dormant_sleep' | 'path_cancel' | 'serialization';
    entityId: string | null;
    epoch: number;
  };

export class RuntimeDeterminismTrace implements RuntimeDeterminismTraceSink {
  private readonly entries: RuntimeDeterminismTraceEntry[] = [];
  private readonly maxEntries: number;
  private readonly replaySystem: ReplaySystem | null;

  constructor(replaySystem: ReplaySystem | null, maxEntries = 4096) {
    this.replaySystem = replaySystem;
    this.maxEntries = Math.max(128, maxEntries);
  }

  recordFrameDt(frameIndex: number, dt: number): void {
    this.push({
      kind: 'frame_dt',
      frameIndex,
      dtMicros: toMicros(dt),
    });
  }

  recordChunkLifecycle(
    action: 'loaded' | 'unloaded',
    details: { worldId: string; chunkId: string; cellId: string; entityCount: number },
  ): void {
    this.push({
      kind: 'chunk_lifecycle',
      action,
      worldId: details.worldId,
      chunkId: details.chunkId,
      cellId: details.cellId,
      entityCount: details.entityCount,
    });
  }

  recordEncounterOwnershipTransition(details: {
    encounterKey: string | null;
    previous: EncounterOwnership;
    next: EncounterOwnership;
    epoch: number;
  }): void {
    this.push({
      kind: 'encounter_ownership',
      encounterKey: details.encounterKey,
      previous: details.previous,
      next: details.next,
      epoch: details.epoch,
    });
  }

  recordQueuedJobExecution(details: RuntimeQueuedJobExecutionTrace): void {
    this.push({
      kind: 'queued_job_execution',
      frameIndex: details.frameIndex,
      order: details.order,
      jobKey: details.jobKey,
      jobType: details.jobType,
      chunkId: details.chunkId,
      encounterKey: details.encounterKey,
      dtMicros: toMicros(details.dt),
      priority: details.priority,
      epoch: details.epoch,
    });
  }

  recordAIActivation(details: { aiKey: string; encounterKey: string; activated: boolean; epoch: number }): void {
    this.push({
      kind: 'ai_activation',
      aiKey: details.aiKey,
      encounterKey: details.encounterKey,
      activated: details.activated,
      epoch: details.epoch,
    });
  }

  recordPrefabSpawn(details: {
    prefabId: string;
    chunkId: string;
    entityId: string;
    order: number;
    epoch: number;
  }): void {
    this.push({
      kind: 'prefab_spawn',
      prefabId: details.prefabId,
      chunkId: details.chunkId,
      entityId: details.entityId,
      order: details.order,
      epoch: details.epoch,
    });
  }

  recordStreamingTransition(details: {
    transitionType: 'dormant_wake' | 'dormant_sleep' | 'path_cancel' | 'serialization';
    entityId: string | null;
    epoch: number;
  }): void {
    this.push({
      kind: 'streaming_transition',
      transitionType: details.transitionType,
      entityId: details.entityId,
      epoch: details.epoch,
    });
  }

  getEntries(): RuntimeDeterminismTraceEntry[] {
    return [...this.entries];
  }

  getDigest(): string {
    return RuntimeDeterminismTrace.digestEntries(this.entries);
  }

  getDebugState(): Record<string, unknown> {
    return {
      entryCount: this.entries.length,
      digest: this.getDigest(),
    };
  }

  static digestRecording(recording: ReplayRecording): string {
    const traceEntries = recording.events
      .filter((event): event is ReplayEvent & { data: RuntimeDeterminismTraceEntry } => event.type === RUNTIME_DETERMINISM_TRACE_EVENT)
      .map((event) => event.data);
    return RuntimeDeterminismTrace.digestEntries(traceEntries);
  }

  static digestEntries(entries: RuntimeDeterminismTraceEntry[]): string {
    let hash = 0x811c9dc5;
    for (const entry of entries) {
      const serialized = serializeEntry(entry);
      for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private push(entry: RuntimeDeterminismTraceEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    if (this.replaySystem?.isRecording()) {
      this.replaySystem.recordEvent(RUNTIME_DETERMINISM_TRACE_EVENT, entry);
    }
  }
}

export const NullRuntimeDeterminismTrace = NullRuntimeDeterminismTraceSink;

function serializeEntry(entry: RuntimeDeterminismTraceEntry): string {
  switch (entry.kind) {
    case 'frame_dt':
      return `frame:${entry.frameIndex}:${entry.dtMicros}`;
    case 'chunk_lifecycle':
      return `chunk:${entry.action}:${entry.worldId}:${entry.chunkId}:${entry.cellId}:${entry.entityCount}`;
    case 'encounter_ownership':
      return `encounter:${entry.encounterKey ?? 'none'}:${entry.previous}:${entry.next}:${entry.epoch}`;
    case 'queued_job_execution':
      return `job:${entry.frameIndex}:${entry.order}:${entry.jobKey}:${entry.jobType}:${entry.chunkId ?? 'none'}:${entry.encounterKey ?? 'none'}:${entry.dtMicros}:${entry.priority}:${entry.epoch}`;
    case 'ai_activation':
      return `ai:${entry.aiKey}:${entry.encounterKey}:${entry.activated}:${entry.epoch}`;
    case 'prefab_spawn':
      return `prefab:${entry.prefabId}:${entry.chunkId}:${entry.entityId}:${entry.order}:${entry.epoch}`;
    case 'streaming_transition':
      return `stream:${entry.transitionType}:${entry.entityId ?? 'none'}:${entry.epoch}`;
  }
}

function toMicros(dt: number): number {
  return Math.max(0, Math.round(dt * 1_000_000));
}