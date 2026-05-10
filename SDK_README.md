# Game Engine SDK - Release Mode

## Overview

The game engine is transitioning into **SDK-Release Mode**, enabling third-party plugin development and engine extensibility.

This document covers:
- Current public API surface
- Running the Engine-Doctor validation suite
- Building your first plugin
- Current implementation status and remaining hardening work

---

## Quick Start

### 1. Run the Engine-Doctor Validation

```bash
node scripts/doctor.js
```

This validates:
- ✓ Determinism safety scan (current report still has 23 accepted setTimeout warnings)
- ✓ Plugin interfaces (IDisposable, GamePlugin)
- ✓ Config parity (shared-contracts source of truth)
- ✓ Public API completeness
- ✓ Golden path test (EmptyPlugin)

Output: `SDK_DOCTOR_REPORT.json`

### 2. Build a Simple Plugin

Start with the golden path template:

```typescript
import type { GamePlugin, PluginInitContext } from '@shared/contracts';

export class MyPlugin implements GamePlugin {
  readonly id = 'my-plugin';
  readonly name = 'My Plugin';
  readonly version = '1.0.0';
  
  async init(context: PluginInitContext): Promise<void> {
    context.logger.log('Plugin initialized!');
  }
  
  dispose(): void {
    // Clean up resources
  }
}
```

See: `test/sdk/EmptyPlugin.ts` for complete example.

---

## Public API Surface

### Exported Interfaces

All these are available from `@shared/contracts`:

#### Core Plugin Contract

```typescript
export interface GamePlugin extends IDisposable {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  
  init?(context: PluginInitContext): void | Promise<void>;
  onLoad?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
  dispose(): void;
  capabilities?: { hooks?: string[]; systems?: string[]; events?: string[] };
}

export interface IDisposable {
  dispose(): void;
}
```

#### Plugin Initialization Context

```typescript
export interface PluginInitContext {
  gameLoop: any;           // Deterministic game loop
  stateManager: any;       // State management
  systemContext: any;      // System registry context
  
  gameBus: IEventBus;      // Event subscription
  logger: ILogger;         // Structured logging
  features: IFeatures;     // Feature flags
  config: IConfig;         // Configuration
}
```

#### System Management

```typescript
export interface ISystemRegistry {
  registerSystem(id: string, system: any): void;
  unregisterSystem(id: string): void;
  getSystem(id: string): any | undefined;
  getAllSystems(): Record<string, any>;
  hasSystem(id: string): boolean;
  listSystems(): string[];
}
```

#### Event Bus

```typescript
export interface IEventBus {
  emit(event: string, data?: any): void;
  on(event: string, handler: (data: any) => void): () => void;
  once(event: string, handler: (data: any) => void): () => void;
  off(event: string, handler?: (data: any) => void): void;
}
```

#### Plugin Registry

```typescript
export interface IPluginRegistry extends IDisposable {
  register(plugin: GamePlugin): void;
  unregister(pluginId: string): void;
  getPlugin(pluginId: string): GamePlugin | undefined;
  listPlugins(): GamePlugin[];
  getPluginsWithCapability(capability: string): GamePlugin[];
  initializeAll(context: PluginInitContext): Promise<void>;
  unloadAll(): Promise<void>;
  isInitialized(): boolean;
  getLoadedPlugins(): string[];
}
```

### Currently Exposed Game Systems

Through `client/src/index.ts`:

**Gameplay:**
- GameModeManager, GameModeSystem
- CharacterActorSystem, PlayerModelSystem
- WeaponPresentationSystem, CombatSystem
- PhysicsSystem, HealthSystem, SpawnSystem
- InteractionManager, PathfindingSystem

**Rendering:**
- Renderer, Camera, Scene
- PS1Renderer, RenderingEffects, Lights

**Engine:**
- Engine, StateManager, GameLoop, PlayController

**Networking:**
- MultiplayerClient, CollisionAuthoritySystem

**Contracts (Shared):**
- PHYSICS_CONSTANTS
- Entity types (Vec3, PlayerState, EntityState)
- Network contracts (serialization, schemas)

---

## Writing Deterministic Plugins

### Checklist

