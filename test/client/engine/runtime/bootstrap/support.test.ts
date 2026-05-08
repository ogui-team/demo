import { describe, expect, it, beforeEach } from 'vitest'
import { readNumber, getDefaultServerHttpUrl, getDefaultServerWsUrl, getHalfExtentsFromRenderData } from '@engine/runtime/bootstrap/support'

describe('bootstrap support utilities', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: {
        protocol: 'https:',
        hostname: 'example.com',
        port: '8080',
      },
      writable: true,
    })
  })

  it('reads numbers with fallback', () => {
    expect(readNumber(3, 1)).toBe(3)
    expect(readNumber('foo', 5)).toBe(5)
    expect(readNumber(NaN, 2)).toBe(2)
  })

  it('builds default HTTP and WS URLs', () => {
    expect(getDefaultServerHttpUrl()).toBe('https://example.com:8080')
    expect(getDefaultServerWsUrl()).toBe('wss://example.com:8080')
  })

  it('computes half extents for all supported mesh types', () => {
    expect(getHalfExtentsFromRenderData({ meshType: 'sphere', geometry: { radius: 2 } })).toEqual({ x: 2, y: 2, z: 2 })
    expect(getHalfExtentsFromRenderData({ meshType: 'capsule', geometry: { radius: 1, height: 4 } })).toEqual({ x: 1, y: 3, z: 1 })
    expect(getHalfExtentsFromRenderData({ meshType: 'cylinder', geometry: { radiusTop: 0.5, radiusBottom: 1, height: 2 } })).toEqual({ x: 1, y: 1, z: 1 })
    expect(getHalfExtentsFromRenderData({ meshType: 'plane', geometry: { width: 4, height: 2 } })).toEqual({ x: 2, y: 0.1, z: 1 })
    expect(getHalfExtentsFromRenderData({ meshType: 'box', geometry: { width: 2, height: 4, depth: 6 } })).toEqual({ x: 1, y: 2, z: 3 })
  })
})
