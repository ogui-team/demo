import { OGUI } from '../../ui/OGUITheme';
import { MOVEMENT_FEEL_DEBUG_LIMITS } from '../../../3-network/network/MovementTuningConfig';
import type { ResolvedDebugMovementState, StatusMovementDebugState } from '../../runtime/RuntimeAuxiliaryAssembly';

interface StatusMovementDebugConfig {
  rooted: boolean;
  chilled: boolean;
  electrocuted: boolean;
  speedMultiplier: number;
  impulseMagnitude: number;
  feelSpeedMultiplier: number;
  feelAccelerationMultiplier: number;
  feelFrictionMultiplier: number;
  feelFloatiness: number;
  feelAirControlEnabled: boolean;
  networkSimulation: boolean;
  logEachFrame: boolean;
}

interface StatusMovementDebugPanelConfig {
  getState: () => StatusMovementDebugState;
  setConfig: (patch: Partial<StatusMovementDebugConfig>) => StatusMovementDebugState;
  reset: () => StatusMovementDebugState;
}

export class StatusMovementDebugPanel {
  private readonly getState: StatusMovementDebugPanelConfig['getState'];
  private readonly setConfig: StatusMovementDebugPanelConfig['setConfig'];
  private readonly resetConfig: StatusMovementDebugPanelConfig['reset'];
  private readonly root: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;
  private readonly selectionLine: HTMLDivElement;
  private readonly movementFeelLine: HTMLDivElement;
  private readonly movementHookLine: HTMLDivElement;
  private readonly playersLine: HTMLDivElement;
  private rootedToggle!: HTMLInputElement;
  private chilledToggle!: HTMLInputElement;
  private electrocutedToggle!: HTMLInputElement;
  private networkToggle!: HTMLInputElement;
  private logToggle!: HTMLInputElement;
  private speedSlider!: HTMLInputElement;
  private speedValue!: HTMLSpanElement;
  private impulseSlider!: HTMLInputElement;
  private impulseValue!: HTMLSpanElement;
  private feelSpeedSlider!: HTMLInputElement;
  private feelSpeedValue!: HTMLSpanElement;
  private feelAccelerationSlider!: HTMLInputElement;
  private feelAccelerationValue!: HTMLSpanElement;
  private feelFrictionSlider!: HTMLInputElement;
  private feelFrictionValue!: HTMLSpanElement;
  private feelFloatinessSlider!: HTMLInputElement;
  private feelFloatinessValue!: HTMLSpanElement;
  private feelAirControlToggle!: HTMLInputElement;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private visible = false;
  private animationFrame: number | null = null;

