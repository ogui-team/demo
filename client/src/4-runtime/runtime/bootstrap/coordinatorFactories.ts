import { RuntimeDiagnosticsCoordinator } from '../../diagnostics/debug/RuntimeDiagnosticsCoordinator';
import { EditorAuthorityCoordinator } from '../EditorAuthorityCoordinator';

interface RuntimeDiagnosticsFactoryOptions {
  defaultBaseUrl: string;
  search: string;
  multiplayerClient: ConstructorParameters<typeof RuntimeDiagnosticsCoordinator>[0]['multiplayerClient'];
  stateManager: ConstructorParameters<typeof RuntimeDiagnosticsCoordinator>[0]['stateManager'];
  renderingDiagnostics: ConstructorParameters<typeof RuntimeDiagnosticsCoordinator>[0]['renderingDiagnostics'];
  isDebugEnabled: () => boolean;
  isDebugOverlayVisible: () => boolean;
}

export function createRuntimeDiagnosticsCoordinator(options: RuntimeDiagnosticsFactoryOptions): RuntimeDiagnosticsCoordinator {
  return new RuntimeDiagnosticsCoordinator({
    defaultBaseUrl: options.defaultBaseUrl,
    metricsBaseUrlOverride: new URLSearchParams(options.search).get('metricsBaseUrl') ?? null,
    multiplayerClient: options.multiplayerClient,
    stateManager: options.stateManager,
    renderingDiagnostics: options.renderingDiagnostics,
    shouldPoll: () => options.multiplayerClient.connected || options.isDebugEnabled() || options.isDebugOverlayVisible(),
  });
}

export function createEditorAuthorityCoordinator(
  options: ConstructorParameters<typeof EditorAuthorityCoordinator>[0],
): EditorAuthorityCoordinator {
  return new EditorAuthorityCoordinator(options);
}