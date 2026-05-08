import { MetadataStore } from '../../client/src/engine/reflection/ReflectionSystem'
import { EngineClass, EditorProperty, Replicated, SaveGame } from '../../client/src/engine/reflection/Decorators'
import {
  getEditorProperties,
  getEditorPropertiesByCategory,
  setEditorProperty,
  getReplicatedState,
  applyReplicatedState,
  getSaveGameState,
  applySaveGameState,
} from '../../client/src/engine/reflection/SerializationUtils'

function registerDecoratedProperty(target: object, propertyKey: string, ...decorators: PropertyDecorator[]): void {
  for (const decorator of decorators) {
    decorator(target, propertyKey)
  }
}

describe('ReflectionSystem and SerializationUtils', () => {
  it('registers class metadata and property decorators correctly', () => {
    class TestMetadataTarget {
      maxHealth = 100

      isBoss = false

      displayName = 'Test'
    }

    EngineClass('Test Metadata Target')(TestMetadataTarget)
    registerDecoratedProperty(
      TestMetadataTarget.prototype,
      'maxHealth',
      EditorProperty({ type: 'number', label: 'Max Health', min: 0, max: 200, category: 'Vitals' }),
      Replicated(),
      SaveGame(),
    )
    registerDecoratedProperty(
      TestMetadataTarget.prototype,
      'isBoss',
      EditorProperty({ type: 'boolean', label: 'Is Boss', category: 'Appearance' }),
      SaveGame(),
    )
    registerDecoratedProperty(
      TestMetadataTarget.prototype,
      'displayName',
      EditorProperty({ type: 'string', label: 'Display Name', category: 'General', readOnly: true }),
    )

    const meta = MetadataStore.getClass('TestMetadataTarget')
    expect(meta).toBeDefined()
    expect(meta?.properties.size).toBeGreaterThanOrEqual(3)

    const editorProps = getEditorProperties(new TestMetadataTarget())
    expect(editorProps.map((p) => p.propertyKey)).toEqual(expect.arrayContaining(['maxHealth', 'isBoss', 'displayName']))

    const grouped = getEditorPropertiesByCategory(new TestMetadataTarget())
    expect(grouped.some((g) => g.category === 'Vitals')).toBe(true)
    expect(grouped.some((g) => g.category === 'Appearance')).toBe(true)
  })

  it('coerces and sets editor property values with type conversion and enforces read-only', () => {
    class TestSetterTarget {
      scale = 2

      isActive = false

      immutableValue = 42
    }

    registerDecoratedProperty(
      TestSetterTarget.prototype,
      'scale',
      EditorProperty({ type: 'number', label: 'Scale', min: 1, max: 5 }),
    )
    registerDecoratedProperty(
      TestSetterTarget.prototype,
      'isActive',
      EditorProperty({ type: 'boolean', label: 'Active' }),
    )
    registerDecoratedProperty(
      TestSetterTarget.prototype,
      'immutableValue',
      EditorProperty({ type: 'number', readOnly: true }),
    )

    const target = new TestSetterTarget()
    setEditorProperty(target, 'scale', '4')
    expect(target.scale).toBe(4)

    setEditorProperty(target, 'scale', '999')
    expect(target.scale).toBe(5)

    setEditorProperty(target, 'isActive', 0)
    expect(target.isActive).toBe(false)

    expect(() => setEditorProperty(target, 'immutableValue', 10)).toThrow()
  })

  it('returns early when setting unknown editor property', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    class MissingTarget {
      name = 'missing'
    }
    setEditorProperty(new MissingTarget(), 'unknown', 1)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('collects and applies replicated and save game state accurately', () => {
    class ReplicatedTarget {
      position = { x: 1, y: 2, z: 3 }

      level = 5

      unlocked = true
    }

    registerDecoratedProperty(ReplicatedTarget.prototype, 'position', Replicated())
    registerDecoratedProperty(ReplicatedTarget.prototype, 'level', SaveGame())
    registerDecoratedProperty(ReplicatedTarget.prototype, 'unlocked', SaveGame())

    const target = new ReplicatedTarget()
    const replicatedState = getReplicatedState(target)
    expect(replicatedState).toEqual({ position: target.position })

    const saveState = getSaveGameState(target)
    expect(saveState).toEqual({ level: 5, unlocked: true })

    target.position = { x: 9, y: 9, z: 9 }
    applyReplicatedState(target, { position: { x: 7, y: 8, z: 9 } })
    expect(target.position).toEqual({ x: 7, y: 8, z: 9 })

    target.level = 1
    target.unlocked = false
    applySaveGameState(target, { level: 10, unlocked: true })
    expect(target.level).toBe(10)
    expect(target.unlocked).toBe(true)
  })
})
