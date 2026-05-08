# 📚 DOCUMENTATION INDEX & NAVIGATION MAP

**Last Updated**: April 17, 2026  
**Purpose**: Find the right doc for your task in 30 seconds  

---

## 🎯 I NEED TO...

### 🚀 Get Started (New Developer)
**Read in order:**
1. [README.md](README.md) - Project overview
2. [SYSTEM_STATE_SNAPSHOT.md](SYSTEM_STATE_SNAPSHOT.md) - Current status (5 min)
3. [PROJECT_EVOLUTION_2026.md](PROJECT_EVOLUTION_2026.md) - Master plan + decision matrix

**Then run:**
```bash
cd client && npm run dev  # Start dev server
```

### 🔍 Understand the Architecture
- **Overall Strategy**: [PROJECT_EVOLUTION_2026.md](PROJECT_EVOLUTION_2026.md) - "Current Architecture" section
- **Lazy-Loading**: [PHASE_3_LAZY_LOAD_IMPLEMENTATION.md](PHASE_3_LAZY_LOAD_IMPLEMENTATION.md) - Full implementation details
- **Kernel Design**: [TRANSACTIONAL_KERNEL_DIRECTIVE.md](TRANSACTIONAL_KERNEL_DIRECTIVE.md) - DOD kernel architecture
- **Performance**: [PHASE_0_AND_1_EXECUTION_COMPLETE.md](PHASE_0_AND_1_EXECUTION_COMPLETE.md) - Build optimization

### 🐛 Debug Something
- **Chunk Loading**: [LAZY_LOAD_DEBUG_SCRIPT.js](LAZY_LOAD_DEBUG_SCRIPT.js) - Paste in console
- **Performance Issues**: [ENGINE_PERFORMANCE_BUDGET.md](client/engine/reports/ENGINE_PERFORMANCE_BUDGET.md) - Live metrics
- **General Debugging**: [PROJECT_AUDIT_AND_ROADMAP.md](PROJECT_AUDIT_AND_ROADMAP.md) - Known issues section
- **Multiplayer Issues**: [NETWORK_DIAGNOSTICS_FINDINGS.md](NETWORK_DIAGNOSTICS_FINDINGS.md) - Network audit

### 🎮 Add a Feature
1. **Feature Planning**: [MASTER_ROADMAP_v0_1_4_to_v0_1_9.md](MASTER_ROADMAP_v0_1_4_to_v0_1_9.md) - Milestone roadmap
2. **Architecture Decision**: [PROJECT_EVOLUTION_2026.md](PROJECT_EVOLUTION_2026.md) - "Decision Matrix"
3. **Game Systems**: [PROJECT_AUDIT_AND_ROADMAP.md](PROJECT_AUDIT_AND_ROADMAP.md) - System list + health scores

### ⚡ Optimize Performance
- **Current Baseline**: [SYSTEM_STATE_SNAPSHOT.md](SYSTEM_STATE_SNAPSHOT.md) - Performance metrics
- **Bundle Analysis**: `ANALYZE_BUNDLE=true npm run build` → See `dist/bundle-report.html`
- **Build Optimization**: [PHASE_0_AND_1_EXECUTION_COMPLETE.md](PHASE_0_AND_1_EXECUTION_COMPLETE.md) - TypeScript caching, etc.
- **Runtime Profiling**: [LAZY_LOAD_DEBUG_SCRIPT.js](LAZY_LOAD_DEBUG_SCRIPT.js) - Chunk timing

### 🔗 Understand Networking
- **Architecture**: [NETWORK_ARCHITECTURE_AUDIT.md](NETWORK_ARCHITECTURE_AUDIT.md) - Network design
- **Protocol**: [NETWORK_DIAGNOSTICS_FINDINGS.md](NETWORK_DIAGNOSTICS_FINDINGS.md) - Message types & stability
- **Replication**: [MULTIPLAYER_REPLICATION_OVERHAUL_PLAN.md](MULTIPLAYER_REPLICATION_OVERHAUL_PLAN.md) - How sync works

### 🎯 Understand Gameplay
- **Combat System**: [PROJECT_AUDIT_AND_ROADMAP.md](PROJECT_AUDIT_AND_ROADMAP.md) - "Gameplay Systems" section
- **Abilities**: [MASTER_ROADMAP_v0_1_4_to_v0_1_9.md](MASTER_ROADMAP_v0_1_4_to_v0_1_9.md) - Milestone 1-3 details
- **HUD/UI**: [QUICK_CODE_REFERENCE.md](QUICK_CODE_REFERENCE.md) - HUD system reference

