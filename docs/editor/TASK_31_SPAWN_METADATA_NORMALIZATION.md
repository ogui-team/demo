# Task 31 - Spawn Metadata Normalization

## Goal
Normalize prefab/spawn-library metadata used by the editor.

## Problem
Preview, spawn, labels, icons, filtering, and inspector hints become brittle when each surface assumes a different entry shape.

## What To Do
1. Audit the spawn-library entry contract across editor menu, inspector, and placement code.
2. Define one normalized metadata shape for id, label, category, description, glyph, accent, and any preview hints.
3. Add safe defaults for missing optional values.
4. Keep backward compatibility at the edges if existing content sources are incomplete.
5. Remove ad-hoc field normalization duplicated across multiple UI layers.

## Done When
- Spawn-library consumers use one stable metadata contract.
- Missing optional fields no longer cause degraded UI behavior.