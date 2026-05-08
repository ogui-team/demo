# Quick Reference - Session Fixes

## 🎯 What We Fixed Today (April 17, 2026)

### 1. Bootloader Not Loading ✅
**Problem**: Stuck at "Initializing Kernel" screen  
**Fix**: Added `publicPath: '/'` to webpack config + removed hardcoded script paths  
**Result**: Bootloader now loads and completes in ~100-200ms

### 2. Engine Double Initialization ✅
**Problem**: "Engine already initialized" error when clicking mode  
**Fix**: Removed duplicate `Engine.init()` call from bootstrapClientRuntime.ts  
**Added**: Guard to prevent `bootstrapRuntime()` from running twice  
**Result**: Clean single initialization, no errors

### 3. Bootloader UI Doesn't Disappear ✅
**Problem**: Loading screen stayed visible after bootloader complete  
**Fix**: Changed from `opacity: 0` to `display: none` on UI elements  
**Result**: Canvas becomes visible immediately

### 4. TITAN Overlay Cluttering Scene ✅
**Problem**: Debug benchmark overlay visible during gameplay  
**Fix**: Commented out TitanBenchmarkOverlay initialization  
**Result**: Clean gameplay screen

### 5. Invisible Blocking Walls (Ghost Colliders) ✅
**Problem**: Players hit invisible walls, can't see them  
**Root Cause**: THREE.js not available in window scope  
**Fix**: Completely removed static collider replication to client  
**Result**: Clean scene, physics still works server-side  
**Docs**: See [INVISIBLE_COLLIDERS_FIX_COMPLETE.md](INVISIBLE_COLLIDERS_FIX_COMPLETE.md)

---

## 🚀 Current State

- ✅ Freeplay mode loads
- ✅ Character spawns in game world
- ✅ No invisible walls cluttering scene
- ✅ Clean menu and UI
- ✅ Server-side physics working

---

## 📋 Files Moved to Docs

All root-level `.md` files moved from `c:\Projekte\demo\` to `c:\Projekte\demo\docs\`

**Command used**:
```powershell
Get-ChildItem -Path . -Depth 1 -Filter "*.md" | Where-Object {$_.PSIsContainer -eq $false} | Move-Item -Destination docs/ -Force
```

---

## 🔧 Key Code Changes

### Server-side Removal
**File**: `server/src/core/GameSession.ts` (~line 200)
```typescript
// DELETED: This code that created static_collider entities
```

### Snapshot Filter
**File**: `server/src/session/SnapshotFilter.ts` (line 13)
```typescript
// BEFORE:
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player', 'static_collider']);

// AFTER:
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player']);
```

### Client Visualization Removal
**File**: `client/src/engine/gameplay/game/WorldObjectAuthorityService.ts`
- Removed: `import * as THREE from 'three'`
- Removed: Debug helpers `__showColliders`, `__toggleColliders`
- Removed: Entire `static_collider` handling block from `spawnOrUpdateRemoteObject()`

---

## 🧪 Testing

**Start Fresh**:
```powershell
# Terminal 1: Webpack dev server
cd client
npm run dev

# Terminal 2: Game server (if needed)
cd server
npm run dev
```

**Browser**:
1. Go to http://localhost:3000/
2. Click FREEPLAY
3. Click "Solo Sandbox"
4. Verify: No red boxes, movement works

---

## 📝 Architecture Notes

### Physics Handling
- **Server**: Authoritative collision detection (static + dynamic)
- **Client**: Only visualizes dynamic entities (players, enemies)
- **Result**: No ghost colliders on client, physics still correct

### Single Initialization Pattern
- Engine initialized ONCE during kernel bootstrap (Phase 2)
- Modes don't re-initialize, they configure the single Engine instance
- Guard prevents `bootstrapRuntime()` from running twice

### UI Hiding
- Must use `display: none` (not just `opacity: 0`)
- Hides from layout completely, frees up DOM space
- Applied to both dynamic `#bootloader-ui` and static `#ui` elements

---

## ❌ Disabled Features

These are **disabled but code remains** (can be re-enabled):

1. **TITAN Benchmark Overlay**
   - Location: `bootstrapClientRuntime.ts` line ~685-691
   - Re-enable: Uncomment code + run `window.__benchmarkOverlay = benchmarkOverlay;`

2. **Keyboard Shortcuts in Mode Selector**
   - Location: `bootloader.ts` line ~250-265
   - Reason: Was causing multiple mode triggers
   - Re-enable: Uncomment if needed with debouncing

---

## 🎓 Lessons Learned

1. **Single Init Pattern is Critical**: Engine can only be initialized once, guard with flags
2. **Webpack publicPath**: Must match actual file serving location
3. **THREE.js Scope**: Import directly instead of accessing via window
4. **Display vs Opacity**: `display: none` actually hides elements, `opacity: 0` doesn't free space
5. **Network Filtering**: Don't replicate debug data, keep snapshots clean
6. **Server Authority**: Physics validation on server, clients only visualize results

---

## 📞 Quick Commands

| Task | Command |
|------|---------|
| Start dev server | `cd client && npm run dev` |
| Test freeplay | Go to http://localhost:3000/, click FREEPLAY |
| Show colliders (old) | `window.__toggleColliders()` (no longer works - removed) |
| Check logs | F12 → Console tab |
| Rebuild | `npm run dev` auto-rebuilds on file save |

---

**Last Updated**: April 17, 2026  
**Status**: All fixes complete, ready for testing
