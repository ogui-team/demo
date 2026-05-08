import { describe, expect, it, vi } from 'vitest'
import { wireRuntimeAssemblies } from '../../../../../client/src/engine/runtime/bootstrap/wireRuntimeAssemblies'

describe('wireRuntimeAssemblies', () => {
  it('wires runtime components and binds transport functions', () => {
    const multiplayerRuntime = {
      setSessionLifecycleCoordinator: vi.fn(),
      setGameLaunchCoordinator: vi.fn(),
      wire: vi.fn(),
    }
    const sessionLifecycleCoordinator = {}
    const gameLaunchCoordinator = {}
    const editorAuthorityCoordinator = {
      syncEditorPrefabLibrary: vi.fn(),
      wire: vi.fn(),
    }
    const auxiliaryAssembly = {
      register: vi.fn(),
    }
    const mpClient = {
      connected: true,
      on: vi.fn(),
      sendWorldObjectPlace: vi.fn(),
      sendWorldObjectUpdate: vi.fn(),
      sendWorldObjectRemove: vi.fn(),
    }
    const worldObjectAuthorityService = {
      bindTransport: vi.fn(),
    }
    const kernelMovementIntegration = {}

    wireRuntimeAssemblies({
      multiplayerRuntime,
      sessionLifecycleCoordinator,
      gameLaunchCoordinator,
      editorAuthorityCoordinator,
      auxiliaryAssembly,
      worldObjectAuthorityService,
      mpClient,
      kernelMovementIntegration,
    })

    expect(multiplayerRuntime.setSessionLifecycleCoordinator).toHaveBeenCalledWith(sessionLifecycleCoordinator)
    expect(multiplayerRuntime.setGameLaunchCoordinator).toHaveBeenCalledWith(gameLaunchCoordinator)
    expect(multiplayerRuntime.wire).toHaveBeenCalled()
    expect(editorAuthorityCoordinator.syncEditorPrefabLibrary).toHaveBeenCalled()
    expect(editorAuthorityCoordinator.wire).toHaveBeenCalled()
    expect(auxiliaryAssembly.register).toHaveBeenCalledWith(kernelMovementIntegration)
    expect(worldObjectAuthorityService.bindTransport).toHaveBeenCalled()

    const transport = worldObjectAuthorityService.bindTransport.mock.calls[0][0]
    transport.on('test', () => {})
    expect(mpClient.on).toHaveBeenCalledWith('test', expect.any(Function))
    expect(transport.isConnected()).toBe(true)

    transport.sendWorldObjectPlace({ id: 'place' })
    expect(mpClient.sendWorldObjectPlace).toHaveBeenCalledWith({ id: 'place' })

    transport.sendWorldObjectUpdate({ id: 'update' })
    expect(mpClient.sendWorldObjectUpdate).toHaveBeenCalledWith({ id: 'update' })

    transport.sendWorldObjectRemove('remove')
    expect(mpClient.sendWorldObjectRemove).toHaveBeenCalledWith('remove')
  })
})
