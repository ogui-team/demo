import { BinaryTraceExporter, TraceParser } from '../../client/src/engine/core/BinaryTraceExporter'

describe('BinaryTraceExporter', () => {
  it('exports a hex dump string for a valid buffer', () => {
    const buffer = new ArrayBuffer(1024 * 10)
    const view = new DataView(buffer)
    view.setUint32(0, 0, true)
    view.setFloat64(8, 1234.5, true)
    view.setUint32(16, 42, true)
    view.setUint16(20, 2, true)

    const kernel = { getBiteBuffer: () => buffer } as any
    const hex = BinaryTraceExporter.exportHexDump(kernel, 2)

    expect(hex).toContain('Frame 0:')
    expect(hex).toContain('Frame 1:')
  })

  it('creates a download link and revokes the object URL when exporting', () => {
    const buffer = new ArrayBuffer(1024 * 10)
    const kernel = { getBiteBuffer: () => buffer } as any
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const linkClick = vi.fn()
    const originalCreateElement = document.createElement.bind(document)

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName)
      if (tagName === 'a') {
        element.click = linkClick
      }
      return element
    })

    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    BinaryTraceExporter.exportTrace(kernel)

    expect(createObjectURL).toHaveBeenCalled()
    expect(linkClick).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
    spyLog.mockRestore()
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it('parses trace frames and validates buffer integrity', () => {
    const buffer = new ArrayBuffer(1024 * 300)
    const view = new DataView(buffer)
    view.setUint32(0, 0, true)
    view.setFloat64(8, 1234.5, true)
    view.setUint32(16, 1, true)
    view.setUint16(20, 0, true)
    const parser = new TraceParser(buffer)

    expect(parser.getFrameHeader(0)).toEqual(expect.objectContaining({ frameIndex: 0, timestamp: 1234.5 }))
    expect(parser.validate().valid).toBe(false) // buffer has no sequential frames
    expect(parser.getReconciliationEvents(0)).toEqual([])
    expect(parser.getGizmoEvents(0)).toEqual([])
  })
})
