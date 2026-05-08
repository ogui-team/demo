# Scene Graph System Guide

## Overview

The Scene Graph System manages hierarchical relationships between entities, enabling parent/child transformations and automatic propagation of transforms through the hierarchy.

**Key Features:**
- Hierarchical entity relationships (parent/child)
- Automatic transform propagation from parent to children
- World vs. local transform calculations
- Dynamic reparenting with world transform preservation
- Cycle detection to prevent infinite loops
- Full StateManager integration for consistency

## Architecture

```
SceneGraph
  ├── SceneNode Map (entityId → SceneNode)
  │   └── SceneNode { entityId, parentId?, children[] }
  ├── Entities Map (entityId → Entity)
  └── StateManager integration
```

## Core Concepts

### Local vs. World Transforms

- **Local Transform**: An entity's position/rotation/scale relative to its parent
- **World Transform**: An entity's position/rotation/scale in world space

When an entity has a parent, its local transform is stored in the StateManager relative to the parent. The world transform is calculated by combining all parent transforms up the hierarchy.

### Transform Propagation

When a parent's transform changes, all child transforms are automatically updated to maintain consistency. This is done through the `propagateTransform()` method, which recurses through the entire subtree.

## Usage Examples

### Basic Hierarchy Setup

```typescript
import { getEntityManager, getSceneGraph } from './Engine';

const entityManager = getEntityManager();
const sceneGraph = getSceneGraph();

// Create entities
const parent = entityManager.createEntity('parent');
const child1 = entityManager.createEntity('child1');
const child2 = entityManager.createEntity('child2');

// Build hierarchy
sceneGraph.addChild(parent.id, child1.id);
sceneGraph.addChild(parent.id, child2.id);

// child1 and child2 are now children of parent
```

### Working with World Transforms

```typescript
import { getEntityManager, getSceneGraph } from './Engine';

const sceneGraph = getSceneGraph();

// Get world position of an entity
const worldPos = sceneGraph.getWorldTransform(entityId);
console.log(worldPos.position); // { x, y, z } in world space

// Set world position (automatically adjusts local position)
sceneGraph.setWorldPosition(entityId, { x: 5, y: 3, z: 0 });

// Set world rotation
sceneGraph.setWorldRotation(entityId, { x: 0, y: Math.PI / 2, z: 0 });

// Set world scale
sceneGraph.setWorldScale(entityId, { x: 2, y: 2, z: 2 });
```

### Getting Hierarchy Information

```typescript
import { getSceneGraph } from './Engine';

const sceneGraph = getSceneGraph();

// Get parent of an entity
const parentId = sceneGraph.getParent(entityId);

// Get all direct children
const childIds = sceneGraph.getChildren(parentId);

// Get hierarchy path from root to entity
const path = sceneGraph.getHierarchyPath(entityId);
console.log(path); // [rootId, parentId, entityId]

// Get all entities in subtree (depth-first)
const subtree = sceneGraph.getSubtree(rootId);
console.log(subtree); // [rootId, child1, grandchild1, child2, ...]
```

### Dynamic Reparenting

```typescript
import { getSceneGraph } from './Engine';

const sceneGraph = getSceneGraph();

// Reparent an entity while maintaining world transform
sceneGraph.reparent(entityId, newParentId);

// Unparent an entity (make it a root)
sceneGraph.reparent(entityId); // newParentId is optional
```

### Removing Entities from Hierarchy

```typescript
import { getSceneGraph } from './Engine';

const sceneGraph = getSceneGraph();

// Remove a child from its parent
sceneGraph.removeChild(parentId, childId);

// When destroying an entity, SceneGraph is automatically cleaned up via EntityManager
```

## Integration with Editor and Play Modes

### Selection System Integration

The Selection System can use SceneGraph to:
- Display hierarchy in the inspector
- Highlight parent/child relationships
- Visualize entity trees

```typescript
import { getSceneGraph, getSelectionSystem } from './Engine';

const sceneGraph = getSceneGraph();
const selectionSystem = getSelectionSystem();

// Get hierarchy path for UI display
const selectedEntity = selectionSystem.getSelectedEntity();
if (selectedEntity) {
  const path = sceneGraph.getHierarchyPath(selectedEntity.id);
  console.log('Path:', path); // Display in breadcrumb UI
}
```

### Gizmo System Integration

The Gizmo System uses world transforms from SceneGraph:
- Gizmos display entity position in world space
- Gizmo interactions update world positions
- SceneGraph automatically adjusts local positions

```typescript
import { getGizmoSystem, getSceneGraph } from './Engine';

const gizmoSystem = getGizmoSystem();
const sceneGraph = getSceneGraph();

// When gizmo updates world position:
// gizmoSystem sets world position
// sceneGraph.setWorldPosition() adjusts local position relative to parent
```

