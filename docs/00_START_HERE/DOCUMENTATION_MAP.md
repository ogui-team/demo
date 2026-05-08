# 🗺️ Project Documentation Map

**Visual guide to understanding your engine's documentation structure**

---

## 🎯 The Big Picture

```
┌─────────────────────────────────────────────────────┐
│   PS1-Styled 3D Game Engine (Browser-based)         │
│   Solo Developer Project                             │
└─────────────────────────────────────────────────────┘
           ↓
    ┌──────────────────────────────────────────┐
    │     Documentation (52 Active Files)      │
    └──────────────────────────────────────────┘
           ↓
    ┌─────────────────────────────────────────────┐
    │  9 Organized Folders + 1 Archive            │
    │  (See folders below)                        │
    └─────────────────────────────────────────────┘
```

---

## 📂 Folder Purposes & Connections

```
┌─ 🚀 00_START_HERE (Getting Oriented)
│  ├─ README.md ...................... Project overview
│  ├─ QUICK_START.md ................. Get running in 5 min
│  ├─ CURRENT_OVERVIEW.md ............ Live status snapshot
│  ├─ PROJECT_EVOLUTION_2026.md ...... Master plan
│  ├─ SYSTEM_STATE_SNAPSHOT.md ....... Current metrics
│  ├─ ORGANIZATION_GUIDE.md .......... **NEW** This structure
│  └─ SPRINT_A_QUICKSTART.md ......... Sprint planning
│     │
│     └─→ Links to: 02_ARCHITECTURE, 06_PHASES
│
├─ 📖 01_GUIDES (How-To & Tutorials)
│  ├─ QUICK_CHECKLIST.md ............ **NEW** Common tasks
│  ├─ DEBUGGING.md .................. Debug strategies
│  ├─ DEBUG_MENU_F6_GUIDE.md ........ F6 debug menu ref
│  ├─ DEBUG_SYSTEM.md ............... Debug infrastructure
│  ├─ DEVELOPER_GUIDE.md ............ Dev setup & workflow
│  ├─ EDITOR_QUICK_START.md ......... In-game editor
│  ├─ GIZMO_SYSTEM_GUIDE.md ......... Transform gizmo
│  ├─ SELECTION_SYSTEM_GUIDE.md ..... Entity selection
│  ├─ SESSION_QUICK_REFERENCE.md .... Quick lookup
│  └─ LAZY_LOAD_DEBUG_SCRIPT.js ..... Performance tool
│     │
│     └─→ Links to: 03_SYSTEMS, 05_PERFORMANCE
│
├─ 🏗️ 02_ARCHITECTURE (Design & Decisions)
│  ├─ ARCHITECTURE.md ............... Overall design
│  ├─ BOOTLOADER_ARCHITECTURE.md .... Entry point (152 bytes)
│  ├─ COMMUNICATION_PROTOCOL.md ..... Server communication
│  ├─ INTEGRATION_FLOW.md ........... System patterns
│  ├─ MODE_SYSTEM.md ............... Gameplay modes
│  ├─ STATE_MANAGER.md ............ Application state
│  ├─ SYSTEM_BOUNDARY_RULES.md ..... Domain separation
│  └─ SYSTEM_DEPENDENCY_MAP.md .... Component relationships
│     │
│     └─→ Links to: 03_SYSTEMS, 04_MULTIPLAYER, 02_PERFORMANCE
│
├─ ⚙️ 03_SYSTEMS (Individual Systems)
│  ├─ ENGINE_CAPABILITY_TRUTH_TABLE.md ... Feature matrix
│  ├─ EVENTS.md ........................... Event system
│  ├─ SCALING_RULES_5000_NPC.md ......... Performance targets
│  └─ INVISIBLE_COLLIDERS_FIX_COMPLETE.md Collision fixes
│     │
│     └─→ Referenced from: 02_ARCHITECTURE
│
├─ 🌐 04_MULTIPLAYER (Networking & Sync)
│  ├─ NETWORK_ARCHITECTURE_AUDIT.md .... Multiplayer design
│  ├─ NETWORK_DIAGNOSTICS_FINDINGS.md . Network analysis
│  ├─ MULTIPLAYER_REPLICATION_OVERHAUL_PLAN.md .. State sync
│  └─ MULTIPLAYER_INIT_AND_SPAWN_FIX_SUMMARY.md . Session init
│     │
│     └─→ Referenced from: 02_ARCHITECTURE
│
├─ ⚡ 05_PERFORMANCE (Optimization & Profiling)
│  ├─ LAZY_LOAD_INTEGRATION.md ........ Lazy-loading
│  ├─ GRAPHICS_DEBUG_GUIDE.md ........ GPU profiling
│  ├─ NETCODE_MEMORY_UPGRADE_PLAN.md . Memory optimization
│  └─ TIER_0_PATCHING_STRATEGY.md .... Patch strategy
│     │
│     └─→ Referenced from: 06_PHASES
│
├─ 📅 06_PHASES (Roadmap & Milestones)
│  ├─ ENGINE_ROADMAP_v0.1.4_to_v0.2.9.md ... Long-term roadmap
│  ├─ MASTER_ROADMAP_v0_1_4_to_v0_1_9.md ... Gameplay milestones
│  ├─ PHASE_3_RUNTIME_GUIDE.md .............. ✅ LOCKED (Lazy-load)
│  ├─ PHASE_4_IMPLEMENTATION.md ............ 🚀 NEXT (Preloading)
│  ├─ PHASE_4_TESTING.md ................... Phase 4 testing
│  ├─ PHASE_4_COMPLETION_REPORT.md ........ Phase 4 status
│  └─ v0-2-0-EXECUTION-PLAN.md ............ Future plan
│     │
│     └─→ Links to: 05_PERFORMANCE for details
│
├─ 📋 07_REFERENCE (Changelogs & Audits)
│  ├─ CHANGELOG_v0.1.4.md ............. Version history
│  ├─ FULL_SYSTEM_AUDIT_v0.1.4.md .... System health
│  ├─ DOCUMENTATION.md ............... Doc index
│  ├─ DOCUMENTATION_INDEX.md ......... Doc map
│  ├─ PROJEKT_STRUKTUR.md ........... Project structure
│  └─ TEAM_MEMO_LAUNCH.md ........... Team communication
│     │
│     └─→ Historical context, cross-references
│
└─ 🗂️ _ARCHIVE (Historical Reference)
   ├─ Completed phases (25 files)
   ├─ Audit reports
   ├─ Implementation notes
   └─ Version history
      │
      └─→ For reference when needed
```

