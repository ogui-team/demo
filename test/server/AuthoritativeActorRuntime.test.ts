import { describe, expect, it, vi } from 'vitest'
import { AuthoritativeActorRuntime, type AuthoritativeActorProfile, type AuthoritativeActorRuntimeHost } from '../../server/src/actor/AuthoritativeActorRuntime'

describe('AuthoritativeActorRuntime', () => {
  const createHost = () => {
    const host: AuthoritativeActorRuntimeHost = {
      sessionId: 'session-1',
      hasActiveActors: vi.fn().mockReturnValue(true),
      resolveMovement: vi.fn((actor, desiredStep) => ({
        x: actor.position.x + desiredStep.x,
        y: actor.position.y,
        z: actor.position.z + desiredStep.z,
      })),
      upsertWorldObject: vi.fn().mockReturnValue(false),
      removeWorldObject: vi.fn().mockReturnValue(false),
      broadcastWorldObjectPlacedOrUpdated: vi.fn(),
      broadcastWorldObjectRemoved: vi.fn(),
    }
    return host
  }

  const createProfile = (): AuthoritativeActorProfile => ({
    id: 'actor-1',
    entityType: 'enemy',
    halfExtents: { x: 1, y: 2, z: 1 },
    collisionRadius: 0.5,
    renderData: { meshType: 'box', color: 0xffffff, geometry: {} },
    motion: { moveSpeed: 5, detectionRange: 10, stopRange: 1, returnRange: 20, syncInterval: 1 },
    createObjectId: (sessionId: string) => `object_${sessionId}_actor-1`,
    resolveSpawnPosition: () => ({ x: 0, y: 0, z: 0 }),
    resolveGoal: () => ({ position: { x: 5, y: 0, z: 0 }, stopRange: 0.5 }),
  })

  it('registers a profile and creates a singleton actor', () => {
    const host = createHost()
    const runtime = new AuthoritativeActorRuntime(host)
    runtime.registerProfile(createProfile())

    const actor = runtime.ensureSingleton('actor-1')

    expect(actor).not.toBeNull()
    expect(actor?.lifecycleState).toBe('active')
    expect(runtime.getActorCount()).toBe(1)
    expect(host.upsertWorldObject).toHaveBeenCalled()
    expect(host.broadcastWorldObjectPlacedOrUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'object_session-1_actor-1' }), false)
  })

  it('destroys an existing actor and broadcasts removal when the world object is removed', () => {
    const host = createHost()
    host.removeWorldObject = vi.fn().mockReturnValue(true)
    const runtime = new AuthoritativeActorRuntime(host)
    runtime.registerProfile(createProfile())
    runtime.ensureSingleton('actor-1')

    runtime.destroyActor('actor-1')

    expect(runtime.getActorCount()).toBe(0)
    expect(host.removeWorldObject).toHaveBeenCalledWith('object_session-1_actor-1')
    expect(host.broadcastWorldObjectRemoved).toHaveBeenCalledWith('object_session-1_actor-1')
  })

  it('updates actor movement toward goal and emits world object updates', () => {
    const host = createHost()
    const runtime = new AuthoritativeActorRuntime(host)
    runtime.registerProfile(createProfile())
    runtime.ensureSingleton('actor-1')

    runtime.update(1)

    expect(runtime.getDiagnostics()).toEqual(expect.objectContaining({ actorCount: 1, lastUpdatedActors: 1, lastMovedActors: 1, profileCount: 1 }))
    expect(host.upsertWorldObject).toHaveBeenCalledTimes(2)
    expect(host.broadcastWorldObjectPlacedOrUpdated).toHaveBeenCalledTimes(2)
  })

  it('does not update or move actors when within stop range', () => {
    const host = createHost()
    const runtime = new AuthoritativeActorRuntime(host)
    const profile = createProfile()
    profile.resolveGoal = () => ({ position: { x: 0, y: 0, z: 0 }, stopRange: 1 })
    runtime.registerProfile(profile)
    runtime.ensureSingleton('actor-1')

    runtime.update(1)

    expect(runtime.getDiagnostics()).toEqual(expect.objectContaining({ actorCount: 1, lastUpdatedActors: 0, lastMovedActors: 0, profileCount: 1 }))
    expect(host.upsertWorldObject).toHaveBeenCalledTimes(1)
    expect(host.broadcastWorldObjectPlacedOrUpdated).toHaveBeenCalledTimes(1)
  })
})
