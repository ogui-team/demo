# Task 05 — Camera Save/Restore on P-Toggle

## Problem
When you press P to go into play mode and then press P again to return to editor,
the editor camera is at position 0,0,0 instead of where you left it.

## What to do

### Step 1 — Find ModeManager.saveSceneState() and restoreSceneState()

File: `client/src/2-systems/gameplay/modes/ModeManager.ts`

These methods already exist but are stubs that just log a line.

### Step 2 — Save camera position before entering play

```typescript
private savedCameraPosition: { x: number; y: number; z: number } | null = null;
private savedCameraRotation: { x: number; y: number; z: number } | null = null;

private saveSceneState(): void {
  const camera = getCamera(); // import from wherever the camera utility is
  if (camera) {
    this.savedCameraPosition = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.savedCameraRotation = { x: euler.x, y: euler.y, z: euler.z };
  }
  console.log('[Mode] Scene state saved');
}
```

### Step 3 — Restore camera position when returning to editor

```typescript
private restoreSceneState(): void {
  if (!this.savedCameraPosition || !this.savedCameraRotation) {
    console.log('[Mode] No previous scene state to restore');
    return;
  }
  const adapter = getCameraStateAdapter(); // import from CameraStateAdapter
  if (adapter) {
    adapter.applySnapshot({
      position: this.savedCameraPosition,
      rotation: this.savedCameraRotation,
    }, 'editor');
  }
  console.log('[Mode] Scene state restored');
}
```

### Step 4 — Check imports

At the top of `ModeManager.ts`, add whatever imports are needed:
- `getCamera` — search for where it's used in `EditorController.ts`, use the same import
- `getCameraStateAdapter` — same, check `EditorController.ts`
- `THREE` — already imported in most files

## Done when
Press P (enter play), move around, press P again (return to editor) — camera is back where you left it.
