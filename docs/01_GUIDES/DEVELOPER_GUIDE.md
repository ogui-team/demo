# Developer Guide - Domain-Driven Architecture

## Quick Reference

### Adding a New System

1. Identify the domain (usually `gameplay/systems/` for game logic)
2. Create your system file: `src/engine/gameplay/systems/MySystem.ts`
3. Export from domain barrel: Add `export * from './MySystem';` to `src/engine/gameplay/systems/index.ts`
4. Register with engine in appropriate bootstrap file

### Example: Adding a New Gameplay System

```typescript
// src/engine/gameplay/systems/MyNewSystem.ts
import type { SystemContext, SystemCapabilities } from '../../core/SystemHealthCorridor';

export class MyNewSystem {
  constructor(private context: SystemContext) {}
  
  update(dt: number): void {
    // Your logic here
  }
  
  getCapabilities(): SystemCapabilities {
    return {
      id: 'myNewSystem',
      exposesDebug: false,
      hasDebugIntegration: false,
    };
  }
}

export function createMyNewSystem(context: SystemContext): MyNewSystem {
  return new MyNewSystem(context);
}
```

### Importing Between Domains

**From gameplay to UI:**
```typescript
// In ui/HUDSystem.ts
import { HealthSystem } from '../../gameplay/systems/HealthSystem';
import { WeaponSystem } from '../../gameplay/systems/WeaponSystem';
```

**From diagnostics to any domain:**
```typescript
// In diagnostics/debug/DebugManager.ts
import { getSystem } from '../../core/SystemRegistry';
import { gameBus } from '../../core/EventBus';
```

## Domain-by-Domain Guide

### Core Domain (`core/`)
**Purpose**: Fundamental engine utilities and services
**Key Classes**:
- `EntityManager`: Entity lifecycle management
- `EventBus`: Global event dispatcher
- `SystemRegistry`: System metadata
- `FeatureManager`: Feature toggles

**When to use**: For foundational features that many domains depend on

```typescript
import { EntityManager } from '../../core/EntityManager';
import { gameBus } from '../../core/EventBus';
```

### Foundation Domain (`foundation/`)
**Purpose**: Engine bootstrapping, game loop, app state
**Key Classes**:
- `Engine`: Main engine singleton
- `GameLoop`: Update/render loop
- `StateManager`: Application state (play, edit, menu, etc.)
- `PlayController`: Player input bridging

**When to use**: For engine lifecycle and global state

```typescript
import * as Engine from '../../foundation/Engine';
import { getStateManager } from '../../foundation/state/StateManager';
```

### Gameplay Domain (`gameplay/`)
**Purpose**: All game logic, modes, systems, and Ability System
**Subdirectories**:
- `game/`: Game modes, player systems
- `systems/`: Gameplay mechanics (combat, health, etc.)
- `systems/gas/`: Gameplay Ability System
- `systems/2d/`: 2D rendering systems
- `modes/`: Game mode implementations

**When to use**: For anything related to game mechanics

```typescript
import { GameModeSystem } from '../../gameplay/game/GameModeSystem';
import { HealthSystem } from '../../gameplay/systems/HealthSystem';
import { AbilitySystem } from '../../gameplay/systems/gas/AbilitySystem';
```

### Network Domain (`network/`)
**Purpose**: Multiplayer, networking, replication, authority
**Key Classes**:
- `MultiplayerClient`: WebSocket connection
- `NetworkSyncSystem`: Entity synchronization
- `CollisionAuthoritySystem`: Authoritative collision handling

**When to use**: For multiplayer features and network synchronization

```typescript
import { MultiplayerClient } from '../../network/MultiplayerClient';
import { NetworkSyncSystem } from '../../network/NetworkSyncSystem';
```

### Render Domain (`render/`)
**Purpose**: 3D rendering and scene management
**Key Classes**:
- `Renderer`: Three.js wrapper
- `Scene`: Scene graph management
- `Camera`: Camera transformation

**When to use**: For rendering and visualization

```typescript
import { Renderer } from '../../render/Renderer';
import { addToScene, removeFromScene } from '../../render/Scene';
```

### UI Domain (`ui/`)
**Purpose**: User interface, menus, HUD, overlays
**Key Classes**:
- `MainMenu`: Main menu implementation
- `HUDSystem`: In-game HUD
- `ServerBrowser`: Multiplayer server list
- `UICompositionCoordinator`: UI orchestration

**When to use**: For UI, menus, and player-facing elements

```typescript
import { MainMenu } from '../../ui/MainMenu';
import { HUDSystem } from '../../ui/HUDSystem';
```

### Editor Domain (`editor/`)
**Purpose**: Level editor and development tools
**Key Classes**:
- `EditorController`: Editor mode management
- `SelectionSystem`: Entity selection
- `GizmoSystem`: Transform gizmos

**When to use**: For editor-only functionality (check mode before use!)

```typescript
import { SelectionSystem } from '../../editor/tools/SelectionSystem';
import { GizmoSystem } from '../../editor/tools/GizmoSystem';
```

### Diagnostics Domain (`diagnostics/`)
**Purpose**: Debug features, profiling, validation
**Key Classes**:
- `DebugManager`: Debug UI and panels
- `RuntimeDiagnosticsCoordinator`: Runtime diagnostics
- `RuntimeMetricsReporter`: Performance metrics

