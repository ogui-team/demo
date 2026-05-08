# GizmoSystem - Quick Reference Guide

## Editor Workflow

### Basic Object Manipulation

#### 1. Spawn an Object
- Press **M** to open Editor Menu
- Click a spawn button (Cube, Sphere, Plane, Script Gate)
- Object appears in the scene

#### 2. Select the Object
- **Left-click** on the object in the 3D view
- Object is selected (highlighted in entity list)
- **Red/Green/Blue arrows appear** (the gizmo!)

#### 3. Move the Object (Translate)
Default mode when selected.

**Move along X axis (red):**
- Drag the red arrow left/right

**Move along Y axis (green):**
- Drag the green arrow up/down

**Move along Z axis (blue):**
- Drag the blue arrow forward/backward

#### 4. Rotate the Object
Press **R** (or click in properties to rotate):
- Arrows change appearance (rotation mode)
- Drag arrows to rotate around that axis

**Rotate around X axis (red):**
- Drag red arrow to rotate forward/backward

**Rotate around Y axis (green):**
- Drag green arrow to rotate left/right

**Rotate around Z axis (blue):**
- Drag blue arrow to rotate clockwise/counter-clockwise

#### 5. Scale the Object
Press **S** (future feature):
- Arrows become small scale handles
- Drag along axis to grow/shrink along that direction

### Keyboard Shortcuts (Proposed)

| Key | Action |
|-----|--------|
| **M** | Open/Close Editor Menu |
| **Click Object** | Select entity |
| **T** | Switch to Translate mode |
| **R** | Switch to Rotate mode |
| **S** | Switch to Scale mode |
| **Delete** | Delete selected entity |
| **ESC** | Deselect entity |

### Visual Indicators

#### Gizmo Colors
- 🔴 **Red** = X Axis (left/right)
- 🟢 **Green** = Y Axis (up/down)
- 🔵 **Blue** = Z Axis (forward/backward)

#### Gizmo Appearance by Mode
- **Translate**: Three directional arrows
- **Rotate**: Rotation indicator arrows
- **Scale**: Smaller scale-handle arrows

#### Selection Feedback
- Entity highlighted in menu
- Gizmo appears at entity position
- Properties panel shows transform values

### Common Tasks

#### Move Object 5 units on X-axis
1. Select object (click it)
2. Drag red arrow roughly 5 units
3. Check X value in Properties
4. Adjust as needed

#### Rotate 90 degrees around Y-axis
1. Select object
2. Press R (or click axis indicator)
3. Drag green arrow
4. Check Rotation Y in Properties
5. Fine-tune if needed

#### Position Object at Center
1. Select object
2. In Properties panel
3. Set Position X: 0, Y: 0, Z: 0
4. Click away to confirm

#### Make Object Invisible
1. Select object
2. In Properties → Attributes
3. Check "Invisible" checkbox

### Tips & Tricks

#### Precision Movement
- Drag axes slowly for fine-grained control
- Watch the Properties panel for exact values
- Edit values directly in Properties for precision

#### Compound Transforms
- Move object first (Translate mode)
- Then rotate (Rotate mode)
- Then scale (Scale mode)

#### Grid Snap (Future)
- Enable in advanced settings
- Objects snap to grid increments
- Great for level design

#### Undo/Redo (Future)
- Ctrl+Z to undo last change
- Ctrl+Y or Ctrl+Shift+Z to redo

### Troubleshooting

#### Gizmo Not Appearing
- ✓ Is object selected? (Click it)
- ✓ Is Editor Menu visible? (Press M)
- ✓ Are you in Editor Mode? (Not Play mode)

#### Can't Drag Gizmo
- ✓ Click directly on the colored arrow
- ✓ Make sure left mouse button is used
- ✓ Verify object is selected

#### Position Not Updating
- ✓ Ensure drag is on viewport, not UI
- ✓ Check Properties panel for value
- ✓ Gizmo updates in real-time

#### Changes Reverted After Manipulation
- ✓ Changes should persist
- ✓ Check StateManager via console
- ✓ Refresh page if needed

### Technical Details for Developers

#### What Happens Behind the Scenes

1. **Selection**: SelectionSystem raycasts scene
2. **Gizmo Creation**: GizmoSystem creates arrows at position
3. **Drag Detection**: Raycaster tests gizmo hits
4. **Transform Update**: StateManager updates entity.transform
5. **Sync**: EntityRenderer syncs mesh from StateManager
6. **Render**: Three.js renders updated mesh

#### StateManager Keys Used
```
entities.{entityId}.position  // {x, y, z}
entities.{entityId}.rotation  // {x, y, z} in radians
entities.{entityId}.scale     // {x, y, z}
```

#### Integration Points
- **SelectionSystem**: Entity selection → Gizmo attachment
- **StateManager**: Transform storage → Gizmo reads/writes
- **EntityRenderer**: Visual sync from state changes
- **ModeManager**: Mode-based enable/disable

### Play Mode

When you switch to **Play Mode**:
- ✗ Gizmo automatically hides
- ✗ Clicking objects doesn't select them
- ✓ Player movement works normally
- ✓ Game logic executes

Return to **Editor Mode** to continue editing.

### Entity Properties Reference

#### Transform Properties
| Property | Type | Range | Unit |
|----------|------|-------|------|
| Position X | float | unlimited | World units |
| Position Y | float | unlimited | World units |
| Position Z | float | unlimited | World units |
| Rotation X | float | -π to π | Radians |
| Rotation Y | float | -π to π | Radians |
| Rotation Z | float | -π to π | Radians |
| Scale X | float | 0.1+ | Multiplier |
| Scale Y | float | 0.1+ | Multiplier |
| Scale Z | float | 0.1+ | Multiplier |

#### Attributes
| Attribute | Effect |
|-----------|--------|
| Hitbox | Enable/disable collision |
| Script Gate | Marks as trigger volume |
| Invisible | Hide from rendering |

---

**Happy editing!** 🎮

For more details, see [GIZMO_SYSTEM_GUIDE.md](GIZMO_SYSTEM_GUIDE.md) and [SELECTION_SYSTEM_GUIDE.md](SELECTION_SYSTEM_GUIDE.md).
