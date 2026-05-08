# SelectionSystem Integration Guide

## Overview

The **SelectionSystem** is a fully integrated component-based selection system for the PS1-styled 3D game engine. It enables mouse-based entity selection via raycasting and provides a subscription API for other systems to respond to selection events.

## Architecture

### Core Components

**SelectionSystem.ts**
- Uses THREE.js raycasting to detect entity clicks
- Only active in Editor mode (automatically toggled by ModeManager)
- Tracks mouse position and input
- Maintains selection state
- Emits selection/deselection events

**Integration Points**
- **Engine.ts**: Initializes SelectionSystem and manages lifecycle
- **ModeManager**: Automatically enables/disables based on editor/play mode
- **EditorMenu**: Receives selection events to update UI and gizmo
- **EntityRenderer**: Tags meshes with entity IDs for raycasting

## How It Works

1. **Mouse Tracking**
   - SelectionSystem tracks mouse position in normalized device coordinates
   - Updates raycaster orientation with each mouse move

2. **Click Detection**
   - On left mouse click, raycaster fires from camera through mouse position
   - Checks if click hit any entity meshes
   - Ignores UI elements and non-editor mode

3. **Entity Selection**
   - When raycast hits a mesh, extracts entity ID from:
     - Mesh name pattern: `entity_{entityId}`
     - Mesh userData: `mesh.userData.entityId`
   - Updates selection state and notifies subscribers

4. **Editor Integration**
   - EditorMenu subscribes to `SelectionSystem.onSelect()` events
   - When entity is selected via click, EditorMenu.selectEntity() is called
   - TransformGizmo attaches to selected entity automatically

## API Reference

### SelectionSystem Class

```typescript
constructor(
  scene: THREE.Scene,
  entityManager: EntityManager,
  modeManager: ModeManager,
  camera: THREE.Camera,
  config?: { enableLogging?: boolean; raycastDistance?: number }
)
```

### Methods

```typescript
// Enable/disable system
enable(): void
disable(): void

// Selection management
selectEntity(entityId: string): void
deselect(): void

// Get selection state
getSelected(): string | null
getSelectedEntity(): Entity | null

// Subscriptions
onSelect(callback: (entityId: string) => void): () => void  // Returns unsubscribe
onDeselect(callback: (entityId: string) => void): () => void

// Cleanup
destroy(): void
```

## Usage Examples

### Basic Usage (Automatic)

The SelectionSystem is automatically initialized and managed by the Engine:

```typescript
// In Engine.init()
selectionSystem = new SelectionSystem(scene, entityManager, modeManager, camera);

// Automatically enabled/disabled based on mode
// In editor mode: SelectionSystem is active
// In play mode: SelectionSystem is disabled
```

### Subscribing to Selection Events

```typescript
const selectionSystem = Engine.getSelectionSystem();

// Listen for selections
const unsubscribeSelect = selectionSystem!.onSelect((entityId: string) => {
  console.log('User selected entity:', entityId);
  // Custom logic here
});

// Listen for deselections
const unsubscribeDeselect = selectionSystem!.onDeselect((entityId: string) => {
  console.log('User deselected entity:', entityId);
});

// Unsubscribe when done
unsubscribeSelect();
unsubscribeDeselect();
```

### Getting Current Selection

```typescript
const selectionSystem = Engine.getSelectionSystem();
const selectedEntityId = selectionSystem?.getSelected();
const selectedEntity = selectionSystem?.getSelectedEntity();
```

## EditorMenu Integration

The EditorMenu automatically connects to SelectionSystem:

```typescript
// In EditorMenu.constructor()
const selectionSystem = Engine.getSelectionSystem();
if (selectionSystem) {
  selectionSystem.onSelect((entityId: string) => {
    const entityManager = Engine.getEntityManager();
    const entity = entityManager?.getEntity(entityId);
    if (entity) {
      this.selectEntity(entity);  // Selects in UI and attaches gizmo
    }
  });
}
```

## Workflow: Selecting Objects

1. **User clicks on an object in the scene (Editor mode)**
   ↓
2. **SelectionSystem.onMouseDown() is triggered**
   ↓
3. **Raycast is performed from camera through mouse position**
   ↓
4. **Hit detection finds entity mesh**
   ↓
5. **Entity ID is extracted and selection is updated**
   ↓
6. **SelectionSystem notifies subscribers (EditorMenu)**
   ↓
7. **EditorMenu.selectEntity() is called**
   ↓
8. **TransformGizmo attaches to selected entity**
   ↓
9. **Properties panel updates with entity info**

## Implementation Details

### Mesh Identification

Meshes are tagged with entity ID in EntityRenderer.ts:
```typescript
mesh.name = `entity_${entity.id}`;
mesh.userData.entityId = entity.id;
```

This allows SelectionSystem to trace any mesh back to its entity.

### Mode-Based Activation

SelectionSystem is automatically toggled by ModeManager:

```typescript
modeManager.registerListener({
  onEnterEditor: () => {
    if (selectionSystem) selectionSystem.enable();
  },
  onExitEditor: () => {
    if (selectionSystem) selectionSystem.disable();
  },
  onEnterPlay: () => {
    if (selectionSystem) selectionSystem.disable();
  },
});
```

This prevents selection interference during play mode.

### Performance Considerations

- **Selective Raycasting**: Only tests against selectable entity meshes (not static geometry)
- **Lazy Updates**: Raycaster only updated on mouse move (not every frame)
- **Deferred Callbacks**: Subscriptions called safely with error handling
- **Clean Unsubscription**: Subscribers can unsubscribe at any time

## UI Interaction Protection

SelectionSystem ignores clicks on:
- Editor Menu (#editor-menu)
- Gizmo Mode Indicator (#gizmo-mode-indicator)
- Input fields, buttons, textareas

This prevents accidentally selecting objects while interacting with the UI.

## Extensibility

### Adding Custom Selection Subscribers

Any system can subscribe to selection events:

```typescript
export class CustomSystem {
  private unsubscribes: Array<() => void> = [];

  constructor() {
    const selectionSystem = Engine.getSelectionSystem();
    if (selectionSystem) {
      this.unsubscribes.push(
        selectionSystem.onSelect((entityId) => this.onEntitySelected(entityId)),
        selectionSystem.onDeselect((entityId) => this.onEntityDeselected(entityId))
      );
    }
  }

  private onEntitySelected(entityId: string): void {
    console.log('Custom system: Entity selected', entityId);
  }

  private onEntityDeselected(entityId: string): void {
    console.log('Custom system: Entity deselected', entityId);
  }

  destroy(): void {
    // Clean up subscriptions
    this.unsubscribes.forEach(unsub => unsub());
  }
}
```

## Debugging

Enable logging in development:

```typescript
selectionSystem = new SelectionSystem(
  scene,
  entityManager,
  modeManager,
  camera,
  { enableLogging: true }  // Verbose logging
);
```

Logs will show:
- System initialization/cleanup
- Entity selection/deselection
- Mouse click detection
- Unknown entity warnings

## Summary

The SelectionSystem provides:
✓ Mouse-based raycasting for entity selection
✓ Editor-mode-only activation (play-mode safe)
✓ Subscription API for responsive systems
✓ Seamless EditorMenu integration
✓ Transform gizmo support
✓ Performance-optimized raycasting
✓ Clean, modular architecture
