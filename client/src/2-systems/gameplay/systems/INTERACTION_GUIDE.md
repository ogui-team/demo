# Interaction System Guide

Quick reference for the modular interaction/highlight pipeline.

---

## Overview

Five systems collaborate to handle all in-world interactions:

```
InteractionManager
    ├── RaycastInteraction   (crosshair detection, priority 40)
    ├── ProximityInteraction (walk-up range, priority 10)
    └── HighlightSystem      (visual box outline — driven by winner)

PhysGunSystem → sets override priority 50/100 on InteractionManager
PickupSystem  → reads ProximityInteraction result on E key
```

---

## Making an Entity Interactive

### Step 1 — Add the `interactable` component

**Via prefab JSON** (recommended for prefab objects):
```json5
{
  "interactable": {
    "interactionType": "item",   // "item" | "physics" | "door" | "npc"
    "pickupable": true,          // true → E key will collect to inventory
    "highlightable": true,       // true → amber box outline when nearby
    "itemId": "health_small",    // ID passed to InventorySystem on pickup
    "quantity": 1,
    "prompt": "MEDKIT",          // HUD label (falls back to itemId)
    "highlightColor": 14065744   // optional tint (default: amber 0xd6a850)
  }
}
```

**Via code** (spawned entities):
```typescript
import { createInteractableComponent } from './components/InteractableComponent';

entity.addComponent({
  name: 'interactable',
  data: createInteractableComponent({
    interactionType: 'item',
    pickupable:      true,
    highlightable:   true,
    itemId:          'health_small',
  }) as unknown as Record<string, unknown>,
});
```

### Step 2 — Ensure the entity has a mesh

`EntityRenderer.syncEntity(entity)` must have been called so the entity has a mesh in the scene. Prefab spawning handles this automatically.

---

## Pickup Flow (E key)

```
Player walks near entity
    │
    ▼
ProximityInteraction.update()  ← runs every frame via InteractionManager
    │  scans entityManager for entities with highlightable interactable
    │  within 2.4 m radius; 150 ms stability window prevents flicker
    ▼
InteractionManager.getProximityTarget() returns the nearest entity
    │
    ▼  (user presses E in play mode)
PickupSystem.handleKeyDown()
    │  checks: enabled + not console + proximity target exists
    │  checks: interactable.pickupable === true
    ▼
em.destroyEntity(entityId)      ← removes from world
    │
    ▼
onPickup callback (wired in Engine.ts → InventoryGridManager.giveItem)
gameBus.emit('itemPicked', { entityId, itemId, quantity })
```

---

## Highlight Modes

| Mode | Trigger | Color |
|------|---------|-------|
| `proximity` | Entity within 2.4 m walk-up range | Amber (#d4a850) |
| `hover` | PhysGun crosshair over entity | Cyan (#80d4ff) |
| `held` | PhysGun actively dragging entity | Blue (#3060ff) |

Custom highlight color per entity:
```json5
"interactable": { ..., "highlightColor": 16711680 }
```
Hex color is stored as a decimal integer in JSON (0xFF0000 → 16711680).

---

## Interaction Types

| `interactionType` | Meaning |
|--------------------|---------|
| `"item"` | Collectable — goes to inventory on E key |
| `"physics"` | Show highlight but not pickupable via E (grabbed by PhysGun) |
| `"door"` | Future: open/close on E |
| `"npc"` | Future: dialogue trigger |

---

## PhysGun Priority

PhysGunSystem registers overrides on InteractionManager directly:

```typescript
// When hovering over an entity:
interactionManager.setOverride('physgun', entityId, mesh, INTERACTION_PRIORITY.PHYSGUN_HOVER);

// When actively holding:
interactionManager.setOverride('physgun', entityId, mesh, INTERACTION_PRIORITY.PHYSGUN_HELD);

// On release:
interactionManager.clearOverride('physgun');
```

Priority 100 (held) and 50 (hover) beat PROXIMITY (10), so the physgun highlight
always wins over the amber pickup highlight.

---

## Tuning Proximity Radius

Change globally at startup (Engine.ts):
```typescript
interactionManager = new InteractionManager({ ..., proximityRadius: 3.0 });
```

Change per entity (future — currently all entities share the same radius):
```typescript
interactionManager.setProximityRadius(1.2); // crouching reduces reach
```

---

## Common Issues

**E key does nothing in play mode**
- Confirm entity has `interactable` component with `pickupable: true`
- Confirm you are in play mode (`mode play` in console)
- Confirm `pickupSystem` is enabled (happens on `onEnterPlay`)

**No amber highlight when walking near entity**
- Confirm `highlightable: true` in the interactable component
- Confirm entity mesh registered in `EntityRenderer` (requires `syncEntity`)

**PhysGun can grab entity but E can't pick it up**
- Normal — PhysGun uses raycast interaction; E uses proximity
- User must be within 2.4 m *and* face the correct direction (proximity is radial, not directional)
