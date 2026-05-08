import { beforeEach, describe, expect, it } from 'vitest'

import { gameBus } from '../../../../client/src/engine/core/EventBus'
import { Entity } from '../../../../client/src/engine/core/Entity'
import { ComponentInspector } from '../../../../client/src/engine/editor/ComponentInspector'

describe('ComponentInspector', () => {
  beforeEach(() => {
    gameBus.clear()
  })

  it('publishes normalized entity data on selection and writes component updates back into ECS memory', () => {
    const entity = new Entity('entity_1', 'TestEntity')
    entity.addComponent({
      name: 'stats',
      data: {
        nested: {
          speed: 4,
        },
        values: [1, 2, 3],
      },
    })

    const selectSubscribers: Array<(entityId: string) => void> = []
    const deselectSubscribers: Array<() => void> = []
    const selectedPayloads: any[] = []
    const updatePayloads: any[] = []

    const inspector = new ComponentInspector({
      selectionSystem: {
        onSelect(callback) {
          selectSubscribers.push(callback)
          return () => {}
        },
        onDeselect(callback) {
          deselectSubscribers.push(() => callback())
          return () => {}
        },
        getSelected() {
          return null
        },
      },
      entityManager: {
        getEntity(entityId) {
          return entityId === entity.id ? entity : null
        },
      },
    })

    const offSelected = gameBus.on('EDITOR_ENTITY_SELECTED', (payload) => selectedPayloads.push(payload))
    const offUpdated = gameBus.on('EDITOR_COMPONENT_UPDATED', (payload) => updatePayloads.push(payload))

    selectSubscribers[0](entity.id)

    expect(selectedPayloads).toHaveLength(1)
    expect(selectedPayloads[0]).toEqual(expect.objectContaining({ entityId: entity.id, entityType: 'TestEntity' }))
    expect(selectedPayloads[0].components[0]).toEqual(expect.objectContaining({ name: 'stats' }))

    gameBus.emit('EDITOR_UPDATE_COMPONENT', {
      entityId: entity.id,
      componentName: 'stats',
      path: 'nested.speed',
      value: 9,
      source: 'ui',
      timestamp: Date.now(),
    })

    expect(entity.getComponent('stats')?.data.nested.speed).toBe(9)
    expect(updatePayloads.at(-1)).toEqual(expect.objectContaining({ entityId: entity.id, componentName: 'stats', value: 9 }))
    expect(selectedPayloads).toHaveLength(2)

    deselectSubscribers[0]()
    offSelected()
    offUpdated()
    inspector.destroy()
  })
})