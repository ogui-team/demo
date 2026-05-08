# GizmoSystem Integration Guide

## Overview

The **GizmoSystem** provides interactive 3D transform manipulation gizmos for selected entities in the editor. It works seamlessly with SelectionSystem to offer an Unreal Engine-like workflow for moving, rotating, and scaling objects.

## Architecture

### Core Components

**GizmoSystem.ts**
- Manages visual gizmo representation (arrows/handles for each axis)
- Handles mouse drag interactions on gizmo axes
- Updates entity transforms exclusively through StateManager
- Subscribes to SelectionSystem events
- Automatically enabled/disabled based on editor mode

**Integration Stack**
```
SelectionSystem
      ↓ (onSelect event)
GizmoSystem
      ↓ (updates via StateManager)
Entity Transform
      ↓ (syncs to)
EntityRenderer → Three.js Mesh
```

## How It Works

### 1. Entity Selection
User clicks on an entity in the 3D view via SelectionSystem

### 2. Gizmo Attachment
SelectionSystem notifies GizmoSystem via `onSelect()` callback
```typescript
selectionSystem.onSelect((entityId: string) => {
  gizmoSystem.attachEntity(entityId);
});
```

### 3. Visual Representation
GizmoSystem creates color-coded axis handles:
- **Red arrow** = X axis
- **Green arrow** = Y axis
- **Blue arrow** = Z axis

### 4. Drag Interaction
User drags an axis arrow to transform:
- **Translate mode**: Move along the axis
- **Rotate mode**: Rotate around the axis
- **Scale mode**: Scale along the axis

### 5. StateManager Update
All transform changes go through StateManager:
```typescript
stateManager.set('entities.{id}.position', newPos);
stateManager.set('entities.{id}.rotation', newRot);
stateManager.set('entities.{id}.scale', newScale);
```

### 6. Mesh Sync
EntityRenderer automatically syncs the mesh position/rotation from StateManager

## API Reference

### GizmoSystem Class

```typescript
constructor(
  scene: THREE.Scene,
  stateManager: StateManager,
  modeManager: ModeManager,
  camera: THREE.Camera,
  config?: {
    enableLogging?: boolean;
    gizmoSize?: number;
    axisLength?: number;
    lineMaterial?: THREE.LineBasicMaterial;
    highlightMaterial?: THREE.LineBasicMaterial;
  }
)
```

### Methods

```typescript
// Lifecycle
enable(): void
disable(): void
destroy(): void

// Entity management
attachEntity(entity: Entity | string): void
detachEntity(): void

// Gizmo mode control
setMode(mode: 'translate' | 'rotate' | 'scale'): void
getMode(): GizmoMode
```

## Usage Examples

### Basic Setup (Automatic)

The GizmoSystem is automatically initialized and integrated:

```typescript
// In Engine.init()
gizmoSystem = new GizmoSystem(scene, stateManager, modeManager, camera, {
  enableLogging: false,
  gizmoSize: 1,
  axisLength: 2,
});

// Automatically connected to SelectionSystem
selectionSystem.onSelect((entityId) => gizmoSystem.attachEntity(entityId));
```

### Programmatic Attachment

```typescript
const gizmoSystem = Engine.getGizmoSystem();

// Attach to entity
gizmoSystem?.attachEntity(entityId);

// Switch mode
gizmoSystem?.setMode('rotate');

// Detach
gizmoSystem?.detachEntity();
```

### Mode Cycling

```typescript
const gizmoSystem = Engine.getGizmoSystem();
const currentMode = gizmoSystem?.getMode();

const modes: GizmoMode[] = ['translate', 'rotate', 'scale'];
const nextMode = modes[(modes.indexOf(currentMode!) + 1) % modes.length];
gizmoSystem?.setMode(nextMode);
```

## Transform Workflow

### Translate Mode
```
User drags X arrow
    ↓
raycaster.intersectObjects() detects hit
    ↓
dragPlane calculated perpendicular to X axis
    ↓
mouse movement tracked on drag plane
    ↓
delta.x applied to entity.position
    ↓
StateManager.set('entities.{id}.position', {x: oldX + deltaX, y: oldY, z: oldZ})
    ↓
EntityRenderer syncs and updates mesh position
```

### Rotate Mode
```
User drags Y arrow
    ↓
rotation detected around Y axis
    ↓
angle calculated from drag delta
    ↓
rotation.y += angleChange
    ↓
StateManager.set('entities.{id}.rotation', {x: oldX, y: oldY + angle, z: oldZ})
    ↓
Mesh rotation quaternion updated
```

### Scale Mode
```
User drags Z arrow
    ↓
scale multiplier calculated from drag distance
    ↓
scale.z *= multiplier (clamped to min 0.1)
    ↓
StateManager.set('entities.{id}.scale', {x: oldX, y: oldY, z: oldZ * mult})
    ↓
Mesh scale property updated
```

