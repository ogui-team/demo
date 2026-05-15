# Multiplayer Flow And HUD Overview

## Purpose
This document describes the end-to-end multiplayer flow in the demo runtime:
- Menu and lobby entry
- Host and join handshake
- Lobby state updates
- Match start and spawn/bootstrap
- Snapshot replication and avatar rendering
- HUD and in-game UI behavior
- Failure modes and diagnostics

It is intended as the single operational reference for debugging join races, spawn timing issues, and player visualization mismatches.

## System Map

### Client systems
- UI composition and lobby browser:
  - `UICompositionCoordinator`
  - `ServerBrowser`
- Network transport and message translation:
  - `MultiplayerClient`
  - `NetworkConnectionResolver`
- Session orchestration:
  - `MultiplayerRuntimeCoordinator`
  - `SessionLifecycleCoordinator`
  - `ClientWorldRuntimeCoordinator`
- Snapshot and movement replication:
  - `NetworkSyncSystem`
  - `ReplicationSystem`
- Player visual state:
  - `PlayerModelSystem`
  - `AvatarBuilder`

### Server systems
- Entry and socket routing:
  - `server/src/index.ts`
- Lobby lifecycle:
  - `LobbyManager`
- Match/session authority:
  - `GameSession`
  - `playerJoinRuntime`
  - `playerSessionRuntime`
- Snapshot fanout:
  - `SnapshotBroadcast`
  - `SnapshotFilter`

## Lifecycle: Main Menu To Match

### 1. Open Multiplayer Lobby (client)
1. User clicks Multiplayer in main menu.
2. `UICompositionCoordinator.openMultiplayer()` runs.
3. Runtime is transitioned to lobby mode and server browser is shown.

Current hardening behavior:
- Any stale multiplayer connection is explicitly disconnected before opening browser.
- Persisted browser visibility is reset for fresh entry.
- This prevents implicit reattach to old sessions when user only intended to open lobby list.

### 2. Host flow (client to server)
1. Host clicks Start Server in `ServerBrowser`.
2. Browser calls `hostGame`, which reaches `MultiplayerRuntimeCoordinator.hostAutostartMultiplayer`.
3. Coordinator:
   - captures pending appearance/archetype from state
   - calls `prepareMultiplayerLobby('host')`
   - transitions to lobby state
   - sends `HOST_GAME` over websocket
4. Server `index.ts` handles `HOST_GAME`:
   - creates room in `LobbyManager`
   - joins host player into room
   - returns `JOIN_ACK`
   - forces post-ack lobby rebroadcast (`LOBBY_UPDATE`)

### 3. Join flow (client to server)
1. Joiner opens browser and selects server row.
2. Browser filters non-joinable entries and uses `joinGame` callback.
3. Coordinator `joinAutostartMultiplayer`:
   - captures appearance/archetype
   - prepares clean lobby state
   - resolves room target and sends `PLAYER_JOIN`
4. Server `index.ts` handles `PLAYER_JOIN`:
   - if requested room is waiting and has capacity: `JOIN_ACK` + lobby rebroadcast
   - if requested room is in game: late-join path (`GAME_START` with `late: true`)

Current hardening behavior:
- Generic browser join excludes `in_game` rooms.
- Auto-join fallback selects only joinable non-`in_game` rooms.
- This avoids accidental late-join immediate game entry when user expected lobby.

### 4. Lobby updates
- `LobbyManager` emits `LOBBY_UPDATE` payloads to all room players for:
  - join/leave
  - ready state
  - host settings
  - map/mode
  - archetype changes
  - countdown transitions

- `ServerBrowser` listens and renders:
  - roster rows
  - host badge
  - ready states
  - selected map/mode/countdown

### 5. Match start
- When lobby transitions to in-game (countdown or force start), server creates `GameSession`.
- Server sends `GAME_START` to each room player.
- Client `MultiplayerClient` emits `game_start`.
- Coordinator requests full sync and starts gameplay bootstrap.

## Spawn/Bootstrap Contract

### Authoritative ownership
- Server sends `SPAWN_AUTHORITY` to joining player.
- Client validates authority packet against local player id.
- Network sync binds local player to authoritative network entity id.

### Full sync and snapshots
- Server sends `FULL_SYNC_DATA` and ongoing snapshots.
- Client normalizes to `AuthoritativeSnapshotPayload`.
- Coordinator forwards snapshots to:
  - `NetworkSyncSystem.applyAuthoritativeSnapshot`
  - `PlayerModelSystem.syncFromPayload`

