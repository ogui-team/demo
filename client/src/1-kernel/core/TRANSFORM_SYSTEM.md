# Transform System

## Overview

The Transform System provides centralized, state-managed control over all entity positions, rotations, and scales. All modifications route through StateManager to ensure consistency across editor, multiplayer, and save/load systems.

**Key Features:**
- StateManager-backed transforms (immutable, auditable)
- Type-safe TypeScript API
- Real-time subscriptions to transform changes
- Perfect for editors, multiplayer sync, and undo/redo
- No direct entity mutation (prevents bugs)

## Architecture

### Core Components

**Transform.ts** - Main system with two APIs:
1. **Functional API** - Standalone functions for direct use
2. **TransformSystem Class** - Unified object-oriented interface

**Integration Points:**
- EntityManager registers entities when created
- StateManager stores all transform data under `entities.<id>.position/rotation/scale`
- EntityRenderer reads transforms (stays in sync)
- Engine exposes unified API

### Data Location

```
StateManager State Tree:
├── entities
│   ├── entity_0
│   │   ├── position: { x, y, z }
│   │   ├── rotation: { x, y, z }
│   │   └── scale: { x, y, z }
│   ├── entity_1
│   │   ├── position: { x, y, z }
│   │   ├── rotation: { x, y, z }
│   │   └── scale: { x, y, z }
│   └── ...
└── (other global state)
```

All transforms are immutable and auditable through StateManager's subscription system.

## API Reference

### TransformSystem Class

**Constructor:**
```typescript
new TransformSystem(stateManager: StateManager)
```

**Methods:**

#### Position
```typescript
getPosition(entity: Entity): Vector3
setPosition(entity: Entity, position: Vector3): void
translate(entity: Entity, dx: number, dy: number, dz: number): void
```

#### Rotation
```typescript
getRotation(entity: Entity): Vector3
setRotation(entity: Entity, rotation: Vector3): void // Radians
rotateAxis(entity: Entity, axis: 'x' | 'y' | 'z', angle: number): void
```

#### Scale
```typescript
getScale(entity: Entity): Vector3
setScale(entity: Entity, scale: Vector3): void
scale(entity: Entity, scaleX: number, scaleY?: number, scaleZ?: number): void
```

#### Full Transform
```typescript
getTransform(entity: Entity): Transform
setTransform(entity: Entity, transform: Partial<Transform>): void
```

#### Subscriptions
```typescript
subscribe(
  entity: Entity,
  callback: (newTransform: Transform, oldTransform: Transform) => void
): () => void // Returns unsubscribe function
```

#### Batch Operations
```typescript
getAllTransforms(): Map<string, Transform>
syncFromState(entity: Entity): void // Restore from StateManager
```

#### Management
```typescript
registerEntity(entity: Entity, transform?: Partial<Transform>): void
unregisterEntity(entity: Entity): void
```

### Functional API

All TransformSystem methods available as standalone functions:

```typescript
import { getPosition, setPosition, translate, getTransform, setTransform } from './Transform'

// All functions take (entity, stateManager, ...)
setPosition(entity, stateManager, { x: 0, y: 1, z: 0 })
const pos = getPosition(entity, stateManager)
translate(entity, stateManager, 1, 2, 3)
```

### Engine API

High-level access through Engine:

```typescript
// Get the system
const transformSystem = Engine.getTransformSystem()

// Or use directly on returned system
transformSystem?.setPosition(entity, { x: 0, y: 5, z: 10 })
transformSystem?.translate(entity, 1, 0, -2)
transformSystem?.rotateAxis(entity, 'y', Math.PI / 4)
```

## Usage Patterns

### Basic Position Control

```typescript
const transformSystem = Engine.getTransformSystem()!
const entity = entityManager.getEntity('my_entity')!

// Get position
const pos = transformSystem.getPosition(entity)
console.log(pos) // { x: 0, y: 1, z: 0 }

// Set position (updates both entity and StateManager)
transformSystem.setPosition(entity, { x: 5, y: 2, z: -3 })

// Move relative to current position
transformSystem.translate(entity, 1, 0.5, -2)
```

### Rotation

```typescript
// Rotate around Y axis by 45 degrees
transformSystem.rotateAxis(entity, 'y', Math.PI / 4)

// Set absolute rotation
transformSystem.setRotation(entity, {
  x: 0,
  y: Math.PI / 2,
  z: 0,
})
```

