import { Logger } from '../../client/src/engine/debug/Logger'

describe('Logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    Logger.verbose = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Logger.verbose = false
  })

  it('does not output log or warn when verbose mode is disabled', () => {
    Logger.log('TEST', 'hello')
    Logger.warn('TEST', 'warning')
    Logger.error('TEST', 'failure')

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('writes formatted messages when verbose mode is enabled', () => {
    Logger.verbose = true

    Logger.log('SYSTEM', 'hello', { value: 1 })
    Logger.warn('SYSTEM', 'warning', { code: 'X' })
    Logger.error('SYSTEM', 'failure', { reason: 'bad' })
    Logger.lifecycle('BOOT')

    expect(logSpy).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenLastCalledWith(
      '%cLIFECYCLE: %cBOOT',
      'color: #0099ff; font-weight: bold; font-size: 12px',
      'color: #00ff00; font-size: 12px',
      ''
    )
  })

  it('exposes global browser accessors through window', () => {
    expect((window as any).ENGINE_LOGGER).toBe(Logger)
    expect(Logger.verbose).toBe(false)

    ;(window as any).ENGINE_VERBOSE(true)
    expect(Logger.verbose).toBe(true)
    expect(logSpy).toHaveBeenCalledWith('[Logger] Verbose mode: true')
  })
})
