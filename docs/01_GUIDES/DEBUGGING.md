# 🐛 Debugging Guide

**Debug Console Commands & Strategies**  
Paste these in the browser console (F12) while in-game.

---

## 📊 Debug Menu (Press F6)

The in-game debug menu (F6 key) provides:
- Performance metrics (FPS, frame time, draw calls)
- Entity statistics
- Network diagnostics
- System status
- Memory profiling

**See**: [DEBUG_MENU_F6_GUIDE.md](DEBUG_MENU_F6_GUIDE.md) for full F6 reference

---

## 🔍 Console Commands

### Lazy-Load Monitoring
```javascript
// Run LAZY_LOAD_DEBUG_SCRIPT.js - monitors chunk loading
// Copy the entire script from root folder and paste in console
```

### Performance Profiling
```javascript
// Measure frame time
console.time('frame');
// ... do something
console.timeEnd('frame');
```

### Network Status
```javascript
// Check WebSocket connection
engine.network?.ws?.readyState  // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
engine.network?.debugNetworkStats()  // Show connection metrics
```

### Entity Queries
```javascript
// Get entity count
engine.entities.getAll().length

// Find specific entity
const player = engine.entities.findByTag('player');
console.log(player);

// List all entities
engine.entities.getAll().forEach(e => console.log(e));
```

---

## 🎮 Common Issues & Solutions

### "Game won't load"
1. Open F12 console
2. Check for red errors
3. Run `LAZY_LOAD_DEBUG_SCRIPT.js` to check chunk loading
4. Look for failed network requests (Network tab)

### "Performance is slow"
1. Press F6 to open debug menu
2. Check draw calls and entity count
3. Run profiler: `console.profile('render'); /* wait 10s */ console.profileEnd('render');`
4. Look for spike in JavaScript or rendering time

### "Multiplayer not connecting"
1. Ensure server is running: `cd server && npm run dev`
2. Check browser console for connection errors
3. Verify localhost:8080 is accessible
4. Look at WebSocket status in console: `engine.network?.ws?.readyState`

### "Entities not syncing"
1. Check Network tab for message frequency
2. Use `engine.network?.debugNetworkStats()`
3. Verify server is receiving updates
4. Check for lag (look at ping in debug menu F6)

---

## 🚀 Development Workflow

### Making Changes
1. Edit code in `client/src/`
2. Webpack auto-rebuilds
3. Browser auto-refreshes (if webpack-dev-server running)
4. Check F12 console for any errors

### Testing Locally
```bash
# Terminal 1 - Start client (with hot reload)
cd client && npm run dev

# Terminal 2 - Start server
cd server && npm run dev

# Then open: http://localhost:3000
```

### Production Build
```bash
cd client && npm run build
# Creates optimized dist/ folder
```

---

## 📈 Performance Metrics (F6 Debug Menu)

| Metric | Target | Notes |
|--------|--------|-------|
| **FPS** | 60 | Frame rate |
| **Frame Time** | <16ms | At 60fps |
| **Draw Calls** | <100 | GPU calls per frame |
| **Entity Count** | <5000 | Active entities |
| **Memory** | <150MB | Browser heap |

---

## 🔗 Related Docs

- [DEBUG_SYSTEM.md](DEBUG_SYSTEM.md) — Debug infrastructure details
- [DEBUG_MENU_F6_GUIDE.md](DEBUG_MENU_F6_GUIDE.md) — Full F6 menu reference
- [../LAZY_LOAD_DEBUG_SCRIPT.js](../LAZY_LOAD_DEBUG_SCRIPT.js) — Chunk loading monitor