### Scaling

```typescript
// Double scale on X axis, keep others
const scale = transformSystem.getScale(entity)
transformSystem.setScale(entity, {
  x: scale.x * 2,
  y: scale.y,
  z: scale.z,
})

// Or use convenience scale function
transformSystem.scale(entity, 1.5) // 1.5x on all axes
transformSystem.scale(entity, 2, 1, 1) // 2x X only
```

### Full Transform Management

```typescript
// Get snapshot of all transform data
const transform = transformSystem.getTransform(entity)
// { position: {...}, rotation: {...}, scale: {...} }

// Set entire transform at once
transformSystem.setTransform(entity, {
  position: { x: 0, y: 5, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

// Or partial updates
transformSystem.setTransform(entity, {
  position: { x: 10, y: 10, z: 10 },
  // rotation/scale unchanged
})
```

## Advanced Usage

### Subscribe to Changes

Perfect for reactive UI systems (inspector panels, visual gizmos):

```typescript
const unsubscribe = transformSystem.subscribe(entity, (newTransform, oldTransform) => {
  console.log('Transform changed:', oldTransform, '=>', newTransform)

  // Update inspector UI
  updateInspectorPanel(entity, newTransform)

  // Sync to multiplayer
  sendNetworkUpdate(entity.id, newTransform)

  // Log for undo system
  recordUndoState(entity.id, oldTransform)
})

// Later: stop listening
unsubscribe()
```

### Animation Loop

```typescript
let time = 0
const animationSpeed = 2

function update(deltaTime: number) {
  time += deltaTime * animationSpeed

  // Circular motion
  const x = Math.cos(time * Math.PI * 2) * 5
  const z = Math.sin(time * Math.PI * 2) * 5
  const y = Math.sin(time * Math.PI * 2) * 2 + 1

  transformSystem.setPosition(entity, { x, y, z })
  transformSystem.rotateAxis(entity, 'y', time * Math.PI * 2)
}
```

### Editor Inspector System

```typescript
class EntityInspector {
  selectedEntity: Entity | null = null

  setPosition(x: number, y: number, z: number) {
    if (!this.selectedEntity) return
    transformSystem.setPosition(this.selectedEntity, { x, y, z })
  }

  setRotation(x: number, y: number, z: number) {
    if (!this.selectedEntity) return
    transformSystem.setRotation(this.selectedEntity, { x, y, z })
  }

  setScale(x: number, y: number, z: number) {
    if (!this.selectedEntity) return
    transformSystem.setScale(this.selectedEntity, { x, y, z })
  }
}

const inspector = new EntityInspector()

// Listen to transforms for two-way sync
transformSystem.subscribe(entity, (transform) => {
  inspector.displayTransform(transform)
})
```

### Batch Entity Manipulation

```typescript
// Move all enemies in formation
const enemies = entityManager.getEntitiesByType('Enemy')
enemies.forEach((enemy, index) => {
  transformSystem.setPosition(enemy, {
    x: index * 2,
    y: 1,
    z: 0,
  })
})

// Scale all decorative objects
const decorations = entityManager.getEntitiesByType('Decoration')
decorations.forEach((decoration) => {
  transformSystem.scale(decoration, 0.8)
})
```

### Save/Load Integration

```typescript
// Get snapshot for saving
const transforms = transformSystem.getAllTransforms()

// Store in SaveLoadManager
const mapData = {
  entities: entityManager.serialize(),
  transforms: transforms, // Transforms already in StateManager!
}

// On load: StateManager automatically has transforms
// Just sync entities back
entityManager.getEntities().forEach((entity) => {
  transformSystem.syncFromState(entity)
})
```

### Multiplayer State Sync

```typescript
// On every transform change, send update
transformSystem.subscribe(entity, (newTransform) => {
  // Send to server
  networkManager?.sendEntityUpdate({
    entityId: entity.id,
    transform: newTransform,
  })
})

// On receiving remote update
function receiveEntityUpdate(entityId: string, transform: Transform) {
  const entity = entityManager.getEntity(entityId)
  if (entity) {
    transformSystem.setTransform(entity, transform)
  }
}
```

### Undo/Redo System

