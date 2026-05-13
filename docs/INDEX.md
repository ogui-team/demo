# 📚 PS1 Engine Documentation Index

**Solo Developer Quick Navigation**  
*Last Updated: May 8, 2026 - v0.3.1 candidate audit added*

---

## 🏆 LATEST RELEASE - v0.3.0 ✅

**Status:** Production Ready - All Tier 0 gates passing (19/19 tests)  
**Released:** April 18, 2026

**Start Here:**
1. [EXECUTION_SUMMARY.md](../archive/root-md/2026-05-11/EXECUTION_SUMMARY.md) - 🚀 **Upgrade ready check** (pick execution strategy)
2. [V0_3_1_MILESTONE_PLAN.md](../archive/root-md/2026-05-11/V0_3_1_MILESTONE_PLAN.md) - 13 milestones with Phase Architecture Contract
3. [V0_3_0_VICTORY_LOG.md](../archive/root-md/2026-05-11/V0_3_0_VICTORY_LOG.md) - v0.3.0 release highlights
4. [CHANGELOG.md](../archive/root-md/2026-05-11/CHANGELOG.md) - Professional release notes
5. [V0_4_0_HORIZON_PLAN.md](../archive/root-md/2026-05-11/V0_4_0_HORIZON_PLAN.md) - Multiplayer scale roadmap

---

## 🔎 CURRENT v0.3.1 CANDIDATE AUDIT

**Status:** Candidate ready for release gating  
**Audit Date:** May 8, 2026

**Start Here:**
1. [V0_3_1_FEATURE_AUDIT_AND_INDEX.md](../archive/root-md/2026-05-11/V0_3_1_FEATURE_AUDIT_AND_INDEX.md) - Current feature audit, file index, validation snapshot, and release-gate status
2. [V0_3_1_MILESTONE_PLAN.md](../archive/root-md/2026-05-11/V0_3_1_MILESTONE_PLAN.md) - Original milestone and architecture plan
3. [V0_3_1_VALIDATION_CHECKLIST.md](../archive/root-md/2026-05-11/V0_3_1_VALIDATION_CHECKLIST.md) - Formal release validation steps
4. [ARCHIVE_COMPLETED.md](../archive/root-md/2026-05-11/ARCHIVE_COMPLETED.md) - Previously completed bootstrap/shared-contract work

---

## 🏗️ v0.3.1 BOOTSTRAP ARCHITECTURE UPGRADE

**New Architecture:** Idempotent, Replaceable, Streamable phases with System Registry  
**Status:** ✅ Ready for execution (all specs complete)

**Quick Links:**
- [EXECUTION_SUMMARY.md](../archive/root-md/2026-05-11/EXECUTION_SUMMARY.md) - Pick your execution strategy (Sequential/Parallel/Hybrid)
- [BOOTSTRAP_UPGRADE_READY_CHECK.md](../archive/root-md/2026-05-11/BOOTSTRAP_UPGRADE_READY_CHECK.md) - Complete checklist (all 12 steps ✅)
- [BOOTSTRAP_ARCHITECTURE_IMPLEMENTATION.md](../archive/root-md/2026-05-11/BOOTSTRAP_ARCHITECTURE_IMPLEMENTATION.md) - Copy-paste ready implementation
- [SYSTEM_REGISTRY_IMPLEMENTATION.md](../archive/root-md/2026-05-11/SYSTEM_REGISTRY_IMPLEMENTATION.md) - Full TypeScript code + tests
- [V0_3_1_VALIDATION_CHECKLIST.md](../archive/root-md/2026-05-11/V0_3_1_VALIDATION_CHECKLIST.md) - Per-milestone validation procedure

**What's Changing:**
- 690-line bootstrap function → 50-line orchestrator + 6 independent phases
- Hidden system creation → Phase contract (pure functions returning PhaseResult)
- No hot reload → Reload any phase with `await window.__reloadPhase('phase3')`
- Scattered types → Shared contracts package (single source of truth)

