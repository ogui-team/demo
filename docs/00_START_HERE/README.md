# PS1-Styled 3D Game Engine

A browser-based PS1-styled 3D game engine with multiplayer support via WebSockets. Built with TypeScript, Three.js, and Node.js.

> 🚀 **NEW** (April 2026): Phase 3 Complete - Lazy-Load Architecture Ready!  
> 📍 **START HERE**: [PROJECT_EVOLUTION_2026.md](PROJECT_EVOLUTION_2026.md) - Master Plan + Quick Start  
> 📸 **QUICK VIEW**: [SYSTEM_STATE_SNAPSHOT.md](SYSTEM_STATE_SNAPSHOT.md) - Current Status  

## Features

- **PS1-Era Graphics**: Low-poly rendering with flat shading and vertex colors
- **Real-time Multiplayer**: WebSocket-based server for synchronized game state
- **Modular Architecture**: Clean separation between client engine and server logic
- **TypeScript**: Full type safety across both client and server
- **Three.js Integration**: Powerful 3D graphics rendering
- **🆕 Lazy-Load Architecture**: 152-byte bootloader + on-demand chunks (44% faster TTI)

## Project Structure

The client is organized around **domain-driven** architecture with clear separation of concerns. Each domain handles a specific aspect of the engine:

```
client/src/engine/
├── core/                      # Core engine utilities & services
│   ├── Entity.ts              # Entity component system
│   ├── EntityManager.ts       # Entity lifecycle management
│   ├── EventBus.ts            # Event system
│   ├── SystemRegistry.ts      # System metadata & lookup
│   └── ...
├── foundation/                # Engine foundation & bootstrap
│   ├── Engine.ts              # Main engine singleton
│   ├── GameLoop.ts            # Update/render loop
│   ├── CorridorOrchestrator.ts # System health corridor
│   ├── state/                 # Application state management
│   └── ...
├── gameplay/                  # Game logic & systems
│   ├── game/                  # Game mode & player management
│   │   ├── GameModeSystem.ts
│   │   ├── GameModeManager.ts
│   │   ├── PlayerModelSystem.ts
│   │   └── ...
│   ├── systems/               # Gameplay systems
│   │   ├── PhysicsSystem.ts
│   │   ├── HealthSystem.ts
│   │   ├── WeaponSystem.ts
│   │   ├── InventorySystem.ts
│   │   ├── 2d/                # 2D rendering systems
│   │   ├── gas/               # Gameplay Ability System
│   │   └── ...
│   └── modes/                 # Game mode implementations
├── network/                   # Multiplayer & networking
│   ├── MultiplayerClient.ts
│   ├── NetworkSyncSystem.ts
│   ├── CollisionAuthoritySystem.ts
│   └── ...
├── render/                    # 3D rendering layer
│   ├── Renderer.ts
│   ├── Scene.ts
│   └── ...
├── ui/                        # UI & HUD components
│   ├── UICompositionCoordinator.ts
│   ├── MainMenu.ts
│   ├── ServerBrowser.ts
│   ├── 2d/                    # 2D UI support
│   └── ...
├── editor/                    # Editor & tools
│   ├── EditorController.ts
│   ├── EditorMenu.ts
│   ├── tools/
│   │   ├── SelectionSystem.ts
│   │   ├── GizmoSystem.ts
│   │   └── ...
│   └── ...
├── diagnostics/               # Debug & diagnostics
│   ├── debug/
│   │   ├── DebugManager.ts
│   │   ├── RuntimeDiagnosticsCoordinator.ts
│   │   ├── StatusMovementDebugPanel.ts
│   │   └── ...
│   └── ...
├── runtime/                   # Runtime coordination
│   ├── coordinators/          # Runtime coordinators
│   │   ├── ClientWorldRuntimeCoordinator.ts
│   │   ├── MultiplayerRuntimeCoordinator.ts
│   │   └── RuntimeOverlayCoordinator.ts
│   ├── bootstrap/             # Bootstrap logic
│   └── ...
├── camera/                    # Camera systems
├── reflection/                # Reflection & serialization
├── audit/                     # Engine capability auditing
└── index.ts                   # Main barrel file
```

### Domain Breakdown

