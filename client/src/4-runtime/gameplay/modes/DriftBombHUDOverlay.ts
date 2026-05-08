/**
 * DRIFT BOMB HUD OVERLAY
 * Displays round state, economy, bomb position, tether status
 */

import type { DriftBombModeState } from './DriftBombModeRuntime';

export interface HUDDisplayState {
  roundState: string;
  attackerScore: number;
  defenderScore: number;
  attackerEconomy: number;
  defenderEconomy: number;
  bombCarried: boolean;
  bombPositionX: number;
  bombPositionY: number;
  bombPositionZ: number;
  defuseProgress: number;
  tetherActive: boolean;
  tetherDistance: number;
  phaseTimeRemaining: number;
  backendMode: string;
  replayEpoch: number;
  authorityOwner: string;
  driftVelocity: number;
  listenerCount: number;
  queuePressure: number;
}

export class DriftBombHUDOverlay {
  private displayState: HUDDisplayState;
  private canvasId: string;
  private container: HTMLElement | null = null;

  constructor(canvasId: string = 'game-canvas') {
    this.canvasId = canvasId;
    this.displayState = {
      roundState: 'idle',
      attackerScore: 0,
      defenderScore: 0,
      attackerEconomy: 2400,
      defenderEconomy: 2400,
      bombCarried: false,
      bombPositionX: 0,
      bombPositionY: 0,
      bombPositionZ: 0,
      defuseProgress: 0,
      tetherActive: false,
      tetherDistance: 0,
      phaseTimeRemaining: 0,
      backendMode: 'legacy',
      replayEpoch: 0,
      authorityOwner: 'none',
      driftVelocity: 0,
      listenerCount: 0,
      queuePressure: 0,
    };
  }

  initialize(): void {
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) return;

    // Create overlay container
    this.container = document.createElement('div');
    this.container.id = 'drift-bomb-hud';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      font-family: monospace;
      color: #00ff00;
      font-size: 14px;
      z-index: 1000;
    `;

    canvas.parentElement?.appendChild(this.container);
    this.render();
  }

  update(state: DriftBombModeState, phaseTime: number): void {
    this.displayState = {
      roundState: state.state,
      attackerScore: state.attackerScore,
      defenderScore: state.defenderScore,
      attackerEconomy: state.teamEconomy.attackers,
      defenderEconomy: state.teamEconomy.defenders,
      bombCarried: state.bombCarrierEntityId !== null,
      bombPositionX: Math.round(state.bombPosition.x * 10) / 10,
      bombPositionY: Math.round(state.bombPosition.y * 10) / 10,
      bombPositionZ: Math.round(state.bombPosition.z * 10) / 10,
      defuseProgress: Math.round(state.defuseProgress * 100),
      tetherActive: state.defuserEntityId !== null,
      tetherDistance: Math.round(((state as any).debugMetrics?.tetherDistance ?? 0) * 100) / 100,
      phaseTimeRemaining: phaseTime,
      backendMode: String((state as any).debugMetrics?.backendMode ?? 'legacy'),
      replayEpoch: Number((state as any).debugMetrics?.replayEpoch ?? 0),
      authorityOwner: String((state as any).debugMetrics?.authorityOwner ?? 'none'),
      driftVelocity: Number((state as any).debugMetrics?.driftVelocity ?? 0),
      listenerCount: Number((state as any).debugMetrics?.listeners ?? 0),
      queuePressure: Number((state as any).debugMetrics?.queuePressure ?? 0),
    };

    this.render();
  }

  private render(): void {
    if (!this.container) return;

    const html = `
      <div style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); padding: 10px; border: 2px solid #00ff00;">
        <div><strong>DRIFT BOMB</strong></div>
        <div>Round State: ${this.displayState.roundState}</div>
        <div>Attackers: ${this.displayState.attackerScore} | Defenders: ${this.displayState.defenderScore}</div>
        <div>ATK Economy: $${this.displayState.attackerEconomy} | DEF Economy: $${this.displayState.defenderEconomy}</div>
        <div>Bomb Position: (${this.displayState.bombPositionX}, ${this.displayState.bombPositionY}, ${this.displayState.bombPositionZ})</div>
        <div>Bomb Carried: ${this.displayState.bombCarried ? 'YES' : 'NO'}</div>
        ${this.displayState.tetherActive ? `<div style="color: #ff0000;">⚠ DEFUSING - Progress: ${this.displayState.defuseProgress}%</div>` : ''}
        <div>Tether Distance: ${this.displayState.tetherDistance.toFixed(2)}m</div>
        <div>Phase Time: ${this.displayState.phaseTimeRemaining}s</div>
        <div style="margin-top:6px;border-top:1px solid rgba(0,255,0,0.25);padding-top:6px;">
          <div>Backend: ${this.displayState.backendMode.toUpperCase()}</div>
          <div>Replay Epoch: ${this.displayState.replayEpoch}</div>
          <div>Authority: ${this.displayState.authorityOwner}</div>
          <div>Drift Velocity: ${this.displayState.driftVelocity.toFixed(2)} u/s</div>
          <div>Listeners: ${this.displayState.listenerCount} | Queue: ${this.displayState.queuePressure}</div>
        </div>
      </div>
    `;

    this.container.innerHTML = html;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
  }

  getDisplayState(): Readonly<HUDDisplayState> {
    return { ...this.displayState };
  }
}
