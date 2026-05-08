# State Manager Architecture

## Overview

The State Manager is a unified central state layer that all engine systems read from and write to in a controlled manner. It replaces ad-hoc direct system-to-system communication with a clean, decoupled architecture.

**Core Principle**: All engine data flows through the state manager. No system should directly modify another system's internal data.

## Architecture

### Central State Structure

```typescript
{
  mode: 'editor' | 'play',
  
  camera: {
    position: { x, y, z },
    rotation: { x, y, z },
    fov: number
  },
  
  fog: {
    density: number,
    color: number,
    enabled: boolean
  },
  
  lighting: {
    ambientIntensity: number,
    directionalIntensity: number
  },
  
  atmosphericEffects: {
    fogPulsing: boolean,
    lightingFlicker: boolean,
    postProcessing: boolean,
    cameraEffects: boolean
  },
  
  debug: {
    enabled: boolean,
    visible: boolean
  }
}
```

### Core Components

#### 1. StateManager
**File**: `src/engine/StateManager.ts`

Central store for all engine data with controlled access patterns.

**Key Responsibilities**:
- Store immutable state (deep frozen)
- Provide get/set/update methods
- Manage subscriptions
- Prevent direct mutations
- Notify subscribers of changes

**Public API**:
```typescript
get(path: string): StateValue
getState(path?: string): Record<string, any>
set(path: string, value: StateValue): boolean
update(updates: Record<string, StateValue>): Record<string, boolean>
subscribe(path: string, callback: (newValue, oldValue) => void): () => void
onUpdate(callback: (changes) => void): () => void
snapshot(): Record<string, any>
```

#### 2. CameraStateAdapter
**File**: `src/engine/CameraStateAdapter.ts`

Bridges between Three.js camera and state manager. Ensures bidirectional synchronization.

**Responsibilities**:
- Keep state synchronized with Three.js camera
- React to state changes and update camera
- Prevent circular updates with syncing flag

**Usage**:
```typescript
const adapter = getCameraStateAdapter();
adapter.syncCameraToState();          // Push camera position to state
adapter.initializeFromState();        // Initialize from state values
```

## Data Flow Architecture

```
User Input (Keyboard/Mouse)
    ↓
Controller (EditorController / PlayController)
    ↓
Updates Three.js Camera
    ↓
syncCameraToState() via Adapter
    ↓
StateManager.set("camera.position.*")
    ↓
Subscribers Notified
    ↓
Systems React (Fog, Lighting, etc.)
```

## System Integration Example

### How Fog System Connects

```typescript
// In Engine.ts initialization:
const stateManager = initStateManager(initialState);

// Subscribe fog system to state changes
stateManager.subscribe('fog.density', (value: any) => {
  setFogDensity(value);
});

stateManager.subscribe('fog.color', (value: any) => {
  setFogColor(value);
});

// When debug UI changes fog density:
stateManager.set('fog.density', 0.025);
// → Automatically triggers subscription callback
// → Fog system receives update via setFogDensity()
```

### How Camera Movement Works (Fixed)

```typescript
// EditorController.ts update() method:
update(deltaTime: number): void {
  if (!this.enabled || !this.camera) return;
  
  // Calculate movement...
  this.camera.position.addScaledVector(forward, actualSpeed);
  
  // IMPORTANT: Sync camera to state after modifications
  const adapter = getCameraStateAdapter();
  if (adapter) {
    adapter.syncCameraToState();
  }
  
  // This triggers:
  // stateManager.update({
  //   'camera.position.x': newX,
  //   'camera.position.y': newY,
  //   'camera.position.z': newZ
  // })
}
```

## Path-Based Access

StateManager uses dot notation for paths:

```typescript
// Getting values
stateManager.get('camera.position.x');     // 5
stateManager.get('fog.density');           // 0.015
stateManager.get('lighting');              // { ambientIntensity: 0.4, ... }

// Setting values
stateManager.set('camera.position.x', 10);
stateManager.set('fog.color', 0xff0000);

// Batch updates
stateManager.update({
  'camera.position.x': 10,
  'camera.position.y': 5,
  'fog.density': 0.020
});
```

## Immutability & Deep Freeze

State is deeply frozen to prevent mutations:

```typescript
const state = stateManager.getState();
state.camera.position.x = 999;  // Error: Cannot assign to read only property
state.fog.density = 0.5;         // Error: Cannot assign to read only property

// CORRECT: Use state manager methods
stateManager.set('camera.position.x', 999);
stateManager.set('fog.density', 0.5);
```

## Subscriptions

### Single Path Subscription

