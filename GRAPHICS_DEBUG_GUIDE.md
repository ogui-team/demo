# Graphics Pipeline Debug Guide

## Quick Start

1. **Press `G` to enable CrunchyModern pipeline** (starts at debug level 2: passthrough)
2. **Open browser console** (F12)
3. **Test each debug level** to find where it breaks

---

## Debug Levels (0-4)

Test these in order. Each level builds on the previous one.

### Level 0: Disabled
```javascript
window.__debugGraphicsConfig.setDebugLevel(0)
```
**Expected:** Scene renders normally (PS1 pipeline)
**If broken:** Something is very wrong

---

### Level 1: Raw FBO (Simplest)
```javascript
window.__debugGraphicsConfig.setDebugLevel(1)
```
**What it does:** Renders base scene to FBO, displays FBO texture directly (no shaders, no effects)

**Expected:** Scene displays normally
**If black:** FBO is not capturing the scene (problem in Engine.ts or Three.js setup)
**If glitchy:** Texture format or size issue

---

### Level 2: Passthrough Shader
```javascript
window.__debugGraphicsConfig.setDebugLevel(2)
```
**What it does:** Uses passthrough shader - just copies input texture to output (minimal shader test)

**Expected:** Scene displays normally
**If black:** Shader compilation or passthrough material is broken
**If nothing:** Composite render not working
**Next step:** If this works, all shader infrastructure is okay

---

### Level 3: Pixelation Only
```javascript
window.__debugGraphicsConfig.setDebugLevel(3)
```
**What it does:** Passthrough + pixelation shader

**Expected:** Scene displays pixelated (480x270 grid)
**If black:** Pixelation shader has error
**If shows but not pixelated:** Pixelation math is wrong
**Next step:** If this works, effect pass chain works

---

### Level 4: Full Pipeline
```javascript
window.__debugGraphicsConfig.setDebugLevel(4)
```
**What it does:** All effects (pixelation → posterization → film grain → vignette)

**Expected:** Heavy retro aesthetic with crunchy colors and dithering
**If black:** One of the complex passes is broken
**Debug:** Enable verbose logging (see below)

---

## Verbose Logging

Enable detailed logs for every frame:

```javascript
window.__debugGraphicsConfig.debugLevel.verbose = true
window.__debugGraphicsConfig.debugLevel.logEveryFrame = true
```

**Output:** Console will show `[CrunchyModern]` logs with texture info, pass execution, errors

Disable with:
```javascript
window.__debugGraphicsConfig.debugLevel.verbose = false
window.__debugGraphicsConfig.debugLevel.logEveryFrame = false
```

---

## Debug Info Snapshot

Get current state:
```javascript
window.__debugGraphicsConfig.getDebugInfo()
```

Returns:
```javascript
{
  frameCount: 1234,
  baseSceneRenderTarget: true,
  cachedLastOutputTexture: true,
  debugLevel: 2
}
```

- `frameCount`: How many frames have been rendered
- `baseSceneRenderTarget`: Is the FBO being created?
- `cachedLastOutputTexture`: Is the effect output being cached?
- `debugLevel`: Current debug level

---

## Bypass Mode (for comparison)

To see the raw scene without pipeline (for comparison):

```javascript
window.__bypassCrunchyEffects = true
```

Press `G` - should show the scene normally (like PS1 pipeline).

Then:
```javascript
window.__bypassCrunchyEffects = false
```

Press `G` - should show processed version.

---

## Test Sequence

### **Does Level 1 work?**

```javascript
window.__debugGraphicsConfig.setDebugLevel(1)
// Press G in game
```

- ✅ **YES** → FBO rendering is fine, move to Level 2
- ❌ **NO** → Problem is FBO setup, texture format, or canvas size
  - Check console for `[CrunchyModern]` initialization logs
  - Verify `getDebugInfo()` shows `baseSceneRenderTarget: true`

### **Does Level 2 work?**

```javascript
window.__debugGraphicsConfig.setDebugLevel(2)
// Press G in game
```

- ✅ **YES** → Shader pipeline is fine, move to Level 3
- ❌ **NO** → Problem is shader compilation, orthographic camera, or composite mesh
  - Enable logging: `window.__debugGraphicsConfig.debugLevel.verbose = true`
  - Look for shader errors in console

### **Does Level 3 work?**

```javascript
window.__debugGraphicsConfig.setDebugLevel(3)
// Press G in game
```

- ✅ **YES** → Effect passes work, move to Level 4
- ❌ **NO** → Pixelation shader has error
  - Enable verbose logging
  - Check pixelation uniform values: `window.__debugGraphicsConfig.config`

### **Does Level 4 work?**

```javascript
window.__debugGraphicsConfig.setDebugLevel(4)
// Press G in game
```

- ✅ **YES** → Full pipeline working! Turn off verbose logging, enjoy the crunchy aestheticBNX ❌ **NO** → One of the complex passes (posterization, film grain, vignette) is broken
  - Enable verbose logging to see which pass fails
  - Test each individually by uncommenting in CrunchyModernPipeline.ts

---

## Keyboard Shortcuts

- **`G`** - Toggle between CrunchyModern and PS1 pipelines
- **`F6`** - Debug menu (for other engine debug features)

---

## If All Levels are Black

1. Check if `baseSceneRenderTarget` is initialized:
   ```javascript
   window.__debugGraphicsConfig.getDebugInfo()
   ```

2. Check if there are shader compilation errors:
   ```javascript
   window.__debugGraphicsConfig.debugLevel.verbose = true
   window.__debugGraphicsConfig.setDebugLevel(2)
   // Check console
   ```

3. Check if the FBO is being set correctly:
   - Look for `[CrunchyModern] Constructor called` in console (should appear once on startup)
   - Look for `[CrunchyModern] Base scene render target set` (should appear once)

4. If FBO exists but nothing displays:
   - Problem is in composite render (orthographic camera or material issue)
   - Try Level 1 which uses a fresh camera/scene each frame

---

## Config Tweaking

Change effect parameters in real-time:

```javascript
window.__debugGraphicsConfig.applyConfig({
  pixelSize: 2,              // Larger pixels
  colorBits: 4,              // Fewer colors (4-bit)
  ditheringIntensity: 0.8,   // More dithering
  effectFramerate: 15        // 15 FPS jitter instead of 24
})
```

---

## Report Template

When reporting issues, include:

```
Debug Level: [1, 2, 3, or 4]
Result: [black, glitchy, normal, etc.]
Verbose output: [paste relevant console logs]
getDebugInfo(): [paste output]
Config: [paste relevant settings]
```

---

## Next Steps

Once you identify which level breaks, we'll:
1. Add more granular logging to that specific pass
2. Test individual shader code
3. Fix the issue incrementally
4. Move back up the levels one by one
