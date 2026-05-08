# v0.2.0 PROJECT CLEANUP & EXECUTION PLAN
## Deliberate, Sophisticated Path (Ausgeklügelt)

**Status**: Gate 1A Starting  
**Approach**: Incremental, validated, zero-risk progression  
**Baseline**: v0.1.4 PvP functional + 6 identified issues

---

## PHASE 0: PROJECT CLEANUP (Establishing Clean State)

### 0.1 Audit File Integration
- ✅ PROJECT_AUDIT_AND_ROADMAP.md (Main spec)
- ✅ v0-1-4-TECHNICAL-METRICS-AND-STATUS.md (Validation)  
- ✅ REVISED_AUDIT_EXECUTIVE_SUMMARY.md (Overview)
- ✅ .copilot-instructions.md (Skill reference)

**Action**: These are now your source of truth. Reference them for every decision.

### 0.2 Repository Organization (NEW STRUCTURE)

Create structured directories for v0.2.0 work:

```
project-root/
├── engine/
│   ├── audit/                    # Existing
│   ├── reports/                  # Existing
│   └── v0-2-0-gates/            # NEW: Track gate completion
│       ├── gate-1a-geometry.md  # This gate
│       ├── gate-1b-compile.md
│       ├── gate-2a-death.md
│       └── ...
├── server/
│   ├── src/
│   │   └── session/             # Extract work goes here
├── client/
│   ├── src/
│   │   └── engine/
│       └── runtime/
│           └── bootstrap/       # Extract work goes here
└── docs/
    ├── v0-2-0-technical-notes.md # Your working notes
    └── gate-completions/        # Sign-offs as you finish
```

### 0.3 Baseline Measurement (Before ANY Changes)

Run these commands and save outputs:

```bash
# 1. Build baseline
npm run type-check > /tmp/baseline-typecheck.txt
npm run build > /tmp/baseline-build.txt
npm run audit:engine > /tmp/baseline-audit.txt

# 2. Record timestamps
echo "Build started at $(date)" > /tmp/baseline-timestamp.txt
```

**Why**: You'll compare against this after Gate 1A to ensure no regressions.

### 0.4 Create Gate 1A Tracking File

Create `engine/v0-2-0-gates/gate-1a-geometry.md`:

```markdown
# Gate 1A: Map Geometry Isolation
**Status**: STARTING  
**Blocker**: YES (ROOT)  
**Target Completion**: [TBD]

## Tasks
- [ ] Task 1: Mode-aware MapCollisionData structure
- [ ] Task 2: Collision hooks + lifecycle
- [ ] Task 3: Mode transition binding  
- [ ] Task 4: Validation testing

## Implementation Log
[Will update as work progresses]
```

---

## PHASE 1: GATE 1A - MAP GEOMETRY ISOLATION

### Problem Summary
```
Current State:
  - MapCollisionData.ts loads collision from static JSON at startup
  - No mode-scoping: freeplay colliders persist into multiplayer
  - Result: Wrong collision boundaries in MP, can walk through geometry

Root Cause:
  - Collision stored in module-level state (not instance)
  - No cache per mode (freeplay vs multiplayer)
  - No mode-transition hook to reload
  - Server sends different mapId per session, client ignores it
```

### Task 1.1: Create Mode-Aware MapCollisionData Class

**Location**: `client/src/engine/network/MapCollisionData.ts`

**Current Issue**: Static module-level state

**Fix**: Convert to instance-based, mode-scoped storage

Create new type definitions:

