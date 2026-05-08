import { ObjectPool, type IPoolable } from '../../client/src/engine/core/ObjectPool'

describe('ObjectPool', () => {
  it('prewarms available objects and reports stats', () => {
    const pool = new ObjectPool(() => ({ value: 1 }), { initialSize: 2 })
    expect(pool.getStats()).toEqual({ available: 2, active: 0, total: 2 })
  })

  it('acquires and releases poolable objects with lifecycle hooks', () => {
    const factory = vi.fn(() => ({ isActive: false, reset() { this.value = 0 }, value: 42 }))
    const onAcquire = vi.fn()
    const onRelease = vi.fn()
    const pool = new ObjectPool(factory, { onAcquire, onRelease })

    const item = pool.acquire() as IPoolable & { value: number }
    expect(item.isActive).toBe(true)
    expect(onAcquire).toHaveBeenCalledWith(item)
    expect(pool.getStats()).toEqual({ available: 0, active: 1, total: 1 })

    pool.release(item)
    expect(item.isActive).toBe(false)
    expect(onRelease).toHaveBeenCalledWith(item)
    expect(pool.getStats()).toEqual({ available: 1, active: 0, total: 1 })
  })

  it('releases only active objects and keeps stats correct', () => {
    const pool = new ObjectPool(() => ({ isActive: false, reset() {} }))
    const first = pool.acquire()
    const second = pool.acquire()

    pool.release(first)
    pool.release(first)
    expect(pool.getStats()).toEqual({ available: 1, active: 1, total: 2 })
  })

  it('releaseAll returns all active objects to the pool', () => {
    const pool = new ObjectPool(() => ({ isActive: false, reset() {} }))
    pool.acquire()
    pool.acquire()

    pool.releaseAll()
    expect(pool.getStats()).toEqual({ available: 2, active: 0, total: 2 })
  })

  it('uses a custom reset callback when provided', () => {
    const resetFn = vi.fn()
    const pool = new ObjectPool(
      () => ({ isActive: false, reset() {}, value: 1 }),
      { reset: resetFn },
    )

    const item = pool.acquire()
    pool.release(item)

    expect(resetFn).toHaveBeenCalledWith(item)
  })

  it('returns active values iterator', () => {
    const pool = new ObjectPool(() => ({ isActive: false, reset() {} }))
    const item = pool.acquire()
    const values = Array.from(pool.getActiveValues())

    expect(values).toEqual([item])
  })

  it('iterates active values with forEachActive', () => {
    const pool = new ObjectPool(() => ({ isActive: false, reset() {} }))
    pool.acquire()
    let count = 0
    pool.forEachActive(() => count += 1)
    expect(count).toBe(1)
  })
})
