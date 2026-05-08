# Save/Load System

## Overview

The Save/Load System serializes and deserializes world state without touching Three.js rendering objects. It's designed to be:

- **Engine-Agnostic**: Serializes only game data, not rendering internals
- **Extensible**: Easy to add custom entity types or settings
- **Storage Flexible**: Works with localStorage, file I/O, or network transmission
- **Format Simple**: Human-readable JSON, easy to debug and parse

## Architecture

### Core Files

- **SaveLoadManager.ts** - Main serialization/deserialization logic
- **Entity.ts** - Entity type definitions (already existed, used by SaveLoadManager)
- **EntityManager.ts** - Entity registry (already existed, used by SaveLoadManager)

### What Gets Serialized

✅ **Serialized:**
- All entities (id, type, active state)
- Entity transforms (position, rotation, scale)
- Entity components and their data (excluding functions)
- Global settings (fog, lighting, camera, atmosphere, mode)
- Timestamp and version info

❌ **NOT Serialized:**
- Three.js Scene, Camera, Renderer objects
- Mesh geometry and materials
- WebGL state
- Network connections
- UI state

## Data Format

Saved world format:

```json
{
  "version": "1.0",
  "timestamp": 1234567890,
  "entities": [
    {
      "id": "entity_abc123",
      "type": "Player",
      "active": true,
      "transform": {
        "position": { "x": 0, "y": 1, "z": 0 },
        "rotation": { "x": 0, "y": 0, "z": 0 },
        "scale": { "x": 1, "y": 1, "z": 1 }
      },
      "components": {
        "render": { "meshType": "sphere", "color": 16776960 },
        "localPlayer": { "isLocal": true }
      }
    }
  ],
  "settings": {
    "fog": {
      "density": 0.015,
      "color": 1710207,
      "enabled": true
    },
    "lighting": {
      "ambientIntensity": 0.4,
      "directionalIntensity": 0.8
    },
    "camera": {
      "position": { "x": 0, "y": 5, "z": 10 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "fov": 75
    },
    "atmosphericEffects": {
      "fogPulsing": true,
      "lightingFlicker": true,
      "postProcessing": true,
      "cameraEffects": true
    },
    "mode": "editor"
  }
}
```

## API

### SaveLoadManager Class

**Constructor:**
```typescript
new SaveLoadManager(
  entityManager: EntityManager,
  stateManager: StateManager,
  options?: { enableLogging?: boolean }
)
```

**Methods:**

#### Serialization
```typescript
serializeWorld(): SavedWorldState
```
Converts current world state to JSON-compatible object.

#### Deserialization
```typescript
deserializeWorld(saved: SavedWorldState): { entitiesCreated: number; settingsApplied: number }
```
Rebuilds entities and applies settings. **Note:** Does NOT recreate Three.js meshes—call `entityRenderer.syncEntity()` after loading.

#### Storage (localStorage)
```typescript
saveMap(name: string): boolean
loadMap(name: string): { success: boolean; entitiesCreated: number; settingsApplied: number }
listMaps(): string[]
deleteMap(name: string): boolean
getMapInfo(name: string): SavedWorldState | null
```

#### File I/O (JSON)
```typescript
exportMap(name?: string): string
importMap(json: string, name?: string): { success: boolean; entitiesCreated: number; settingsApplied: number }
```

### Engine API

Wrapper methods in `Engine.ts`:

```typescript
// Save/Load
saveMap(name: string): boolean
loadMap(name: string): { success; entitiesCreated; settingsApplied }
listMaps(): string[]
deleteMap(name: string): boolean

// Export/Import JSON
exportMap(name?: string): string
importMap(json: string, name?: string): { success; entitiesCreated; settingsApplied }

// Access
getMapInfo(name: string): SavedWorldState | null
getSaveLoadManager(): SaveLoadManager | null
```

## Usage Examples

### Save World
```typescript
import { saveMap } from './engine/Engine';

// Save current state
const success = saveMap('level-01');
if (success) {
  console.log('✓ World saved');
}
```

