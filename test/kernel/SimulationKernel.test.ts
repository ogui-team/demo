import { SimulationKernel } from '../../client/src/engine/core/kernel/SimulationKernel'
import { SystemCategory, type IKernelSystem } from '../../client/src/engine/core/kernel/types'

describe('SimulationKernel', () => {
  it('creates and destroys entities with default health and ammo', () => {
    const kernel = new SimulationKernel({ maxEntities: 2, commandCapacity: 8 })
    const handle = kernel.createEntity(1, 2, 3)

    expect(handle).not.toBeNull()
    expect(kernel.entities.activeCount).toBe(1)

    const dense = kernel.entities.getDenseIndex(handle!)
    expect(dense).toBe(0)
    expect(kernel.healths.getHealth(dense)).toBe(100)
    expect(kernel.healths.getMaxHealth(dense)).toBe(100)
    expect(kernel.inventories.getAmmo(dense)).toBe(30)
    expect(kernel.inventories.getItemId(dense)).toBe(1)

    expect(kernel.destroyEntity(handle!)).toBe(true)
    expect(kernel.entities.getDenseIndex(handle!)).toBe(-1)
    expect(kernel.entities.activeCount).toBe(0)
  })

  it('returns null when entity capacity is exhausted', () => {
    const kernel = new SimulationKernel({ maxEntities: 1, commandCapacity: 2 })
    const first = kernel.createEntity()
    expect(first).not.toBeNull()
    const second = kernel.createEntity()
    expect(second).toBeNull()
  })

  it('executes added kernel systems during tickOnce', () => {
    const kernel = new SimulationKernel({ maxEntities: 1, commandCapacity: 4 })
    const events: string[] = []

    const kernelSystem: IKernelSystem = {
      id: 'test_system',
      category: SystemCategory.KERNEL,
      execute: (dt: number) => {
        events.push(`execute:${dt}`)
      },
      setActiveCount: (count: number) => {
        events.push(`activeCount:${count}`)
      },
    }

    kernel.addSystem(kernelSystem)
    expect(kernel.tick).toBe(0)
    kernel.tickOnce(16)

    expect(kernel.tick).toBe(1)
    expect(events).toContain('activeCount:0')
    expect(events).toContain('execute:16')
  })

  it('spawns entities from blob data and preserves health and ammo values', () => {
    const kernel = new SimulationKernel({ maxEntities: 2, commandCapacity: 8 })
    const blob = new Uint8Array(4 + 2 * 24)
    const view = new DataView(blob.buffer)

    view.setUint32(0, 2, true)
    view.setFloat32(4, 1, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 3, true)
    view.setFloat32(16, 123.5, true)
    view.setUint32(20, 7, true)
    view.setUint32(24, 42, true)

    view.setFloat32(28, 4, true)
    view.setFloat32(32, 5, true)
    view.setFloat32(36, 6, true)
    view.setFloat32(40, 200, true)
    view.setUint32(44, 15, true)
    view.setUint32(48, 99, true)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const handles = kernel.spawnFromBlob(blob)
    logSpy.mockRestore()

    expect(handles).toHaveLength(2)
    expect(kernel.entities.activeCount).toBe(2)

    const dense0 = kernel.entities.getDenseIndex(handles[0])
    const dense1 = kernel.entities.getDenseIndex(handles[1])

    expect(kernel.healths.getHealth(dense0)).toBe(123.5)
    expect(kernel.inventories.getAmmo(dense0)).toBe(7)
    expect(kernel.inventories.getItemId(dense0)).toBe(42)

    expect(kernel.healths.getHealth(dense1)).toBe(200)
    expect(kernel.inventories.getAmmo(dense1)).toBe(15)
    expect(kernel.inventories.getItemId(dense1)).toBe(99)
  })

  it('dispatches built-in kernel commands to registered health system', () => {
    const kernel = new SimulationKernel({ maxEntities: 1, commandCapacity: 4 })
    const consumeDamageCommand = vi.fn()

    class DummyHealthSystem implements IKernelSystem {
      readonly id = 'health_system'
      readonly category = SystemCategory.KERNEL
      execute = vi.fn()
      consumeDamageCommand = consumeDamageCommand
    }

    const healthSystem = new DummyHealthSystem()
    kernel.addSystem(healthSystem)
    const registeredHealthSystem = (kernel as any).healthSystem
    expect(registeredHealthSystem).toBeDefined()
    expect(registeredHealthSystem.id).toBe('health_system')
    expect('consumeDamageCommand' in registeredHealthSystem).toBe(true)
    expect(registeredHealthSystem.consumeDamageCommand).toBe(consumeDamageCommand)

    expect(kernel.enqueueCommand(1, 1234, 'test', 'DAMAGE_CMD', null, { target: 1 })).toBe(true)
    const cmdQueue = (kernel as any).commands
    expect(cmdQueue.length).toBe(1)
    expect(cmdQueue.seq[0]).toBe(1)
    expect(cmdQueue.tick[0]).toBe(0)
    expect(cmdQueue.timestamp[0]).toBe(1234)
    expect(cmdQueue.source[0]).toBe('test')
    expect(cmdQueue.type[0]).toBe('DAMAGE_CMD')
    expect(cmdQueue.payload[0]).toEqual({ target: 1 })

    const externalConsumer = vi.fn()
    kernel.tickOnce(16, externalConsumer)
    expect((kernel as any).commands.length).toBe(0)
    expect(externalConsumer).toHaveBeenCalledOnce()
    expect(externalConsumer).toHaveBeenCalledWith(1, 0, 1234, 'test', 'DAMAGE_CMD', null, { target: 1 })

    expect(consumeDamageCommand).toHaveBeenCalledOnce()
    expect(consumeDamageCommand).toHaveBeenCalledWith({ target: 1 })
  })
})