### Play Mode Transform Updates

In Play Mode, components can manipulate entities while respecting hierarchy:

```typescript
import { getSceneGraph, getStateManager } from './Engine';

const sceneGraph = getSceneGraph();
const stateManager = getStateManager();

// Move entity in world space (world transform)
sceneGraph.setWorldPosition(entityId, newWorldPos);

// Move entity relative to parent (local transform)
const entity = entityManager.getEntity(entityId);
if (entity) {
  const currentLocal = entity.getTransform().position;
  entity.setPosition({
    x: currentLocal.x + deltaX,
    y: currentLocal.y + deltaY,
    z: currentLocal.z + deltaZ,
  });
  stateManager.set(`entities.${entityId}.position`, entity.getPosition());
}
```

## Performance Considerations

### Efficient Lookups

- O(1) lookup for entity → node mapping via Map
- O(n) for getting full subtree (where n = subtree size)
- O(h) for hierarchy path (where h = tree height)

### Minimizing Iterations

- Transform propagation is lazy (only called when transforms change)
- Use `getSubtree()` sparingly; cache results if needed
- Avoid deep nesting (keep tree height reasonable)

### Optimization Tips

1. **Batch operations**: Group multiple parent/child operations when possible
2. **Avoid circular hierarchies**: SceneGraph detects cycles, but prevention is faster
3. **Cache hierarchy information**: If you frequently query the same path, cache the result
4. **Use local transforms in Play mode**: When possible, modify local transforms instead of world transforms (cheaper calculation)

## Debugging

### Print Hierarchy

```typescript
import { getSceneGraph } from './Engine';

const sceneGraph = getSceneGraph();

// Print entire scene hierarchy to console
sceneGraph.debugPrintHierarchy();

// Output:
// [SceneGraph] Hierarchy:
// - rootEntity1
//   - child1
//     - grandchild1
//   - child2
// - rootEntity2
```

### State Manager Integration

All hierarchy data is stored in StateManager:
```typescript
// Parent ID of entity
stateManager.get(`entities.${entityId}.parentId`);

// Children of entity
stateManager.get(`entities.${entityId}.children`);
```

## Common Patterns

### Creating a Game Object with Children

```typescript
const player = entityManager.createEntity('character');
const weaponModel = entityManager.createEntity('model');
const weaponCollider = entityManager.createEntity('collider');

// Attach weapon parts to player
sceneGraph.addChild(player.id, weaponModel.id);
sceneGraph.addChild(player.id, weaponCollider.id);

// All weapon parts follow player
sceneGraph.setWorldPosition(player.id, { x: 0, y: 2, z: 0 });
// weaponModel and weaponCollider automatically update
```

### Switching Ownership

```typescript
// Transfer child from one parent to another
sceneGraph.reparent(childId, newParentId);

// This maintains world position while changing parent
```

### Camera Following Entity

```typescript
// Camera follows entity's world position
const targetEntity = entityManager.getEntity(targetId);
if (targetEntity) {
  const worldPos = sceneGraph.getWorldTransform(targetId);
  camera.position.set(worldPos.position.x, worldPos.position.y + 5, worldPos.position.z + 10);
}
```

## Best Practices

1. **Always register entities**: EntityManager automatically registers with SceneGraph
2. **Use world transforms from SceneGraph**: Don't calculate them manually
3. **Let StateManager handle persistence**: SceneGraph data is automatically saved/loaded
4. **Avoid deep nesting**: Keep trees shallow for performance (ideally < 10 levels)
5. **Use meaningful parent/child relationships**: Ensure hierarchy reflects logical grouping
6. **Test cycle detection**: SceneGraph prevents cycles, but validate your hierarchy logic
7. **Cache frequently accessed paths**: If getting the same hierarchy path multiple times, cache it

## Troubleshooting

### Children Not Following Parent
- Ensure `propagateTransform()` is called after parent transform changes
- Check StateManager for correct parentId and children arrays
- Verify children are registered in SceneGraph

### Transform Not Applying
- Check entity is registered with StateManager
- Verify entity is active (not destroyed)
- Use `getWorldTransform()` to verify current state

### Cycle Detected Error
- Review hierarchy logic; can't make A parent of B if B is parent of A
- Use `getHierarchyPath()` to check current relationships
- Ensure reparenting logic doesn't create cycles

## Future Enhancements

- [ ] Incremental transform updates (don't recalculate entire subtrees)
- [ ] Spatial partitioning for queries
- [ ] Batch hierarchy operations for performance
- [ ] Serialization format for saving/loading hierarchies
- [ ] Visualization tools for debugging hierarchies
