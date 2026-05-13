# Task 01 — Entity Renderer Fallback

## Problem
In the editor, entities spawn but are invisible because the renderer can't find their asset.
Console shows: `[EntityRenderer] Missing custom asset instance; keeping entity invisible`

## What to do

Find the file that logs that warning. Search for:
```
Missing custom asset instance
```

In that file, find the code that sets the entity invisible and add a fallback wireframe box:

```typescript
// BEFORE (something like this):
if (!assetInstance) {
  console.warn('[EntityRenderer] Missing custom asset instance; keeping entity invisible', ...);
  return; // or mesh.visible = false
}

// AFTER:
if (!assetInstance) {
  console.warn('[EntityRenderer] Missing custom asset instance; keeping entity invisible', ...);
  // Add fallback wireframe box so entity is visible in editor
  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true })
  );
  fallback.userData.isFallbackMesh = true;
  // attach fallback to wherever the entity mesh normally goes
  // look at how real meshes are attached in this file and do the same
}
```

## Notes
- Only do this when NOT in play mode, or always — doesn't matter much for now
- The fallback box does not need physics, collision, or anything — just visibility
- Size 1x1x1 is fine as a default
- Color `0x888888` (grey wireframe) makes it obvious it's a placeholder

## Done when
Entities placed with Q menu or spawned in editor are visible as grey wireframe boxes.
