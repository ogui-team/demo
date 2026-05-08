# ⚡ Solo Developer Quick Checklist

**Fast reference for common tasks** — Copy & use!

---

## 🚀 Starting Development

```bash
# Terminal 1 - Start client with hot reload
cd client && npm run dev
# Open http://localhost:3000

# Terminal 2 - Start server
cd server && npm run dev

# Terminal 3 (Optional) - Watch for TypeScript errors
cd client && npm run type-check
```

**Docs**: [00_START_HERE/QUICK_START.md](../00_START_HERE/QUICK_START.md)

---

## 🐛 Debugging Workflow

### 1. **In-Game Debug Menu**
- Press **F6** in game
- Shows: FPS, draw calls, entity count, memory, network status

**Docs**: [DEBUG_MENU_F6_GUIDE.md](DEBUG_MENU_F6_GUIDE.md)

### 2. **Browser Console (F12)**
Run these commands:
```javascript
// Check chunk loading
// Paste entire LAZY_LOAD_DEBUG_SCRIPT.js

// Network connection status
engine.network?.ws?.readyState  // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED

// Entity count
engine.entities.getAll().length

// Performance profile
console.profile('render');
// wait 10 seconds
console.profileEnd('render');
```

**Docs**: [DEBUGGING.md](DEBUGGING.md)

---

## 📦 Performance Optimization

### Check Bundle Size
```bash
cd client
ANALYZE_BUNDLE=true npm run build
# Opens: dist/bundle-report.html
```

### Profile Runtime Performance
1. Press **F6** in game
2. Check Frame Time (target: <16ms at 60fps)
3. Check Draw Calls (target: <100)
4. Check Entity Count (target: <5000)

**Docs**: [../05_PERFORMANCE/LAZY_LOAD_INTEGRATION.md](../05_PERFORMANCE/LAZY_LOAD_INTEGRATION.md)

---

## 🌐 Multiplayer Testing

### Test Locally
1. Start server: `cd server && npm run dev`
2. Open client on PC: `http://localhost:3000`
3. Open client on phone (same network): `http://<your-ip>:3000`
4. Both should see each other

### Debug Network Issues
- Check server console for errors
- Open F12 → Network tab
- Filter for WebSocket connections
- Run `engine.network?.debugNetworkStats()` in console

**Docs**: [../04_MULTIPLAYER/NETWORK_DIAGNOSTICS_FINDINGS.md](../04_MULTIPLAYER/NETWORK_DIAGNOSTICS_FINDINGS.md)

---

## 🎮 Game Editor

### Launch In-Game Editor
1. Start game in freeplay mode
2. Press **`** (backtick) key
3. Select "Editor" from menu

### Editor Controls
- **Right-click** → Select entity
- **G** → Toggle gizmo (move/rotate/scale)
- **Spacebar** → Focus selected entity
- **Delete** → Remove entity

**Docs**: [EDITOR_QUICK_START.md](EDITOR_QUICK_START.md)

---

## 📝 Code Changes Workflow

### Making Changes
```
Edit code in client/src/
  ↓
Webpack auto-rebuilds (watch mode)
  ↓
Browser auto-refreshes (HMR)
  ↓
Check console for errors (F12)
  ↓
Done! ✅
```

### If Hot Reload Breaks
1. Hard refresh: **Ctrl+Shift+R** (Chrome) or **Cmd+Shift+R** (Mac)
2. If still broken: Stop webpack (Ctrl+C), restart `npm run dev`
3. Check console for TypeScript errors

---

## 🔄 Build Process

### Development
```bash
npm run dev        # Start webpack watch + dev server
```

### Production
```bash
npm run build      # Create optimized dist/
```

### Type Checking
```bash
npm run type-check # Find TypeScript errors (without building)
```

---

## 📊 Current Status

**Get live project status:**
→ Open [../00_START_HERE/CURRENT_OVERVIEW.md](../00_START_HERE/CURRENT_OVERVIEW.md)

Shows:
- Current phase (✅ Phase 3 LOCKED)
- Build status (✅ ZERO ERRORS)
- Performance (TTI ~350ms)
- Blocked items (🟢 NONE)

---

## 🗺️ Find Documentation

**Master navigation:**  
→ Open [../INDEX.md](../INDEX.md)

Use "Quick Task Lookup" table to find:
- Guides for getting started
- Architecture deep dives
- System references
- Performance optimization
- Multiplayer troubleshooting
- Feature planning
- Changelogs

---

## 💾 Saving Your Work

### Auto-Save (Webpack)
- Code changes auto-save to webpack bundle
- Browser auto-refreshes on save

### Manual Save
- Always save file after edit (Ctrl+S in VS Code)
- Webpack watches automatically

### Commit to Git
```bash
git add .
git commit -m "Your message"
git push
```

---

## 🚨 Common Problems & Fixes

| Problem | Fix |
|---------|-----|
| Port 3000 in use | `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess \| Stop-Process -Force` |
| Build fails | Delete `client/.webpack_cache` and rebuild |
| Hot reload broken | Hard refresh (Ctrl+Shift+R) or restart `npm run dev` |
| Multiplayer not working | Check server is running (`cd server && npm run dev`) |
| Slow performance | Press F6, check draw calls and entity count |
| Entities don't appear | Check editor loaded correctly, verify entity has model |

---

## 📚 Documentation Folders

```
📂 docs/
├── 00_START_HERE/    ← Getting started here
├── 01_GUIDES/        ← How-to guides (includes DEBUGGING.md)
├── 02_ARCHITECTURE/  ← System design
├── 03_SYSTEMS/       ← Individual systems
├── 04_MULTIPLAYER/   ← Networking
├── 05_PERFORMANCE/   ← Optimization
├── 06_PHASES/        ← Roadmap
├── 07_REFERENCE/     ← Audits & changelogs
└── _ARCHIVE/         ← Historical docs
```

**Quick nav**: Open [../INDEX.md](../INDEX.md) first!

---

**Version**: v0.1.4  
**Last Updated**: April 17, 2026  
**For**: Solo Developer  