```typescript
class UndoRedo {
  history: Array<{ entityId: string; transform: Transform }> = []
  index = 0

  recordState(entity: Entity) {
    const transform = transformSystem.getTransform(entity)
    this.history.push({ entityId: entity.id, transform })
  }

  undo() {
    if (this.index <= 0) return
    this.index--
    const { entityId, transform } = this.history[this.index]
    const entity = entityManager.getEntity(entityId)
    if (entity) {
      transformSystem.setTransform(entity, transform)
    }
  }

  redo() {
    if (this.index >= this.history.length - 1) return
    this.index++
    const { entityId, transform } = this.history[this.index]
    const entity = entityManager.getEntity(entityId)
    if (entity) {
      transformSystem.setTransform(entity, transform)
    }
  }
}
```

## Design Principles

### Everything Through StateManager

No direct entity transform modifications:

```typescript
// ✗ WRONG - breaks state consistency
entity.setPosition({ x: 10, y: 10, z: 10 })

// ✓ CORRECT - maintains state
transformSystem.setPosition(entity, { x: 10, y: 10, z: 10 })
```

### Immutability

StateManager maintains immutable state. Transform modifications rebuild the state tree:

```typescript
// Each operation triggers StateManager's immutable update cycle
const oldState = stateManager.get('entities.entity_0.position')
transformSystem.setPosition(entity, newPosition)
const newState = stateManager.get('entities.entity_0.position')
// oldState !== newState (new objects created)
```

### Decoupling

Transform system works independently:
- Doesn't depend on rendering (Three.js)
- Doesn't depend on networking
- Entity objects not mutated unnecessarily
- Pure state management

### Auditability

Every transform change is:
- Recorded in StateManager (immutable history)
- Observable via subscriptions
- Serializable to JSON
- Restorable from snapshots

## Editor Integration Checklist

- [x] Position control (X, Y, Z sliders)
- [x] Rotation control (radians or degrees, 3 axes)
- [x] Scale control (uniform or per-axis)
- [x] Transform display updates (subscribe to changes)
- [x] Multi-entity selection (batch operations)
- [x] Transform reset to origin/default
- [x] Copy/paste transforms between entities
- [x] Snap-to-grid for positions
- [x] Undo/redo support (via state history)
- [x] Gizmo support (visual feedback)

## Performance Considerations

**Time Complexity:**
- Get operation: O(1) dictionary lookup
- Set operation: O(n) where n = depth of state tree (typically ~5-10)
- Subscribe: O(1) registration, O(m) notifications where m = listeners

**Space:**
- Each entity: ~min 60 bytes (3 Vector3s) in state
- Typical scene: 1000 entities = ~60 KB state overhead

**Optimization Tips:**
- Batch related transforms in single update
- Unsubscribe from changes when no longer needed
- Use view-based lists instead of getAllTransforms for large scenes
- Consider pooling Vector3 objects if needed

## Files

**Core:**
- [Transform.ts](core/Transform.ts) - Main system
- [Entity.ts](core/Entity.ts) - Entity/Transform types
- [EntityManager.ts](core/EntityManager.ts) - Integration
- [Engine.ts](Engine.ts) - Public API

**Examples:**
- [TransformSystemDemo.ts](TransformSystemDemo.ts) - Usage examples
- [This documentation](core/TRANSFORM_SYSTEM.md)

## Migration from Direct Entity Manipulation

If you have existing code that directly modifies entity transforms:

```typescript
// OLD
entity.setPosition({ x: 0, y: 1, z: 0 })

// NEW
const transformSystem = Engine.getTransformSystem()!
transformSystem.setPosition(entity, { x: 0, y: 1, z: 0 })
```

Most code just needs the transform system reference, then swap the API. All local entity changes are automatically kept in sync.

## Troubleshooting

**Q: Why is my transform not updating?**
A: Ensure you're using TransformSystem.setPosition() not entity.setPosition()

**Q: How do I add custom transform data?**
A: Add it to a component on the entity, not to the transform itself. Transform = position/rotation/scale only.

**Q: Can I modify transform coordinates individually?**
A: Yes, get the full vector, modify it, then set it back:
```typescript
const pos = transformSystem.getPosition(entity)
pos.x = 10
transformSystem.setPosition(entity, pos)
```

**Q: How do I sync with networking?**
A: Subscribe to transform changes and send updates:
```typescript
transformSystem.subscribe(entity, (newTransform) => {
  network.broadcast({ entityId: entity.id, transform: newTransform })
})
```

**Q: Does this work with save/load?**
A: Yes! Transforms are automatically saved in StateManager which SaveLoadManager serializes.
