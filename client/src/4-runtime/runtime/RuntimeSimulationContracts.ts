import type { SpatialCellBounds } from '../../2-systems/gameplay/systems/SpatialGridSystem';

export type EncounterOwnership = 'inactive' | 'foreground' | 'background';
export type RuntimeSimulationJobType = 'chunk' | 'encounter';

export interface SpatialRuntimePosition {
  x: number;
  y: number;
  z: number;
}

export interface SpatialRuntimeCellSnapshot {
  id: string;
  bounds: SpatialCellBounds;
  visible: boolean;
  active: boolean;
}

export interface ISpatialRuntimeView {
  getFocusPosition(): SpatialRuntimePosition | null;
  getFocusCellId(): string | null;
  forEachCell(visitor: (cell: SpatialRuntimeCellSnapshot) => void): void;
}

export interface IChunkRuntimeView {
  forEachLoadedChunkCell(visitor: (cellId: string, chunkId: string) => void): void;
  getStreamingQueueSize(): number;
}

export interface EncounterRuntimeState {
  key: string | null;
  active: boolean;
  activeEncounterCount: number;
  status: string;
}

export interface IEncounterRuntime {
  getRuntimeState(): EncounterRuntimeState;
  stepForeground(dt: number): void;
  stepBackground(dt: number): void;
}

export interface RuntimeQueuedJobExecutionTrace {
  frameIndex: number;
  order: number;
  jobKey: string;
  jobType: RuntimeSimulationJobType;
  chunkId: string | null;
  encounterKey: string | null;
  dt: number;
  priority: number;
  epoch: number;
}

export interface RuntimeDeterminismTraceSink {
  recordFrameDt(frameIndex: number, dt: number): void;
  recordChunkLifecycle(
    action: 'loaded' | 'unloaded',
    details: { worldId: string; chunkId: string; cellId: string; entityCount: number },
  ): void;
  recordEncounterOwnershipTransition(details: {
    encounterKey: string | null;
    previous: EncounterOwnership;
    next: EncounterOwnership;
    epoch: number;
  }): void;
  recordQueuedJobExecution(details: RuntimeQueuedJobExecutionTrace): void;
}

export const NullRuntimeDeterminismTraceSink: RuntimeDeterminismTraceSink = {
  recordFrameDt(): void {},
  recordChunkLifecycle(): void {},
  recordEncounterOwnershipTransition(): void {},
  recordQueuedJobExecution(): void {},
};