```typescript
const unsubscribe = stateManager.subscribe('fog.density', (newValue, oldValue) => {
  console.log(`Fog density changed: ${oldValue} → ${newValue}`);
  updateFogSystem(newValue);
});

// Later: unsubscribe
unsubscribe();
```

### Batch Changes Notification

```typescript
stateManager.onUpdate((changes) => {
  console.log('State changed:', changes);
  // changes = { 'camera.position.x': 5, 'camera.position.y': 6, ... }
});
```

### Parent Path Subscriptions

Subscribing to a parent path receives updates when any child changes:

```typescript
// Subscribe to entire camera object
stateManager.subscribe('camera', (newCamera, oldCamera) => {
  // Called when ANY camera property changes
  updateCameraDisplay(newCamera);
});
```

## Engine API

The Engine module exports state management functions:

```typescript
// Get state
const cameraState = Engine.getEngineState('camera');
const allState = Engine.getEngineState();

// Set state
Engine.setEngineState('fog.density', 0.02);

// Batch updates
Engine.updateEngineState({
  'fog.density': 0.02,
  'fog.color': 0x1a1a1a
});

// Subscribe
const unsub = Engine.subscribeToEngineState('fog.density', (value) => {
  console.log('Fog density:', value);
});
```

## Fixing the Camera Movement Bug

The "snap back" issue was caused by:
1. Controllers modified Three.js camera directly
2. No synchronization back to state
3. Other systems reading stale state
4. Competing updates from different sources

**Solution**:
1. Controllers now sync camera to state after each update
2. CameraStateAdapter ensures bidirectional sync
3. State is the source of truth
4. All systems read from state, not directly from Three.js

## Performance Considerations

### State Freezing
- Deep freeze prevents accidental mutations
- Tiny overhead (~1-2ms for initial freeze)
- No runtime cost - frozen state doesn't slow access

### Subscriptions
- Lazy notification - only called when subscribed paths change
- Efficient path matching - O(1) lookup for direct paths
- Parent path notification - propagates to parent subscriptions

### Batching
- `update()` batches multiple changes
- Single notification cycle for multiple changes
- Efficient for multi-system updates

### Memory
- State object is shallow cloned for get()
- Deep clone only for values stored
- Minimal overhead - ~1-2KB for typical engine state

## System Integration Checklist

When adding a new system that needs state:

1. **Define state structure** - Add properties to initialState in Engine.ts
2. **Create subscriptions** - Subscribe to relevant paths in Engine.init()
3. **Implement adapter** - Create a StateAdapter if system needs bidirectional sync
4. **Debug UI binding** - Expose path setters to debug panel
5. **Document paths** - List all state paths used by system

## Example: Adding a New System

### 1. Define State
```typescript
// In createInitialState():
particles: {
  enabled: boolean,
  emissionRate: number,
  color: number
}
```

### 2. Create Subscriptions
```typescript
// In Engine.init():
stateManager.subscribe('particles.emissionRate', (value: any) => {
  particleSystem.setEmissionRate(value);
});
```

### 3. Sync to State
```typescript
// In ParticleSystem:
update(deltaTime: number) {
  // ... particle logic ...
  
  // Sync state back
  stateManager.set('particles.emissionRate', this.currentRate);
}
```

### 4. Debug UI Binding
```typescript
debugManager.addParameter('Particles', {
  id: 'particle_rate',
  name: 'Emission Rate',
  type: 'slider',
  min: 0,
  max: 1000,
  step: 10,
  get: () => Engine.getEngineState('particles.emissionRate'),
  set: (value) => Engine.setEngineState('particles.emissionRate', value)
});
```

## Troubleshooting

**State changes not reflected?**
- Check subscription path matches exactly
- Verify callback is being called (add console.log)
- Ensure set() is called, not mutation

**Circular updates?**
- Use syncing flag to prevent re-triggering
- See CameraStateAdapter.syncCameraToState() pattern

**Performance issues?**
- Reduce subscription frequency
- Batch related updates in single update() call
- Profile with DevTools to identify heavy subscribers

## Future Enhancements

The state architecture supports:
- **Undo/Redo**: History stack of state snapshots
- **Network Sync**: Send state deltas over WebSocket
- **Persistence**: Save/load state from storage
- **Time Travel**: Debug by replaying state changes
- **Prediction**: Optimistic updates for multiplayer

## Summary

The State Manager provides:
- **Centralized source of truth** for all engine data
- **Clean API** for getting/setting/subscribing
- **Decoupled systems** that communicate through state
- **Immutability** to prevent bugs from mutations
- **Extensibility** for future features (undo, networking, etc.)
- **Debugging** with snapshots and change tracking

This architecture makes the engine more maintainable, testable, and powerful for gameplay mechanics and multiplayer support.
