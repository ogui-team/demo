# 🔧 TIER 0 PATCHING STRATEGY
**Status**: Targeting highest-impact fixes  
**Scope**: v0.0.1 → v0.1.4 foundation stabilization  
**Approach**: Focused implementation of 5 critical blockers  

---

## IMPLEMENTATION ROADMAP

### PRIORITY 1: Lifecycle Contract Enforcement (TIER 0E)
**Why First**: Prevents NEW leaks + enables cleanup registry  
**Impact**: All 65 systems will have cleanup contract  
**Time**: 1-2 hours  

```typescript
// BEFORE: No validation
SystemRegistry.register('MySystem', new MySystem());

// AFTER: Validation enforced
// MySystem must have dispose/destroy/disable/clear
// Bootstrap fails if not present
```

### PRIORITY 2: Comprehensive Mode Transition Cleanup (TIER 0B)
**Why Second**: Depends on lifecycle enforcement  
**Impact**: No ghost state after mode switch  
**Time**: 2-3 hours  

```typescript
// 7-STEP SEQUENCE:
1. Stop all active systems
2. Clear UI listeners + DOM
3. Disconnect network (if multiplayer)
4. Dispose gameplay systems
5. Reset physics/kernel buffers
6. Trigger GC hint
7. Resume new systems
```

### PRIORITY 3: EventListener Registry Integration (TIER 0A)
**Why Third**: Works with lifecycle enforcement  
**Impact**: 0 listeners after transition  
**Time**: 1-2 hours  

```typescript
// All systems using EventListenerRegistry
// Registry.dispose() called in ModeTransitionManager step 2
// Validates 0 listeners remain
```

### PRIORITY 4-5: Snapshot + Entity ID (TIER 0C-0D)
**Why Later**: Lower impact on immediate stability  
**Impact**: Multiplayer edge cases, determinism  
**Time**: 2-3 hours each  

---

## EXECUTION PHASES

### Phase A: Infrastructure (30 min)
- ✅ Create EventListenerRegistry.ts
- Create SystemHealthCorridor extensions
- Add enforceSystemDisposeContract() validation

### Phase B: Core Cleanup (2-3 hours)
- Update SystemRegistry to enforce contracts
- Enhance ModeTransitionManager with 7-step sequence
- Test cleanup order

### Phase C: System Retrofitting (2-3 hours)
- Add dispose() to 12 systems missing cleanup
- Verify contract compliance
- Add diagnostics logging

### Phase D: Integration Testing (1-2 hours)
- Mode transition stress test (100 transitions)
- Memory leak detection
- Listener count validation

---

## WHAT THIS ACHIEVES

### After Phase A
✅ Foundation for listener tracking  
✅ Validation framework ready  

### After Phase B
✅ Lifecycle contracts enforced  
✅ Mode transitions atomic  
✅ 7-step sequence guaranteed  

### After Phase C
✅ All 65 systems have cleanup  
✅ Bootstrap validates compliance  
✅ Zero regressions possible  

### After Phase D
✅ 100 mode transitions stable  
✅ Memory stable ±5%  
✅ Ready for TIER 1  

---

## STARTING NOW

This document is the plan. Implementation begins immediately.

