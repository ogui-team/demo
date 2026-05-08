import { EntityRegistry } from '../../client/src/engine/core/kernel/EntityRegistry'

describe('EntityRegistry', () => {
  it('creates handles and retrieves dense indices correctly', () => {
    const registry = new EntityRegistry(2)
    const first = registry.create()
    const second = registry.create()

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(registry.activeCount).toBe(2)

    expect(registry.getDenseIndex(first!)).toBe(0)
    expect(registry.getDenseIndex(second!)).toBe(1)
    expect(registry.getHandleForDense(0)).toBe(first)
    expect(registry.getHandleForDense(1)).toBe(second)
  })

  it('destroys entities and reuses slots with generation increment', () => {
    const registry = new EntityRegistry(1)
    const handle = registry.create()
    expect(handle).not.toBeNull()
    expect(registry.destroy(handle!)).toBe(true)
    expect(registry.getDenseIndex(handle!)).toBe(-1)
    expect(registry.activeCount).toBe(0)

    const secondHandle = registry.create()
    expect(secondHandle).not.toBeNull()
    expect(secondHandle).not.toBe(handle)
  })

  it('maps network IDs to handles and retrieves them', () => {
    const registry = new EntityRegistry(2)
    const handle = registry.create()!

    registry.setNetworkId(handle, 'player-1')
    expect(registry.getHandleByNetworkId('player-1')).toBe(handle)
    expect(registry.getHandleByNetworkId(1)).toBeNull()

    registry.setNetworkId(handle, 42)
    expect(registry.getHandleByNetworkId(42)).toBe(handle)
  })

  it('iterates dense indices with forEachDense', () => {
    const registry = new EntityRegistry(3)
    const handles = [registry.create(), registry.create()] as [number, number]
    const seen: number[] = []

    registry.forEachDense((dense, handle) => {
      seen.push(dense)
      expect(handle).toBe(handles[dense])
    })

    expect(seen).toEqual([0, 1])
  })

  it('returns null when capacity is exhausted', () => {
    const registry = new EntityRegistry(1)
    expect(registry.create()).not.toBeNull()
    expect(registry.create()).toBeNull()
  })
})
