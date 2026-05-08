import { describe, expect, it } from 'vitest'
import type { SoundHandle } from '@engine/gameplay/systems/AudioEngine'
import { gameBus, EntityManager } from '@engine/core/public-api'
import { createAudioEmitterComponent } from '@engine/gameplay/game/components/AudioEmitterComponent'
import { createAudioListenerComponent } from '@engine/gameplay/game/components/AudioListenerComponent'
import { AudioSystem } from '@engine/gameplay/systems/AudioSystem'

class FakeAudioEngine {
  listenerUpdates: Array<{ position: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } }> = []
  playAtCalls: Array<{ soundKey: string; position: { x: number; y: number; z: number }; entityId?: string }> = []
  updateCalls: Array<Map<string, { x: number; y: number; z: number }>> = []
  stopEntityCalls: string[] = []

  playAt(soundKey: string, position: { x: number; y: number; z: number }, opts?: { entityId?: string }): SoundHandle {
    this.playAtCalls.push({ soundKey, position: { ...position }, entityId: opts?.entityId })
    return {
      id: `snd_${this.playAtCalls.length}`,
      source: {} as never,
      panner: {} as never,
      gainNode: {} as never,
      category: 'ambient',
      entityId: opts?.entityId,
      stop: () => {},
      setVolume: () => {},
      setPosition: () => {},
    }
  }

  setListenerPosition(position: { x: number; y: number; z: number }, rotation?: { x: number; y: number; z: number }): void {
    this.listenerUpdates.push({ position: { ...position }, rotation: rotation ? { ...rotation } : undefined })
  }

  update(entityPositions?: Map<string, { x: number; y: number; z: number }>): void {
    this.updateCalls.push(new Map(entityPositions ? Array.from(entityPositions.entries()).map(([id, position]) => [id, { ...position }]) : []))
  }

  stopEntity(entityId: string): void {
    this.stopEntityCalls.push(entityId)
  }

  destroy(): void {}
}

describe('AudioSystem', () => {
  it('tracks listener transforms, auto-plays spatial emitters, and stops removed emitters', () => {
    const entityManager = new EntityManager()
    const audioEngine = new FakeAudioEngine()
    const system = new AudioSystem(audioEngine as never)

    const listener = entityManager.createEntity('listener', {
      position: { x: 0, y: 1.6, z: 0 },
      rotation: { x: 0, y: 0.25, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    listener.addComponent({
      name: 'audioListener',
      data: createAudioListenerComponent() as unknown as Record<string, any>,
    })

    const emitter = entityManager.createEntity('steam_valve', {
      position: { x: 4, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    emitter.addComponent({
      name: 'audioEmitter',
      data: createAudioEmitterComponent('steam_hiss', {
        category: 'ambient',
        volume: 0.35,
        loop: true,
        autoPlay: true,
      }) as unknown as Record<string, any>,
    })

    system.init({
      entityManager,
      eventBus: gameBus,
      network: {} as never,
      replication: {} as never,
      resources: null,
      systems: {},
    })

    system.update(0.016)

    expect(audioEngine.listenerUpdates[0]?.position).toEqual({ x: 0, y: 1.6, z: 0 })
    expect(audioEngine.playAtCalls).toEqual([
      { soundKey: 'steam_hiss', position: { x: 4, y: 0, z: 2 }, entityId: emitter.id },
    ])

    emitter.setPosition({ x: 6, y: 0, z: 1 })
    system.update(0.016)

    expect(audioEngine.updateCalls.at(-1)?.get(emitter.id)).toEqual({ x: 6, y: 0, z: 1 })

    entityManager.destroyEntity(emitter)
    system.update(0.016)

    expect(audioEngine.stopEntityCalls).toContain(emitter.id)
    expect(system.getDebugState()).toMatchObject({
      status: 'idle',
      active: false,
      metrics: expect.objectContaining({ activeEmitterCount: 0 }),
    })
  })
})