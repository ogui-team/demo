import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { PlayController } from '../../../../client/src/engine/foundation/PlayController'
import { gameBus } from '../../../../client/src/engine/core/EventBus'
import { setContext } from '../../../../client/src/engine/core/InputContext'
import { InputContextManager } from '../../../../client/src/engine/core/InputContextManager'
import { getCamera } from '../../../../client/src/engine/render/Camera'
import { isConsoleOpen } from '../../../../client/src/engine/editor/Console'

vi.mock('../../../../client/src/engine/render/Camera', () => ({
  getCamera: vi.fn(() => new THREE.PerspectiveCamera(75, 1, 0.1, 1000)),
}))

vi.mock('../../../../client/src/engine/editor/Console', () => ({
  isConsoleOpen: vi.fn(() => false),
}))

vi.mock('../../../../client/src/engine/core/EventBus', () => ({
  gameBus: {
    on: vi.fn(() => () => {}),
    emit: vi.fn(),
  },
}))

vi.mock('../../../../client/src/engine/core/InputContext', () => ({
  setContext: vi.fn(),
}))

vi.mock('../../../../client/src/engine/core/InputContextManager', () => {
  class MockInputContextManager {
    tryLock = vi.fn(() => false)
    getActiveContext = vi.fn(() => 'play')
    forceSetContext = vi.fn()
    requestPointerLock = vi.fn(() => false)
    releasePointerLock = vi.fn()
    syncLockState = vi.fn()
  }

  return { InputContextManager: MockInputContextManager }
})

describe('PlayController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<canvas></canvas>'
    Object.defineProperty(document, 'pointerLockElement', {
      get: () => null,
      configurable: true,
    })
    document.exitPointerLock = vi.fn()
  })

  it('enables and disables input with proper state transitions', () => {
    const controller = new PlayController()
    controller.enable()
    expect(controller.isEnabled()).toBe(true)
    expect(gameBus.emit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({
      source: 'PlayController',
      path: 'playController.enabled',
    }))

    controller.disable()
    expect(controller.isEnabled()).toBe(false)
    expect(document.exitPointerLock).not.toHaveBeenCalled()
  })

  it('binds an entity and reports the bound ID', () => {
    const controller = new PlayController()
    controller.bind('player-123')
    expect(controller.getBoundEntityId()).toBe('player-123')
    expect(gameBus.emit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({
      source: 'PlayController',
      path: 'playController.boundEntityId',
    }))
  })

  it('returns movement input based on pressed keys', () => {
    const controller = new PlayController()
    controller.enable()
    const keyEvent = new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' })
    controller.handleKeyDown(keyEvent)

    const input = controller.getMovementInput()
    expect(input.forward).toBe(true)
    expect(input.backward).toBe(false)
    expect(input.left).toBe(false)
    expect(input.right).toBe(false)
  })

  it('ignores input when disabled', () => {
    const controller = new PlayController()
    const keyEvent = new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' })
    expect(controller.handleKeyDown(keyEvent)).toBe(false)
  })

  it('handles pointer down and activates drag look when left button pressed', () => {
    const controller = new PlayController()
    controller.enable()
    const downEvent = new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 20 })

    expect(controller.handlePointerDown(downEvent)).toBe(true)
    expect((controller as any).dragLookActive).toBe(true)
    expect((controller as any).lastPointerPosition).toEqual({ x: 10, y: 20 })
  })

  it('applies look delta when pointer moves with mouse locked', () => {
    const controller = new PlayController()
    controller.enable()
    ;(controller as any).mouseLocked = true
    const moveEvent = new MouseEvent('pointermove', { clientX: 5, clientY: 10, buttons: 1 })
    ;(moveEvent as any).movementX = 10
    ;(moveEvent as any).movementY = 5

    expect(controller.handlePointerMove(moveEvent)).toBe(true)
    const rotation = controller.getViewRotation()
    expect(rotation.y).not.toBe(0)
  })

  it('provides diagnostics about its current state', () => {
    const controller = new PlayController()
    const diag = controller.getDiagnostics()
    expect(diag).toEqual(expect.objectContaining({ status: 'idle', active: false }))
    expect((diag as any).metrics).toHaveProperty('mouseLocked', false)
  })
})
