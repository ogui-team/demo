import { initializeTraceAPI } from '../../client/src/engine/core/TraceWindowAPI'

describe('TraceWindowAPI', () => {
  it('initializes global trace API and exposes export/dump functions', () => {
    const kernel = { getBiteBuffer: () => new ArrayBuffer(1024 * 10) } as any

    initializeTraceAPI(kernel)

    expect(window.__kernelInstance).toBe(kernel)
    expect(window.TraceParser).toBeDefined()
    expect(typeof window.exportTrace).toBe('function')
    expect(typeof window.dumpTraceHex).toBe('function')

    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    window.dumpTraceHex()
    expect(spyLog).toHaveBeenCalled()
    spyLog.mockRestore()
  })

  it('exportTrace logs an error when kernel is missing', () => {
    delete (window as any).__kernelInstance
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    initializeTraceAPI({ getBiteBuffer: () => null } as any)
    window.exportTrace()
    expect(spyError).toHaveBeenCalledWith('[BinaryTraceExporter] No BITE buffer available')
    spyError.mockRestore()
  })
})