### Load World
```typescript
import { loadMap } from './engine/Engine';

// Load a saved state
const result = loadMap('level-01');
if (result.success) {
  console.log(`✓ Loaded ${result.entitiesCreated} entities`);
}
```

### List Saved Worlds
```typescript
import { listMaps } from './engine/Engine';

const maps = listMaps();
console.log('Available worlds:', maps);
```

### Export to File
```typescript
import { exportMap } from './engine/Engine';

// Get JSON string
const json = exportMap();

// Download to user's computer
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'world.json';
a.click();
```

### Import from File
```typescript
import { importMap } from './engine/Engine';

// Handle file input from user
function handleFileSelect(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const json = e.target?.result as string;
    const result = importMap(json, 'imported-level');
    if (result.success) {
      console.log('✓ World imported');
    }
  };
  reader.readAsText(file);
}
```

### Auto-Save Loop
```typescript
import { saveMap } from './engine/Engine';

// Auto-save every 30 seconds
setInterval(() => {
  saveMap(`autosave-${Date.now()}`);
}, 30000);
```

## Key Design Decisions

### 1. No Three.js in Serialized Data
- Meshes are ephemeral—recreated from component data on load
- Three.js objects are not serializable (contain WebGL state)
- This keeps data portable and debuggable

### 2. Components Are Data-First
- Only `component.data` is serialized, not `component.update` functions
- Component logic is reattached on deserialization or by the app
- This allows hot-reloading of logic without losing data

### 3. localStorage for Convenience
- No backend required for basic save/load
- Good for single-player editor workflows
- For multiplayer: export JSON and send to server

### 4. Explicit Mesh Recreation
- After loading, app must call `entityRenderer.syncEntity(entity)`
- This separates concerns: data layer vs. rendering layer
- Allows loading without rendering (e.g., headless servers)

## Extending the System

### Add Custom Entity Data

Edit `SavedEntity` interface in `SaveLoadManager.ts`:

```typescript
export interface SavedEntity {
  // ... existing fields ...
  customField?: any;
}
```

Update `serializeEntity()` to capture custom data:

```typescript
private serializeEntity(entity: Entity): SavedEntity {
  // ... existing code ...
  return {
    // ... existing fields ...
    customField: entity.getComponent('custom')?.data,
  };
}
```

### Add Custom Global Settings

Edit `SavedWorldState` settings:

```typescript
export interface SavedWorldState {
  // ... existing fields ...
  settings: {
    // ... existing settings ...
    custom: {
      myField: string;
    };
  };
}
```

Update serialization in `serializeWorld()`:

```typescript
custom: {
  myField: state.custom?.myField ?? 'default',
}
```

## Storage Considerations

### localStorage Limits
- Browser limit: 5-10 MB per domain
- Good for: small levels, local saves
- Not good for: large worlds, many saves

### Best Practices
- Clean old autosaves periodically
- Use meaningful map names
- Export important saves to files
- Store critical data on backend for multiplayer

### Future: Server Integration
```typescript
// Structure allows easy backend swap:
async function saveMapToServer(name: string, json: string) {
  const response = await fetch('/api/maps', {
    method: 'POST',
    body: JSON.stringify({ name, data: json })
  });
  return response.ok;
}
```

## Testing

See `SaveLoadManagerDemo.ts` for comprehensive examples:

```typescript
// In browser console:
GameAPI.saveMap('test')
GameAPI.loadMap('test')
GameAPI.listMaps()
GameAPI.exportMap()
```

## Debugging

Enable logging:

```typescript
// In Engine.ts initialization:
saveLoadManager = new SaveLoadManager(entityManager, stateManager, {
  enableLogging: true  // See detailed save/load messages
});
```

Console output will show:
- `[SaveLoadManager] Serialized world: X entities`
- `[SaveLoadManager] Saved map: "name" (Y KB)`
- `[SaveLoadManager] Loaded map: "name"`
- `[SaveLoadManager] Deserialized world: X entities, Y settings`

## Files Modified

- **Engine.ts** - Added saveLoadManager instance, new API methods
- **SaveLoadManager.ts** - New file, core save/load logic
- **SaveLoadManagerDemo.ts** - New file, examples and testing utilities
