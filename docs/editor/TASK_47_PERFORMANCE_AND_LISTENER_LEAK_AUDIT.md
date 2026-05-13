# Task 47 - Performance And Listener Leak Audit

## Goal
Audit editor overhead and event-listener leakage.

## Problem
An editor that rebuilds often can slowly degrade through duplicated listeners, stale preview objects, and unnecessary per-frame work.

## What To Do
1. Audit listener registration around dock rebuild, editor re-entry, drag flows, and runtime reset.
2. Check whether preview, hover, or selection visuals leak scene objects over time.
3. Review any high-frequency editor update loops for avoidable work.
4. Add simple diagnostics where leak-prone code lacks visibility.
5. Fix the worst concrete offenders rather than performing a broad speculative cleanup.

## Done When
- Repeated editor/play cycles do not obviously accumulate listeners or editor-only scene junk.
- The worst editor overhead sources are identified or fixed.