import * as MovementRuntime from '../../server/src/movement/MovementRuntime'
import { applyActivePlayerMovement, updateActorRuntimeForRound } from '../../server/src/session/tickRuntime'

describe('TickRuntime', () => {
  it('skips dead players when applying active player movement', () => {
    const spy = vi.spyOn(MovementRuntime, 'applyPlayerMovementStep').mockImplementation(() => undefined)

    applyActivePlayerMovement({
      players: [
        { id: 'alive', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, dead: false } as any,
        { id: 'dead', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, dead: true } as any,
      ],
      step: 1,
      now: 1000,
      tick: 2,
      config: { movementSpeed: 1 } as any,
      resolveMovement: () => ({ x: 0, y: 0, z: 0 }),
      refreshPlayerStatusMovementModifier: () => undefined,
      syncPlayerEntity: () => undefined,
    })

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('updates actor runtime when round is active and destroys actor otherwise', () => {
    const actorRuntime = {
      ensureSingleton: vi.fn(),
      update: vi.fn(),
      destroyActor: vi.fn(),
    }

    updateActorRuntimeForRound(actorRuntime, 'active', 'actor1', 16)
    expect(actorRuntime.ensureSingleton).toHaveBeenCalledWith('actor1')
    expect(actorRuntime.update).toHaveBeenCalledWith(16)
    expect(actorRuntime.destroyActor).not.toHaveBeenCalled()

    actorRuntime.ensureSingleton.mockClear()
    actorRuntime.update.mockClear()
    actorRuntime.destroyActor.mockClear()

    updateActorRuntimeForRound(actorRuntime, 'warmup', 'actor1', 24)
    expect(actorRuntime.destroyActor).toHaveBeenCalledWith('actor1')
    expect(actorRuntime.ensureSingleton).not.toHaveBeenCalled()
  })
})
