# Task 08 - Transform Gizmos

## Goal
Implement Unreal/Unity-style move/rotate/scale gizmos.

## Why
This is the main interaction surface for editing. If this is weak, the editor never feels professional.

## Must Include
- world/local mode
- axis locking
- drag lifecycle
- snapping hooks
- editor-only rendering
- deterministic transform updates

## Scope
- Upgrade current gizmo system into a formal interaction subsystem.
- Keep rendering and interaction separate, but coordinated.

## Implementation Steps
1. Formalize gizmo state model:
- active mode (move, rotate, scale)
- orientation space (world, local)
- active axis or plane
- dragging state snapshot
2. Define drag lifecycle events:
- drag begin
- drag update
- drag commit
- drag cancel
3. Add axis and plane locking behavior for all modes.
4. Add snapping hook interfaces:
- position grid snap
- rotation increment snap
- scale increment snap
5. Ensure transforms are applied through deterministic commit path.
6. Keep gizmo render objects editor-only and excluded from runtime save paths.

## Integration Targets
- EditorToolCoordinator
- SelectionSystem
- future Undo/Redo command stack

## Done When
- Move/rotate/scale interactions are stable and predictable.
- World/local toggle works per selection orientation.
- Snap behavior can be enabled without changing gizmo core.
- Drag operations produce clean begin and commit boundaries.