```
✓ Do NOT use Math.random()      → Use deterministic seeded RNG
✓ Do NOT use Date.now()          → Use gameLoop.currentTick
✓ Do NOT use setTimeout()         → Use gameLoop.schedule()
✓ Do NOT use global state        → Use plugin instance state
✓ Do clear all subscriptions in dispose()
✓ Do implement IDisposable interface
```

### Example: Deterministic Random

```typescript
// ✗ WRONG
const rand = Math.random();

// ✓ CORRECT - Use deterministic seed
import { SeededRandom } from '@shared/contracts';
const rng = new SeededRandom(seed);
const rand = rng.next();
```

### Event Naming Convention

```
plugin:{pluginId}:{event}
  → plugin:combat-system:hit
  → plugin:ui-overlay:menu-open
  → plugin:networking:connection-lost
```

This prevents collisions with engine events.

---

## Current SDK Status

### What Is Done

- Tier 1 interfaces and validation are in place.
- Public SystemRegistry and Public EventBus wrappers exist.
- PluginRegistry runtime wiring exists.
- The SDK global `Engine` namespace is available at runtime.
- The browser bootstrap now loads successfully with the SDK path enabled.

### What Remains

- `node scripts/doctor.js` still reports 23 determinism warnings from `setTimeout` usage in UI/input/runtime coordination paths.
- Those warnings are tracked as hardening work, not release blockers for the current runtime boot path.

---

## Known API Gaps

### Critical (Must be addressed before SDK release)

| Gap | Status | Workaround |
|-----|--------|-----------|
| Runtime PluginRegistry | ✅ Implemented | Use public SDK registry |
| Public System Registry | ✅ Implemented | Access systems through public wrapper |
| Plugin System Registration | ✅ Implemented | Register plugin-safe systems only |

### High Priority

| Gap | Status | Impact |
|-----|--------|--------|
| Event Bus Whitelisting | ✅ Implemented | Whitelisted public event surface |
| Configuration Manager | ⏳ TODO | No persistent config |
| Plugin Lifecycle Hooks | ✅ Implemented | init / onLoad / onUnload supported in registry flow |
| Error Boundaries | ⏳ TODO | Plugin crash crashes engine |

### Medium Priority

| Gap | Status | Impact |
|-----|--------|--------|
| Logger Interface | ⏳ TODO | Only basic logging |
| Feature Flags | ⏳ TODO | No feature control |
| Plugin Dependencies | ⏳ TODO | No ordering |

See `SDK_API_GAP_ANALYSIS.md` for detailed roadmap.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  SDK-Released Game Engine                    │
├─────────────────────────────────────────────┤
│                                              │
│  GameEngineSdk (Public Interface)           │
│  ├── plugins: IPluginRegistry               │
│  ├── systems: ISystemRegistry               │
│  ├── events: IEventBus                      │
│  ├── config: IConfig                        │
│  └── features: IFeatures                    │
│                                              │
├─────────────────────────────────────────────┤
│                                              │
│  Bootstrapped Systems (Internal)            │
│  ├── GameLoop (deterministic)               │
│  ├── StateManager                           │
│  ├── Rendering Pipeline                     │
│  ├── Physics Engine                         │
│  ├── Network Coordinator                    │
│  └── UI Coordinator                         │
│                                              │
├─────────────────────────────────────────────┤
│                                              │
│  Shared Contracts (@shared/contracts)      │
│  ├── Game Plugin Interfaces                 │
│  ├── Gameplay Constants                     │
│  ├── Network Protocols                      │
│  └── Entity Types                           │
│                                              │
└─────────────────────────────────────────────┘
         ↓
    Third-Party Plugins (External)
```

---

## Plugin Development Workflow

### Step 1: Create Plugin Class

```typescript
export class MyCustomPlugin implements GamePlugin {
  readonly id = 'my-custom-plugin';
  readonly name = 'My Custom Plugin';
  readonly version = '1.0.0';
  
  async init(context: PluginInitContext): Promise<void> {
    // Initialize plugin
  }
  
