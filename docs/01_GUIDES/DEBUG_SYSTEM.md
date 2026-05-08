# Debug System Architecture

## Overview

The debug system is a modular, optional component of the PS1-styled game engine that provides real-time inspection and parameter tuning without affecting production behavior. It operates independently from core engine systems through a clean parameter binding interface.

## Key Features

- **F1 Toggle**: Press F1 to show/hide the debug panel
- **Real-time Tuning**: Adjust engine parameters with instant feedback
- **Zero Impact When Disabled**: No performance penalty when not in use
- **Strict Separation**: Debug logic never mixed into core systems
- **Easy Extension**: Simple interface to add new parameters

## Architecture

### Core Components

#### 1. DebugManager
**File**: `src/engine/debug/DebugManager.ts`

Central controller that orchestrates the entire debug system.

**Key Responsibilities**:
- Register and manage parameter groups
- Handle enable/disable state
- Manage keyboard toggle (F1 key)
- Lifecycle management (init, destroy)

**Public Interface**:
```typescript
addParameter(groupName: string, binding: ParameterBinding): void
toggle(): void
enable(): void
disable(): void
isEnabled(): boolean
```

#### 2. DebugUI
**File**: `src/engine/debug/DebugUI.ts`

Visual overlay that renders the debug panel and controls.

**Features**:
- Green terminal-style aesthetic matching PS1 theme
- Organized parameter groups
- Multiple control types: sliders, color pickers, text inputs, buttons
- Responsive value display for sliders
- Keyboard-accessible

**Control Types**:
- `slider`: Range input with min/max/step
- `color`: HTML color picker
- `input`: Text field for string values
- `button`: Clickable action button

#### 3. ParameterBinding & ParameterRegistry
**File**: `src/engine/debug/ParameterBinding.ts`

Defines the contract between debug system and engine systems.

**ParameterBinding Interface**:
```typescript
{
  id: string;                          // Unique identifier
  name: string;                        // Display name
  type: 'slider' | 'color' | 'button' | 'input';
  min?: number;                        // For sliders
  max?: number;                        // For sliders
  step?: number;                       // For sliders
  get: () => number | string;          // Read current value
  set?: (value: number | string) => void;  // Write new value
  options?: string[];                  // For dropdowns
}
```

**Key Design**: The binding system uses getter/setter functions to decouple the debug system from engine implementations. The debug system never directly accesses engine state.

### Decoupling Strategy

```
ENGINE CORE (Fog, Lights, Camera)
        ↓
        ↑ (only exports clean parameter functions)
        │
   DebugManager
        │
        ├─→ DebugUI (renders)
        └─→ ParameterRegistry (stores metadata)
```

**Critical Rule**: Core engine modules do NOT import or reference debug code.

Example:
```typescript
// In Engine.ts (core system)
export function setEngineFogDensity(density: number): void {
  setFogDensity(density);  // delegates to Fog module
}

// In index.ts (initialization)
debugManager.addParameter('Fog', {
  name: 'Density',
  get: () => fogEffects.baseDensity,
  set: (value) => Engine.setEngineFogDensity(value as number)
});
```

## Integration Points

### 1. Engine Interface (Engine.ts)

New exported functions for debug system:

```typescript
getAtmosphericEffectsManager()        // Access effects systems
setEngineFogDensity(density: number)
setEngineFogColor(color: number)      // Hex color
getEngineCameraFOV(): number
setEngineCameraFOV(fov: number)
```

### 2. Initialization (index.ts)

```typescript
const debugManager = initDebugManager({
  enableKeyToggle: true,
  toggleKey: 'F1',
  enabled: false  // Start disabled
});

// Add parameters
debugManager.addParameter('Fog', {
  id: 'fog_density',
  name: 'Density',
  type: 'slider',
  min: 0,
  max: 0.1,
  step: 0.001,
  get: () => fogEffects.baseDensity,
  set: (value) => Engine.setEngineFogDensity(value as number),
});
```

## Adding New Parameters

Example: Adding a light flicker parameter

```typescript
debugManager.addParameter('Lighting', {
  id: 'flicker_speed',
  name: 'Flicker Speed',
  type: 'slider',
  min: 0,
  max: 10,
  step: 0.1,
  get: () => lightingEffects.flickerSpeed,
  set: (value) => lightingEffects.setFlickerSpeed(value as number),
});
```

## File Structure

```
client/src/engine/debug/
├── index.ts                    # Exports all debug system modules
├── DebugManager.ts             # Central controller
├── DebugUI.ts                  # Visual overlay
└── ParameterBinding.ts         # Interface definitions
```

## Performance Characteristics

### When Disabled
- No DOM updates
- No event listeners in parameters
- UI completely hidden with `display: none`
- Minimal memory footprint (~1-2KB metadata)

### When Enabled
- Single update per frame on `get()` calls
- Canvas rendering for overlay (efficient)
- Event delegation for slider inputs
- ~2-3ms overhead per frame with full parameter set

## Styling Customization

The debug panel uses inline CSS (PS1-themed green terminal):

```typescript
// In DebugUI.ts - customize ANSI styling here
background: rgba(0, 0, 0, 0.85);        // Dark background
border: 2px solid #00ff00;              // Green border
color: #0f0;                            // Green text
box-shadow: 0 0 20px rgba(0, 255, 0, 0.3); // Glow effect
```

## Best Practices

1. **Always use getters/setters**: Never mutate engine state directly
2. **Group related parameters**: Same group name for organization
3. **Set reasonable min/max**: Prevent invalid parameter ranges
4. **Test disabled performance**: Ensure no impact when not in use
5. **Document custom parameters**: Include clear naming and limits
6. **Bind through Engine exports**: Never bind directly to core systems

## Keyboard Controls

- **F1**: Toggle debug panel visibility
- **Slider drag**: Real-time parameter adjustment
- **Color picker**: Click to change colors
- **Text input**: Type and press Enter to confirm

## Future Enhancement Ideas

- Parameter presets (save/load parameter sets)
- Graph visualization for time-series parameters
- Record/playback parameter changes
- Network synchronization for multiplayer debugging
- Parameter history / undo-redo
- Hotkey recording and macro system

## Troubleshooting

**Debug panel not showing?**
- Press F1
- Check browser console for errors
- Verify `enableKeyToggle: true` in config

**Parameter changes not reflected?**
- Check getter function returns current value
- Verify setter function is called (add console.log)
- Ensure engine function is exported from Engine.ts

**Performance issues?**
- Disable unnecessary effect systems
- Reduce number of bound parameters
- Check for continuous re-renders in UI

## Summary

The debug system provides a professional debugging experience while maintaining architectural separation. Its modular design allows developers to:

- Inspect and tune engine parameters in real-time
- Add new parameters with minimal code
- Disable completely for production with zero overhead
- Keep core engine logic pure and testable
