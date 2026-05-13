# Task 32 - Entity Naming And Grouping

## Goal
Improve how newly placed entities appear in the hierarchy.

## Problem
Freshly spawned objects are harder to manage when names are generic and grouping is inconsistent.

## What To Do
1. Define a clear naming fallback order for spawned entities.
2. Add deterministic suffixing when multiple instances of the same prefab are created.
3. If the hierarchy already supports grouping, place spawned entities into the correct parent/group.
4. Keep naming stable across selection refreshes and scene saves.
5. Avoid changing runtime-only identity rules just for editor labels.

## Done When
- New entities have readable, consistent hierarchy labels.
- Repeated placements do not produce confusing duplicates like many identical anonymous rows.