---

👉 **[00_START_HERE/ORGANIZATION_GUIDE.md](00_START_HERE/ORGANIZATION_GUIDE.md)**  
**NEW!** Understand the new doc structure (this will take 2 minutes and save you hours)

👉 **[00_START_HERE/README.md](00_START_HERE/README.md)**  
High-level project overview, features, and structure.

👉 **[00_START_HERE/QUICK_START.md](00_START_HERE/QUICK_START.md)**  
Get the engine running in 5 minutes.

👉 **[00_START_HERE/CURRENT_OVERVIEW.md](00_START_HERE/CURRENT_OVERVIEW.md)**  
Live project status (Phase 3 locked, Phase 4 ready).

👉 **[00_START_HERE/PROJECT_EVOLUTION_2026.md](00_START_HERE/PROJECT_EVOLUTION_2026.md)**  
Master plan, architecture decisions, roadmap.

👉 **[01_GUIDES/QUICK_CHECKLIST.md](01_GUIDES/QUICK_CHECKLIST.md)**  
Fast reference for common dev tasks (bookmarks this!)

---

## 📖 GUIDES & HOW-TOs

**[01_GUIDES/](01_GUIDES/)** — Practical tutorials and setup guides

- **[DEVELOPER_GUIDE.md](01_GUIDES/DEVELOPER_GUIDE.md)** — Development setup & workflow
- **[DEBUGGING.md](01_GUIDES/DEBUGGING.md)** — Debugging strategies (includes F6 debug menu)
- **[EDITOR_QUICK_START.md](01_GUIDES/EDITOR_QUICK_START.md)** — In-game editor tutorial
- **[GIZMO_SYSTEM_GUIDE.md](01_GUIDES/GIZMO_SYSTEM_GUIDE.md)** — Transform gizmo usage
- **[SELECTION_SYSTEM_GUIDE.md](01_GUIDES/SELECTION_SYSTEM_GUIDE.md)** — Entity selection in editor

---

## 🛠️ EDITOR WORKSTREAMS

**[editor/](editor/)** — Editor implementation, repair, and autonomous execution docs

- **[editor/EDITOR_IMPL_PLAN.md](editor/EDITOR_IMPL_PLAN.md)** — First-wave editor implementation plan and task set
- **[editor/AUTONOMOUS_AGENT_MASTER_PROMPT.md](editor/AUTONOMOUS_AGENT_MASTER_PROMPT.md)** — Original autonomous editor build prompt
- **[editor/EDITOR_REPAIR_AND_ENHANCEMENT_PLAN.md](editor/EDITOR_REPAIR_AND_ENHANCEMENT_PLAN.md)** — Second-wave repair and enhancement roadmap
- **[editor/RAPTOR_NIGHT_SHIFT_MASTER_PROMPT.md](editor/RAPTOR_NIGHT_SHIFT_MASTER_PROMPT.md)** — Overnight low-cost autonomous editor repair prompt
- **[editor/RAPTOR_REPAIR_TASK_QUEUE.md](editor/RAPTOR_REPAIR_TASK_QUEUE.md)** — Live progress queue for Tasks 25-48

---

## 🏗️ ARCHITECTURE (System Design & Decisions)

**[02_ARCHITECTURE/](02_ARCHITECTURE/)** — Core engine architecture

- **[ARCHITECTURE.md](02_ARCHITECTURE/ARCHITECTURE.md)** — Overall engine design & domains
- **[BOOTLOADER_ARCHITECTURE.md](02_ARCHITECTURE/BOOTLOADER_ARCHITECTURE.md)** — 152-byte entry point design
- **[INTEGRATION_FLOW.md](02_ARCHITECTURE/INTEGRATION_FLOW.md)** — System integration patterns
- **[SYSTEM_BOUNDARY_RULES.md](02_ARCHITECTURE/SYSTEM_BOUNDARY_RULES.md)** — Domain separation & constraints
- **[SYSTEM_DEPENDENCY_MAP.md](02_ARCHITECTURE/SYSTEM_DEPENDENCY_MAP.md)** — Component relationships
- **[STATE_MANAGER.md](02_ARCHITECTURE/STATE_MANAGER.md)** — Application state management
- **[MODE_SYSTEM.md](02_ARCHITECTURE/MODE_SYSTEM.md)** — Gameplay modes (freeplay/multiplayer)
- **[COMMUNICATION_PROTOCOL.md](02_ARCHITECTURE/COMMUNICATION_PROTOCOL.md)** — Server communication design

