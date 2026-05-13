# Task 12 - Editor Selection Outlines

## Goal
Provide professional viewport selection feedback.

## Why
Visual clarity is core editor usability.

## Must Include
- outline rendering
- hover highlighting
- selected entity indicators
- multi-select visuals
- editor-only overlays

## Scope
- Add editor-only visual layer for hover and selection presentation.
- Keep visuals decoupled from selection ownership logic.

## Implementation Steps
1. Create SelectionVisualSystem with hover and selected sets.
2. Add outline pass or equivalent post-process for selected entities.
3. Add lightweight hover tint or edge highlight for hovered entity.
4. Add visual state for multi-select, including primary selection marker.
5. Ensure all visuals render only in editor mode.
6. Exclude gizmos and non-selectable helper meshes from highlight pass.

## Integration Targets
- SelectionSystem hover and select events
- future multi-select state model
- editor render pipeline hooks

## Done When
- Hover target is obvious before click.
- Selected entities are clearly distinguished.
- Multi-select remains readable in dense scenes.
- No selection visual renders in pure play mode.
