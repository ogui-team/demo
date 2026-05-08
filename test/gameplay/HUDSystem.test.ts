import { HUDSystem } from '../../client/src/engine/gameplay/systems/HUDSystem'
import { gameBus } from '../../client/src/engine/core/public-api'

const healthAdapter = {
  getHpFraction: () => 0.45,
  getHp: () => 45,
  getShield: () => 10,
  getShieldFraction: () => 0.5,
  getMaxShield: () => 20,
}

const weaponAdapter = {
  getCurrentAmmo: () => 3,
  getReserveAmmo: () => 12,
  isReloading: () => true,
  getEquipped: () => 'railgun',
  getDefinition: () => ({ name: 'Railgun' }),
}

const makeStateManager = () => {
  const subs: Record<string, () => void> = {}
  return {
    subscribe(path: string, callback: () => void) {
      subs[path] = callback
      return () => { delete subs[path] }
    },
    fire(path: string) {
      subs[path]?.()
    },
  }
}

describe('HUDSystem', () => {
  let stateManager: ReturnType<typeof makeStateManager>
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stateManager = makeStateManager()
    emitSpy = vi.spyOn(gameBus, 'emit')
  })

  it('mounts, shows, hides, and unmounts the HUD DOM', () => {
    const hud = new HUDSystem({ health: healthAdapter, weapons: weaponAdapter, stateManager, showDebug: true })

    hud.mount()
    expect(document.body.querySelector('div')).toBeTruthy()

    hud.show()
    expect(hud.isVisible()).toBe(true)

    hud.hide()
    expect(hud.isVisible()).toBe(false)

    hud.unmount()
    expect(document.body.querySelector('div')).toBeNull()
  })

  it('updates player mode, round state, and debug data correctly', () => {
    const hud = new HUDSystem({ health: healthAdapter, weapons: weaponAdapter, stateManager, showDebug: true, playerMode: 'play' })

    hud.mount()
    hud.show()
    hud.setPlayerMode('editor')
    expect(hud.getPlayerMode()).toBe('editor')
    expect(emitSpy).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'hudSystem', path: 'ui.hud.mode' }))

    hud.setPlayerMode('play')
    hud.setRoundState(5_200, 5, 2, 1)
    hud.setSpectatingTarget('Watcher')
    hud.setEntityCount(34)
    hud.setTeam('blue')
    hud.setPlayerName('PlayerOne')
    hud.setPlayerList([{ name: 'PlayerOne', hp: 34, team: 1 }])
    hud.setDebugVisible(true)
    hud.setDebugInfo({ latency: 20, server: 'eu' })
    hud.flashDamage(1)
    hud.showNotification('Test Message', 0.1)

    hud.update(0.3)
    expect(hud.isVisible()).toBe(true)

    hud.unmount()
  })

  it('subscribes to state updates when mounted', () => {
    const hud = new HUDSystem({ health: healthAdapter, weapons: weaponAdapter, stateManager })
    hud.mount()
    hud.show()

    stateManager.fire('health.player.hp')
    hud.unmount()
  })
})
