# Task 18 - Editor Performance Overlay

## Goal
Provide built-in editor diagnostics.

## Why
Required before scaling scene size and tooling complexity.

## Must Include
- FPS
- frame timings
- draw calls
- memory tracking
- entity counts
- listener counts
- runtime diagnostics

## Scope
- Add editor diagnostics overlay panel with runtime and tooling metrics.
- Keep it lightweight and toggleable.

## Implementation Steps
1. Define diagnostics sample model and update interval.
2. Add metric collectors for:
- fps and frame time
- render draw calls
- memory snapshots
- entity totals
- active listener totals
3. Build overlay UI panel with concise grouped metrics.
4. Add thresholds and warning colors for spikes.
5. Add toggle command and persisted visibility preference.
6. Emit diagnostics snapshots for optional logging.

## Integration Targets
- existing runtime debug HUD and metrics sources
- SystemRegistry metrics where available
- editor command palette toggle

## Done When
- Overlay can be enabled and disabled in editor mode.
- Key metrics update in near real time.
- Performance regressions are visible during tool development.
