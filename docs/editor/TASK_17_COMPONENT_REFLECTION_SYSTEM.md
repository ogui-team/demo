# Task 17 - Component Reflection System

## Goal
Generate inspector UI automatically from component schemas.

## Why
Prevents hardcoded inspector growth from becoming unmaintainable.

## Must Include
- typed reflection metadata
- property categories
- editable field definitions
- validation hooks
- serialization integration

## Scope
- Introduce schema metadata for component field definitions.
- Use metadata to render inspector editors dynamically.

## Implementation Steps
1. Define reflection schema format per component type:
- field key
- type
- label
- category
- editor widget kind
- validation rules
2. Add registry for component reflection metadata.
3. Build generic inspector renderer from metadata.
4. Add field-level validation and error display hooks.
5. Map edits to EDITOR_UPDATE_COMPONENT with typed coercion.
6. Align with scene serialization field naming and defaults.

## Integration Targets
- ComponentInspector event bridge
- InspectorPanel rendering layer
- command stack for property edits

## Done When
- New components appear in inspector without custom UI code.
- Validation errors are visible and non-destructive.
- Serialization uses same field contracts as inspector editing.
