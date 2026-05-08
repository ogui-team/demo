import { describe, expect, it } from 'vitest'
import {
  collectAuthorityReadDriftViolations,
  collectProtectedWriteViolations,
} from '../../scripts/validate-authority-enforcement.mjs'

describe('validate-authority-enforcement', () => {
  it('flags protected state writes outside EngineController', () => {
    const violations = collectProtectedWriteViolations(
      'client/src/4-runtime/runtime/bootstrap/example.ts',
      "stateManager.set('game.mode', 'horde')\n",
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      rule: 'forbidden-protected-write',
      filePath: 'client/src/4-runtime/runtime/bootstrap/example.ts',
      line: 1,
    })
  })

  it('allows EngineController to own protected state writes', () => {
    const violations = collectProtectedWriteViolations(
      'client/src/1-kernel/core/EngineController.ts',
      "this.writeStateValue('game.mode', normalized)\n",
    )

    expect(violations).toHaveLength(0)
  })

  it('flags modeManager truth reads on runtime surfaces', () => {
    const violations = collectAuthorityReadDriftViolations(
      'client/src/4-runtime/ui/MainMenu.ts',
      'setContext(modeManager?.isPlayMode() ? \'game\' : \'editor\')\n',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('mode-manager-authority-read')
  })

  it('flags engineGameModes authority reads on runtime surfaces', () => {
    const violations = collectAuthorityReadDriftViolations(
      'client/src/4-runtime/runtime/RuntimeAuxiliaryAssembly.ts',
      "if (engineGameModes.getActiveName() === 'horde') {}\n",
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('game-mode-system-authority-read')
  })

  it('flags state-managed HUD bootstrap defaults', () => {
    const violations = collectAuthorityReadDriftViolations(
      'client/src/4-runtime/runtime/bootstrap/phases.ts',
      "const gameHUD = new HUDSystem({ stateManager, playerMode: 'hidden' })\n",
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('hud-bootstrap-authority-default')
  })
})