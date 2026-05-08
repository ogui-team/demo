import { EventListenerRegistry } from '../../client/src/engine/core/EventListenerRegistry'
import { EventBus } from '../../client/src/engine/core/EventBus'

describe('EventListenerRegistry', () => {
  let registry: EventListenerRegistry
  let element: HTMLElement
  let bus: EventBus<{ ping: { payload: string } }>

  beforeEach(() => {
    registry = new EventListenerRegistry()
    element = document.createElement('div')
    document.body.appendChild(element)
    bus = new EventBus()
  })

  it('tracks DOM listeners and removes them on dispose', () => {
    const listener = vi.fn()
    registry.addEventListener(element, 'click', listener)
    element.click()
    expect(listener).toHaveBeenCalledOnce()

    registry.dispose()
    element.click()
    expect(listener).toHaveBeenCalledOnce()
    expect(registry.getListenerCount()).toBe(0)
    expect(registry.getListenerBreakdown()).toEqual({ addEventListener: 0, eventBus: 0 })
  })

  it('tracks event bus subscriptions and disposes them', () => {
    const callback = vi.fn()
    registry.on(bus, 'ping', callback)
    bus.emit('ping', { payload: 'hi' })
    expect(callback).toHaveBeenCalledOnce()

    registry.dispose()
    bus.emit('ping', { payload: 'hi again' })
    expect(callback).toHaveBeenCalledOnce()
  })

  it('ignores adds after disposal', () => {
    registry.dispose()
    const listener = vi.fn()
    registry.addEventListener(element, 'click', listener)
    element.click()
    expect(listener).not.toHaveBeenCalled()
    expect(registry.getListenerCount()).toBe(0)
  })
})

