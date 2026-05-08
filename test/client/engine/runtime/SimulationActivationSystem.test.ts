import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/1-kernel/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
}))

import { SimulationActivationSystem } from '../../../../client/src/2-systems/gameplay/systems/SimulationActivationSystem'

interface EntityStub {
  id: string
  type: string
  isActive: boolean
  position: { x: number; y: number; z: number }
  components: Map<string, { data: any }>
}

function createEntityStub(id: string, position: { x: number; y: number; z: number }, type = 'enemy'): EntityStub & {
  getPosition(): { x: number; y: number; z: number }
  getComponent(name: string): { data: any } | undefined
  addComponent(component: { name: string; data: any }): void
  hasComponent(name: string): boolean
}
{
  const entity: EntityStub = {
    id,
    type,
    isActive: false,
    position,
    components: new Map(),
  }
  return {
    ...entity,
    getPosition() {
      return { ...entity.position }
    },
    getComponent(name: string) {
      return entity.components.get(name)
    },
    addComponent(component: { name: string; data: any }) {
      entity.components.set(component.name, { data: component.data })
    },
    hasComponent(name: string) {
      return entity.components.has(name)
    },
  }
}

describe('SimulationActivationSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activates entities inside the focus radius and updates diagnostics', () => {
    const entity = createEntityStub('entity-1', { x: 1, y: 0, z: 1 }, 'enemy')
    entity.addComponent({ name: 'aiController', data: { type: 'aiController', currentPath: [], pathRequestId: 0, targetState: 'position' } })

    const spatialGrid = {
      getCellSize: () => 32,
      getCells: () => [{ id: '0:0', bounds: { minX: 0, maxX: 32, minZ: 0, maxZ: 32 }, entities: new Set(['entity-1']), visible: true, active: false, frustumBounds: null }][Symbol.iterator](),
      setCellActive: vi.fn(),
      getCellForEntity: () => '0:0',
    }
    const entityManager = { getEntity: vi.fn(() => entity) }
    const system = new SimulationActivationSystem({
      spatialGrid,
      entityManager,
      getFocusPosition: () => ({ x: 0, y: 0, z: 0 }),
      activationRadius: 1,
      updateInterval: 0.1,
    })

    system.update(0.2)

    expect(spatialGrid.setCellActive).toHaveBeenCalledWith('0:0', true)
    expect(entity.isActive).toBe(true)
    expect(system.getDiagnostics().activeEntities).toBe(1)
    expect(system.getDebugState().status).toBe('active')
  })

  it('puts entities to sleep when they are outside the activation radius', () => {
    const controllerData = { type: 'aiController', currentPath: [{ x: 0, y: 0, z: 0 }], pathRequestId: 0, targetState: 'position' }
    const entity = createEntityStub('entity-2', { x: 100, y: 0, z: 100 }, 'enemy')
    entity.addComponent({ name: 'aiController', data: controllerData })
    entity.addComponent({ name: 'animation', data: { paused: false } })
    entity.addComponent({ name: 'physics', data: { active: true, sleeping: false } })

    const spatialGrid = {
      getCellSize: () => 32,
      getCells: () => [{ id: '3:3', bounds: { minX: 96, maxX: 128, minZ: 96, maxZ: 128 }, entities: new Set(['entity-2']), visible: true, active: false, frustumBounds: null }][Symbol.iterator](),
      setCellActive: vi.fn(),
      getCellForEntity: () => '3:3',
    }
    const entityManager = { getEntity: vi.fn(() => entity) }
    const system = new SimulationActivationSystem({
      spatialGrid,
      entityManager,
      getFocusPosition: () => ({ x: 0, y: 0, z: 0 }),
      activationRadius: 1,
      updateInterval: 0.1,
    })

    system.update(0.2)

    expect(entity.isActive).toBe(false)
    expect(entity.getComponent('animation')?.data.paused).toBe(true)
    expect(entity.getComponent('physics')?.data.sleeping).toBe(true)
    expect(entity.getComponent('aiController')?.data.pathRequestId).toBeGreaterThanOrEqual(1)
  })

  it('respects enabled state and activation radius settings', () => {
    const entity = createEntityStub('entity-3', { x: 0, y: 0, z: 0 }, 'enemy')
    const spatialGrid = {
      getCellSize: () => 32,
      getCells: () => [][Symbol.iterator](),
      setCellActive: vi.fn(),
      getCellForEntity: () => undefined,
    }
    const entityManager = { getEntity: vi.fn() }
    const system = new SimulationActivationSystem({
      spatialGrid,
      entityManager,
      getFocusPosition: () => ({ x: 0, y: 0, z: 0 }),
      activationRadius: 0.5,
      updateInterval: 0.1,
    })

    system.setEnabled(false)
    system.update(1)
    expect(system.isEnabled()).toBe(false)
    expect(system.getDiagnostics().activeEntities).toBe(0)

    system.setEnabled(true)
    system.setActivationRadius(5)
    expect(system.getDebugState().metrics).toEqual(system.getDiagnostics())
  })
})
