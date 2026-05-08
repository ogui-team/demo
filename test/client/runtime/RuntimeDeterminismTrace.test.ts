import { ReplaySystem } from '../../../client/src/1-kernel/core/ReplaySystem';
import { RuntimeDeterminismTrace } from '../../../client/src/4-runtime/runtime/RuntimeDeterminismTrace';

// Helper: Simple seeded RNG for deterministic fuzz testing
function simpleRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
}

// Helper: Create a fuzz run with deterministic seed
function createFuzzRun(eventCount: number, seed: number): string {
  const replaySystem = new ReplaySystem();
  const trace = new RuntimeDeterminismTrace(replaySystem);
  const rng = simpleRng(seed);

  replaySystem.startRecording('runtime-determinism', seed);

  for (let i = 0; i < eventCount; i++) {
    const eventType = rng() % 5;
    const epoch = Math.floor(i / 2);

    switch (eventType) {
      case 0:
        trace.recordFrameDt(i, 1 / 60 + rng() / 10000);
        break;
      case 1:
        trace.recordChunkLifecycle('loaded', {
          worldId: `world-${rng() % 3}`,
          chunkId: `chunk:${rng() % 5}:${rng() % 5}`,
          cellId: `${rng() % 5}:${rng() % 5}`,
          entityCount: rng() % 20,
        });
        break;
      case 2:
        trace.recordEncounterOwnershipTransition({
          encounterKey: `horde:${rng() % 3}`,
          previous: 'inactive',
          next: 'foreground',
          epoch,
        });
        break;
      case 3:
        trace.recordAIActivation({
          aiKey: `ai:${rng() % 10}`,
          encounterKey: `horde:${rng() % 3}`,
          activated: rng() % 2 === 0,
          epoch,
        });
        break;
      case 4:
        trace.recordStreamingTransition({
          transitionType: ['dormant_wake', 'dormant_sleep', 'path_cancel', 'serialization'][rng() % 4] as any,
          entityId: `ent:${rng() % 50}`,
          epoch,
        });
        break;
    }
  }

  const recording = replaySystem.stopRecording();
  return RuntimeDeterminismTrace.digestRecording(recording);
}

// Helper: Detect unstable ordering
function detectUnstableOrdering(recordingFactory: (seed: number) => string, testCount: number = 20): boolean {
  const digests = new Map<string, number>();

  for (let i = 0; i < testCount; i++) {
    const digest = recordingFactory(i);
    digests.set(digest, (digests.get(digest) ?? 0) + 1);
  }

  // If all runs produce the same digest, ordering is stable
  return digests.size > 1;
}

function recordDeterministicRun(): string {
  const replaySystem = new ReplaySystem();
  const trace = new RuntimeDeterminismTrace(replaySystem);

  replaySystem.startRecording('runtime-determinism', 1337);
  trace.recordFrameDt(1, 1 / 60);
  trace.recordChunkLifecycle('loaded', {
    worldId: 'world-a',
    chunkId: 'chunk:0:0',
    cellId: '0:0',
    entityCount: 4,
  });
  trace.recordEncounterOwnershipTransition({
    encounterKey: 'horde:primary',
    previous: 'inactive',
    next: 'foreground',
    epoch: 1,
  });
  trace.recordQueuedJobExecution({
    frameIndex: 1,
    order: 1,
    jobKey: 'chunk:0:0',
    jobType: 'chunk',
    chunkId: '0:0',
    encounterKey: null,
    dt: 0.5,
    priority: 250,
    epoch: 0,
  });
  trace.recordFrameDt(2, 1 / 30);
  trace.recordQueuedJobExecution({
    frameIndex: 2,
    order: 1,
    jobKey: 'encounter:horde:primary',
    jobType: 'encounter',
    chunkId: null,
    encounterKey: 'horde:primary',
    dt: 0.25,
    priority: 1000,
    epoch: 2,
  });

  const recording = replaySystem.stopRecording();
  return RuntimeDeterminismTrace.digestRecording(recording);
}

