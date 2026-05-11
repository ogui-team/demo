# Current Gameplay Blockers

Date: 2026-05-08
Scope: Drift Bomb playable verification sprint

## Exact Broken Gameplay Systems
- Physics backend switching is live for `PhysicsSystem` query/mirroring paths, but full collision/contact parity across all consumers is not complete.
- Drift Bomb route/debug map is objective-driven; dedicated authored world geometry/chunk assets for the debug map are still placeholder-level.

## Placeholder Systems
- Drift Bomb world representation still uses placeholder bomb mesh and debug route lines rather than final assets.
- Queue pressure/readouts in overlay rely on diagnostics fallbacks when dedicated queue metrics are unavailable.

## Unfinished UX
- Drift Bomb debug autostart is URL-driven and opens automatically via script, but still depends on webpack dev startup timing.
- Team auto-pick is query-driven (`driftBombAutoTeam`) and not yet exposed as an in-game toggle widget.

## Replication Gaps
- Drift Bomb verification flow is optimized for local session validation first; multiplayer replication parity checks for all hotkey-driven debug actions are pending.
- Runtime snapshot dump is console-based and not yet persisted to structured artifacts.

## Missing Assets
- No dedicated `DriftBomb_DebugMap` authored mesh/texture package yet.
- Spawn labels/route markers are debug primitives only.

## Balance Placeholders
- Drift route timing, tether radius, and defuse pacing use debug-friendly defaults.
- Economy/loadout tuning is not final for competitive balance.

## Gameplay Readiness Snapshot
- Playable now: launch -> Drift Bomb -> auto join team -> plant -> drift -> defuse -> restart loop.
- Production-ready later: final map art, full replication checks, collision parity, polished UX controls.
