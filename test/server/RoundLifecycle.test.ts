import { activateRoundState, advanceActiveRoundClock, buildPlayerScoreSummary, completeRoundState, createScheduledRoundState, selectRoundWinner } from '../../server/src/session/roundLifecycle'

describe('RoundLifecycle', () => {
  const room = { selectedMode: 'ffa' as const, killLimit: 10, roundDurationSec: 120 }

  it('creates scheduled round state with warmup', () => {
    const now = 1000
    const round = createScheduledRoundState(room, 0, now, 500)

    expect(round.status).toBe('warmup')
    expect(round.phase).toBe('starting')
    expect(round.roundNumber).toBe(1)
    expect(round.endsAt).toBe(round.startedAt + 120000)
  })

  it('activates round state correctly', () => {
    const scheduled = createScheduledRoundState(room, 1, 0, 100)
    const active = activateRoundState(scheduled, 1000, 120000)

    expect(active.status).toBe('active')
    expect(active.phase).toBe('in_round')
    expect(active.timeRemainingMs).toBe(120000)
  })

  it('advances round clock and detects timeout', () => {
    const state = activateRoundState(createScheduledRoundState(room, 2, 0, 100), 50, 120000)
    const result = advanceActiveRoundClock(state, state.endsAt + 1)

    expect(result.timedOut).toBe(true)
    expect(result.roundState.timeRemainingMs).toBe(0)
  })

  it('completes round state and assigns winner data', () => {
    const state = activateRoundState(createScheduledRoundState(room, 3, 0, 100), 50, 120000)
    const completed = completeRoundState(state, 'p1', 'timer')

    expect(completed.status).toBe('ended')
    expect(completed.phase).toBe('round_end')
    expect(completed.winnerId).toBe('p1')
    expect(completed.reason).toBe('timer')
  })

  it('builds player score summary with required keys', () => {
    const player = {
      id: 'p1',
      name: 'Alice',
      health: 50,
      armor: 10,
      kills: 3,
      deaths: 1,
      level: 2,
      exp: 150,
      ping: 60,
      equipment: ['pistol'],
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      dead: false,
    }
    const summary = buildPlayerScoreSummary(player as any)

    expect(summary.id).toBe('p1')
    expect(summary.kills).toBe(3)
    expect(summary.position).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('selects the player with highest kills and lowest deaths', () => {
    const winner = selectRoundWinner([
      { id: 'a', kills: 1, deaths: 0, name: 'A' },
      { id: 'b', kills: 2, deaths: 1, name: 'B' },
      { id: 'c', kills: 2, deaths: 0, name: 'C' },
    ])

    expect(winner?.id).toBe('c')
  })
})
