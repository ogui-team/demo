import { gameBus } from '@engine/1-kernel/core/public-api';

export interface MovementSmoothnessMonitor {
  dispose(): void;
  getState(): {
    sampleCount: number;
    maxCorrectionDistance: number;
    sustainedHighDriftFrames: number;
  };
}

interface MovementSmoothnessSample {
  correctionDistance?: number;
  lerpFactor?: number;
  tick?: number;
  source?: string;
  playerId?: string;
  entityId?: string | number;
}

export function attachMovementSmoothnessTest(options?: {
  perfWarningDistance?: number;
  sustainedWarningFrames?: number;
}): MovementSmoothnessMonitor {
  const perfWarningDistance = options?.perfWarningDistance ?? 0.35;
  const sustainedWarningFrames = options?.sustainedWarningFrames ?? 8;

  let sampleCount = 0;
  let maxCorrectionDistance = 0;
  let sustainedHighDriftFrames = 0;

  const unsubscribe = gameBus.on('SMOOTHNESS_SAMPLE', (sample: MovementSmoothnessSample) => {
    const correctionDistance = typeof sample?.correctionDistance === 'number' && Number.isFinite(sample.correctionDistance)
      ? Math.max(0, sample.correctionDistance)
      : 0;
    const lerpFactor = typeof sample?.lerpFactor === 'number' && Number.isFinite(sample.lerpFactor)
      ? Math.max(0, sample.lerpFactor)
      : 0;

    sampleCount += 1;
    maxCorrectionDistance = Math.max(maxCorrectionDistance, correctionDistance);
    sustainedHighDriftFrames = correctionDistance >= perfWarningDistance
      ? sustainedHighDriftFrames + 1
      : 0;

    console.log(`[SMOOTHNESS] CorrectionDistance: ${correctionDistance.toFixed(4)}, LerpFactor: ${lerpFactor.toFixed(2)}`, {
      source: sample?.source ?? 'unknown',
      tick: sample?.tick ?? null,
      playerId: sample?.playerId ?? null,
      entityId: sample?.entityId ?? null,
      sampleCount,
    });

    if (
      sustainedHighDriftFrames >= sustainedWarningFrames
      && sustainedHighDriftFrames % sustainedWarningFrames === 0
    ) {
      console.warn('[PERF_WARNING] Physics Desync Detected', {
        source: sample?.source ?? 'unknown',
        tick: sample?.tick ?? null,
        playerId: sample?.playerId ?? null,
        entityId: sample?.entityId ?? null,
        correctionDistance,
        perfWarningDistance,
        sustainedHighDriftFrames,
      });
    }
  });

  return {
    dispose(): void {
      unsubscribe();
    },
    getState() {
      return {
        sampleCount,
        maxCorrectionDistance,
        sustainedHighDriftFrames,
      };
    },
  };
}