  constructor(config: StatusMovementDebugPanelConfig) {
    this.getState = config.getState;
    this.setConfig = config.setConfig;
    this.resetConfig = config.reset;

    this.root = document.createElement('div');
    this.root.id = 'status-movement-debug-panel';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: String(OGUI.zDebug),
      display: 'none',
      width: '420px',
      padding: '12px',
      background: OGUI.bgBase,
      border: `1px solid ${OGUI.border}`,
      color: OGUI.textPri,
      fontFamily: OGUI.font,
      fontSize: '11px',
      lineHeight: '1.45',
      letterSpacing: '0.6px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      pointerEvents: 'auto',
    });

    const title = document.createElement('div');
    title.textContent = 'STATUS MOVEMENT DEBUG [F7]';
    title.style.marginBottom = '10px';
    title.style.fontWeight = '700';
    this.root.appendChild(title);

    this.statusLine = document.createElement('div');
    this.statusLine.style.marginBottom = '10px';
    this.root.appendChild(this.statusLine);

    this.root.appendChild(this.buildToggleRow('Rooted', (input) => {
      this.rootedToggle = input;
      input.addEventListener('change', () => {
        this.setConfig({ rooted: input.checked });
      });
    }));
    this.root.appendChild(this.buildToggleRow('Chilled', (input) => {
      this.chilledToggle = input;
      input.addEventListener('change', () => {
        this.setConfig({ chilled: input.checked });
      });
    }));
    this.root.appendChild(this.buildToggleRow('Electrocuted', (input) => {
      this.electrocutedToggle = input;
      input.addEventListener('change', () => {
        this.setConfig({ electrocuted: input.checked });
      });
    }));
    this.root.appendChild(this.buildToggleRow('Authoritative MP Sim', (input) => {
      this.networkToggle = input;
      input.addEventListener('change', () => {
        this.setConfig({ networkSimulation: input.checked });
      });
    }));
    this.root.appendChild(this.buildToggleRow('Frame Logs', (input) => {
      this.logToggle = input;
      input.addEventListener('change', () => {
        this.setConfig({ logEachFrame: input.checked });
      });
    }));

    const speedRow = this.buildSliderRow('Chill Speed', 0, 1, 0.05, (input, value) => {
      this.speedSlider = input;
      this.speedValue = value;
      input.addEventListener('input', () => {
        value.textContent = Number(input.value).toFixed(2);
        this.setConfig({ speedMultiplier: Number(input.value) });
      });
    });
    this.root.appendChild(speedRow);

    const impulseRow = this.buildSliderRow('Electrocute Impulse', 0, 12, 0.5, (input, value) => {
      this.impulseSlider = input;
      this.impulseValue = value;
      input.addEventListener('input', () => {
        value.textContent = Number(input.value).toFixed(1);
        this.setConfig({ impulseMagnitude: Number(input.value) });
      });
    });
    this.root.appendChild(impulseRow);

    const feelDivider = document.createElement('div');
    feelDivider.textContent = 'MOVEMENT FEEL LAYER';
    Object.assign(feelDivider.style, {
      marginTop: '12px',
      marginBottom: '8px',
      fontWeight: '700',
      color: OGUI.textPri,
    });
    this.root.appendChild(feelDivider);

    const feelSpeedRow = this.buildSliderRow('Feel speedMultiplier', MOVEMENT_FEEL_DEBUG_LIMITS.speedMultiplier.min, MOVEMENT_FEEL_DEBUG_LIMITS.speedMultiplier.max, MOVEMENT_FEEL_DEBUG_LIMITS.speedMultiplier.step, (input, value) => {
      this.feelSpeedSlider = input;
      this.feelSpeedValue = value;
      input.addEventListener('input', () => {
        value.textContent = Number(input.value).toFixed(2);
        this.setConfig({ feelSpeedMultiplier: Number(input.value) });
      });
    });
    this.root.appendChild(feelSpeedRow);

    const feelAccelerationRow = this.buildSliderRow('Feel acceleration', MOVEMENT_FEEL_DEBUG_LIMITS.accelerationMultiplier.min, MOVEMENT_FEEL_DEBUG_LIMITS.accelerationMultiplier.max, MOVEMENT_FEEL_DEBUG_LIMITS.accelerationMultiplier.step, (input, value) => {
      this.feelAccelerationSlider = input;
      this.feelAccelerationValue = value;
      input.addEventListener('input', () => {
        value.textContent = Number(input.value).toFixed(2);
        this.setConfig({ feelAccelerationMultiplier: Number(input.value) });
      });
    });
    this.root.appendChild(feelAccelerationRow);

    const feelFrictionRow = this.buildSliderRow('Feel friction', MOVEMENT_FEEL_DEBUG_LIMITS.frictionMultiplier.min, MOVEMENT_FEEL_DEBUG_LIMITS.frictionMultiplier.max, MOVEMENT_FEEL_DEBUG_LIMITS.frictionMultiplier.step, (input, value) => {
      this.feelFrictionSlider = input;
      this.feelFrictionValue = value;
      input.addEventListener('input', () => {
        value.textContent = Number(input.value).toFixed(2);
        this.setConfig({ feelFrictionMultiplier: Number(input.value) });
      });
    });
    this.root.appendChild(feelFrictionRow);

    const feelFloatinessRow = this.buildSliderRow('Feel floatiness', MOVEMENT_FEEL_DEBUG_LIMITS.floatiness.min, MOVEMENT_FEEL_DEBUG_LIMITS.floatiness.max, MOVEMENT_FEEL_DEBUG_LIMITS.floatiness.step, (input, value) => {
      this.feelFloatinessSlider = input;
      this.feelFloatinessValue = value;
      input.addEventListener('input', () => {
        value.textContent = Number(input.value).toFixed(2);
        this.setConfig({ feelFloatiness: Number(input.value) });
      });
    });
    this.root.appendChild(feelFloatinessRow);

    this.root.appendChild(this.buildToggleRow('Air Control Hook', (input) => {
      this.feelAirControlToggle = input;
      input.addEventListener('change', () => {
        this.setConfig({ feelAirControlEnabled: input.checked });
      });
    }));

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '10px';
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset';
    Object.assign(resetButton.style, {
      flex: '1',
      padding: '6px 8px',
      background: '#1d1d1d',
      color: OGUI.textPri,
      border: `1px solid ${OGUI.border}`,
      cursor: 'pointer',
    });
    resetButton.addEventListener('click', () => {
      this.resetConfig();
      this.render();
    });
    actions.appendChild(resetButton);
    this.root.appendChild(actions);

    this.selectionLine = document.createElement('div');
    Object.assign(this.selectionLine.style, {
      marginTop: '10px',
      marginBottom: '8px',
      fontSize: '10px',
      color: OGUI.textDim,
    });
    this.root.appendChild(this.selectionLine);

    this.movementFeelLine = document.createElement('div');
    Object.assign(this.movementFeelLine.style, {
      marginBottom: '6px',
      fontSize: '10px',
      color: OGUI.textDim,
    });
    this.root.appendChild(this.movementFeelLine);

    this.movementHookLine = document.createElement('div');
    Object.assign(this.movementHookLine.style, {
      marginBottom: '8px',
      fontSize: '10px',
      color: OGUI.textDim,
    });
    this.root.appendChild(this.movementHookLine);

    this.playersLine = document.createElement('div');
    Object.assign(this.playersLine.style, {
      marginTop: '0',
      marginBottom: '0',
      display: 'grid',
      gap: '8px',
    });
    this.root.appendChild(this.playersLine);

    document.body.appendChild(this.root);

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key !== 'F7') return;
      event.preventDefault();
      this.toggle();
    };
    window.addEventListener('keydown', this.keyHandler);
    this.render();
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'block';
    this.render();
    this.scheduleRender();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.hide();
    window.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }

  private scheduleRender(): void {
    if (!this.visible) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.render();
      this.scheduleRender();
    });
  }

  private render(): void {
    const state = this.getState();
    this.rootedToggle.checked = state.config.rooted;
    this.chilledToggle.checked = state.config.chilled;
    this.electrocutedToggle.checked = state.config.electrocuted;
    this.networkToggle.checked = state.config.networkSimulation;
    this.logToggle.checked = state.config.logEachFrame;
    this.speedSlider.value = String(state.config.speedMultiplier);
    this.speedValue.textContent = state.config.speedMultiplier.toFixed(2);
    this.impulseSlider.value = String(state.config.impulseMagnitude);
    this.impulseValue.textContent = state.config.impulseMagnitude.toFixed(1);
    this.feelSpeedSlider.value = String(state.config.feelSpeedMultiplier);
    this.feelSpeedValue.textContent = state.config.feelSpeedMultiplier.toFixed(2);
    this.feelAccelerationSlider.value = String(state.config.feelAccelerationMultiplier);
    this.feelAccelerationValue.textContent = state.config.feelAccelerationMultiplier.toFixed(2);
    this.feelFrictionSlider.value = String(state.config.feelFrictionMultiplier);
    this.feelFrictionValue.textContent = state.config.feelFrictionMultiplier.toFixed(2);
    this.feelFloatinessSlider.value = String(state.config.feelFloatiness);
    this.feelFloatinessValue.textContent = state.config.feelFloatiness.toFixed(2);
    this.feelAirControlToggle.checked = state.config.feelAirControlEnabled;
    this.statusLine.textContent = `mode: ${state.mode} | connected: ${state.connected ? 'yes' : 'no'} | gameplay: ${state.gameplayActive ? 'yes' : 'no'} | players: ${state.players.length}`;
    this.selectionLine.textContent = `selected: ${state.selectedPlayerId || 'none'} | lane state is explicit: active vs inactive`;
    this.movementFeelLine.textContent = state.movementFeel.live
      ? `feel: ${state.movementFeel.authorityLabel} | live maxSpeed=${state.movementFeel.live.maxSpeed.toFixed(2)} accel=${state.movementFeel.live.acceleration.toFixed(2)} friction=${state.movementFeel.live.friction.toFixed(2)} gravity=${state.movementFeel.live.gravityScale.toFixed(2)}`
      : `feel: ${state.movementFeel.authorityLabel}`;
    this.movementHookLine.textContent = state.movementFeel.hooks
      ? `hooks: jump=${state.movementFeel.hooks.jumpPrepared ? 'ready' : 'off'} sprint=${state.movementFeel.hooks.sprintPrepared ? 'ready' : 'off'} airControl=${state.movementFeel.hooks.airControlEnabled ? 'on' : 'off'} airborne=${state.movementFeel.hooks.airborne ? 'yes' : 'no'} lastJumpImpulse=${state.movementFeel.hooks.lastJumpImpulse.toFixed(2)}`
      : 'hooks: unavailable';
    this.renderPlayerCards(state.players);
  }

  private renderPlayerCards(players: ResolvedDebugMovementState[]): void {
    this.playersLine.replaceChildren();
    if (players.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No active movement debug players';
      empty.style.color = OGUI.textDim;
      this.playersLine.appendChild(empty);
      return;
    }

    for (const playerState of players) {
      this.playersLine.appendChild(this.buildPlayerCard(playerState));
    }
  }

  private buildPlayerCard(playerState: ResolvedDebugMovementState): HTMLDivElement {
    const card = document.createElement('div');
    card.dataset.playerId = playerState.playerId;
    Object.assign(card.style, {
      border: `1px solid ${OGUI.border}`,
      background: 'rgba(0, 0, 0, 0.2)',
      padding: '8px',
      display: 'grid',
      gap: '6px',
    });

    const header = document.createElement('div');
    header.textContent = `${playerState.playerId} | entity=${playerState.entityId || 'n/a'} | net=${playerState.networkEntityId || 'n/a'}`;
    header.style.fontWeight = '700';
    card.appendChild(header);

    const intent = document.createElement('div');
    intent.textContent = `intent (${playerState.hasMovementIntent ? 'set' : 'empty'}): ${JSON.stringify(playerState.movementIntent)}`;
    intent.style.color = OGUI.textDim;
    card.appendChild(intent);

    const movementDelta = document.createElement('div');
    movementDelta.textContent = playerState.hasMovementDelta
      ? `movement delta: ${playerState.movementDelta.toFixed(3)}`
      : 'movement delta: 0.000 (initial sample)';
    movementDelta.style.color = OGUI.textDim;
    card.appendChild(movementDelta);

    const resolvedSummary = document.createElement('div');
    resolvedSummary.textContent = `resolved status: ${JSON.stringify(playerState.resolved)}`;
    resolvedSummary.style.color = OGUI.textDim;
    card.appendChild(resolvedSummary);

    card.appendChild(this.buildLaneBlock('Authoritative Snapshot', playerState.authoritative, playerState.hasAuthoritative, '#5bb6ff'));
    card.appendChild(this.buildLaneBlock('Local Derived', playerState.local, playerState.hasLocal, '#7ad67a'));
    card.appendChild(this.buildLaneBlock('Debug Override', playerState.debug, playerState.hasDebug, '#ffbf5b'));
    card.appendChild(this.buildLaneBlock('Resolved Output', playerState.resolved, playerState.hasResolved, '#ff7a7a'));
    return card;
  }

  private buildLaneBlock(label: string, value: unknown, active: boolean, accent: string): HTMLDivElement {
    const block = document.createElement('div');
    Object.assign(block.style, {
      borderLeft: `3px solid ${accent}`,
      paddingLeft: '6px',
      color: active ? OGUI.textPri : OGUI.textDim,
    });
    const title = document.createElement('div');
    title.textContent = `${label} ${active ? '[set]' : '[empty]'}`;
    title.style.fontWeight = '700';
    const body = document.createElement('pre');
    Object.assign(body.style, {
      margin: '2px 0 0 0',
      whiteSpace: 'pre-wrap',
      fontSize: '10px',
      color: active ? OGUI.textPri : OGUI.textDim,
    });
    body.textContent = active ? JSON.stringify(value) : '{} (inactive lane)';
    block.appendChild(title);
    block.appendChild(body);
    return block;
  }

  private buildToggleRow(label: string, onReady: (input: HTMLInputElement) => void): HTMLLabelElement {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '8px',
      cursor: 'pointer',
    });
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    onReady(input);
    row.appendChild(text);
    row.appendChild(input);
    return row;
  }

  private buildSliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    onReady: (input: HTMLInputElement, value: HTMLSpanElement) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.marginBottom = '8px';
    const title = document.createElement('div');
    title.textContent = label;
    title.style.marginBottom = '4px';
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.gap = '8px';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.style.flex = '1';
    const value = document.createElement('span');
    value.style.minWidth = '36px';
    onReady(input, value);
    controls.appendChild(input);
    controls.appendChild(value);
    row.appendChild(title);
    row.appendChild(controls);
    return row;
  }
}
