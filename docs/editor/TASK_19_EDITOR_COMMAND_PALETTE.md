# Task 19 - Editor Command Palette

## Goal
Create a universal editor action launcher.

## Why
Search-first command workflows scale much better than deep menu navigation.

## Must Include
- searchable commands
- keyboard-first workflows
- editor action registry
- quick entity actions

## Scope
- Build a command registry and palette UI with fuzzy search.
- Expose both global and selection-scoped editor actions.

## Implementation Steps
1. Define command registry API:
- id
- label
- category
- hotkey hint
- execute callback
- availability predicate
2. Build command palette modal UI with search input and results list.
3. Add keyboard open shortcut and navigation keys.
4. Add scoped command support for selected entities.
5. Add integration points for layout, tools, and diagnostics commands.
6. Add command usage telemetry hooks.

## Integration Targets
- EditorEventRouter
- selection state provider
- dock and layout systems

## Done When
- Users can launch key editor actions from search.
- Palette supports keyboard-only workflows.
- Command list is registry-driven, not hardcoded in UI.
