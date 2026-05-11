# Active Violation Report

Status: no active Phase A authority violations detected by the repo scanner.

Validation result:

- `node scripts/validate-authority-enforcement.mjs` -> pass
- `npx vitest run test/runtime/AuthorityEnforcementValidator.test.ts --config test/vitest.config.ts` -> pass
- `npm --prefix client run type-check` -> pass

Violations removed in this pass:

- `modeManager.isPlayMode()` / `isEditorMode()` authority reads in runtime/UI context restoration paths.
- `engineGameModes.getActiveName()` authority reads in bootstrap loadout resolution and auxiliary runtime flow.
- Bootstrap-local HUD `playerMode` injection for the state-managed HUD instance.
- Missing CI gate for protected-key writes and authority read drift.

Remaining active violations:

- None in the enforced Phase A rule set.