describe('RuntimeDeterminismTrace', () => {
  it('produces identical replay output across repeated runs from the same input stream', () => {
    expect(recordDeterministicRun()).toBe(recordDeterministicRun());
  });

  it('changes digest when queued job execution order changes', () => {
    const replaySystem = new ReplaySystem();
    const trace = new RuntimeDeterminismTrace(replaySystem);

    replaySystem.startRecording('runtime-determinism', 1337);
    trace.recordFrameDt(1, 1 / 60);
    trace.recordQueuedJobExecution({
      frameIndex: 1,
      order: 2,
      jobKey: 'chunk:0:0',
      jobType: 'chunk',
      chunkId: '0:0',
      encounterKey: null,
      dt: 0.5,
      priority: 250,
      epoch: 0,
    });
    const recording = replaySystem.stopRecording();

    expect(RuntimeDeterminismTrace.digestRecording(recording)).not.toBe(recordDeterministicRun());
  });

  it('changes digest when encounter ownership transition order changes', () => {
    const replaySystem = new ReplaySystem();
    const trace = new RuntimeDeterminismTrace(replaySystem);

    replaySystem.startRecording('runtime-determinism', 1337);
    trace.recordEncounterOwnershipTransition({
      encounterKey: 'horde:primary',
      previous: 'inactive',
      next: 'foreground',
      epoch: 1,
    });
    trace.recordFrameDt(1, 1 / 60);
    trace.recordEncounterOwnershipTransition({
      encounterKey: 'horde:primary',
      previous: 'foreground',
      next: 'background',
      epoch: 2,
    });
    const recording = replaySystem.stopRecording();

    expect(RuntimeDeterminismTrace.digestRecording(recording)).not.toBe(recordDeterministicRun());
  });

  it('changes digest when chunk lifecycle order changes', () => {
    const replaySystem = new ReplaySystem();
    const trace = new RuntimeDeterminismTrace(replaySystem);

    replaySystem.startRecording('runtime-determinism', 1337);
    trace.recordFrameDt(1, 1 / 60);
    trace.recordEncounterOwnershipTransition({
      encounterKey: 'horde:primary',
      previous: 'inactive',
      next: 'foreground',
      epoch: 1,
    });
    trace.recordChunkLifecycle('loaded', {
      worldId: 'world-a',
      chunkId: 'chunk:0:0',
      cellId: '0:0',
      entityCount: 4,
    });
    const recording = replaySystem.stopRecording();

    expect(RuntimeDeterminismTrace.digestRecording(recording)).not.toBe(recordDeterministicRun());
  });

  it('detects AI activation order changes', () => {
    const replaySystem1 = new ReplaySystem();
    const trace1 = new RuntimeDeterminismTrace(replaySystem1);

    replaySystem1.startRecording('runtime-determinism', 1337);
    trace1.recordAIActivation({ aiKey: 'ai:goblin', encounterKey: 'horde:primary', activated: true, epoch: 0 });
    trace1.recordAIActivation({ aiKey: 'ai:orc', encounterKey: 'horde:primary', activated: true, epoch: 1 });
    const recording1 = replaySystem1.stopRecording();
    const digest1 = RuntimeDeterminismTrace.digestRecording(recording1);

    const replaySystem2 = new ReplaySystem();
    const trace2 = new RuntimeDeterminismTrace(replaySystem2);

    replaySystem2.startRecording('runtime-determinism', 1337);
    trace2.recordAIActivation({ aiKey: 'ai:orc', encounterKey: 'horde:primary', activated: true, epoch: 1 });
    trace2.recordAIActivation({ aiKey: 'ai:goblin', encounterKey: 'horde:primary', activated: true, epoch: 0 });
    const recording2 = replaySystem2.stopRecording();
    const digest2 = RuntimeDeterminismTrace.digestRecording(recording2);

    expect(digest1).not.toBe(digest2);
  });

  it('detects prefab spawn order changes', () => {
    const replaySystem1 = new ReplaySystem();
    const trace1 = new RuntimeDeterminismTrace(replaySystem1);

    replaySystem1.startRecording('runtime-determinism', 1337);
    trace1.recordPrefabSpawn({ prefabId: 'goblin', chunkId: 'chunk:0:0', entityId: 'ent:1', order: 1, epoch: 0 });
    trace1.recordPrefabSpawn({ prefabId: 'orc', chunkId: 'chunk:0:0', entityId: 'ent:2', order: 2, epoch: 0 });
    const recording1 = replaySystem1.stopRecording();
    const digest1 = RuntimeDeterminismTrace.digestRecording(recording1);

    const replaySystem2 = new ReplaySystem();
    const trace2 = new RuntimeDeterminismTrace(replaySystem2);

    replaySystem2.startRecording('runtime-determinism', 1337);
    trace2.recordPrefabSpawn({ prefabId: 'orc', chunkId: 'chunk:0:0', entityId: 'ent:2', order: 2, epoch: 0 });
    trace2.recordPrefabSpawn({ prefabId: 'goblin', chunkId: 'chunk:0:0', entityId: 'ent:1', order: 1, epoch: 0 });
    const recording2 = replaySystem2.stopRecording();
    const digest2 = RuntimeDeterminismTrace.digestRecording(recording2);

    expect(digest1).not.toBe(digest2);
  });

  it('detects streaming transition order changes', () => {
    const replaySystem1 = new ReplaySystem();
    const trace1 = new RuntimeDeterminismTrace(replaySystem1);

    replaySystem1.startRecording('runtime-determinism', 1337);
    trace1.recordStreamingTransition({ transitionType: 'dormant_wake', entityId: 'ent:1', epoch: 0 });
    trace1.recordStreamingTransition({ transitionType: 'dormant_sleep', entityId: 'ent:2', epoch: 1 });
    const recording1 = replaySystem1.stopRecording();
    const digest1 = RuntimeDeterminismTrace.digestRecording(recording1);

    const replaySystem2 = new ReplaySystem();
    const trace2 = new RuntimeDeterminismTrace(replaySystem2);

    replaySystem2.startRecording('runtime-determinism', 1337);
    trace2.recordStreamingTransition({ transitionType: 'dormant_sleep', entityId: 'ent:2', epoch: 1 });
    trace2.recordStreamingTransition({ transitionType: 'dormant_wake', entityId: 'ent:1', epoch: 0 });
    const recording2 = replaySystem2.stopRecording();
    const digest2 = RuntimeDeterminismTrace.digestRecording(recording2);

    expect(digest1).not.toBe(digest2);
  });
});

