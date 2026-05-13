# Task 16 - Editor Layout System

## Goal
Implement dockable professional editor UI architecture.

## Why
Layout quality strongly affects workflow speed and perceived editor maturity.

## Must Include
- resizable panels
- layout persistence
- tab system
- viewport layouts
- workspace restore

## Scope
- Evolve dock layout from static slots to configurable workspaces.
- Persist and restore user layouts across sessions.

## Implementation Steps
1. Define layout state schema:
- panel docks
- split sizes
- open tabs
- active viewport layout
2. Extend dock manager to support tab containers.
3. Add save and restore to local storage or project config layer.
4. Add viewport layout presets:
- single
- two pane
- quad
5. Add workspace restore on startup with safe fallbacks.
6. Add layout reset command.

## Integration Targets
- EditorDockLayout
- DockManager and DockHandle
- command palette for layout presets

## Done When
- Panels can be resized and tabbed.
- Layout survives app restart.
- Users can switch viewport arrangements quickly.