| Domain | Purpose |
|--------|---------|
| **core** | ECS, events, services, utilities |
| **foundation** | Engine startup, game loop, app state |
| **gameplay** | Game logic, modes, systems, Ability System |
| **network** | Multiplayer, replication, authority |
| **render** | Three.js integration, scene graph |
| **ui** | HUD, menus, overlays |
| **editor** | Level editor, tools, gizmos |
| **diagnostics** | Debug panels, profiling, validation |
| **runtime** | Runtime coordinators, bootstrapping |

### Import Patterns

After the restructure, all imports follow consistent patterns:

```ts
// From same domain
import { HUDSystem } from '../systems/HUDSystem';

// From another domain (via domain path)
import { MultiplayerClient } from '../../network/MultiplayerClient';
import { GameModeSystem } from '../../gameplay/game/GameModeSystem';
import { DebugManager } from '../../diagnostics/debug/DebugManager';

// From barrel files (recommended for re-exports)
import * as Engine from '../../foundation/Engine';
```

## Architecture & Design

### Domain-Driven Architecture (April 2026)

The engine follows a **domain-driven design** pattern to improve maintainability, scalability, and code organization. Each domain is self-contained and communicates through well-defined interfaces.

**Key Principles:**
- **Single Responsibility**: Each domain handles one area of the engine
- **Dependency Inversion**: Domains depend on abstractions, not implementations
- **Module Isolation**: Barrel files (`index.ts`) control public APIs
- **Type Safety**: Full TypeScript across all modules
- **Hot Reload**: Dev server supports code changes without full reload

**Design Patterns Used:**
- **Entity Component System (ECS)**: Flexible game object architecture
- **Observer Pattern**: Event bus for decoupled communication
- **Factory Pattern**: System creation and injection
- **Service Locator**: Global access to core services
- **Coordinator Pattern**: Orchestration of complex workflows

### System Architecture

```
┌─────────────────────────────────────────────┐
│           Browser / Client (3000)           │
├──────────────────────┬──────────────────────┤
│  UI/Menus/HUD        │ GameEngine/Gameplay  │
│  (ui, editor)        │ (gameplay, render)   │
├──────────────────────┴──────────────────────┤
│       Runtime Coordinators                  │
│  ClientWorldRuntimeCoordinator              │
│  MultiplayerRuntimeCoordinator              │
├─────────────────────────────────────────────┤
│  Network / WebSocket                        │
│  (network domain)                           │
└────────────────┬────────────────────────────┘
                 │ WebSocket
┌────────────────┴────────────────────────────┐
│        Backend / Server (8080)              │
│         Node.js + Express + ws              │
│  Game State, Authority, Synchronization     │
└─────────────────────────────────────────────┘
```

## Getting Started

### Installation

```bash
npm install
```

This installs dependencies for both client and server using npm workspaces.

### Development

Run the development server and client:

```bash
npm run dev
```

This starts:
- **Server**: WebSocket server on `http://localhost:8080`
- **Client**: Dev server on `http://localhost:3000`

### Building

```bash
npm run build
```

Builds both client and server for production.

### Running Production

```bash
npm start
```

Starts the production server.

## Architecture

### Backend (Server)

- **Express.js**: HTTP server for serving static files
- **ws**: WebSocket library for real-time communication
- **GameState**: Centralized game state management
- Message types: `PLAYER_JOIN`, `PLAYER_UPDATE`, `ACTION`

### Frontend (Client)

- **Three.js**: 3D rendering engine
- **webpack**: Module bundler and dev server
- **GameEngine**: Main game loop coordinating renderer and network
- **PS1Renderer**: WebGL renderer with PS1-style settings
- **NetworkManager**: WebSocket client for multiplayer sync

## Next Steps

- [ ] Add player input handling (keyboard/mouse)
- [ ] Implement collision detection
- [ ] Create PS1-style shader effects
- [ ] Add more game objects and scenes
- [ ] Implement game physics
- [ ] Add audio system
- [ ] Create level editor

## Technologies

- **Frontend**: TypeScript, Three.js, Webpack
- **Backend**: TypeScript, Node.js, Express, WebSocket (ws)
- **Build Tools**: Webpack, ts-node, TypeScript Compiler

## License

MIT