---

## 📁 DOCUMENT CATEGORIES

### 🟢 ACTIVE MASTER DOCUMENTS (Read These)

| Doc | Purpose | Read When |
|-----|---------|-----------|
| **PROJECT_EVOLUTION_2026.md** | Current master plan | Any major decision |
| **SYSTEM_STATE_SNAPSHOT.md** | Status + quick ref | Starting work |
| **PHASE_3_LAZY_LOAD_IMPLEMENTATION.md** | Lazy-load details | Implementing Phase 4 |
| **README.md** | Project overview | New developer |

### 📄 REFERENCE DOCUMENTS (Consult for Details)

| Doc | Topic | Depth |
|-----|-------|-------|
| **TRANSACTIONAL_KERNEL_DIRECTIVE.md** | Kernel architecture | Deep |
| **MASTER_ROADMAP_v0_1_4_to_v0_1_9.md** | Gameplay milestones | Medium |
| **PROJECT_AUDIT_AND_ROADMAP.md** | System health + roadmap | Deep |
| **NETWORK_ARCHITECTURE_AUDIT.md** | Multiplayer design | Deep |
| **PHASE_0_AND_1_EXECUTION_COMPLETE.md** | Build optimization | Medium |

### 🛠️ OPERATIONAL DOCUMENTS (Use For Tasks)

| Doc | Purpose | When |
|-----|---------|------|
| **LAZY_LOAD_DEBUG_SCRIPT.js** | Monitor chunk loads | Testing lazy-load |
| **QUICK_CODE_REFERENCE.md** | Code snippets | Quick lookup |
| **QUICK_TEST_GUIDE.md** | Testing procedures | Validation |
| **WEBPACK_OPTIMIZATION_SUMMARY.md** | Build config | Build issues |

### 📋 AUDIT & ANALYSIS DOCUMENTS (Reference)

| Doc | Content | Status |
|-----|---------|--------|
| **DEPENDENCY_AUDIT.md** | Module dependencies | Latest |
| **NETWORK_DIAGNOSTICS_FINDINGS.md** | Network analysis | April 17 |
| **MOVEMENT_SYSTEM_AUDIT.md** | Gameplay audit | Latest |
| **REVISED_AUDIT_EXECUTIVE_SUMMARY.md** | Summary findings | Latest |

### 🏆 COMPLETION & STATUS DOCUMENTS (Archive/Reference)

| Doc | Milestone | Status |
|-----|-----------|--------|
| **PHASE_0_AND_1_EXECUTION_COMPLETE.md** | Baseline + optimization | ✅ LOCKED |
| **PHASE_2_MEMORY_SCHEMATICS.md** | DOD kernel design | ✅ LOCKED |
| **PHASE_3_LAZY_LOAD_IMPLEMENTATION.md** | Lazy-load arch | ✅ LOCKED |
| **TRANSACTIONAL_KERNEL_FINAL_SUMMARY.md** | Kernel integration | ✅ LOCKED |
| **UNIFIED_PHYSICS_SYSTEM_COMPLETE.md** | Physics validation | ✅ LOCKED |

---

## 🗺️ DECISION TREE: Which Doc Do I Need?

```
START: What do you need?
│
├─ "I'm new, where do I start?"
│  → README.md → SYSTEM_STATE_SNAPSHOT.md → PROJECT_EVOLUTION_2026.md
│
├─ "How does the architecture work?"
│  → SYSTEM_STATE_SNAPSHOT.md ("Architecture State") 
│  → PROJECT_EVOLUTION_2026.md ("Current Architecture")
│  → PHASE_3_LAZY_LOAD_IMPLEMENTATION.md (for details)
│
├─ "How do I add a feature?"
│  → PROJECT_EVOLUTION_2026.md ("Decision Matrix")
│  → Find in MASTER_ROADMAP_v0_1_4_to_v0_1_9.md
│  → Check phase in PROJECT_EVOLUTION_2026.md
│
├─ "How do I fix a performance issue?"
│  → SYSTEM_STATE_SNAPSHOT.md ("Performance Baseline")
│  → Run: ANALYZE_BUNDLE=true npm run build
│  → Check: ENGINE_PERFORMANCE_BUDGET.md
│  → Reference: PHASE_0_AND_1_EXECUTION_COMPLETE.md
│
├─ "How does lazy-loading work?"
│  → SYSTEM_STATE_SNAPSHOT.md ("Lazy Chunks")
│  → PHASE_3_LAZY_LOAD_IMPLEMENTATION.md (full detail)
│  → LAZY_LOAD_DEBUG_SCRIPT.js (to test)
│
├─ "What systems exist?"
│  → PROJECT_AUDIT_AND_ROADMAP.md ("Current State")
│  → Count: 65 systems, 98.28 average health
│
└─ "What are the known issues?"
   → PROJECT_EVOLUTION_2026.md ("Current Blockers")
   → PROJECT_AUDIT_AND_ROADMAP.md ("Known Issues")
```

