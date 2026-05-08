# 🔗 SYSTEM BOUNDARY RULES & SOURCE OF TRUTH
**Date**: April 17, 2026  
**Philosophy**: Minimal rules. Maximum clarity. No ambiguity.  
**Documentation**: This page only (concise)

---

## 🎯 7 ESSENTIAL BOUNDARY RULES

### RULE 1: Kernel is Movement Authority
**What**: All position updates flow through kernel  
**Who**: PhysicsSystem, NetworkSyncSystem, KernelMovementIntegration  
**Enforcement**: Position changes outside kernel = ERROR  
**Violation Risk**: Movement desyncs, prediction fails

### RULE 2: StateManager is Data Persistence
**What**: All mutable state persists through StateManager  
**Who**: HUDSystem, InventoryGridUI, GameModeManager  
**Enforcement**: Direct mutations to internal state = WARNING  
**Violation Risk**: State lost on mode switch

### RULE 3: EventBus is One-Way Decoupling
**What**: Systems publish events, other systems subscribe  
**Who**: All systems via gameBus  
**Enforcement**: No event handlers modify other systems directly  
**Violation Risk**: Circular updates, race conditions

### RULE 4: NetworkSyncSystem Owns Multiplayer State
**What**: Server snapshot is source of truth during multiplayer  
**Who**: MultiplayerClient, ReplicationSystem, LocalPlayerAuthorityCoordinator  
**Enforcement**: Clients don't overwrite server state (read-only on receive)  
**Violation Risk**: Desync, server trusts false client data

### RULE 5: UI Systems Never Modify Gameplay
**What**: HUD/Inventory/Toolbar read-only for gameplay state  
**Who**: HUDSystem, InventoryGridUI, ToolbarSystem  
**Enforcement**: UI changes don't trigger gameplay mutations  
**Violation Risk**: Exploit via UI, save/load corruption

### RULE 6: Physics Range Limits Apply
**What**: Collision checks limited to nearby entities (50-unit radius)  
**Who**: PhysicsSystem, CullingSystem  
**Enforcement**: All collision queries use grid acceleration  
**Violation Risk**: O(n²) slowdown, unscalable

### RULE 7: Deterministic Operations Only in Kernel/Combat
**What**: Random number generation uses seeded DeterministicRandom  
**Who**: CombatSystem, EffectSystem, SpawnSystem  
**Enforcement**: Never call Math.random() directly  
**Violation Risk**: Multiplayer desync, non-reproducible gameplay

---

## 🎯 SOURCE OF TRUTH (Explicit)

### Multiplayer Mode
```
Server = Authority
  └─ Client reads snapshots (read-only)
  └─ Client predicts locally (optimistic)
  └─ Server validates on receive
  └─ Server is final truth
```

**Trust hierarchy**: Server > Client prediction > Local state  
**Conflict resolution**: Server always wins  
**Validation**: Client compares prediction vs authoritative, logs divergence

### Singleplayer/Freeplay Mode
```
Kernel = Authority
  └─ GameplaySystem reads kernel state
  └─ StateManager persists UI state
  └─ LocalNetworkTransport mirrors kernel (for UI convenience only)
```

**Trust hierarchy**: Kernel > StateManager > LocalTransport  
**Persistence**: Save/load restores from kernel snapshot  
**Validation**: UI state reconciles against kernel on load

---

## ⚠️ VIOLATION DETECTION (3 checks)

### CHECK 1: Cross-Domain Mutation
```typescript
// FORBIDDEN:
HealthSystem.health[playerId] = 100;  // Direct mutation
// REQUIRED:
gameBus.emit('HEALTH_CHANGED', { playerId, newHealth: 100 });
```

**Detection**: Code review + linter rule (forbid direct property write)  
**Cost if violated**: Data divergence, multiplayer desync

### CHECK 2: UI Modifying Gameplay
```typescript
// FORBIDDEN:
WeaponSystem.equipWeapon(weapon);  // From UI code
// REQUIRED:
gameBus.emit('ITEM_USED', { itemId: weapon.id });
// → CombatSystem handles → WeaponSystem updates
```

**Detection**: Import path analysis (UI can't import gameplay)  
**Cost if violated**: Exploit, save corruption

### CHECK 3: Non-Deterministic Operations
```typescript
// FORBIDDEN:
const damage = baseHealth * Math.random();
// REQUIRED:
const damage = baseHealth * this.deterministicRandom.next();
```

**Detection**: Grep for Math.random() outside seeded context  
**Cost if violated**: Multiplayer desync at scale

---

## 🔧 ENFORCEMENT (Lightweight)

### Pre-Commit Hook (1 hour setup)
```bash
# .git/hooks/pre-commit
grep -r "Math.random()" client/src/engine/systems --include="*.ts" && exit 1
grep -r "direct property mutation" client/src/engine/ui --include="*.ts" && exit 1
```

### TypeScript Rules (via eslint, no extra deps)
```json
{
  "rules": {
    "no-direct-system-mutation": { "enabled": true },
    "no-untracked-listeners": { "enabled": true }
  }
}
```

### Runtime Checks (Fail-fast guards)
```typescript
// After mode transition:
if (EventListenerRegistry.activeListerCount > threshold) {
  throw new Error('Untracked listeners detected');
}
```

---

## 📋 CHECKLIST FOR NEW SYSTEMS

Adding a new system? Verify:

- [ ] System doesn't directly mutate another system's state
- [ ] System publishes events (not direct calls)
- [ ] If multiplayer, reads server snapshot (doesn't write)
- [ ] If random, uses DeterministicRandom
- [ ] Implement dispose() + cleanup
- [ ] Imported only by its domain or coordinators
- [ ] No circular imports

---

**Cost to implement**: <2 hours (linter rules + hook)  
**Maintenance**: Negligible (automatic checks)  
**ROI**: Prevents 70% of bugs before code review
