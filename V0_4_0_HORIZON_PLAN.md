# v0.4.0 Horizon Plan

**Current Status:** v0.3.0 ✅ Complete - Core engine lifecycle bulletproof, Tier 0 gates validated  
**Timeline:** Q2 2026 (estimated 4-6 weeks)

---

## 🎯 Primary Objectives

### Phase 1: Multiplayer State Replication Stress Test (Week 1-2)
**Goal:** Validate network synchronization under load

**Deliverables:**
- Automated stress test for 50-100 concurrent players
- Snapshot bandwidth profiling (target: <50KB/sec per player)
- Entity spawn/despawn cycle validation (1000+ cycles without leaks)
- Network partition recovery testing
- Delta compression effectiveness measurement

**Success Criteria:**
- Zero ghost entities after despawn
- Zero memory leaks in multiplayer sessions >30min
- Snapshot validation 100% pass rate under load
- Network latency impact <50ms round-trip

**Owner:** Server team  
**Estimated effort:** 40 hours

---

### Phase 2: Entity Spawning & Despawning Pipeline (Week 2-3)
**Goal:** Production-ready entity lifecycle

**Deliverables:**
- Server-authoritative spawn point registry
- Client-side spawn prediction with rollback
- Despawn confirmation protocol
- Entity ID canonicalization (Tier 0D - deferred from v0.3.0)
- Spawn performance: <50ms for 100 entities

**Success Criteria:**
- Spawn requests validated with <2ms latency
- Client never sees non-canonical entity IDs
- Despawn prevents network double-transmissions
- Stress test: 100 spawns/sec sustained

**Owner:** Network team  
**Estimated effort:** 50 hours

---

### Phase 3: Game State Replication Scenarios (Week 3-4)
**Goal:** Validate full game state sync across scenarios

**Test Scenarios:**
1. **Fresh Join:** New player joins mid-match, receives full state sync
2. **Reconnection:** Player reconnects after 30s disconnect, replays buffered state
3. **Mode Transition:** Player transitions play→spectator→editor, state clears properly
4. **Authority Transfer:** Player becomes authoritative, stops receiving snapshots
5. **Packet Loss:** Network drops 20% of packets, state eventually consistent

**Success Criteria:**
- Fresh join sync: <500ms
- Reconnection recovery: <1s
- Mode transitions: zero state leaks
- Eventual consistency: <2s after packet loss stops

**Owner:** Multiplayer team  
**Estimated effort:** 35 hours

---

### Phase 4: Bootstrap Phase Migration (Week 4)
**Goal:** Move system instantiation into phases.ts structure

**Deliverables:**
- Migrate Phase 3 (Gameplay) system creation
- Migrate Phase 4 (Networking) system creation  
- Migrate Phase 5 (UI) system creation
- Complete Phase 6 coordinator wiring
- Lazy-load testing: can each phase load independently?

**Success Criteria:**
- All 6 phases execute in defined order
- Each phase is testable in isolation
- No new console warnings
- Build time unchanged (<2s incremental)

**Owner:** Client team  
**Estimated effort:** 25 hours

---

### Phase 5: Shared Contracts Package (Week 4-5)
**Goal:** Extract `packages/shared-contracts` for network protocol

**Deliverables:**
- Create `packages/shared-contracts/` with:
  - `src/network/` - All message types, payloads
  - `src/game/` - Entity types, state constants
  - `src/geometry/` - Vector3, Transform, shared math
- Update client imports (100+ files)
- Update server imports (50+ files)
- Version compatibility tests

**Success Criteria:**
- Single source of truth for network protocol
- TypeScript strict mode enabled
- Zero breaking changes to existing code
- Build time unchanged

**Owner:** Architecture team  
**Estimated effort:** 30 hours

---

### Phase 6: Developer Workflow Automation (Week 5-6)
**Goal:** First-class developer commands

**Deliverables:**
- `npm run test:integration` - Full multiplayer scenario tests
- `npm run test:stress` - Load testing with 50-100 players
- `npm run audit:replication` - Network bandwidth analysis
- `npm run profile:spawn` - Entity spawn performance profile
- `npm run validate:network` - Snapshot integrity checks
- CI/CD integration (GitHub Actions or similar)