---

## ⚙️ SYSTEMS (Engine Features & Implementations)

**[03_SYSTEMS/](03_SYSTEMS/)** — Individual system documentation

- **[DEBUG_SYSTEM.md](03_SYSTEMS/DEBUG_SYSTEM.md)** — Debug infrastructure
- **[ENGINE_CAPABILITY_TRUTH_TABLE.md](03_SYSTEMS/ENGINE_CAPABILITY_TRUTH_TABLE.md)** — Feature matrix
- **[EVENTS.md](03_SYSTEMS/EVENTS.md)** — Event system & message types
- **[SCALING_RULES_5000_NPC.md](03_SYSTEMS/SCALING_RULES_5000_NPC.md)** — Performance targets
- **[INVISIBLE_COLLIDERS_FIX_COMPLETE.md](03_SYSTEMS/INVISIBLE_COLLIDERS_FIX_COMPLETE.md)** — Collision system fixes

---

## 🌐 MULTIPLAYER (Networking & Synchronization)

**[04_MULTIPLAYER/](04_MULTIPLAYER/)** — Network architecture & gameplay sync

- **[NETWORK_ARCHITECTURE_AUDIT.md](04_MULTIPLAYER/NETWORK_ARCHITECTURE_AUDIT.md)** — Multiplayer design
- **[NETWORK_DIAGNOSTICS_FINDINGS.md](04_MULTIPLAYER/NETWORK_DIAGNOSTICS_FINDINGS.md)** — Network analysis & fixes
- **[MULTIPLAYER_REPLICATION_OVERHAUL_PLAN.md](04_MULTIPLAYER/MULTIPLAYER_REPLICATION_OVERHAUL_PLAN.md)** — State sync strategy
- **[MULTIPLAYER_INIT_AND_SPAWN_FIX_SUMMARY.md](04_MULTIPLAYER/MULTIPLAYER_INIT_AND_SPAWN_FIX_SUMMARY.md)** — Session initialization

---

## ⚡ PERFORMANCE & OPTIMIZATION

**[05_PERFORMANCE/](05_PERFORMANCE/)** — Build optimization & runtime profiling

- **[LAZY_LOAD_INTEGRATION.md](05_PERFORMANCE/LAZY_LOAD_INTEGRATION.md)** — Lazy-loading architecture
- **[WEBPACK_OPTIMIZATION_SUMMARY.md](05_PERFORMANCE/WEBPACK_OPTIMIZATION_SUMMARY.md)** — Build config & caching
- **[GRAPHICS_DEBUG_GUIDE.md](05_PERFORMANCE/GRAPHICS_DEBUG_GUIDE.md)** — GPU profiling & optimization
- **[NETCODE_MEMORY_UPGRADE_PLAN.md](05_PERFORMANCE/NETCODE_MEMORY_UPGRADE_PLAN.md)** — Memory optimization

---

## 📅 PHASES & PLANNING

**[06_PHASES/](06_PHASES/)** — Current roadmap & milestone status

