import {
  bindSystemContext,
  createNetworkFacade,
  createReplicationFacade,
  createSystemAccessProxy,
  deriveSystemCapabilities,
  deriveSystemDebugState,
  ensureEngineSystemContract,
  enforceSystemDisposeContract,
  getBoundSystemContext,
} from '../../client/src/engine/core/SystemHealthCorridor'

describe('SystemHealthCorridor', () => {
  it('ensures engine system contract adds dispose and capabilities', () => {
    const system: any = {}
    ensureEngineSystemContract(system, 'test-system', { deterministic: false })

    expect(system.id).toBe('test-system')
    expect(typeof system.dispose).toBe('function')
    expect(system.getCapabilities().deterministic).toBe(false)
  })

  it('binds system context and preserves getCapabilities warnings', () => {
    const system: any = {
      setSystemContext(ctx: any) { this.ctx = ctx },
      getCapabilities: vi.fn(() => ({ usesSystemContext: false })),
    }
    const ctx = { network: { getClient: () => null, getSync: () => null } } as any

    bindSystemContext(system, 'test-system', ctx)
    expect(getBoundSystemContext(system)).toBe(ctx)
    expect(system.ctx).toBe(ctx)
  })

  it('creates a network facade with safe attach and fallback behavior', () => {
    const networkFacade = createNetworkFacade({ networkManager: null, networkSyncSystem: null, replicationSystem: null })
    expect(networkFacade.getClient()).toBeNull()
    expect(networkFacade.getSync()).toBeNull()

    networkFacade.attachClient({ sendGameplayCommand: vi.fn() } as any)
    networkFacade.sendCommand({ type: 'action', payload: {}, playerId: 'p1', seq: 1, tick: 1, timestamp: Date.now(), input: {} })
    expect(networkFacade.getClient()).not.toBeNull()
  })

  it('creates a replication facade with fallback values', () => {
    const facade = createReplicationFacade(null)
    expect(facade.getSnapshot('a')).toBeUndefined()
    expect(facade.applySnapshot({} as any)).toBe(false)
    expect(facade.applySnapshots([])).toEqual([])
    expect(facade.getDiagnostics()).toEqual({})
    expect(facade.getSystem()).toBeNull()
  })

  it('creates a system access proxy that resolves missing systems safely', () => {
    const proxy = createSystemAccessProxy(() => null)
    expect(proxy['missing']).toBeNull()
    expect('missing' in proxy).toBe(false)
  })

  it('enforces disposal contract for systems with destroy()', () => {
    const system: any = {
      destroy: vi.fn(),
    }

    enforceSystemDisposeContract(system, 'destroy-system')
    expect(typeof system.dispose).toBe('function')
    system.dispose()
    expect(system.destroy).toHaveBeenCalled()
  })

  it('derives capabilities and debug state for a simple object', () => {
    const system: any = {
      id: 'debug-system',
      getDebugState: () => ({ active: true }),
    }

    const caps = deriveSystemCapabilities(system)
    expect(caps.exposesDebug).toBe(true)
    const debugState = deriveSystemDebugState(system)
    expect(debugState.id).toBe('debug-system')
  })
})