---

## 📊 DOCUMENT DEPENDENCY GRAPH

```
ENTRY POINTS (Start here):
├─ README.md
├─ SYSTEM_STATE_SNAPSHOT.md
└─ PROJECT_EVOLUTION_2026.md
   │
   ├─ Needs architecture? → PHASE_3_LAZY_LOAD_IMPLEMENTATION.md
   ├─ Needs kernel detail? → TRANSACTIONAL_KERNEL_DIRECTIVE.md
   ├─ Needs gameplay? → MASTER_ROADMAP_v0_1_4_to_v0_1_9.md
   ├─ Needs audit? → PROJECT_AUDIT_AND_ROADMAP.md
   └─ Needs validation? → LAZY_LOAD_DEBUG_SCRIPT.js
```

---

## 🎯 QUICK ANSWERS

### Q: "What phase are we in?"
**A:** Phase 3 COMPLETE, Phase 4 starting  
**Read:** PROJECT_EVOLUTION_2026.md

### Q: "What's the performance baseline?"
**A:** TTI ~350ms, chunk load ~600ms  
**Read:** SYSTEM_STATE_SNAPSHOT.md - Performance Baseline

### Q: "How do I test lazy-loading?"
**A:** Paste debug script in console, click mode button  
**Read:** LAZY_LOAD_DEBUG_SCRIPT.js + PHASE_3_LAZY_LOAD_IMPLEMENTATION.md

### Q: "What's the next task?"
**A:** Phase 4: Smart preloading + safe transitions  
**Read:** PROJECT_EVOLUTION_2026.md - "Phase 4"

### Q: "Is the build working?"
**A:** Yes, zero errors. ✅ Build complete.  
**Verify:** Run `npm run build` in client folder

### Q: "How many systems do we have?"
**A:** 65 systems, 0 coupling violations, 98.28 average health  
**Read:** PROJECT_AUDIT_AND_ROADMAP.md

### Q: "Where's the multiplayer code?"
**A:** client/src/engine/network/  
**See:** NETWORK_ARCHITECTURE_AUDIT.md

### Q: "What changed in Phase 3?"
**A:** Bootloader + lazy-load chunks + mode orchestration  
**Read:** PHASE_3_LAZY_LOAD_IMPLEMENTATION.md + SYSTEM_STATE_SNAPSHOT.md

---

## 📱 MOBILE-FRIENDLY QUICK START

```bash
# 1. Run dev server
cd client && npm run dev

# 2. Open browser
http://localhost:3000

# 3. Test lazy-loading
# Console: Paste LAZY_LOAD_DEBUG_SCRIPT.js
# Network: Click MULTIPLAYER button
# Result: See chunk load timing

# 4. Check build
npm run build  # ~85 seconds

# 5. Check health
npm run audit:engine  # See ENGINE_PERFORMANCE_BUDGET.md
```

---

## 🚨 IMPORTANT: Document Lifecycle

### 🟢 ACTIVE (Current Phase)
- **PROJECT_EVOLUTION_2026.md** - Master plan (UPDATE THIS)
- **SYSTEM_STATE_SNAPSHOT.md** - Status (UPDATE THIS)
- **PHASE_3_LAZY_LOAD_IMPLEMENTATION.md** - Reference (READ ONLY)

### 🟡 REFERENCE (Completed Phases)
- **MASTER_ROADMAP_v0_1_4_to_v0_1_9.md** - Historical roadmap (reference)
- **TRANSACTIONAL_KERNEL_DIRECTIVE.md** - Architecture (reference)
- **PHASE_0_AND_1_EXECUTION_COMPLETE.md** - Locked baseline (reference)

### 🔴 ARCHIVE (Old/Deprecated)
- **Various audit reports** - Use for research only
- **Session summaries** - Historical records

---

**Last Update**: April 17, 2026  
**Maintainer**: Development Team  
**Next Review**: After Phase 4 completion