---

## 🔄 Information Flow

```
START HERE
    ↓
[README] → Understand what this is
    ↓
[QUICK_START] → Get it running
    ↓
[CURRENT_OVERVIEW] → Check status
    ↓
     ├─→ [GUIDES] → Learn how to do things
     │      ↓
     │   [DEBUGGING] → Fix problems
     │   [EDITOR] → Modify assets
     │
     ├─→ [ARCHITECTURE] → Understand why
     │      ↓
     │   [SYSTEMS] → Deep dive on features
     │   [MULTIPLAYER] → Network details
     │   [PERFORMANCE] → Optimization
     │
     └─→ [PHASES] → Plan what's next
            ↓
         [ROADMAP] → See milestones
         [REFERENCE] → Check history
```

---

## 🎯 Common Navigation Paths

### "I'm building a feature"
```
README → QUICK_START → QUICK_CHECKLIST
         ↓
   ARCHITECTURE → SYSTEMS
         ↓
   PHASES/ROADMAP
```

### "I need to debug"
```
QUICK_CHECKLIST → DEBUGGING
         ↓
   DEBUG_MENU_F6_GUIDE
   or LAZY_LOAD_DEBUG_SCRIPT
```

### "I need to optimize"
```
CURRENT_OVERVIEW → PERFORMANCE/
         ↓
   LAZY_LOAD_INTEGRATION
   GRAPHICS_DEBUG_GUIDE
```

### "I need architecture details"
```
README → ARCHITECTURE
         ↓
   BOOTLOADER_ARCHITECTURE
   COMMUNICATION_PROTOCOL
   SYSTEM_DEPENDENCY_MAP
         ↓
   SYSTEMS/ (for individual system details)
```

### "I need multiplayer info"
```
ARCHITECTURE → MULTIPLAYER/
         ↓
   NETWORK_ARCHITECTURE_AUDIT
   NETWORK_DIAGNOSTICS_FINDINGS
```

---

## 📊 Doc Statistics

| Category | Count | Purpose |
|----------|-------|---------|
| **Start Here** | 7 | Onboarding & status |
| **Guides** | 10 | How-to tutorials |
| **Architecture** | 8 | Design decisions |
| **Systems** | 4 | Individual features |
| **Multiplayer** | 3 | Networking |
| **Performance** | 4 | Optimization |
| **Phases** | 7 | Roadmap |
| **Reference** | 6 | History & audits |
| **Archive** | 25 | Historical |
| **TOTAL** | **74** | Active docs |

---

## 🚀 You Are Here

```
docs/
├── INDEX.md ..................... ← YOU ARE HERE (master nav)
├── 00_START_HERE/
│   └── ORGANIZATION_GUIDE.md .... ← Read this next
├── 01_GUIDES/
│   ├── QUICK_CHECKLIST.md ....... ← Bookmark this
│   └── DEBUGGING.md
├── 02_ARCHITECTURE/ ............ Next level
├── 03_SYSTEMS/ ................. Details
├── 04_MULTIPLAYER/ ............. If networking
├── 05_PERFORMANCE/ ............. If optimizing
├── 06_PHASES/ .................. For planning
├── 07_REFERENCE/ ............... For history
└── _ARCHIVE/ ................... If desperate
```

---

## 💡 Tips

✅ **Do this:**
- Start with ORGANIZATION_GUIDE.md (3 min read)
- Keep INDEX.md bookmarked
- Use QUICK_CHECKLIST.md for daily dev

❌ **Don't do this:**
- Don't dig through _ARCHIVE unless needed
- Don't read everything at once
- Don't forget to check INDEX.md for cross-references

---

**Created**: April 17, 2026  
**Purpose**: Visual documentation navigation map  
**For**: Solo developer quick reference  

