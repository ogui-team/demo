import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DebugUI } from '../../../../client/src/engine/diagnostics/debug/DebugUI'
import { ParameterRegistry } from '../../../../client/src/engine/diagnostics/debug/ParameterBinding'

vi.mock('@engine/core/public-api', () => ({
  listSystems: vi.fn(() => []),
  getSystemDebugProperties: vi.fn(),
  getSystemDebugValue: vi.fn(),
  getSystemStateSnapshot: vi.fn(),
  setSystemDebugValue: vi.fn(),
}))

describe('DebugUI', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('creates an overlay and toggles visibility', () => {
    const registry = new ParameterRegistry()
    const ui = new DebugUI(registry)

    expect(document.getElementById('debug-dashboard-overlay')).toBeTruthy()
    expect(ui.isVisible()).toBe(false)

    ui.show()
    expect(ui.isVisible()).toBe(true)
    expect(document.getElementById('debug-dashboard-overlay')?.style.display).toBe('flex')

    ui.hide()
    expect(ui.isVisible()).toBe(false)
    expect(document.getElementById('debug-dashboard-overlay')?.style.display).toBe('none')
  })

  it('refreshes only when visible', () => {
    const registry = new ParameterRegistry()
    const ui = new DebugUI(registry)
    const renderSpy = vi.spyOn(ui as any, 'render')

    ui.refresh()
    expect(renderSpy).not.toHaveBeenCalled()

    ui.show()
    ui.refresh()
    expect(renderSpy).toHaveBeenCalled()
  })

  it('destroys the overlay and stops refresh timer', () => {
    const registry = new ParameterRegistry()
    const ui = new DebugUI(registry)

    ui.show()
    ui.destroy()

    expect(document.getElementById('debug-dashboard-overlay')).toBeNull()
  })
})