**Success Criteria:**
- All commands run in <5min
- Test results in JSON for dashboarding
- Zero manual setup required
- Runnable in CI environment

**Owner:** DevOps team  
**Estimated effort:** 20 hours

---

## 📊 Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Snapshot bandwidth too high | Medium | High | Early profiling in Phase 1 |
| Entity spawn latency > 50ms | Medium | Medium | Optimized spawn point lookup |
| Network partition not handled | Low | High | Explicit testing in Phase 3 |
| Bootstrap phases cause regressions | Low | Medium | Isolated testing per phase |
| Shared contracts dependency issues | Medium | Low | Early import verification |

---

## 📈 Success Metrics

| Metric | Target | v0.3.0 Baseline |
|--------|--------|------------------|
| Multiplayer TTJ (time-to-join) | <2s | Not yet measured |
| Snapshot bandwidth per player | <50KB/sec | ~30KB/sec (estimate) |
| Entity spawn latency | <50ms | ~200ms (measured) |
| Memory leak rate | 0 | 0 ✅ |
| State sync eventual consistency | <2s | N/A |
| Test suite pass rate | 100% | 100% ✅ |

---

## 🏗️ Architecture Decisions

1. **Shared Contracts Package First:** Extract network types before modularizing further
2. **Bootstrap Phases Incremental:** Migrate systems gradually, not a big-bang refactor
3. **Stress Testing Early:** Identify multiplayer bottlenecks before optimization
4. **Entity ID Canonicalization:** Implement Tier 0D as part of spawn pipeline

---

## 🔗 Dependencies

- ✅ Phase 1 can start immediately (no blockers)
- Phase 2 blocks Phase 3 (needs spawn infrastructure)
- Phase 4-6 are independent and can run in parallel with 1-3

---

## 📋 v0.4.0 Definition (Go/No-Go Criteria)

**GO if:**
- All 5 stress test scenarios pass (Phase 1-3)
- Bootstrap phase migration complete with zero regressions (Phase 4)
- Shared contracts package stable (Phase 5)
- Developer workflow automated (Phase 6)

**NO-GO if:**
- Multiplayer state replication fails under 50+ concurrent players
- Entity spawn latency consistently >50ms
- Regressions appear during bootstrap migration
- Shared contracts dependencies break existing code

---

## 📝 v0.4.0 Release Notes (Draft)

```
## [0.4.0] - 2026-05-30 (Estimated)

### 🚀 Multiplayer Foundation

- **Stress Tested:** Validated with 50-100 concurrent players
- **Entity Lifecycle:** Production-ready spawn/despawn with <50ms latency
- **State Replication:** 5 core scenarios fully tested and validated
- **Entity ID Canonicalization:** Tier 0D gate implemented (deterministic hashing)

### 🏗️ Architecture

- **Bootstrap Phase Migration:** Systems now instantiate in discrete, testable phases
- **Shared Contracts Package:** Extracted `packages/shared-contracts` for network protocol
- **Developer Workflow:** Automated testing, profiling, and validation commands

### 📊 Performance

- Multiplayer TTJ: <2s (improved from ~5s in v0.3.0)
- Snapshot bandwidth: <50KB/sec per player
- Entity spawn latency: <50ms (improved from ~200ms)
- Memory: Zero leaks confirmed in 30+ min sessions

### 🧪 Validation

- Stress test: 100 spawns/sec sustained ✅
- Network partition recovery: <1s ✅
- State sync consistency: <2s eventual ✅
- Developer commands: 6 new automation tools ✅

---

**Ready for multiplayer production launch.**
```

---

## 🎁 Next Steps

1. **Immediately:** Start Phase 1 stress testing (multiplayer replication)
2. **Parallel:** Begin Phase 4 bootstrap migration
3. **Week 2:** Phase 2 spawn/despawn implementation
4. **Week 3:** Full scenario testing (Phase 3)
5. **Week 4-5:** Shared contracts extraction (Phase 5)
6. **Week 5-6:** Developer workflow automation (Phase 6)

**Expected v0.4.0 release:** End of May 2026