// Fuzz testing suite for Phase B expansion
describe('RuntimeDeterminismTrace - Fuzz Suite', () => {
  it('identical seed produces identical digest across multiple runs', () => {
    const digest1 = createFuzzRun(50, 42);
    const digest2 = createFuzzRun(50, 42);
    expect(digest1).toBe(digest2);
  });

  it('different seeds produce different digests', () => {
    const digest1 = createFuzzRun(50, 42);
    const digest2 = createFuzzRun(50, 43);
    expect(digest1).not.toBe(digest2);
  });

  it('detects unstable ordering across multiple permutations', () => {
    const digests = new Set<string>();
    const seedCount = 10;

    for (let i = 0; i < seedCount; i++) {
      const digest = createFuzzRun(30, i);
      digests.add(digest);
    }

    // All different seeds should produce different digests due to event order variance
    expect(digests.size).toBeGreaterThan(1);
  });
});

describe('RuntimeDeterminismTrace - Unstable-Order Detector', () => {
  it('identifies stable ordering when all runs produce same digest', () => {
    const factory = () => {
      const replaySystem = new ReplaySystem();
      const trace = new RuntimeDeterminismTrace(replaySystem);

      replaySystem.startRecording('runtime-determinism', 1337);
      trace.recordFrameDt(1, 1 / 60);
      trace.recordChunkLifecycle('loaded', {
        worldId: 'world-a',
        chunkId: 'chunk:0:0',
        cellId: '0:0',
        entityCount: 4,
      });

      const recording = replaySystem.stopRecording();
      return RuntimeDeterminismTrace.digestRecording(recording);
    };

    const isUnstable = detectUnstableOrdering(factory, 5);
    expect(isUnstable).toBe(false);
  });

  it('identifies unstable ordering when runs produce different digests', () => {
    const factory = (seed: number) => createFuzzRun(20, seed);
    const isUnstable = detectUnstableOrdering(factory, 10);
    expect(isUnstable).toBe(true);
  });
});
