# Task 07 - Viewport Raycasting

## Goal
Replace naive click detection with a centralized viewport picking pipeline.

## Why
Selection usually breaks once gizmos, overlays, instancing, and tool previews all exist at once.

## Must Include
- proper raycast manager
- selectable layer filtering
- click priority ordering
- gizmo exclusion
- hover target resolution
- future physics/editor separation

## Scope
- Introduce one editor-owned picking service for pointer hit resolution.
- Move raycast logic out of individual tools into this service.
- Make all tools consume normalized pick results instead of raw Three.js hits.

## Implementation Steps
1. Create a ViewportRaycastManager under editor runtime systems.
2. Define pick query inputs:
- screen position
- camera
- mask/layers
- include and exclude groups
3. Define pick result payload:
- hit type (entity, gizmo, overlay, none)
- entity id or gizmo axis id
- world point and normal
- distance
4. Add strict priority ordering:
- modal overlays
- gizmo handles
- editor entities
- optional fallback world hits
5. Add explicit gizmo exclusion and editor-only include masks.
6. Add hover resolution API separate from click resolution.
7. Add an adapter boundary for future physics-backed picking.

## Integration Targets
- SelectionSystem
- GizmoSystem
- TriggerVolumeTool
- EditorPainterSystem

## Done When
- All viewport tools use the same pick manager.
- Click ordering is deterministic and testable.
- Gizmo clicks never leak into entity selection.
- Hover and click targets are consistent frame to frame.
