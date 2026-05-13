# Editor <-> Gameplay Transition Guide

## Goal

Make this loop stable:

`editor -> gameplay -> editor -> gameplay -> editor`

The editor must not accumulate live player entities, and authored spawn markers must control where gameplay starts.

## Root Cause

The duplicate-player bug came from two separate contracts being violated at once.

1. The editor world buffer used `SaveLoadManager.serializeWorld()` with no runtime filtering.
2. The local player prefab already carries the tag `runtime`, but persistence ignored that tag.
3. On play exit, the runtime player stayed alive in the live editor scene.
4. On the next cycle, that leaked runtime player could be serialized back into the editor buffer and show up again in the hierarchy.

This means the problem was not just "bad despawn timing". The real issue was that the editor had no hard boundary between:

- authored editor entities
- runtime player entities

## Implemented Fixes

### 1. Persistent world serialization now filters runtime players

File:

- `client/src/1-kernel/core/SaveLoadManager.ts`

Change:

- Added `serializeWorld(options)` with `includeRuntimeEntities?: boolean`
- Added persistence filtering for:
  - `localPlayer` entities
  - `RemotePlayer` / `LocalPlayer` runtime entities
  - prefabs tagged `runtime`
- Hierarchy serialization now filters nodes to the same allowed entity set

Why it matters:

- `player_v1.json` already has `tags: ["player", "runtime", ...]`
- that tag is now actually respected when the editor builds or merges its world buffer
- runtime players no longer get written back into editor persistence

### 2. World buffer build and merge now use persistent-only snapshots

File:

- `client/src/4-runtime/runtime/WorldBuildService.ts`

Change:

- `buildActiveWorldBuffer()` now serializes with `includeRuntimeEntities: false`
- `mergeRuntimeWorldIntoActiveBuffer()` also serializes with `includeRuntimeEntities: false`

Why it matters:

- the editor buffer stays editor-authored
- runtime player entities are excluded both when entering play and when returning from play

### 3. Leaving play mode now removes leaked runtime player entities from the live scene

File:

- `client/src/4-runtime/runtime/PlayerPossessionService.ts`

Change:

- `releaseToEditorMode()` now collects runtime player entities and destroys them
- it still preserves the current camera/world position in network sync before cleanup
- it clears velocity before destroy so physics does not carry junk state into the editor transition

Why it matters:

- even if the live runtime world contains one or more player entities, they are removed on exit
- this directly fixes the visible hierarchy growth the user reported

### 4. Editor spawn markers are now resolved more robustly

File:

- `client/src/4-runtime/runtime/coordinators/ClientWorldRuntimeCoordinator.ts`

Change:

- pinned spawn resolution still supports `PlayerSpawnPoint` entity types
- it now also recognizes prefab metadata with `gameplay.markerType === 'player_spawn'`

Why it matters:

- the `player_spawn_point` prefab becomes the durable editor-side spawn contract
- gameplay spawn no longer depends only on fragile entity-type matching

### 5. Runtime player prefabs are hidden from the editor spawn library

File:

- `client/src/4-runtime/runtime/EditorAuthorityCoordinator.ts`

Change:

- prefabs tagged `runtime` and identified as player prefabs are filtered out of the editor spawn library

Why it matters:

- authors should place `player_spawn_point`, not a live gameplay player prefab
- this prevents the editor from reintroducing runtime-only player content by design

### 6. Invalid player spawn marker metadata was removed

File:

- `client/src/assets/prefabs/player_spawn_point.json`

Change:

- removed the unsupported `metadata.kind` field again

Why it matters:

- keeps prefab validation aligned with `PrefabSystem`'s allowed editor metadata schema

## Current Transition Contract

### Editor -> Gameplay

1. Build active world buffer from persistent editor entities only.
2. Reset runtime state.
3. Apply the editor-authored world.
4. Spawn or bind the local gameplay player.
5. Choose spawn position by priority:
   - editor camera position during editor toggle
   - pinned `player_spawn_point`
   - fallback map spawn

### Gameplay -> Editor

1. Zero runtime velocities.
2. Merge runtime changes back into the active buffer using persistent-only serialization.
3. Remove runtime player entities from the live scene.
4. Return HUD/input/lifecycle to editor mode.
5. Keep authored editor content, not live gameplay players.

## Why the Previous Snapshot-Based Cleanup Was Not Enough

The earlier attempt tried to snapshot editor entity ids and delete anything not in that baseline.

That approach was too broad because it mixed two concerns:

- editor persistence policy
- live runtime cleanup policy

It also risked deleting legitimate runtime-created content without defining which new entities should persist.

The new implementation fixes the two correct boundaries instead:

- persistence filters runtime player entities out of editor snapshots
- play exit destroys leaked runtime player entities in the live scene

## Validation Performed

Command:

`npm --prefix client run type-check`

Result:

- passed

## Manual Verification Checklist

### Required editor/play loop test

1. Open the editor.
2. Confirm the hierarchy contains no leaked live player from previous runs.
3. Place one `Player Spawn Point` marker if desired.
4. Press `P` to enter gameplay.
5. Move around.
6. Press `P` to return to editor.
7. Confirm no new `player` entity remains in the hierarchy.
8. Press `P` again.
9. Repeat the cycle three times.

Expected result:

- the hierarchy should not gain one extra player per cycle
- spawn should respect the player spawn marker when present
- the editor should remain usable after every return

### Spawn marker verification

1. Place `player_spawn_point` in the editor.
2. Enter gameplay from a different camera position.
3. Verify whether editor-toggle spawn should use camera first or marker first for your intended design.

Current intended behavior in code:

- editor toggle prefers editor camera position
- pinned spawn marker is the next fallback

If you want marker-first behavior instead, that is a separate design choice and can be changed cleanly now.

## Recommended Next Hardening Steps

1. Add a dedicated persistence flag or lifecycle flag at entity level instead of inferring runtime-only status from tags/components.
2. Add a focused test for `SaveLoadManager.serializeWorld({ includeRuntimeEntities: false })` covering player-prefab filtering.
3. Add a focused editor transition test for `editor -> play -> editor` to assert the hierarchy player count stays stable.
4. Implement the drag-preview path separately once this loop is confirmed stable.

## Working Rule Going Forward

In editor persistence, authored markers persist.

Live gameplay players do not.