```typescript
type GameMode = 'freeplay' | 'editor' | 'multiplayer';

interface CollisionModeCache {
  mode: GameMode;
  mapId: string;
  geometry: MapCollisionLayout;
  loadedAt: number;
}

class MapCollisionDataInstance {
  private modeCache: Map<GameMode, CollisionModeCache> = new Map();
  private currentMode: GameMode | null = null;
  private currentGeometry: MapCollisionLayout | null = null;
  
  constructor(private collisionConfig: CollisionConfig) {}
  
  async loadForMode(mode: GameMode, mapId: string): Promise<MapCollisionLayout> {
    // Check cache first
    const cached = this.modeCache.get(mode);
    if (cached?.mapId === mapId) {
      this.currentMode = mode;
      this.currentGeometry = cached.geometry;
      console.log(`[Collision] Loaded from cache: ${mode}/${mapId}`);
      return cached.geometry;
    }
    
    // Load fresh
    const geometry = this.buildGeometryForMap(mapId);
    this.modeCache.set(mode, {
      mode,
      mapId,
      geometry,
      loadedAt: Date.now(),
    });
    
    this.currentMode = mode;
    this.currentGeometry = geometry;
    console.log(`[Collision] Loaded fresh: ${mode}/${mapId}`);
    return geometry;
  }
  
  getCurrentGeometry(): MapCollisionLayout | null {
    return this.currentGeometry;
  }
  
  clearModeCache(mode: GameMode): void {
    this.modeCache.delete(mode);
    console.log(`[Collision] Cleared cache for mode: ${mode}`);
  }
  
  private buildGeometryForMap(mapId: string): MapCollisionLayout {
    const mapConfig = this.collisionConfig.maps[mapId];
    if (!mapConfig) {
      console.warn(`[Collision] Map config not found: ${mapId}`);
      return { mapId, sessionId: '', bounds: null, boxes: [] };
    }
    
    return {
      mapId,
      sessionId: '',
      bounds: mapConfig.bounds || null,
      boxes: (mapConfig.boxes || []).map(box => ({
        id: box.id,
        position: box.position,
        halfExtents: this.sizeToHalfExtents(box.size),
      })),
    };
  }
  
  private sizeToHalfExtents(size: CollisionVector3): CollisionVector3 {
    return {
      x: size.x / 2,
      y: size.y / 2,
      z: size.z / 2,
    };
  }
}

// Export singleton factory (can be re-created per context)
export let mapCollisionDataInstance: MapCollisionDataInstance | null = null;

export function initializeMapCollisionData(config?: CollisionConfig): MapCollisionDataInstance {
  const finalConfig = config || collisionConfig;
  mapCollisionDataInstance = new MapCollisionDataInstance(finalConfig);
  return mapCollisionDataInstance;
}

export function getMapCollisionData(): MapCollisionDataInstance {
  if (!mapCollisionDataInstance) {
    mapCollisionDataInstance = new MapCollisionDataInstance(collisionConfig);
  }
  return mapCollisionDataInstance;
}
```

**Validation Checklist**:
- [ ] Class compiles without errors
- [ ] Type checks pass: `npm --prefix client run type-check`
- [ ] Methods callable from other modules

---

### Task 1.2: Add Mode Transition Hooks

**Location**: `client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts`

**Goal**: Trigger collision reload when game mode changes

Find the game mode transition logic (likely in GameModeManager or ModeSystem):

```typescript
// In ClientWorldRuntimeCoordinator or relevant coordinator:

private setupModeTransitionHooks(): void {
  const modeManager = systemContext.getSystem(GameModeManager);
  
  modeManager.onModeWillChange.subscribe((nextMode: GameMode) => {
    this.handleModeWillChange(nextMode);
  });
  
  modeManager.onModeDidChange.subscribe((newMode: GameMode, context?: any) => {
    this.handleModeDidChange(newMode, context);
  });
}

private handleModeWillChange(nextMode: GameMode): void {
  // Before leaving current mode, clear its collision cache
  if (this.currentMode) {
    getMapCollisionData().clearModeCache(this.currentMode);
    console.log(`[Coordinator] Clearing collision for mode: ${this.currentMode}`);
  }
}

private async handleModeDidChange(
  newMode: GameMode,
  context?: { mapId?: string; sessionData?: any }
): Promise<void> {
  // After entering new mode, load collision for that mode
  const mapId = context?.mapId || context?.sessionData?.mapId || 'default_map';
  
  console.log(`[Coordinator] Loading collision for ${newMode}/${mapId}`);
  
  try {
    await getMapCollisionData().loadForMode(newMode, mapId);
    this.currentMode = newMode;
    
    // Rebind all physics bodies to new collision geometry
    this.rebindPhysicsColliders();
    
    console.log(`[Coordinator] Collision loaded and applied`);
  } catch (error) {
    console.error(`[Coordinator] Failed to load collision:`, error);
  }
}

private rebindPhysicsColliders(): void {
  // Force physics system to re-apply collision geometry
  const physicsSystem = systemContext.getSystem(PhysicsSystem);
  physicsSystem.rebuildColliders(getMapCollisionData().getCurrentGeometry());
}
```

**Validation Checklist**:
- [ ] Hooks compile
- [ ] Type checks pass
- [ ] No references to non-existent GameModeManager (verify actual name)

---

### Task 1.3: Wire Multiplayer Session Handshake

**Location**: `server/src/index.ts` (or session initialization)

**Goal**: Ensure map ID sent to client in session payload

