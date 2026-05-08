import { GameState } from '../../server/src/core/GameState'

describe('GameState', () => {
  it('adds and updates players correctly', () => {
    const gameState = new GameState()
    const ws = {} as any
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789)

    gameState.addPlayer(ws, {})
    const state = gameState.getState()

    expect(state.players).toHaveLength(1)
    expect(state.players[0].id).toHaveLength(9)

    gameState.updatePlayer(ws, { position: { x: 5, y: 5, z: 5 } })
    expect(gameState.getState().players[0].position).toEqual({ x: 5, y: 5, z: 5 })
  })

  it('removes a player from state', () => {
    const gameState = new GameState()
    const ws = {} as any

    gameState.addPlayer(ws, { id: 'player-1' })
    expect(gameState.getState().players).toHaveLength(1)

    gameState.removePlayer(ws)
    expect(gameState.getState().players).toHaveLength(0)
  })
})
