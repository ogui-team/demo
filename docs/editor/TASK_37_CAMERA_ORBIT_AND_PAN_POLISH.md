# Task 37 - Camera Orbit And Pan Polish

## Goal
Make the editor camera feel predictable and low-friction.

## Problem
Even when state restore works, orbit, pan, and re-entry transitions can still feel jumpy or disorienting.

## What To Do
1. Audit the editor camera control path for orbit, pan, and zoom continuity.
2. Smooth out any sudden snap caused by stale pivot points or mode transitions.
3. Preserve intended camera target/pivot after selecting or framing an entity.
4. Keep play-mode return from stomping editor camera interaction state.
5. Avoid introducing a new camera system; improve the current one.

## Done When
- Orbit and pan feel stable across common editor flows.
- Camera return from play keeps the editor usable immediately.