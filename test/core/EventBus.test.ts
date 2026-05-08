import { EventBus } from '../../client/src/engine/core/EventBus'

type SampleEvents = {
  foo: { value: number }
  bar: string
}

describe('EventBus', () => {
  it('subscribes and emits events', () => {
    const bus = new EventBus<SampleEvents>()
    const result: Array<{ event: string; payload: unknown }> = []

    bus.on('foo', (payload) => {
      result.push({ event: 'foo', payload })
    })

    bus.emit('foo', { value: 42 })
    expect(result).toEqual([{ event: 'foo', payload: { value: 42 } }])
    expect(bus.listenerCount('foo')).toBe(1)
  })

  it('unsubscribes correctly', () => {
    const bus = new EventBus<SampleEvents>()
    const cb = vi.fn()
    const unsub = bus.on('bar', cb)

    expect(bus.listenerCount('bar')).toBe(1)
    unsub()
    expect(bus.listenerCount('bar')).toBe(0)
    bus.emit('bar', 'hello')
    expect(cb).not.toHaveBeenCalled()
  })

  it('supports once subscriptions', () => {
    const bus = new EventBus<SampleEvents>()
    const cb = vi.fn()
    bus.once('bar', cb)

    bus.emit('bar', 'first')
    bus.emit('bar', 'second')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(bus.listenerCount('bar')).toBe(0)
  })

  it('clears listeners by event and globally', () => {
    const bus = new EventBus<SampleEvents>()
    bus.on('foo', () => {})
    bus.on('bar', () => {})
    expect(bus.listenerCount('foo')).toBe(1)
    expect(bus.listenerCount('bar')).toBe(1)

    bus.clear('foo')
    expect(bus.listenerCount('foo')).toBe(0)
    expect(bus.listenerCount('bar')).toBe(1)

    bus.clear()
    expect(bus.listenerCount('bar')).toBe(0)
  })
})

