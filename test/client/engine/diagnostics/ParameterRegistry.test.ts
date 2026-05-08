import { describe, expect, it } from 'vitest'
import { ParameterRegistry } from '../../../../client/src/engine/diagnostics/debug/ParameterBinding'

describe('ParameterRegistry', () => {
  it('adds and retrieves groups correctly', () => {
    const registry = new ParameterRegistry()
    registry.addGroup('graphics')

    expect(registry.getGroup('graphics')).toBeDefined()
    expect(registry.getGroups()).toHaveLength(1)
  })

  it('adds parameters to groups and returns them by id', () => {
    const registry = new ParameterRegistry()
    const parameter = {
      id: 'fpsLimit',
      name: 'FPS Limit',
      type: 'slider' as const,
      min: 30,
      max: 144,
      step: 1,
      get: () => 60,
      set: (value: number | string | boolean) => {},
    }

    registry.addParameter('performance', parameter)

    expect(registry.getGroup('performance')?.parameters).toContain(parameter)
    expect(registry.getParameter('performance', 'fpsLimit')).toBe(parameter)
  })

  it('clears all registered groups and parameters', () => {
    const registry = new ParameterRegistry()
    registry.addParameter('audio', {
      id: 'volume',
      name: 'Volume',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      get: () => 50,
    })

    registry.clear()

    expect(registry.getGroups()).toHaveLength(0)
    expect(registry.getGroup('audio')).toBeUndefined()
  })
})
