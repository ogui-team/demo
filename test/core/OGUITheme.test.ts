import { OGUI, injectOGUIStylesheet } from '../../client/src/engine/ui/OGUITheme'

describe('OGUITheme', () => {
  it('exports expected design tokens', () => {
    expect(OGUI.bgBase).toBe('rgba(11, 11, 11, 0.93)')
    expect(OGUI.hpFull).toBe('#6aaa6c')
    expect(OGUI.zDialog).toBe(9500)
  })

  it('injects stylesheet only once', () => {
    injectOGUIStylesheet()
    injectOGUIStylesheet()
    expect(document.getElementById('ogui-stylesheet')).not.toBeNull()
    expect(document.querySelectorAll('#ogui-stylesheet').length).toBe(1)
  })
})

