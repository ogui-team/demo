# Task 36 - Input Focus Recovery

## Goal
Restore keyboard and pointer focus correctly after editor state changes.

## Problem
After dragging, play toggles, modal interactions, or dock rebuilds, the editor can lose its expected keyboard or viewport focus.

## What To Do
1. Audit how focus is transferred between dock panels, viewport, and play mode.
2. Restore the correct editor focus target after drag end and editor re-entry.
3. Prevent stuck hotkeys from firing while typing in search or inspector inputs.
4. Ensure escape, delete, duplicate, and tool hotkeys respect active text-input focus.
5. Add one explicit focus handoff point if current ownership is ambiguous.

## Done When
- Editor hotkeys work when they should and stay quiet when text inputs are active.
- Returning from play or drag flows does not strand focus in the wrong surface.