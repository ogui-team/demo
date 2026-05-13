# Task 20 - Editor Mode System

## Goal
Formalize editor interaction modes.

## Why
As tool count grows, mode ambiguity causes interaction chaos.

## Must Include
- select mode
- terrain mode
- foliage mode
- paint mode
- scripting mode
- modal isolation
- input ownership boundaries

## Scope
- Extend mode model beyond basic tool toggles.
- Enforce strict ownership and activation boundaries per mode.

## Implementation Steps
1. Define EditorMode enum and mode capability map.
2. Introduce mode transition guard rules and lifecycle hooks.
3. Bind each mode to tool availability and input channels.
4. Add mode-specific overlays and status indicators.
5. Ensure mode switch cancels incompatible active drags and previews.
6. Add persistent last-used mode per workspace.

## Integration Targets
- EditorToolCoordinator
- EditorEventRouter
- Inspector and topbar mode controls

## Done When
- Mode changes are explicit and isolated.
- Input conflicts between tools are eliminated.
- New modes can be added without rewriting core routing.
