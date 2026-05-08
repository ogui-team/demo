import { describe, expect, it } from 'vitest'
import { runtimeFrameCostProfiler } from '../../../../../client/src/engine/diagnostics/debug/FrameCostProfiler'

describe('FrameCostProfiler', () => {
  it('does not sample when frame sampling is disabled', () => {
    runtimeFrameCostProfiler.beginFrame(false)
    const result = runtimeFrameCostProfiler.measure('test', () => 123)
    expect(result).toBe(123)
    runtimeFrameCostProfiler.record('test2', 5)
    runtimeFrameCostProfiler.endFrame(16.7)

    const snapshot = runtimeFrameCostProfiler.consumeBreakdown()
    expect(snapshot.frameWallAvgMs).toBe(0)
    expect(snapshot.frameWallPeakMs).toBe(0)
    expect(snapshot.cpuFrameAvgMs).toBe(0)
    expect(snapshot.breakdown).toEqual([])
  })

  it('records sample durations and returns a breakdown', () => {
    runtimeFrameCostProfiler.beginFrame(true)
    runtimeFrameCostProfiler.record('compute', 2.5)
    runtimeFrameCostProfiler.measure('work', () => {
      // simple work block
      let total = 0
      for (let i = 0; i < 10; i += 1) total += i
      return total
    })
    runtimeFrameCostProfiler.endFrame(12.3)

    const snapshot = runtimeFrameCostProfiler.consumeBreakdown()
    expect(snapshot.frameWallAvgMs).toBeCloseTo(12.3, 3)
    expect(snapshot.frameWallPeakMs).toBeCloseTo(12.3, 3)
    expect(snapshot.cpuFrameAvgMs).toBeGreaterThanOrEqual(2.5)
    expect(snapshot.breakdown.length).toBeGreaterThanOrEqual(1)
    expect(snapshot.breakdown[0].name).toBe('compute')
  })

  it('resets internal state after consuming the breakdown', () => {
    runtimeFrameCostProfiler.beginFrame(true)
    runtimeFrameCostProfiler.endFrame(8)
    runtimeFrameCostProfiler.consumeBreakdown()

    const nextSnapshot = runtimeFrameCostProfiler.consumeBreakdown()
    expect(nextSnapshot.frameWallAvgMs).toBe(0)
    expect(nextSnapshot.frameWallPeakMs).toBe(0)
    expect(nextSnapshot.cpuFrameAvgMs).toBe(0)
    expect(nextSnapshot.breakdown).toEqual([])
  })
})
