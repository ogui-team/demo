# ⚡ TITAN ENGINE DEFINITION v0.2.9 (LEAN)
**Date**: April 17, 2026  
**Purpose**: Concise, measurable definition  
**Philosophy**: What matters. Nothing more.

---

## 🎯 WHAT IS TITAN v0.2.9?

An engine that:
- Runs **1+ hour multiplayer** without freeze/desync
- Handles **5000 NPCs at 60 FPS**
- Uses **<150MB** memory (stable)
- Has **0 untracked event listeners**
- Passes **100 mode transitions** with stable memory
- Survives **multiplayer stress tests** (documented failure modes fixed)

## 📊 ACCEPTANCE CRITERIA (HARD LIMITS)

| Metric | Minimum | Target | Test |
|--------|---------|--------|------|
| Multiplayer duration | 20 min | 60 min | Real session |
| NPC count @ 60 FPS | 3000 | 5000 | Spawn + hold 5min |
| Memory baseline | <160MB | <150MB | After 10 transitions |
| Memory leak after 100 transitions | 0% growth | Stable | Heap snapshot |
| Mode switch time | <3s | <2s | Measure |
| Untracked listeners | 0 | 0 | DevTools check |
| TTI | <1.2s | <1.0s | Network tab |

## ⚡ PASS/FAIL GATES (Simple Verdict)

✅ **PASS** = Meets ALL hard limits  
❌ **FAIL** = Misses ANY hard limit  
⚠️ **RETRY** = Fix + retest

---

## 🔴 TOP 3 FAILURE RISKS (Remaining)

### RISK 1: Event Listener Accumulation Under Load
**When**: Rapid spawn/despawn or UI toggling  
**Impact**: Memory grows 2-5MB per cycle  
**Mitigation**: EventListenerRegistry + automated test  
**Milestone**: 0A (3-4 days)  
**Detector**: Heap growth >5% after 50 spawns

### RISK 2: Mode Transition Leaves Ghost State
**When**: Switching multiplayer → freeplay → multiplayer  
**Impact**: Collision geometry persists, entity ID collision  
**Mitigation**: Atomic cleanup + kernel reset  
**Milestone**: 0B (3-4 days)  
**Detector**: No entities from old mode in new world

### RISK 3: Multiplayer Snapshot Desync at Scale
**When**: 5000 entities broadcasting every frame  
**Impact**: Clients diverge, visual glitches, then stall  
**Mitigation**: Snapshot filtering + recipient validation  
**Milestone**: 0C (2-3 days)  
**Detector**: Diff between client/server entity state

---