### Local player bootstrap
- `LocalPlayerBootstrapCoordinator` keeps input gated until local authoritative spawn is confirmed.
- Once local spawn is actualized:
  - play controller binds
  - camera syncs
  - input sending starts

### Buffering behavior
Current practical buffer points:
- Lobby entry uses explicit disconnect/reset to avoid stale reconnect races.
- `prepareMultiplayerLobby()` now clears remote avatar state before host/join.
- Local input remains gated until authoritative local player actualization.

## Player Rendering And Appearance

### Source of truth
- Authoritative snapshot entities (server)
- Per-player appearance state (`player.{id}.appearance`)

### Appearance pipeline
1. Player chooses archetype in lobby UI.
2. Client stores archetype and appearance in state paths.
3. Join/host payload carries appearance and archetype.
4. Server stores appearance in lobby/match player state.
5. Server forwards `PLAYER_APPEARANCE` updates to peers.
6. Client writes incoming appearance to state.
7. `PlayerModelSystem` applies appearance to existing remote avatar mesh.

### Fallback behavior
- Server-side `createPlayerState` now falls back to canonical archetype appearance when payload appearance is missing.
- Client-side `PlayerModelSystem` uses deterministic color slot only as last resort.

### Ghost/stale remote cleanup
- `PlayerModelSystem` tracks last-seen snapshot time per remote player.
- If a remote player id is not seen for a prune window, it is removed from scene and ECS state.
- This limits duplicate/ghost "pill" avatars after reconnect/session transitions.

## HUD And UI Flow

### Lobby HUD
- `ServerBrowser` shows:
  - server list (waiting rooms)
  - player roster
  - ready/host state
  - map/mode/limit/time
  - archetype selection deck

### In-game HUD
- Gameplay HUD is activated after session lifecycle restoration.
- Player id is set by `SessionLifecycleCoordinator` on connect/actualize.
- Ammo/inventory/attribute sync events from `MultiplayerClient` feed gameplay systems.

### Mode panel
- In-game mode panel is attached to multiplayer client after connect.
- Host/client mode and controls are updated by runtime overlay coordinator.

## Key Message Sequence (Happy Path)

### Host creates room
1. `HOST_GAME` -> server
2. `JOIN_ACK(hosted=true)` -> host
3. `LOBBY_UPDATE` -> host

### Joiner joins host lobby
1. `PLAYER_JOIN(roomId)` -> server
2. `JOIN_ACK(hosted=false)` -> joiner
3. `LOBBY_UPDATE` -> host + joiner

### Match starts
1. `GAME_START` -> all room players
2. `FULL_SYNC_REQ` -> server (client request)
3. `FULL_SYNC_DATA` -> each player
4. `AUTHORITATIVE_SNAPSHOT` stream
5. `SPAWN_AUTHORITY` and local bind/actualization

## Known Failure Modes And Mitigations

### Symptom: joiner instantly enters game instead of lobby
Likely causes:
- joined an `in_game` room (late-join path)
- stale reconnect resumed old session

Mitigations now in place:
- browser filters `in_game` from generic join path
- coordinator auto-join fallback avoids `in_game`
- multiplayer menu entry disconnects stale session first

### Symptom: host cannot see joiner in lobby
Likely causes:
- joiner not in same room/session
- UI race around ack/update ordering

Mitigations now in place:
- strict room join handling
- post-ack lobby rebroadcast
- join path alignment to resolved WS/HTTP backend

### Symptom: extra blue pills / duplicate avatars
Likely causes:
- stale remote entities from previous session
- missing appearance payload fallback

Mitigations now in place:
- remote stale-player prune in `PlayerModelSystem`
- archetype appearance fallback on server player creation
- pre-join/host remote model clear in prepare lobby

## Runtime Debug Checklist

1. Verify both clients resolved same backend URLs (HTTP + WS).
2. Confirm join room id equals host room id in logs.
3. Check `JOIN_ACK` then `LOBBY_UPDATE` ordering per client.
4. Confirm no unexpected `late: true` in `GAME_START` for normal lobby join.
5. Confirm `SPAWN_AUTHORITY` and local player bind emitted.
6. Confirm authoritative snapshots include both player entities.
7. Confirm appearance state exists at `player.{id}.appearance` for each player.
8. Confirm stale remote entities are removed after prune window.

## Practical Notes For Render Testing
- Always hard refresh after deploy to avoid stale JS bundle state.
- Test with two distinct browsers/profiles to avoid shared local storage and auth side effects.
- Start from main menu each run; avoid reusing browser tabs that were mid-session.
- If a run behaves unexpectedly, leave lobby on both clients and re-enter multiplayer once to force clean state.
