import { clearLoggedEvents, getLoggedEvents, getRecentEvents, logEvent } from '../../client/src/engine/core/EventLogger'

describe('EventLogger', () => {
  it('records events and exposes logged events', () => {
    clearLoggedEvents()
    logEvent('test', 'first event')
    logEvent('test', 'second event')

    const events = getLoggedEvents()
    expect(events).toHaveLength(2)
    expect(events[0].message).toBe('first event')
    expect(events[1].message).toBe('second event')
  })

  it('returns the most recent events with a limit', () => {
    clearLoggedEvents()
    for (let i = 0; i < 5; i += 1) {
      logEvent('limit', `event ${i}`)
    }

    const recent = getRecentEvents(3)
    expect(recent).toHaveLength(3)
    expect(recent[0].message).toBe('event 2')
    expect(recent[2].message).toBe('event 4')
  })

  it('clears events', () => {
    logEvent('clear', 'should be cleared')
    clearLoggedEvents()
    expect(getLoggedEvents()).toHaveLength(0)
  })

  it('drops older events when capacity is exceeded', () => {
    clearLoggedEvents()
    for (let i = 0; i < 105; i += 1) {
      logEvent('overflow', `event ${i}`)
    }

    const events = getLoggedEvents()
    expect(events).toHaveLength(100)
    expect(events[0].message).toBe('event 5')
  })
})
