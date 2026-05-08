import { Entity } from '../../client/src/engine/core/Entity'
import { NetworkManager } from '../../client/src/engine/network/NetworkManager'
import type { PlayerNetworkState, NetworkInputCommand, NetworkSnapshot } from '../../client/src/engine/network/NetworkRuntimeContracts'

class FakeTransport {
  public sentStates: PlayerNetworkState[] = []
  public sentInputs: NetworkInputCommand[] = []
  public sentSnapshots: NetworkSnapshot[] = []
  private stateCallback: ((state: PlayerNetworkState) => void) | null = null
  private inputCallback: ((command: NetworkInputCommand) => void) | null = null

  sendState(state: PlayerNetworkState): void {
    this.sentStates.push(state)
  }

  onStateReceived(callback: (state: PlayerNetworkState) => void): void {
    this.stateCallback = callback
  }

  sendInput(command: NetworkInputCommand): void {
    this.sentInputs.push(command)
  }

  onInputReceived(callback: (command: NetworkInputCommand) => void): void {
    this.inputCallback = callback
  }

  sendSnapshot(snapshot: NetworkSnapshot): void {
    this.sentSnapshots.push(snapshot)
  }

  disconnect(): void {
    this.sentStates = []
    this.sentInputs = []
    this.sentSnapshots = []
  }

  triggerState(state: PlayerNetworkState): void {
    this.stateCallback?.(state)
  }
  triggerInput(command: NetworkInputCommand): void {
    this.inputCallback?.(command)
  }}

describe('NetworkManager', () => {
  let transport: FakeTransport
  let entityManager: any
  let manager: NetworkManager

  beforeEach(() => {
    transport = new FakeTransport()
    entityManager = {
      getEntities: vi.fn(() => []),
      createEntity: vi.fn((type, config) => {
        const entity = new Entity('remote-1', type, { position: config.position, rotation: config.rotation })
        entity.addComponent({ name: 'render', data: {} })
        return entity
      }),
      destroyEntity: vi.fn(),
    }
    manager = new NetworkManager(entityManager, transport as any, 'local-1', false)
  })

  it('sends local state on update when a local player entity exists', () => {
    const localEntity = new Entity('local-1', 'player', { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 } })
    localEntity.addComponent({ name: 'localPlayer', data: {} })
    entityManager.getEntities = vi.fn(() => [localEntity])

    manager.update(1 / 60)
    expect(transport.sentStates.length).toBe(1)
    expect(transport.sentStates[0].playerId).toBe('local-1')
  })

  it('increments input sequence and sends commands', () => {
    expect(manager.nextInputSequence()).toBe(1)
    expect(manager.nextInputSequence()).toBe(2)

    const command: NetworkInputCommand = { playerId: 'local-1', seq: 3, tick: 10, timestamp: 123, input: { move: true } }
    manager.sendInputCommand(command)
    expect(transport.sentInputs).toEqual([command])
  })

  it('registers and removes input callbacks cleanly', () => {
    const callback = vi.fn()
    const unsubscribe = manager.onInputCommand(callback)
    transport.triggerInput({ playerId: 'test', seq: 1, tick: 1, timestamp: 1, input: { jump: true } })
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
    transport.triggerInput({ playerId: 'test', seq: 2, tick: 2, timestamp: 2, input: { jump: false } })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('handles remote state updates and returns remote player ids', () => {
    transport.triggerState({ playerId: 'remote-42', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, timestamp: 1 })
    expect(manager.getRemotePlayerIds()).toContain('remote-42')

    manager.removeRemotePlayer('remote-42')
    expect(manager.getRemotePlayerIds()).not.toContain('remote-42')
  })

  it('can send snapshots and destroy network manager resources', () => {
    const snapshot: NetworkSnapshot = { tick: 1, timestamp: 2, ackInputSeq: 0, entities: [] }
    manager.sendSnapshot(snapshot)
    expect(transport.sentSnapshots).toEqual([snapshot])

    manager.destroy()
    expect(transport.sentSnapshots).toEqual([])
  })

  it('exposes diagnostics and local player id updates', () => {
    expect(manager.getLocalPlayerId()).toBe('local-1')
    manager.setLocalPlayerId('local-2')
    expect(manager.getLocalPlayerId()).toBe('local-2')
    expect(manager.getDiagnostics().localPlayerId).toBe('local-2')
  })
})
