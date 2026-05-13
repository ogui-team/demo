# Task 46 - Editor Smoke Tests

## Goal
Add automated coverage for core editor workflows.

## Problem
Manual verification alone is not enough for an editor with growing runtime and UI coordination.

## What To Do
1. Identify the smallest set of automated smoke cases that cover high-value editor workflows.
2. Focus first on deterministic behavior that does not require heavy browser choreography.
3. Candidate coverage:
   - single spawn from one drop event
   - cleanup after reset
   - selection store coherence
   - no duplicate listener registration on rebuild
4. Reuse the current test tooling instead of introducing a new framework.
5. Keep the smoke suite fast enough to run often.

## Done When
- At least the highest-risk editor regressions have automated guardrails.