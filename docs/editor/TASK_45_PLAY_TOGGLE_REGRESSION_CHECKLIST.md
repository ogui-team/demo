# Task 45 - Play Toggle Regression Checklist

## Goal
Codify the manual verification path for editor to play to editor transitions.

## Problem
Repeated toggle flows are the highest-risk editor area, but regressions are currently easy to miss or test inconsistently.

## What To Do
1. Create a concise checklist for the core toggle flow.
2. Include at minimum:
   - editor camera restore
   - no ghost bounds or stale players
   - fallback lighting behavior
   - spawn-library drag after editor re-entry
   - correct selection and inspector state
3. Store expected results and quick failure hints.
4. Keep the checklist short enough to run frequently.

## Done When
- The project has one canonical manual pass for editor/play regressions.