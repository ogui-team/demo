import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/diagnostics/debug/RuntimeDiagnosticsCoordinator', () => ({
  RuntimeDiagnosticsCoordinator: vi.fn(function (this: any, config: any) {
    this.config = config
  }),
}))

vi.mock('../../../../../client/src/engine/runtime/EditorAuthorityCoordinator', () => ({
  EditorAuthorityCoordinator: vi.fn(function (this: any, config: any) {
    this.config = config
  }),
}))

import { createRuntimeDiagnosticsCoordinator, createEditorAuthorityCoordinator } from '../../../../../client/src/engine/runtime/bootstrap/coordinatorFactories'
import { RuntimeDiagnosticsCoordinator } from '../../../../../client/src/engine/diagnostics/debug/RuntimeDiagnosticsCoordinator'
import { EditorAuthorityCoordinator } from '../../../../../client/src/engine/runtime/EditorAuthorityCoordinator'

describe('coordinatorFactories', () => {
  it('creates a runtime diagnostics coordinator with proper polling logic', () => {
    const diagnostics = createRuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://test.local',
      search: '?metricsBaseUrl=http://override.local',
      multiplayerClient: { connected: false },
      stateManager: {},
      renderingDiagnostics: {},
      isDebugEnabled: () => true,
      isDebugOverlayVisible: () => false,
    })

    expect(diagnostics).toBeInstanceOf(RuntimeDiagnosticsCoordinator)
    expect((diagnostics as any).config.defaultBaseUrl).toBe('http://test.local')
    expect((diagnostics as any).config.metricsBaseUrlOverride).toBe('http://override.local')
    expect((diagnostics as any).config.shouldPoll()).toBe(true)
  })

  it('creates an editor authority coordinator instance', () => {
    const editorCoordinator = createEditorAuthorityCoordinator({
      prefabSystem: {},
      spawnSystem: {},
      mpClient: {},
      undoRedoSystem: {},
      saveLoadManager: null,
      worldObjectAuthorityService: {},
      worldRuntime: {},
      editorMenu: null,
      gizmoSystem: null,
    })

    expect(editorCoordinator).toBeInstanceOf(EditorAuthorityCoordinator)
    expect((editorCoordinator as any).config).toBeDefined()
  })
})
