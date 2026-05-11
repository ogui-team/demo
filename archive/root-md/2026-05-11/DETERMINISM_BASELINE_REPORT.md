# Determinism Baseline Report

Phase B started with a bounded replay digest gate for the new runtime determinism trace.

## Current baseline

- Gate: `npm run validate:replay`
- Validation artifact: `test/client/runtime/RuntimeDeterminismTrace.test.ts`
- Package integration: `package.json` now runs `validate:replay` as part of `npm test`

## Coverage added

- Identical event streams produce identical runtime determinism digests.
- Reordered queued job execution changes the digest.
- Reordered encounter ownership transitions change the digest.
- Reordered chunk lifecycle transitions change the digest.
- Typed runtime authority capability interfaces were introduced for multiplayer and session lifecycle coordinator boundaries.
- AI activation order changes detected in digest.
- Prefab spawn order changes detected in digest.
- Streaming transition order changes detected in digest.
- Fuzz suite validates digest stability under permuted event ordering.
- Unstable-order detector can identify nondeterministic behavior across multiple runs.

## Test Suite Stats

- Total determinism tests: 12
- Base replay tests: 4
- New event type tests: 3
- Fuzz tests: 3
- Unstable-order detector tests: 2
- Current pass rate: 100%

## Notes

This is the first executable Phase B enforcement artifact. It is intentionally narrow: it validates deterministic replay digest stability and order sensitivity without widening the current protected-key enforcement surface.
