import * as kernel from '../../client/src/engine/core/kernel/index'

describe('kernel barrel exports', () => {
  it('loads core kernel modules through the kernel index', () => {
    expect(kernel.KernelStateHash).toBeDefined()
    expect(kernel.initTransactionalKernel).toBeDefined()
    expect(kernel.SimulationKernel).toBeDefined()
    expect(kernel.SnapshotReader).toBeDefined()
    expect(kernel.KernelCommandQueue).toBeDefined()
  })
})
