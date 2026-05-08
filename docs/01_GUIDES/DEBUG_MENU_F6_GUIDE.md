# Debug Menu System - F6 Toggle Guide

## 🎯 Overview

The **Debug Menu** is an F6-toggled overlay UI that allows runtime inspection and toggles for debug features during gameplay. This replaces the removed `__toggleColliders()` function with a more comprehensive system.

---

## 🎮 How to Use

### Opening/Closing the Debug Menu
Press **F6** on your keyboard at any time during gameplay to toggle the debug menu on/off.

### Debug Menu Features

The debug menu displays:
- **Toggle Buttons** (clickable or via keyboard)
  - `[✓] Colliders` - Show/hide red transparent collider boxes
  - `[✓] Performance Metrics` - Display FPS and performance data
  - `[ ] Physics Debug` - Physics-specific debugging (future)

- **Live Metrics**
  - Current FPS estimate
  - Number of colliders in scene
  - Current time

---

## 🔴 Colliders Visualization

### What You're Seeing

- **Red Semi-transparent Boxes** = Static collision geometry
- **Opacity 15%** = Visible but won't obscure gameplay
- **Real-time Updates** = Positions sync with server data

### Toggle Collider Visibility

**Method 1: Click in Debug Menu**
```
Press F6 → Click [✓] Colliders line
```

**Method 2: Console Command**
```javascript
// In browser DevTools console (F12)
window.__debugToggleColliders()
```

---

## 🔧 Technical Details

### Files Modified

1. **client/src/engine/runtime/DebugMenu.ts** (NEW)
   - 170+ lines of debug UI code
   - F6 listener and state management
   - Collider visibility toggling
   - Menu rendering and updates

2. **client/src/engine/runtime/bootstrapClientRuntime.ts**
   - Added: `import { initDebugMenu }`
   - Added: `initDebugMenu()` call
   - Added: `(window as any).__Engine = Engine` for debug access

3. **client/src/engine/gameplay/game/WorldObjectAuthorityService.ts**
   - Restored: THREE.js import
   - Restored: Static collider entity handling
   - Creates red transparent boxes for each collider
   - Cleans up meshes on removal

4. **server/src/session/SnapshotFilter.ts**
   - Changed: `['player']` → `['player', 'static_collider']`
   - Result: Static colliders now sent to client

5. **server/src/core/GameSession.ts**
   - Added: Collider entity creation from static layout
   - Creates `static_collider` type entities for each box
   - Includes metadata with half-extents for visualization

---

## 📊 Debug Menu Code Reference

### Opening Menu
```typescript
// Press F6 to toggle
const debugMenuVisible = true; // Shows overlay
```

### Collider Toggle Function
```typescript
export function toggleColliders(): void {
  debugState.collidersVisible = !debugState.collidersVisible;
  setColliderVisibility(debugState.collidersVisible);
  updateDebugMenuContent();
}
```

### Collider Visibility Control
```typescript
function setColliderVisibility(visible: boolean): void {
  const Engine = (window as any).__Engine;
  const scene = Engine.getEngineScene?.();
  
  scene.traverse((obj: any) => {
    if (obj.userData?.debugType === 'staticCollider') {
      obj.visible = visible;
    }
  });
}
```

---

## 🌐 Multi-Mode Testing

You can now verify colliders in all game modes:

| Mode | How to Access | What to Check |
|------|--------------|---------------|
| **Freeplay** | Press FREEPLAY → Solo Sandbox | No invisible walls, smooth movement |
| **Multiplayer** | Start server + join | Colliders consistent across clients |
| **Editor** | Press EDITOR | Collider placement relative to objects |

### Testing Procedure

1. Start game and select mode (FREEPLAY/MULTIPLAYER/EDITOR)
2. Once in-game, press **F6** to show debug menu
3. Verify red boxes appear around obstacles
4. Click `[✓] Colliders` to toggle visibility on/off
5. Move character around to test collision detection

---

## 💡 What Changed From Before

| Feature | Before | Now |
|---------|--------|-----|
| **Collider Visibility** | Hidden/no toggle option | Red boxes, F6 menu toggle |
| **Debug Access** | `window.__toggleColliders()` | Comprehensive F6 menu |
| **Multi-Mode Support** | Only Freeplay | All modes: Freeplay, Multiplayer, Editor |
| **UI Design** | Basic text | Green-on-black matrix style, clickable buttons |
| **Auto-Update** | Manual refresh | Every 100ms when visible |

---

## 🎓 Advanced Usage

### Keyboard Shortcuts (Planned)
Future versions may support:
- **F6** = Toggle menu (ACTIVE)
- **F7** = Toggle colliders only (PLANNED)
- **F8** = Performance overlay (PLANNED)

### Console Access
All debug functions exposed to window:
```javascript
// In browser console (F12)
window.__debugToggleColliders()      // Toggle colliders
window.__debugToggleMetrics()        // Toggle metrics
window.__debugTogglePhysics()        // Toggle physics debug
window.__debugMenuUpdateContent()    // Force menu refresh
```

### Checking Collider Count
```javascript
// In browser console
const scene = window.__Engine?.getEngineScene?.();
let count = 0;
scene?.traverse(obj => {
  if (obj.userData?.debugType === 'staticCollider') count++;
});
console.log(`Total colliders: ${count}`);
```

---

## 🐛 Troubleshooting

### Debug Menu Not Appearing
**Issue**: F6 pressed but menu doesn't show
**Solution**: 
1. Make sure you're in the game (not just bootloader)
2. Check browser console (F12) for errors
3. Verify: `window.__Engine` exists

### Colliders Not Visible
**Issue**: No red boxes appearing
**Solution**:
1. Press F6 to open debug menu
2. Verify `[✓] Colliders` shows checkmark
3. Check if `[✓]` has checkmark - if not, click to enable
4. Make sure you're on a map with colliders (freeplay/sandbox has many)

### Menu Stuck/Unresponsive
**Issue**: Can't click buttons or close menu
**Solution**:
1. Press F6 again to toggle off
2. If still stuck, refresh page (F5)
3. Check browser console for JavaScript errors (F12)

---

## 📝 Next Steps

### For Gameplay Testing
1. ✅ Colliders visible in Freeplay (verify positions)
2. ✅ Colliders toggle on/off properly
3. ✅ No performance impact
4. ⏳ Test in Multiplayer mode
5. ⏳ Test in Editor mode
6. ⏳ Document any incorrect collider placements

### For Future Development
- Add collider highlighting on mouse hover
- Show collider metadata (ID, size, etc.) on inspect
- Network collider count comparison (server vs client)
- Physics force visualization
- Raycast debugging

---

## 🔐 Security Note

Debug menu is **development-only**. Before production:
- Remove debug menu import and initialization
- Remove `window.__Engine` exposure
- Disable debug console functions
- Recompile with production build

```typescript
// Production version (DO NOT ship with debug menu):
// import { initDebugMenu } from './DebugMenu'; // ← REMOVE
// initDebugMenu(); // ← REMOVE
// (window as any).__Engine = Engine; // ← REMOVE
```

---

**Status**: Ready for multi-mode testing  
**Last Updated**: April 17, 2026  
**Created By**: Agent with user guidance
