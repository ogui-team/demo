# Task 41 - Autosave And Recovery

## Goal
Reduce the chance of losing editor work.

## Problem
The editor now does enough real work that accidental refreshes, crashes, or bad mode transitions can cost meaningful progress.

## What To Do
1. Define a lightweight autosave or recovery snapshot strategy.
2. Keep recovery data scoped to editor-safe scene state, not transient runtime artifacts.
3. Add a simple restore path on next load if recovery data exists.
4. Avoid overly aggressive autosaves that hide bugs or overwrite intentional history.
5. Document the recovery behavior in one short note or status surface.

## Done When
- Recent unsaved work can be recovered after an unexpected interruption.
- Recovery snapshots do not include runtime-only junk.