/** @vitest-environment node */
import { vi } from 'vitest'
vi.mock('ws', () => ({
  WebSocket: class {
    static OPEN = 1
  },
}))
import { WebSocket } from 'ws'

describe('Ws import debug', () => {
  it('imports WebSocket', () => {
    expect(WebSocket).toBeDefined()
  })
})