## Integration with SelectionSystem

### Automatic Connection
EditorMenu automatically connects the two systems:

```typescript
export class EditorMenu {
  constructor() {
    const selectionSystem = Engine.getSelectionSystem();
    if (selectionSystem) {
      selectionSystem.onSelect((entityId: string) => {
        const gizmoSystem = Engine.getGizmoSystem();
        if (gizmoSystem) {
          gizmoSystem.attachEntity(entityId);
        }
      });
    }
  }
}
```

### Custom Integration
Systems can independently respond to gizmo events:

```typescript
export class CustomSystem {
  private gizmoSystem: GizmoSystem;

  constructor() {
    this.gizmoSystem = Engine.getGizmoSystem()!;
  }

  onGizmoModeChange(mode: GizmoMode) {
    console.log('Gizmo mode changed to:', mode);
    // Custom logic
  }
}
```

## Mode Management

### Automatic Mode Control

GizmoSystem respects the engine's mode system:

```typescript
// Editor Mode
// → GizmoSystem.enable()
// → Gizmos are visible and interactive

// Play Mode
// → GizmoSystem.disable()
// → Gizmos are hidden
// → Input doesn't interact with transforms
```

### Manual Mode Control

```typescript
const gizmoSystem = Engine.getGizmoSystem();
const modeManager = Engine.getModeManager();

modeManager?.switchMode('editor');  // GizmoSystem auto-enables
gizmoSystem?.setMode('translate');  // Set initial mode

// User starts manipulating...

modeManager?.switchMode('play');    // GizmoSystem auto-disables
```

## Visual Feedback

### Axis Indicators
- Colored arrows for each axis (R/G/B)
- Size adjustable via `gizmoSize` config
- Length adjustable via `axisLength` config

### Dragging Feedback
- Gizmo position follows entity in real-time
- Visual update as user drags
- Smooth synchronization with StateManager

### Mode-Specific Visuals
- **Translate**: Three-directional arrows
- **Rotate**: Rotation indicator arrows
- **Scale**: Smaller scale-handle arrows

## Performance Considerations

### Raycasting
- Only tests against gizmo arrows (not full scene)
- Raycaster updated on mouse move, not every frame
- Efficient intersection calculation

### Transform Updates
- Changes batched through StateManager
- Single state update per drag operation
- Minimal mesh updates through renderer

### Memory
- Gizmos created on-demand (per entity)
- Cleaned up on deselection
- No persistent geometry for hidden gizmos

## Extensibility

### Custom Gizmo Modes

Extend GizmoSystem for additional manipulation modes:

```typescript
export class ExtendedGizmoSystem extends GizmoSystem {
  setMode(mode: GizmoMode | 'skew' | 'custom') {
    if (mode === 'skew') {
      this.showSkewGizmo();
    } else {
      super.setMode(mode as GizmoMode);
    }
  }

  private showSkewGizmo(): void {
    // Custom skew handle visualization
  }
}
```

### Custom Drag Handlers

Add specialized interaction logic:

```typescript
export class SnapGizmoSystem extends GizmoSystem {
  private snapDistance = 0.5;

  applyTranslation(delta: THREE.Vector3): void {
    // Snap to grid before update
    delta.x = Math.round(delta.x / this.snapDistance) * this.snapDistance;
    delta.y = Math.round(delta.y / this.snapDistance) * this.snapDistance;
    delta.z = Math.round(delta.z / this.snapDistance) * this.snapDistance;

    super.applyTranslation(delta);
  }
}
```

## Debugging

### Enable Logging

```typescript
const gizmoSystem = new GizmoSystem(scene, stateManager, modeManager, camera, {
  enableLogging: true  // Verbose logging
});
```

Logs will show:
- Gizmo attachment/detachment
- Mode changes
- Drag start/end
- Axis selections

### Verify StateManager Updates

```typescript
const stateManager = Engine.getStateManager();
const position = stateManager?.get('entities.{entityId}.position');
console.log('Current position:', position);
```

## Summary

The GizmoSystem provides:
✓ Interactive 3D transform gizmos
✓ Intuitive axis-based manipulation
✓ StateManager integration for all changes
✓ SelectionSystem automatic connection
✓ Editor-mode-only operation
✓ Extensible architecture
✓ Performance-optimized raycasting
✓ Clean separation of concerns

The workflow is smooth and familiar to game developers:
1. **Click** entity to select (SelectionSystem)
2. **Gizmo appears** at entity (GizmoSystem)
3. **Drag** axis arrow to transform
4. **Release** to finalize (StateManager syncs)
5. **View updates** in 3D (EntityRenderer)
