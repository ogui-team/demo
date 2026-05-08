import { Entity } from '../../client/src/engine/core/Entity'
import { StateManager } from '../../client/src/engine/foundation/state/StateManager'
import {
  addTag,
  getEntityAttribute,
  getEntityAttributes,
  getMetadata,
  hasTag,
  hasHitbox,
  initializeEntityAttributes,
  isInvisible,
  isScriptGate,
  removeTag,
  setEntityAttribute,
  setHitbox,
  setInvisible,
  setMetadata,
  setScriptGate,
} from '../../client/src/engine/core/EntityAttributes'

describe('EntityAttributes', () => {
  let stateManager: StateManager
  let entity: Entity

  beforeEach(() => {
    stateManager = new StateManager({})
    entity = new Entity('entity-1', 'test')
    initializeEntityAttributes(entity, stateManager)
  })

  it('initializes and reads default attributes', () => {
    expect(getEntityAttributes(entity, stateManager).hasHitbox).toBe(true)
    expect(getEntityAttribute(entity, stateManager, 'isInvisible')).toBe(false)
  })

  it('updates attribute values and metadata', () => {
    setHitbox(entity, stateManager, false)
    setScriptGate(entity, stateManager, true)
    setInvisible(entity, stateManager, true)
    setMetadata(entity, stateManager, 'team', 'red')

    expect(hasHitbox(entity, stateManager)).toBe(false)
    expect(isScriptGate(entity, stateManager)).toBe(true)
    expect(isInvisible(entity, stateManager)).toBe(true)
    expect(getMetadata(entity, stateManager, 'team')).toBe('red')
  })

  it('manages tags and preserves duplicates correctly', () => {
    addTag(entity, stateManager, 'friendly')
    addTag(entity, stateManager, 'friendly')
    expect(hasTag(entity, stateManager, 'friendly')).toBe(true)

    removeTag(entity, stateManager, 'friendly')
    expect(hasTag(entity, stateManager, 'friendly')).toBe(false)
  })
})
