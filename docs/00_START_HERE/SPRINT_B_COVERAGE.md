# Sprint-B: Coverage Improvement Sprint

## 🎯 Goal
Improve test coverage for the most under-tested engine subsystems identified in the latest report, while keeping the current `vitest` coverage pipeline stable.

**Target:** Move the repo from the current 17–18% overall coverage to a higher, measurable baseline focused on critical runtime and session modules.

**Timeline:** 1 week
**Priority:** P1
**Blockers:** currently low coverage in `client/src/engine/core/kernel`, `client/src/engine/0-foundation/runtime`, `client/src/engine/audit`, and `client/src/engine/camera`.

---

## 📊 Key Findings from Updated Coverage Report
- `client/src`: 4.58% statements
- `client/src/engine/core/kernel`: 11.7% statements
- `client/src/engine/0-foundation/runtime`: 1.81% statements
- `client/src/engine/audit`: 5.26% statements
- `client/src/engine/camera`: 2.32% statements
- Overall report: 17.47% statements, 13.35% branches, 18.11% lines

> Report location: `coverage/index.html`

---

## 🧭 Sprint Priorities
1. Stabilize the coverage pipeline and make `vitest` reports actionable.
2. Add meaningful tests for the kernel and runtime layers.
3. Cover audit, camera, and session subsystems with focused regression tests.
4. Add import-all / smoke coverage tests for major modules.

---

## 📝 Sprint Tasks

### Task 1: Refine Coverage and Thresholds
- Review `test/vitest.config.ts` coverage rules.
- Add a focused coverage set for critical source directories and consider excluding untestable static asset folders.
- Validate that the current 100% threshold rule is not blocking progress; adjust it to realistic incremental targets if needed.
- Confirm the coverage report works consistently on CI.

### Task 2: Kernel & Runtime Coverage
- Add or expand tests for `client/src/engine/core/kernel`:
  - `SimulationKernel.ts`
  - command queue processing
  - system registration and execution order
  - buffer read/write helpers
- Add tests for `client/src/engine/0-foundation/runtime`:
  - runtime bootstrap logic
  - runtime mode transitions
  - basic lifecycle paths

### Task 3: Audit + Diagnostics Coverage
- Add tests for `client/src/engine/audit`:
  - audit report creation
  - audit validation logic
  - diagnostics helpers and event emission

### Task 4: Camera & Render Pipeline Coverage
- Add tests for `client/src/engine/camera`:
  - camera update/transform logic
  - view/projection behavior
  - any bootstrap or runtime camera hooks
- Add coverage for render-related runtime code where practical (prefer core logic over browser-dependent UI paths).

### Task 5: Server Session Coverage
- Expand session coverage in `server/src/session`:
  - `playerValidationRuntime` and other validation helpers
  - snapshot broadcast/filter/runtime tests
  - session lifecycle and status runtime checks
- Keep higher-level server tests stable while improving coverage on key flows.

### Task 6: Import-All and Smoke Test Coverage
- Maintain current import-all coverage tests.
- Add similar smoke/import tests for any untested client or server subsystem with public initialization paths.
- Use these tests to catch broken module loads early.

---

## ✅ Acceptance Criteria
- `coverage/index.html` is updated and shows measurable coverage improvement.
- Critical directories improve to these minimums:
  - `client/src/engine/core/kernel` → 50%+ statements
  - `client/src/engine/camera` → 40%+ statements
  - `client/src/engine/audit` → 40%+ statements
- New tests exist for the server session validation and kernel runtime flows.
- `npm run coverage` remains green.

---

## ⚠️ Risks & Blockers
- Some client modules are GUI/renderer-heavy and may be difficult to test in `happy-dom`.
- Asset-only folders may skew overall numbers; use module-level goals rather than global percentage alone.
- Existing 100% coverage gates may need temporary adjustment until the sprint completes.

---

## 📅 Sprint Breakdown
- Day 1: Coverage config review + kernel runtime test spike
- Day 2: Runtime bootstrap and command queue tests
- Day 3: Audit/camera coverage and import-all tests
- Day 4: Server session validation coverage
- Day 5: polish, regression validation, coverage report update

---

## 🟢 Progress
- Added kernel runtime regression tests in `test/kernel/SimulationKernel.test.ts`.
- Added low-level kernel coverage tests for `KernelCommandQueue`, `EntityRegistry`, `InventoryStorage`, and `HealthStorage`.
- Added audit coverage tests in `test/engine/RuntimeCapabilityAudit.test.ts`.
- Added camera coverage tests in `test/engine/CameraStateAdapter.test.ts`.
- Added server session validation coverage tests in `test/server/CombatValidationRuntime.test.ts` and expanded lifecycle coverage in `test/server/playerLifecycleRuntime.test.ts`.
- Added foundation runtime coverage tests for `client/src/engine/0-foundation/runtime/SystemRegistry.ts` in `test/foundation/SystemRegistry.test.ts`.
- Verified all new kernel, audit, camera, session, and foundation tests pass with `npx vitest run --config test/vitest.config.ts`.
- Ran the expanded session suite under `--coverage`, validating the session coverage path and coverage pipeline stability.