  dispose(): void {
    // Clean up
  }
}
```

### Step 2: Register at Runtime

*[Implementation pending - PluginRegistry WIP]*

```typescript
const plugin = new MyCustomPlugin();
const sdk = window.__GAME_ENGINE_SDK__;
sdk.plugins.register(plugin);
```

### Step 3: Listen to Events

```typescript
context.gameBus.on('game:start', () => {
  context.logger.log('Game started!');
});
```

### Step 4: Access Systems

```typescript
const physics = context.systems.getSystem('physics');
const hud = context.systems.getSystem('hud');
```

### Step 5: Register Custom System

*[Implementation pending]*

```typescript
class MySystem implements IDisposable {
  init(ctx: SystemContext): void { }
  dispose(): void { }
}

context.systems.registerSystem('my-system', new MySystem());
```

---

## Testing Your Plugin

### Automated Testing

```bash
npm test -- test/sdk/EmptyPlugin.ts
```

### Manual Testing

1. Load plugin in dev server
2. Check browser console for logs
3. Verify event emissions
4. Check memory usage in DevTools

### Common Issues

**Issue: Plugin not initializing**
- Check PluginRegistry is implemented
- Verify plugin.init() is being called
- Check browser console for errors

**Issue: Events not firing**
- Verify event names match engine events
- Check event bus subscription
- Use logger to trace event flow

**Issue: Memory leaks**
- Verify dispose() unsubscribes all events
- Check for circular references
- Use DevTools memory profiler

---

## Project Structure

```
project-root/
├── packages/
│   └── shared-contracts/
│       ├── src/
│       │   ├── sdk/
│       │   │   ├── plugin-contracts.ts    (Plugin interfaces)
│       │   │   └── index.ts
│       │   ├── gameplay/
│       │   ├── network/
│       │   └── geometry/
│       └── package.json
├── client/src/
│   ├── 0-foundation/          (Engine core)
│   ├── 1-kernel/              (System registry, lifecycle)
│   ├── 2-systems/             (Game systems)
│   ├── 3-network/             (Multiplayer)
│   ├── 4-runtime/
│   │   ├── runtime/
│   │   │   ├── bootstrap/     (Phase system)
│   │   │   └── PluginRegistry (WIP)
│   │   └── PluginRegistry.ts  (WIP)
│   └── index.ts               (Public API)
├── scripts/
│   └── doctor.js              (SDK validation)
├── test/
│   └── sdk/
│       └── EmptyPlugin.ts     (Golden path)
└── SDK_API_GAP_ANALYSIS.md    (Roadmap)
```

---

## Running Engine-Doctor

The Engine-Doctor is a comprehensive validation suite:

```bash
# Run full validation
node scripts/doctor.js

# View report
cat SDK_DOCTOR_REPORT.json
```

### What It Checks

1. **Determinism Safety**
   - Scans for Math.random() and Date.now()
   - Flags non-deterministic operations
   - Severity: ERROR/WARNING

2. **Plugin Infrastructure**
   - Validates GamePlugin interfaces exist
   - Checks IDisposable pattern
   - Ensures plugins can be created

3. **Configuration Parity**
   - Confirms shared-contracts is source of truth
   - Detects duplicate type definitions
   - Validates client/server symmetry

4. **Public API Completeness**
   - Verifies all interfaces are exported
   - Checks SDK module structure
   - Validates type availability

5. **Golden Path Test**
   - Compiles EmptyPlugin
   - Uses ONLY public API
   - Reports missing exports

---

## Next Steps

### For Engine Maintainers

1. ✅ Define plugin interfaces
2. ✅ Create Engine-Doctor validation
3. ✅ Create golden path template
4. ⏳ Implement PluginRegistry
5. ⏳ Create public system registry wrapper
6. ⏳ Document all gaps
7. ⏳ Create example plugins
8. ⏳ Publish SDK to npm

### For Plugin Developers

1. Use EmptyPlugin as template
2. Run Engine-Doctor to validate setup
3. Build plugins using public API only
4. Test with included test suite
5. Share feedback on API gaps

---

## Support & Feedback

- 📄 See: `SDK_API_GAP_ANALYSIS.md` for detailed roadmap
- 🔧 Run: `node scripts/doctor.js` to validate your setup
- 📝 Template: `test/sdk/EmptyPlugin.ts` for plugin starter

For issues or feature requests, refer to the identified gaps in the gap analysis document.

---

**Last Updated:** May 10, 2026  
**Status:** SDK-Release-Mode (TIER 1 - Interfaces Defined)  
**Next Milestone:** Implement PluginRegistry
