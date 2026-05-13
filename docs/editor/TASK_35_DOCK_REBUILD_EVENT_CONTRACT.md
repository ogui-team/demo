# Task 35 - Dock Rebuild Event Contract

## Goal
Make dock rebuild behavior explicit and repeatable.

## Problem
Editor UI rebuilds can orphan listeners or leave old roots partially active, especially around drag and focus handling.

## What To Do
1. Define what a dock rebuild guarantees: old listeners detached, new root discoverable, delegates rebound.
2. Centralize root resolution so panels and coordinators do not each guess the active dock root.
3. Ensure rebuild events fire in a stable order.
4. Verify spawn-library drag delegates and similar dock-root listeners rebind exactly once.
5. Add a light diagnostic log or counter if needed to catch duplicate rebinding during development.

## Done When
- Re-entering the editor does not leave orphan listeners or stale roots.
- Drag and focus listeners bind exactly once to the current dock tree.