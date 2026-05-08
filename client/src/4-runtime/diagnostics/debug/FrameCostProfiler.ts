export interface FrameCostSample {
  name: string;
  avgMs: number;
  peakMs: number;
  sharePct: number;
}

interface CostAccumulator {
  totalMs: number;
  peakMs: number;
}

class FrameCostProfiler {
  private frameWallAccumulatorMs = 0;
  private frameWallPeakMs = 0;
  private cpuAccumulatorMs = 0;
  private cpuPeakMs = 0;
  private frameCount = 0;
  private activeFrameCpuMs = 0;
  private samplingFrame = false;
  private readonly accumulators = new Map<string, CostAccumulator>();

  beginFrame(enabled = true): void {
    this.samplingFrame = enabled;
    this.activeFrameCpuMs = 0;
  }

  endFrame(frameWallMs: number): void {
    if (!this.samplingFrame) {
      this.activeFrameCpuMs = 0;
      return;
    }
    this.frameWallAccumulatorMs += frameWallMs;
    this.frameWallPeakMs = Math.max(this.frameWallPeakMs, frameWallMs);
    this.cpuAccumulatorMs += this.activeFrameCpuMs;
    this.cpuPeakMs = Math.max(this.cpuPeakMs, this.activeFrameCpuMs);
    this.frameCount += 1;
    this.activeFrameCpuMs = 0;
    this.samplingFrame = false;
  }

  measure<T>(name: string, action: () => T): T {
    if (!this.samplingFrame) {
      return action();
    }
    const startedAt = performance.now();
    try {
      return action();
    } finally {
      this.record(name, performance.now() - startedAt);
    }
  }

  record(name: string, durationMs: number): void {
    if (!this.samplingFrame) return;
    const accumulator = this.accumulators.get(name) ?? { totalMs: 0, peakMs: 0 };
    accumulator.totalMs += durationMs;
    accumulator.peakMs = Math.max(accumulator.peakMs, durationMs);
    this.accumulators.set(name, accumulator);
    this.activeFrameCpuMs += durationMs;
  }

  isSamplingFrame(): boolean {
    return this.samplingFrame;
  }

  consumeBreakdown(limit = 8): {
    frameWallAvgMs: number;
    frameWallPeakMs: number;
    cpuFrameAvgMs: number;
    cpuFramePeakMs: number;
    breakdown: FrameCostSample[];
  } {
    const frameCount = Math.max(1, this.frameCount);
    const cpuFrameAvgMs = this.cpuAccumulatorMs / frameCount;
    const breakdown = [...this.accumulators.entries()]
      .map(([name, accumulator]) => ({
        name,
        avgMs: accumulator.totalMs / frameCount,
        peakMs: accumulator.peakMs,
        sharePct: cpuFrameAvgMs > 0 ? (accumulator.totalMs / frameCount / cpuFrameAvgMs) * 100 : 0,
      }))
      .sort((left, right) => right.avgMs - left.avgMs)
      .slice(0, limit)
      .map((entry) => ({
        name: entry.name,
        avgMs: Number(entry.avgMs.toFixed(3)),
        peakMs: Number(entry.peakMs.toFixed(3)),
        sharePct: Number(entry.sharePct.toFixed(2)),
      }));

    const snapshot = {
      frameWallAvgMs: Number((this.frameWallAccumulatorMs / frameCount).toFixed(3)),
      frameWallPeakMs: Number(this.frameWallPeakMs.toFixed(3)),
      cpuFrameAvgMs: Number(cpuFrameAvgMs.toFixed(3)),
      cpuFramePeakMs: Number(this.cpuPeakMs.toFixed(3)),
      breakdown,
    };

    this.frameWallAccumulatorMs = 0;
    this.frameWallPeakMs = 0;
    this.cpuAccumulatorMs = 0;
    this.cpuPeakMs = 0;
    this.frameCount = 0;
    this.accumulators.clear();

    return snapshot;
  }
}

export const runtimeFrameCostProfiler = new FrameCostProfiler();
