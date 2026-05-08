/**
 * Debug System exports
 * Main entry point for all debug functionality
 */

export { DebugManager, initDebugManager, getDebugManager, destroyDebugManager } from './DebugManager';
export { DebugUI } from './DebugUI';
export { ParameterRegistry } from './ParameterBinding';
export type { ParameterBinding, ParameterGroup } from './ParameterBinding';
export type { FrameCostSample } from './FrameCostProfiler';
export { RuntimeDiagnosticsCoordinator } from './RuntimeDiagnosticsCoordinator';
export type { RuntimeMetricsReporter } from './RuntimeMetricsReporter';
export { CharacterDashboardPanel } from './CharacterDashboardPanel';
export { StatusMovementDebugPanel } from './StatusMovementDebugPanel';
export { bootstrapTestEntities } from './bootstrapTestEntities';
export { registerDeveloperConsoleCommands } from './registerDeveloperConsoleCommands';
export { registerMainDebugBindings } from './registerMainDebugBindings';
export { registerRuntimeDiagnosticsDebugBindings } from './registerRuntimeDiagnosticsDebugBindings';
export { runAutostartFromQuery } from './devAutostart';
export { validateEngineRuntime, validateEngineMemory } from './SystemValidator';

