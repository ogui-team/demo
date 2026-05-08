import { processPlayerInput } from '../../server/src/session/playerInputRuntime'

describe('PlayerInputRuntime', () => {
  const basePlayer = {
    dead: false,
    lastInputSeq: 0,
    lastProcessedInputSeq: 0,
    lastProcessedInputTick: 0,
    lastUpdate: 0,
    lastMoveCommandAt: 0,
    rotation: { x: 0, y: 0, z: 0 },
    jumpHeld: false,
    jumpBufferRemaining: 0,
    currentInput: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      crouch: false,
      sprint: false,
      airControl: true,
      yaw: 0,
      pitch: 0,
    },
  }

  it('ignores input when player is dead', () => {
    const player = { ...basePlayer, dead: true }
    processPlayerInput({
      player,
      seq: 1,
      now: 100,
      currentTick: 1,
      tickRate: 60,
      isRoundActive: true,
      jumpBufferSeconds: 0.12,
      sanitizeInput: () => ({ ...player.currentInput, jump: true }),
    })

    expect(player.lastInputSeq).toBe(0)
  })

  it('ignores input when sequence is stale', () => {
    const player = { ...basePlayer, lastInputSeq: 10 }
    processPlayerInput({
      player,
      seq: 5,
      now: 200,
      currentTick: 2,
      tickRate: 60,
      isRoundActive: true,
      jumpBufferSeconds: 0.12,
      sanitizeInput: () => ({ ...player.currentInput, jump: true }),
    })

    expect(player.lastProcessedInputSeq).toBe(0)
  })

  it('updates player input and jump buffer when valid', () => {
    const player = { ...basePlayer }
    processPlayerInput({
      player,
      seq: 1,
      now: 200,
      currentTick: 2,
      tickRate: 60,
      isRoundActive: true,
      jumpBufferSeconds: 0.12,
      sanitizeInput: () => ({ ...player.currentInput, jump: true }),
    })

    expect(player.lastInputSeq).toBe(1)
    expect(player.lastProcessedInputSeq).toBe(1)
    expect(player.jumpHeld).toBe(true)
  })
})
