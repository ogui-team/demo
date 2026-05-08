import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Scoreboard } from '../../../../client/src/engine/ui/Scoreboard'

describe('Scoreboard', () => {
  let root: HTMLElement | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    root = null
  })

  afterEach(() => {
    root = null
  })

  class FakeStateManager {
    private listeners = new Map<string, ((next: unknown) => void)[]>()
    private state: Record<string, unknown>

    constructor(state: Record<string, unknown>) {
      this.state = state
    }

    get(path: string): unknown {
      return this.state[path]
    }

    subscribe(path: string, callback: (next: unknown) => void): () => void {
      const subscribers = this.listeners.get(path) ?? []
      subscribers.push(callback)
      this.listeners.set(path, subscribers)
      return () => {
        this.listeners.set(path, subscribers.filter((cb) => cb !== callback))
      }
    }

    set(path: string, value: unknown): void {
      this.state[path] = value
      this.listeners.get(path)?.forEach((callback) => callback(value))
    }
  }

  it('renders scores and responds to Tab key for show/hide', () => {
    const state = new FakeStateManager({
      'game.players': [
        {
          id: 'p1',
          name: 'Alice',
          kills: 3,
          deaths: 1,
          ping: 20,
          level: 5,
          health: 80,
          equipment: ['pistol'],
          dead: false,
        },
      ],
      'game.round': {
        roundNumber: 1,
        status: 'active',
        killLimit: 10,
        timeRemainingMs: 5400,
      },
    })

    const scoreboard = new Scoreboard(state as any)
    expect(document.body.contains((scoreboard as any).root)).toBe(true)
    expect((scoreboard as any).root.style.display).toBe('none')

    scoreboard.show()
    expect((scoreboard as any).root.style.display).toBe('flex')
    expect(document.body.textContent).toContain('ROUND 1')
    expect(document.body.textContent).toContain('Alice')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect((scoreboard as any).root.style.display).toBe('flex')

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab' }))
    expect((scoreboard as any).root.style.display).toBe('none')

    scoreboard.destroy()
    expect(document.body.contains((scoreboard as any).root)).toBe(false)
  })
})
