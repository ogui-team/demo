import { SystemRegistry } from '../../client/src/engine/kernel/SystemRegistry'

describe('SystemRegistry', () => {
  let registry: SystemRegistry
  let initSpy: ReturnType<typeof vi.fn>
  let disposeSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    registry = new SystemRegistry()
    initSpy = vi.fn()
    disposeSpy = vi.fn()
  })

  it('registers a new system and initializes it', () => {
    registry.registerSystem('test-a', { initialize: initSpy } as any, 'phase-a')
    expect(initSpy).toHaveBeenCalledOnce()
    expect(registry.getSystem('test-a')).not.toBeNull()
    expect(registry.getPhaseOwner('test-a')).toBe('phase-a')
  })

  it('replaces an existing system and disposes the old one', () => {
    const systemA = { initialize: vi.fn(), dispose: disposeSpy } as any
    registry.registerSystem('test-b', systemA, 'phase-b')
    registry.replaceSystem('test-b', { initialize: initSpy, dispose: vi.fn() } as any)
    expect(disposeSpy).toHaveBeenCalledOnce()
    expect(registry.getPhaseOwner('test-b')).toBe('phase-b')
  })

  it('removes systems by phase and returns removed IDs', () => {
    registry.registerSystem('phase-x-1', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-x')
    registry.registerSystem('phase-x-2', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-x')
    registry.registerSystem('phase-y-1', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-y')

    const removed = registry.removePhase('phase-x')
    expect(removed.sort()).toEqual(['phase-x-1', 'phase-x-2'])
    expect(registry.getSystem('phase-x-1')).toBeNull()
    expect(registry.getSystem('phase-x-2')).toBeNull()
    expect(registry.getSystem('phase-y-1')).not.toBeNull()
  })

  it('validates duplicate IDs are not present', () => {
    registry.registerSystem('test-c', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-c')
    expect(registry.validateNoDuplicates()).toBe(true)
  })

  it('returns false from validateAllDisposable when a system lacks dispose', () => {
    registry.registerSystem('test-d', { initialize: vi.fn() } as any, 'phase-d')
    expect(registry.validateAllDisposable()).toBe(false)
  })

  it('provides diagnostic information with counts and registration order', () => {
    registry.registerSystem('d1', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-d')
    registry.registerSystem('d2', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-d')
    const diagnostics = registry.getDiagnostics()

    expect(diagnostics.totalSystems).toBe(2)
    expect(diagnostics.systemsByPhase['phase-d']).toBe(2)
    expect(diagnostics.registrationOrder).toEqual(['d1', 'd2'])
    expect(diagnostics.metrics.registrations).toBe(2)
  })

  it('does not replace an existing system without force and warns', () => {
    const originalInitialize = vi.fn()
    registry.registerSystem('test-e', { initialize: originalInitialize, dispose: vi.fn() } as any, 'phase-e')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registry.registerSystem('test-e', { initialize: vi.fn(), dispose: vi.fn() } as any)

    expect(warn).toHaveBeenCalled()
    expect(registry.getDiagnostics().metrics.replacements).toBe(0)
    expect(registry.getSystem('test-e')).not.toBeNull()
    warn.mockRestore()
  })

  it('throws when registering with invalid arguments', () => {
    expect(() => registry.registerSystem('', { initialize: vi.fn() } as any)).toThrow()
    expect(() => registry.registerSystem('invalid', null as any)).toThrow()
  })

  it('rolls back registration when initialization throws', () => {
    const badSystem = { initialize: vi.fn(() => { throw new Error('bad init') }), dispose: vi.fn() } as any

    expect(() => registry.registerSystem('bad-system', badSystem, 'phase-b')).toThrow('bad init')
    expect(registry.getSystem('bad-system')).toBeNull()
    expect(registry.getDiagnostics().metrics.registrations).toBe(1)
  })

  it('removeSystem increments removals metrics and disposes the system', () => {
    const dispose = vi.fn()
    registry.registerSystem('removable', { initialize: vi.fn(), dispose } as any, 'phase-removable')

    registry.removeSystem('removable')

    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.getDiagnostics().metrics.removals).toBe(1)
    expect(registry.getSystem('removable')).toBeNull()
  })

  it('returns true from validateAllDisposable when all systems are disposable', () => {
    registry.registerSystem('test-f', { initialize: vi.fn(), dispose: vi.fn() } as any, 'phase-f')
    expect(registry.validateAllDisposable()).toBe(true)
  })

  it('removeSystem warns when the system is not found', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registry.removeSystem('missing-system')

    expect(warn).toHaveBeenCalledWith('[SystemRegistry] System "missing-system" not found')
    expect(registry.getSystemIds()).toEqual([])
    warn.mockRestore()
  })

  it('clear disposes all registered systems and empties the registry', () => {
    const disposeA = vi.fn()
    const disposeB = vi.fn()

    registry.registerSystem('clear-a', { initialize: vi.fn(), dispose: disposeA } as any, 'phase-a')
    registry.registerSystem('clear-b', { initialize: vi.fn(), dispose: disposeB } as any, 'phase-b')

    registry.clear()

    expect(disposeA).toHaveBeenCalledOnce()
    expect(disposeB).toHaveBeenCalledOnce()
    expect(registry.getSystemIds()).toEqual([])
  })
})

