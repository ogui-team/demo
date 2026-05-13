# Task 44 - Runtime Reset Verification Harness

## Goal
Add explicit instrumentation for editor/play cleanup correctness.

## Problem
Reset bugs such as ghost bounds, duplicate listeners, stale players, or lingering preview state are hard to trust without a repeatable verification surface.

## What To Do
1. Add lightweight counters or diagnostics for generated artifacts, active placement previews, and key reset-sensitive listeners.
2. Expose a simple verification path after runtime reset or editor re-entry.
3. Reuse existing cleanup services where possible instead of inventing a second cleanup model.
4. Make failures actionable by reporting the leaking slice, not just a generic warning.
5. Keep the harness cheap enough to leave enabled in development builds.

## Done When
- Editor/play cleanup failures are visible and attributable.
- Ghost artifacts can be verified instead of guessed.