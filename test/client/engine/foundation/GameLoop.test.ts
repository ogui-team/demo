import { describe, expect, it, vi } from 'vitest'
import { startGameLoop, onUpdate, onRender, stopGameLoop, isGameLoopRunning, getDeltaTime } from '../../../../client/src/engine/foundation/GameLoop'

describe('GameLoop', () => {
  it('registers and unregisters update callbacks', () => {
    const callback = vi.fn()
    const unsubscribe = onUpdate(callback)
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('registers and unregisters render callbacks', () => {
    const callback = vi.fn()
    const unsubscribe = onRender(callback)
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('reports loop state and delta time without starting', () => {
    expect(isGameLoopRunning()).toBe(false)
    expect(getDeltaTime()).toBeTypeOf('number')
    stopGameLoop()
    expect(isGameLoopRunning()).toBe(false)
  })

  it('starts the game loop and executes callbacks through requestAnimationFrame', () => {
    const updateCallback = vi.fn()
    const renderCallback = vi.fn()
    let frameCount = 0
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      frameCount += 1
      if (frameCount === 1) {
        cb(performance.now() + 16)
      }
      return 0
    })

    const originalRaf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = rafSpy

    const unsubscribeUpdate = onUpdate(updateCallback)
    const unsubscribeRender = onRender(renderCallback)

    try {
      startGameLoop()
      expect(isGameLoopRunning()).toBe(true)
      stopGameLoop()
      expect(isGameLoopRunning()).toBe(false)
      expect(updateCallback).toHaveBeenCalled()
      expect(renderCallback).toHaveBeenCalled()
      expect(rafSpy).toHaveBeenCalled()
    } finally {
      unsubscribeUpdate()
      unsubscribeRender()
      globalThis.requestAnimationFrame = originalRaf
    }
  })

  it('does not stack RAF callbacks across stop and restart', () => {
    const callbacks: FrameRequestCallback[] = []
    const cancelSpy = vi.fn()
    const originalRaf = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame

    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb)
      return callbacks.length
    })
    globalThis.cancelAnimationFrame = cancelSpy

    try {
      startGameLoop()
      expect(callbacks).toHaveLength(1)

      stopGameLoop()
      expect(cancelSpy).toHaveBeenCalledWith(1)
      expect(isGameLoopRunning()).toBe(false)

      callbacks[0]?.(performance.now() + 16)
      expect(callbacks).toHaveLength(1)

      startGameLoop()
      expect(callbacks).toHaveLength(2)
      expect(isGameLoopRunning()).toBe(true)
    } finally {
      stopGameLoop()
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
    }
  })
})
