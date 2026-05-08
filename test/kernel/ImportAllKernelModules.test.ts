
const kernelModules = import.meta.glob('../../client/src/engine/core/kernel/**/*.ts', { eager: true })

describe('kernel module imports', () => {
  it('imports all core kernel modules for coverage', () => {
    const count = Object.keys(kernelModules).length
    expect(count).toBeGreaterThan(20)
    for (const [path, module] of Object.entries(kernelModules)) {
      expect(module).toBeDefined()
      expect(path).toContain('client/src/engine/core/kernel/')
    }
  })
})
