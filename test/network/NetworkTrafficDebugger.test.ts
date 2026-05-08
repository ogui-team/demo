import { NetworkTrafficDebugger, networkTrafficDebugger } from '../../client/src/engine/network/NetworkTrafficDebugger'

describe('NetworkTrafficDebugger', () => {
  afterEach(() => {
    networkTrafficDebugger.clear()
    networkTrafficDebugger.setEnabled(true)
  })

  it('tracks outgoing and incoming traffic events', () => {
    const dbg = new NetworkTrafficDebugger()
    dbg.trackOutgoing('GAMEPLAY_COMMAND', { action: 'move' }, 'MOVE', 'player1', 'entity1')
    dbg.trackIncoming('GAMEPLAY_COMMAND', { action: 'move' }, 'MOVE', 'player1', 'entity1')

    const events = dbg.getEvents()
    expect(events.length).toBe(2)
    expect(events[0].direction).toBe('outgoing')
    expect(events[1].direction).toBe('incoming')
  })

  it('finds matching broadcasts and detects unmatched commands', () => {
    const dbg = new NetworkTrafficDebugger()
    dbg.trackOutgoing('GAMEPLAY_COMMAND', { action: 'spawn' }, 'SPAWN', 'player1', 'entity42')
    expect(dbg.findBroadcastForCommand('GAMEPLAY_COMMAND', 'SPAWN', 'entity42')).toBeNull()

    dbg.trackIncoming('GAMEPLAY_COMMAND', { action: 'spawn' }, 'SPAWN', 'player1', 'entity42')
    expect(dbg.findBroadcastForCommand('GAMEPLAY_COMMAND', 'SPAWN', 'entity42')).not.toBeNull()
  })

  it('detects anomaly patterns and handles disabled tracking', () => {
    const dbg = new NetworkTrafficDebugger()
    dbg.trackOutgoing('GAMEPLAY_COMMAND', { action: 'drop' }, 'DROP_ITEM')
    expect(dbg.detectAnomaly('unmatched_spawns')).toBe(false)
    expect(dbg.detectAnomaly('orphaned_items')).toBe(true)
    expect(dbg.detectAnomaly('unidirectional_traffic')).toBe(true)

    dbg.clear()
    dbg.setEnabled(false)
    dbg.trackOutgoing('GAMEPLAY_COMMAND', { action: 'move' }, 'MOVE')
    expect(dbg.getEvents()).toHaveLength(0)
  })
})
