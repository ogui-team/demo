import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../client/src/engine/ui/MainMenuRenderer', () => {
  const render = vi.fn()
  const show = vi.fn()
  const hide = vi.fn()
  const setAccessoryPanel = vi.fn()
  const setFooter = vi.fn()
  const updateSelection = vi.fn()
  const destroy = vi.fn()

  return {
    MainMenuRenderer: class {
      onHover: ((index: number) => void) | null = null
      onClick: ((index: number) => void) | null = null
      constructor() {
        this.render = render
        this.show = show
        this.hide = hide
        this.setAccessoryPanel = setAccessoryPanel
        this.setFooter = setFooter
        this.updateSelection = updateSelection
        this.destroy = destroy
      }
      render: typeof render
      show: typeof show
      hide: typeof hide
      setAccessoryPanel: typeof setAccessoryPanel
      setFooter: typeof setFooter
      updateSelection: typeof updateSelection
      destroy: typeof destroy
    },
  }
})

vi.mock('../../../../client/src/engine/gameplay/modes/ModeManager', () => ({
  getModeManager: vi.fn(() => ({
    setMenuPreviewActive: vi.fn(),
    setMode: vi.fn(),
    isPlayMode: vi.fn(() => false),
  })),
}))

vi.mock('@engine/core/public-api', () => ({
  setContext: vi.fn(),
}))

import { MainMenu } from '../../../../client/src/engine/ui/MainMenu'

describe('MainMenu', () => {
  let menu: MainMenu

  beforeEach(() => {
    document.body.innerHTML = ''
    menu = new MainMenu({ showOnCreate: false })
  })

  afterEach(() => {
    menu.destroy()
  })

  it('shows, hides, and tracks visibility', () => {
    expect(menu.isVisible()).toBe(false)
    menu.show()
    expect(menu.isVisible()).toBe(true)
    menu.hide()
    expect(menu.isVisible()).toBe(false)
  })

  it('executes the freeplay callback when the root freeplay item is activated', () => {
    const onFreeplay = vi.fn()
    menu.onFreeplay(onFreeplay)
    menu.show()
    menu.clickIndex(6)
    expect(onFreeplay).toHaveBeenCalledTimes(1)
    expect(menu.isVisible()).toBe(false)
  })

  it('can switch to the levels screen and activate level selection', () => {
    const levels = [{ id: 'test_level', label: 'Test Level' }]
    const onStartLevel = vi.fn()
    menu.setLevelProvider(() => levels)
    menu.onStartLevel(onStartLevel)
    menu.show()
    menu['openLevelsScreen']()
    menu.clickIndex(0)
    expect(onStartLevel).toHaveBeenCalledWith('test_level')
  })

  it('toggles selection with hover and updates renderer selection state', () => {
    menu.show()
    menu.hoverIndex(7)
    expect((menu as any).selectedIndex).toBe(7)
  })
})
