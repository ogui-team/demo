# Engine Events Reference

All cross-system events flow through the singleton `gameBus` (type: `EventBus<GameEvents>`).

## Import

```typescript
import { gameBus } from './core/EventBus';
```

---

## Subscribing

```typescript
// Returns an unsub function — always call it when the subscriber is destroyed.
const unsub = gameBus.on('itemPicked', ({ entityId, itemId, quantity }) => {
  console.log(`[pickup] ${itemId} × ${quantity} from entity ${entityId}`);
});

// One-shot — auto-unsubscribes after first fire.
gameBus.once('playerKilled', ({ entityId, killerId }) => { ... });

// Cleanup
unsub();
```

---

## Emitting

```typescript
gameBus.emit('itemPicked', {
  entityId: 'e_42',
  itemId:   'health_small',
  quantity: 1,
});
```

---

## Event Reference

| Event | Payload | Emitted by | Consumed by |
|-------|---------|-----------|-------------|
| `itemPicked` | `{ entityId, itemId, quantity }` | `PickupSystem` | HUD, audio, achievements |
| `playerHit` | `{ entityId, damage, sourceId }` | `WeaponSystem`, `CombatSystem` | HUD, audio, GameModeSystem |
| `playerKilled` | `{ entityId, killerId }` | `HealthSystem` | Scoreboard, GameModeSystem, audio |
| `stateChanged` | `{ from, to }` | `EngineController`, `ModeManager` | Logging, HUD transitions |
| `weaponFired` | `{ entityId, weaponId }` | `WeaponSystem` | Audio, VFX, netcode |
| `ammoChanged` | `{ entityId, current, max }` | `WeaponSystem` | HUD |
| `healthChanged` | `{ entityId, hp, maxHp }` | `HealthSystem` | HUD, audio |

---

## Adding New Events

1. Add the event name and payload to `GameEvents` in `core/types.ts`:
   ```typescript
   myNewEvent: { someField: string; otherField: number };
   ```

2. Emit it from the source system:
   ```typescript
   gameBus.emit('myNewEvent', { someField: 'hello', otherField: 42 });
   ```

3. Subscribe from any consumer — TypeScript enforces the payload shape at compile time.

> **Rule:** Only put engine-level events that cross system boundaries in `GameEvents`.
> System-internal state changes should remain as direct method calls.