- **[PHASE_3_RUNTIME_GUIDE.md](06_PHASES/PHASE_3_RUNTIME_GUIDE.md)** — ✅ Lazy-load implementation (LOCKED)
- **[PHASE_4_IMPLEMENTATION.md](06_PHASES/PHASE_4_IMPLEMENTATION.md)** — 🚀 Preloading & monitoring (NEXT)
- **[PHASE_4_TESTING.md](06_PHASES/PHASE_4_TESTING.md)** — Phase 4 testing procedures
- **[ENGINE_ROADMAP_v0.1.4_to_v0.2.9.md](06_PHASES/ENGINE_ROADMAP_v0.1.4_to_v0.2.9.md)** — Long-term roadmap
- **[MASTER_ROADMAP_v0_1_4_to_v0_1_9.md](06_PHASES/MASTER_ROADMAP_v0_1_4_to_v0_1_9.md)** — Gameplay milestones

---

## 📋 REFERENCE

**[07_REFERENCE/](07_REFERENCE/)** — Code snippets, audit reports, changelogs

- **[CHANGELOG_v0.1.4.md](07_REFERENCE/CHANGELOG_v0.1.4.md)** — Version history
- **[DEPENDENCY_AUDIT.md](07_REFERENCE/DEPENDENCY_AUDIT.md)** — NPM dependencies review
- **[FULL_SYSTEM_AUDIT_v0.1.4.md](07_REFERENCE/FULL_SYSTEM_AUDIT_v0.1.4.md)** — System health report
- **[PROJECT_AUDIT_AND_ROADMAP.md](07_REFERENCE/PROJECT_AUDIT_AND_ROADMAP.md)** — Audit + roadmap combined
- **[TEAM_MEMO_LAUNCH.md](07_REFERENCE/TEAM_MEMO_LAUNCH.md)** — Team communication template

---

## 🗂️ ARCHIVE

**[_ARCHIVE/](ARCHIVE/)** — Historical phases, completed milestones

All completed phase documentation and audit history preserved here for reference.

---

## 🎯 QUICK TASK LOOKUP

### "I need to..."

| Task | Start Here |
|------|-----------|
| **Get started coding** | [00_START_HERE/QUICK_START.md](00_START_HERE/QUICK_START.md) |
| **Understand the architecture** | [02_ARCHITECTURE/ARCHITECTURE.md](02_ARCHITECTURE/ARCHITECTURE.md) |
| **Debug a problem** | [01_GUIDES/DEBUGGING.md](01_GUIDES/DEBUGGING.md) |
| **Check current status** | [00_START_HERE/CURRENT_OVERVIEW.md](00_START_HERE/CURRENT_OVERVIEW.md) |
| **Optimize performance** | [05_PERFORMANCE/LAZY_LOAD_INTEGRATION.md](05_PERFORMANCE/LAZY_LOAD_INTEGRATION.md) |
| **Fix a multiplayer issue** | [04_MULTIPLAYER/NETWORK_DIAGNOSTICS_FINDINGS.md](04_MULTIPLAYER/NETWORK_DIAGNOSTICS_FINDINGS.md) |
| **Add a new feature** | [06_PHASES/MASTER_ROADMAP_v0_1_4_to_v0_1_9.md](06_PHASES/MASTER_ROADMAP_v0_1_4_to_v0_1_9.md) |
| **Find code references** | [07_REFERENCE/PROJECT_AUDIT_AND_ROADMAP.md](07_REFERENCE/PROJECT_AUDIT_AND_ROADMAP.md) |
| **View changelog** | [07_REFERENCE/CHANGELOG_v0.1.4.md](07_REFERENCE/CHANGELOG_v0.1.4.md) |

---

## 📊 Project Status

**Current Phase**: Phase 3 ✅ LOCKED  
**Next Phase**: Phase 4 🚀 READY  
**Build Status**: Zero errors  
**Version**: v0.1.4  

→ See [CURRENT_OVERVIEW.md](00_START_HERE/CURRENT_OVERVIEW.md) for live metrics

---

## 🔧 Local Debug Tools

**Paste in browser console while in-game:**
```javascript
// Available in LAZY_LOAD_DEBUG_SCRIPT.js - Top-level docs
```

→ See [01_GUIDES/DEBUGGING.md](01_GUIDES/DEBUGGING.md) for console commands

