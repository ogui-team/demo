import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/1-kernel/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
}))

import {
  createDormantComponent,
  createRuntimeLifecycleComponent,
  getRuntimeLifecycleState,
  isEntityDormant,
  isEntitySimulationActive,
  isEntityStreamLoaded,
  setEntityRuntimeLifecycleState,
} from '../../../../client/src/2-systems/gameplay/systems/RuntimeLifecycle'
import type { DormantComponent } from '../../../../client/src/2-systems/gameplay/game/components/DormantComponent'
import type { RuntimeLifecycleComponent } from '../../../../client/src/2-systems/gameplay/game/components/RuntimeLifecycleComponent'

interface EntityStub {
  id: string
  isActive: boolean
  components: Map<string, { data: any }>
  type?: string
}

function createEntityStub(initial: Partial<EntityStub> = {}): EntityStub & {
  getComponent(name: string): { data: any } | undefined
  addComponent(component: { name: string; data: any }): void
  hasComponent(name: string): boolean
} {
  const entity: EntityStub = {
    id: initial.id ?? 'entity-1',
    isActive: initial.isActive ?? true,
    components: new Map(Object.entries(initial.components ?? {})),
    type: initial.type ?? 'generic',
  }

  return {
    ...entity,
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

describe('RuntimeLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates dormant and runtime lifecycle components', () => {
    const dormant = createDormantComponent(false, 'test')
    expect(dormant.type).toBe('dormant')
    expect(dormant.active).toBe(false)
    expect(dormant.reason).toBe('test')

    const lifecycle = createRuntimeLifecycleComponent('streamingOut', 'cell:1')
    expect(lifecycle.type).toBe('runtimeLifecycle')
    expect(lifecycle.state).toBe('streamingOut')
    expect(lifecycle.chunkId).toBe('cell:1')
  })

  it('returns the entity runtime lifecycle state from component or active flag', () => {
    const loadedEntity = createEntityStub({ isActive: true })
    expect(getRuntimeLifecycleState(loadedEntity)).toBe('loaded')

    const dormantEntity = createEntityStub({ isActive: false })
    expect(getRuntimeLifecycleState(dormantEntity)).toBe('dormant')

    const overridden = createEntityStub({ isActive: true })
    overridden.addComponent({
      name: 'runtimeLifecycle',
      data: { type: 'runtimeLifecycle', state: 'streamingOut', chunkId: null, updatedAtMs: Date.now() },
    })
    expect(getRuntimeLifecycleState(overridden)).toBe('streamingOut')
  })

  it('detects dormant stream-loaded and simulation-active entities', () => {
    const entity = createEntityStub({ isActive: true })
    expect(isEntityDormant(entity)).toBe(false)
    expect(isEntityStreamLoaded(entity)).toBe(true)
    expect(isEntitySimulationActive(entity)).toBe(true)

    entity.addComponent({
      name: 'dormant',
      data: { type: 'dormant', active: true, sinceMs: Date.now(), reason: 'sleep' },
    } as { name: string; data: DormantComponent })
    expect(isEntityDormant(entity)).toBe(true)
    expect(isEntitySimulationActive(entity)).toBe(false)
  })

  it('updates lifecycle state and emits state mutation events', () => {
    const entity = createEntityStub({ isActive: false })

    setEntityRuntimeLifecycleState(entity, 'loaded', { chunkId: '0:0', reason: 'activation' })

    const runtime = entity.getComponent('runtimeLifecycle')?.data as RuntimeLifecycleComponent
    const dormant = entity.getComponent('dormant')?.data as DormantComponent

    expect(entity.isActive).toBe(true)
    expect(runtime.state).toBe('loaded')
    expect(runtime.chunkId).toBe('0:0')
    expect(dormant.active).toBe(false)
    expect(dormant.reason).toBe('activation')

    setEntityRuntimeLifecycleState(entity, 'dormant', { chunkId: '0:0', reason: 'sleep' })
    expect(entity.isActive).toBe(false)
    expect(entity.getComponent('dormant')?.data.active).toBe(true)
    expect(entity.getComponent('dormant')?.data.reason).toBe('sleep')
  })
})