**When to use**: For debugging and development (can be disabled in production)

```typescript
import { DebugManager } from '../../diagnostics/debug/DebugManager';
import { validateEngineRuntime } from '../../diagnostics/debug/SystemValidator';
```

### Runtime Domain (`runtime/`)
**Purpose**: Runtime coordinators that orchestrate complex flows
**Key Classes**:
- `ClientWorldRuntimeCoordinator`: World initialization
- `MultiplayerRuntimeCoordinator`: Multiplayer setup
- `RuntimeOverlayCoordinator`: UI overlays during gameplay

**When to use**: For complex initialization sequences and runtime management

```typescript
import { ClientWorldRuntimeCoordinator } from '../../runtime/coordinators/ClientWorldRuntimeCoordinator';
```

## Design Patterns Used

### Entity Component System (ECS)
```typescript
// Create entity
const player = entityManager.createEntity('Player', {
  position: { x: 0, y: 1, z: 0 },
});

// Add components
player.addComponent({
  name: 'health',
  data: { hp: 100, maxHp: 100 },
});

// Access from systems
const health = player.getComponent('health');
```

### Service Locator
```typescript
// Instead of dependency injection everywhere
import { getSystem } from '../../core/SystemRegistry';

const healthSystem = getSystem('HealthSystem');
```

### Observer Pattern (Event Bus)
```typescript
// Subscribe to events
import { gameBus } from '../../core/EventBus';

gameBus.on('player:damaged', ({ amount, source }) => {
  console.log(`Took ${amount} damage from ${source}`);
});

// Emit events
gameBus.emit('player:damaged', { amount: 10, source: 'enemy' });
```

### Coordinator Pattern
```typescript
// Complex workflows are handled by coordinators
// Example: MultiplayerRuntimeCoordinator handles the entire multiplayer setup
```

## Common Tasks

### Initialize a New Domain
1. Create directory: `src/engine/myDomain/`
2. Create barrel file: `src/engine/myDomain/index.ts`
3. Add exports as you create files:
   ```typescript
   // src/engine/myDomain/index.ts
   export * from './MyClass';
   export * from './MyFunction';
   ```
4. Update main engine barrel: Add to `src/engine/index.ts`

### Add a Debug Panel
1. Create component in `diagnostics/debug/`: `MyDebugPanel.ts`
2. Export from `diagnostics/debug/index.ts`
3. Register in `RegisterMainDebugBindings` or `RegisterDeveloperConsoleCommands`

### Add a New Game Mode
1. Create class in `gameplay/modes/`: `MyGameMode.ts`
2. Extend `BaseGameMode`
3. Import and register in `GameModeSystem`
4. Implement required methods: `onInit()`, `onUpdate()`, `onPlayerJoin()`, etc.

### Hook into the Game Loop
1. Create system extending appropriate interface
2. Register with engine controller
3. System's `update(dt)` method called each frame

## Performance Considerations

### Domain Organization Benefits
- **Code splitting**: Webpack can better leverage code splitting with clear domains
- **Lazy loading**: Domains can be lazy-loaded as needed
- **Profiling**: Domain-level profiling is now possible
- **Optimization**: Clear boundaries make it easier to optimize specific areas

### When Optimizing
1. Profile the domain using diagnostics tools
2. Identify bottleneck systems
3. Optimize within that domain if possible
4. Coordinate with other domains only if necessary

## Testing

### Unit Testing
Write tests in `__tests__/` directory alongside source:
```
src/engine/gameplay/systems/
├── HealthSystem.ts
├── __tests__/
│   └── HealthSystem.test.ts
```

### Integration Testing
Test domain boundaries and interactions:
```typescript
// Test how HealthSystem integrates with DamageSystem
```

## Troubleshooting

### Circular Dependencies
If you get a circular dependency error:
1. Check import paths for cycles (A → B → A)
2. Use barrel files to break cycles
3. Move shared logic to core domain if needed

### Import Not Found
1. Verify domain path is correct
2. Check that module is exported from domain barrel
3. Ensure TypeScript path is valid (run `npm run type-check`)

### System Not Registering
1. Verify system is exported from domain
2. Check bootstrap code includes your domain
3. Ensure system implements required interface

## Code Style

### File Structure
```typescript
// 1. Imports (in order: core, foundation, domains, types)
import { Entity } from '../../core/Entity';
import { gameBus } from '../../core/EventBus';
import { HealthSystem } from '../../gameplay/systems/HealthSystem';
import type { SystemContext } from '../../core/types';

// 2. Interfaces/Types
export interface MyConfig {
  value: number;
}

// 3. Main class/function
export class MySystem {
  // implementation
}

// 4. Helpers/Utilities
export function createMySystem(): MySystem {
  return new MySystem();
}

// 5. Module-level singleton (if applicable)
export const mySingleton = createMySystem();
```

### Naming Conventions
- Classes: `PascalCase` (e.g., `HealthSystem`)
- Functions: `camelCase` (e.g., `getHealthSystem`)
- Constants: `UPPER_CASE` (e.g., `MAX_HEALTH`)
- Types: `PascalCase` (e.g., `HealthState`)
- Files: match export, usually `PascalCase.ts` or `camelCase.ts`

## Further Reading

- [REFACTORING_2026.md](./REFACTORING_2026.md) - Complete refactoring details
- [README.md](../README.md) - Architecture overview
- Domain-specific files for implementation details
