# Task 14 - Asset Browser

## Goal
Introduce a real content browser.

## Why
This transitions the editor from scene manipulation to content pipeline tooling.

## Must Include
- asset registry
- thumbnails
- drag-drop spawning
- prefab spawning
- folder indexing
- future metadata support

## Scope
- Build a browser panel backed by indexed content registry data.
- Support direct spawning into viewport via drag and drop.

## Implementation Steps
1. Create AssetRegistry service with indexed entries and folder paths.
2. Define asset record schema:
- id
- kind
- path
- thumbnail reference
- tags and metadata placeholders
3. Build browser panel with folder tree and asset grid.
4. Add thumbnail loading and fallback visuals.
5. Add drag-drop from browser to viewport spawn flow.
6. Connect prefab asset entries to PrefabPlacementSystem spawn calls.

## Integration Targets
- Dock layout panel system
- PrefabPlacementSystem
- future command stack for spawn undo

## Done When
- Assets are browsable by folder.
- Prefab assets can be dragged into the viewport.
- Browser architecture supports metadata expansion later.
