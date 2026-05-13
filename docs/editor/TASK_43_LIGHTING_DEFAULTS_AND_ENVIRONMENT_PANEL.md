# Task 43 - Lighting Defaults And Environment Panel

## Goal
Improve lighting authoring and fallback visibility in editor workflows.

## Problem
Dark play sessions are now mitigated by runtime fallback lighting, but the editor still needs better visibility into authored versus fallback environment state.

## What To Do
1. Reuse the new fallback-light behavior as a boundary reference, not as saved scene content.
2. Add a lightweight environment panel or inspector surface for authored ambient, fog, and primary light settings if nearby architecture already exists.
3. Make it obvious when the runtime is using fallback lighting because no authored light exists.
4. Ensure fallback lights never leak into saved editor scene data.
5. Provide a path for quickly adding or fixing authored light setup from the editor.

## Done When
- Dark scenes are easier to diagnose.
- Authored lighting and runtime fallback are clearly separated.