import { KernelCommandQueue } from '../../client/src/engine/core/kernel/KernelCommandQueue'

describe('KernelCommandQueue', () => {
  it('enqueues and drains commands in FIFO order', () => {
    const queue = new KernelCommandQueue(3)
    expect(queue.length).toBe(0)

    expect(queue.enqueue(1, 0, 1000, 'test', 'A', null, { value: 1 })).toBe(true)
    expect(queue.enqueue(2, 0, 1001, 'test', 'B', 'p1', { value: 2 })).toBe(true)
    expect(queue.length).toBe(2)

    const consumed: Array<{ type: string; payload: unknown }> = []
    const count = queue.drain((seq, tick, timestamp, source, type, playerId, payload) => {
      consumed.push({ type, payload })
      expect(source).toBe('test')
      expect(playerId === null || playerId === 'p1').toBe(true)
      expect(timestamp === 1000 || timestamp === 1001).toBe(true)
    })

    expect(count).toBe(2)
    expect(queue.length).toBe(0)
    expect(consumed).toEqual([
      { type: 'A', payload: { value: 1 } },
      { type: 'B', payload: { value: 2 } },
    ])
  })

  it('returns false when capacity is reached and allows clear and reuse', () => {
    const queue = new KernelCommandQueue(2)
    expect(queue.enqueue(1, 1, 1000, 'test', 'A', null, {})).toBe(true)
    expect(queue.enqueue(2, 1, 1001, 'test', 'B', null, {})).toBe(true)
    expect(queue.enqueue(3, 1, 1002, 'test', 'C', null, {})).toBe(false)
    expect(queue.length).toBe(2)

    queue.clear()
    expect(queue.length).toBe(0)
    expect(queue.enqueue(4, 2, 1002, 'test', 'D', null, {})).toBe(true)
  })
})