Check current session initialization code (likely in lobbyManager or gameSession init):

```typescript
// When creating multiplayer session, ensure mapId is sent:

interface SessionPayload {
  sessionId: string;
  localPlayerId: string;
  mapId: string;        // ADD if missing
  roundNumber: number;
  // ... other fields
}

function createSessionPayload(session: GameSession): SessionPayload {
  return {
    sessionId: session.id,
    localPlayerId: session.getLocalPlayerId(),
    mapId: session.currentMap?.id || 'default_map',  // ENSURE THIS
    roundNumber: session.currentRound,
    // ... rest
  };
}
```

Then in client connection handler:

```typescript
// client/src/engine/network/MultiplayerClient.ts or similar

private handleSessionInitialized(payload: SessionPayload): void {
  console.log(`[Network] Session initialized: mapId=${payload.mapId}`);
  
  // Trigger collision reload for multiplayer with correct map
  getMapCollisionData()
    .loadForMode('multiplayer', payload.mapId)
    .then(() => {
      console.log(`[Network] Collision loaded from session handshake`);
    })
    .catch(err => {
      console.error(`[Network] Failed to load collision from handshake:`, err);
    });
}
```

**Validation Checklist**:
- [ ] Server sends mapId in session payload
- [ ] Client receives and logs mapId
- [ ] Collision system triggered on map ID receipt

---

### Task 1.4: Validation Testing

**Test Procedure**:

1. **Freeplay Geometry Test**
   ```
   a) Start freeplay mode
   b) Find collision edge (known walkable boundary)
   c) Try to walk through (should be blocked) ✅
   d) Take note of collision box IDs active
   ```

2. **Mode Transition Test**
   ```
   a) Still in freeplay - walk around, try to clip (blocked)
   b) Exit to main menu → Multiplayer → Host room
   c) Wait for session initialize message in console
   d) Should see: "[Coordinator] Loading collision for multiplayer/..."
   e) Should see: "[Collision] Loaded fresh: multiplayer/..."
   f) Collision boxes should be DIFFERENT from freeplay
   ```

3. **Verification Test**
   ```
   a) In multiplayer - walk toward door/structure that's clipped in freeplay
   b) Should NOT be clipped now (collision is different) ✅
   c) Check console: "Collision loaded from session handshake"
   d) Both players should have same collision boxes (verify via side-by-side)
   ```

4. **Regression Test**
   ```
   a) Exit multiplayer back to freeplay
   b) Old collision boxes should return (from cache or reload)
   c) Walk toward same door - should be clipped again
   d) Verify collision boxes are SAME as before
   ```

**Console Logging Points To Check**:
```
[Collision] Loaded fresh: freeplay/default_map
[Coordinator] Clearing collision for mode: freeplay
[Coordinator] Loading collision for multiplayer/different_map
[Collision] Loaded fresh: multiplayer/different_map
[Network] Collision loaded from session handshake
```

**Success Criteria**:
- ✅ Freeplay collision blocks player movement
- ✅ Mode transition clears old collision
- ✅ Multiplayer loads NEW collision (different map)
- ✅ No walkthrough geometry in multiplayer
- ✅ Returning to freeplay restores old collision
- ✅ All console logs appear in correct order

---

## CHECKPOINT: GATE 1A COMPLETION

**Before proceeding to Gate 1B or 2A, verify**:

1. Build still passes:
   ```bash
   npm run type-check
   npm run build
   npm run audit:engine
   ```
   
2. No regressions in metrics (compare to baseline)

3. All validation tests pass

4. Update `engine/v0-2-0-gates/gate-1a-geometry.md`:
   ```
   **Status**: ✅ COMPLETE
   **Completion Date**: [date]
   **Test Results**: All 4 validation tests passing
   **Regression Check**: Health-score maintained at 98.28+
   ```

5. Commit with message:
   ```
   Gate 1A: Map Geometry Isolation - Mode-scoped collision loading
   
   - MapCollisionData now instance-based, cache per mode
   - Mode transition hooks trigger reload
   - Multiplayer session sends mapId in payload
   - Client loads correct collision for mode
   - Validation: Freeplay ↔ Multiplayer transitions work
   ```

---

## NEXT: Gate 1B (Compile Optimization) - PARALLEL PATH

After Gate 1A validates, you can start Gate 1B (no dependency).

Refer to [ACTION PLAN #2](./PROJECT_AUDIT_AND_ROADMAP.md) in main audit.

---

This is your execution roadmap. Work methodically. Test at each checkpoint. No rushing.
