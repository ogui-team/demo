import { BUILD_PERFORMANCE_BUDGETS, NETWORK_PERFORMANCE_BUDGETS, RENDER_PERFORMANCE_BUDGETS } from '../../client/src/engine/core/PerformanceBudgets'

describe('PerformanceBudgets', () => {
  it('exposes build budgets for bundle size and source maps', () => {
    expect(BUILD_PERFORMANCE_BUDGETS.clientBundleWarnBytes).toBeGreaterThan(0)
    expect(BUILD_PERFORMANCE_BUDGETS.clientIndexHtmlWarnBytes).toBe(4096)
  })

  it('exposes render and network budgets', () => {
    expect(RENDER_PERFORMANCE_BUDGETS.cullPassWarnMs).toBe(2.5)
    expect(NETWORK_PERFORMANCE_BUDGETS.snapshotFanoutWarnMs).toBe(8)
    expect(NETWORK_PERFORMANCE_BUDGETS.statusStaleWarnMs).toBe(5000)
  })
})
