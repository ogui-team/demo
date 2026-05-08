import { StateManager } from '../../0-foundation/foundation/state/StateManager';
import { PlayerRuntimeState, RoundState, sortPlayersForScoreboard } from '../../2-systems/gameplay/game/PlayerState';
import { OGUI } from './OGUITheme';

interface DriftBombScoreboardState {
  phase: string;
  roundNumber: number;
  phaseTimeRemaining: number;
  attackersRoundsWon: number;
  defendersRoundsWon: number;
  attackersAlive: number;
  defendersAlive: number;
  attackerEconomy: number;
  defenderEconomy: number;
}

export class Scoreboard {
  private stateManager: StateManager;
  private root: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private metaEl: HTMLDivElement;
  private tableEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private visible = false;
  private unsubscribeFns: Array<() => void> = [];
  private keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
    this.root = document.createElement('div');
    this.titleEl = document.createElement('div');
    this.metaEl = document.createElement('div');
    this.tableEl = document.createElement('div');
    this.footerEl = document.createElement('div');

    this._applyRootStyle();
    this._applyTitleStyle();
    this._applyMetaStyle();
    this._applyTableStyle();
    this._applyFooterStyle();

    this.titleEl.textContent = 'SCOREBOARD';
    this.footerEl.textContent = 'TAB: Hold to view scoreboard';

    this.root.appendChild(this.titleEl);
    this.root.appendChild(this.metaEl);
    this.root.appendChild(this.tableEl);
    this.root.appendChild(this.footerEl);
    document.body.appendChild(this.root);

    this.hide();
    this._attachState();
    this._attachKeyboard();
    this.render();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.hide();
    while (this.unsubscribeFns.length > 0) this.unsubscribeFns.pop()?.();
    if (this.keyDownHandler) window.removeEventListener('keydown', this.keyDownHandler);
    if (this.keyUpHandler) window.removeEventListener('keyup', this.keyUpHandler);
    this.root.remove();
  }

  render(): void {
    const activeGameMode = this.stateManager.get('game.mode');
    if (activeGameMode === 'drift_bomb') {
      this.renderDriftBomb();
      return;
    }

    const players = sortPlayersForScoreboard((this.stateManager.get('game.players') as PlayerRuntimeState[] | undefined) ?? []);
    const round = (this.stateManager.get('game.round') as RoundState | undefined) ?? null;

    const seconds = round ? Math.max(0, Math.ceil(round.timeRemainingMs / 1000)) : 0;
    this.metaEl.textContent = round
      ? `FFA  |  ROUND ${round.roundNumber}  |  ${round.status.toUpperCase()}  |  KILL LIMIT ${round.killLimit}  |  ${seconds}s`
      : 'FFA  |  WAITING FOR ROUND DATA';

    this.tableEl.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = `display:grid;grid-template-columns:2fr repeat(5,1fr) 2fr;gap:12px;padding:8px 14px;border-bottom:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-size:11px;letter-spacing:1px;text-transform:uppercase;`;
    header.innerHTML = '<span>Player</span><span>K</span><span>D</span><span>Ping</span><span>Lvl</span><span>HP</span><span>Equipment</span>';
    this.tableEl.appendChild(header);

    if (players.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `padding:18px 14px;color:${OGUI.textDim};text-align:center;`;
      empty.textContent = 'No players in match';
      this.tableEl.appendChild(empty);
      return;
    }

    players.forEach((player, index) => {
      const row = document.createElement('div');
      const medalColor = index === 0 ? OGUI.textWhite : OGUI.textSec;
      row.style.cssText = `display:grid;grid-template-columns:2fr repeat(5,1fr) 2fr;gap:12px;padding:10px 14px;border-left:3px solid ${index === 0 ? OGUI.borderSel : 'transparent'};background:${index % 2 === 0 ? OGUI.bgRow : 'transparent'};color:${medalColor};`;
      row.innerHTML = `
        <span>${this._escape(player.name)}${player.dead ? ' [DEAD]' : ''}</span>
        <span>${player.kills}</span>
        <span>${player.deaths}</span>
        <span>${player.ping}</span>
        <span>${player.level}</span>
        <span>${player.health}</span>
        <span>${this._escape(player.equipment.join(', '))}</span>
      `;
      this.tableEl.appendChild(row);
    });
  }

  private renderDriftBomb(): void {
    const driftState = (this.stateManager.get('driftBomb.scoreboard') as DriftBombScoreboardState | null) ?? null;
    if (!driftState) {
      this.metaEl.textContent = 'DRIFT BOMB  |  WAITING FOR ROUND DATA';
      this.tableEl.innerHTML = '';
      return;
    }

    const seconds = Math.max(0, Math.ceil(driftState.phaseTimeRemaining));
    this.metaEl.textContent = `DRIFT BOMB  |  ROUND ${driftState.roundNumber}  |  ${driftState.phase.toUpperCase()}  |  ${seconds}s`;

    this.tableEl.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = `display:grid;grid-template-columns:2fr repeat(4,1fr);gap:12px;padding:8px 14px;border-bottom:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-size:11px;letter-spacing:1px;text-transform:uppercase;`;
    header.innerHTML = '<span>Team</span><span>Rounds Won</span><span>Alive</span><span>Economy</span><span>Objective</span>';
    this.tableEl.appendChild(header);

    const attackerRow = document.createElement('div');
    attackerRow.style.cssText = `display:grid;grid-template-columns:2fr repeat(4,1fr);gap:12px;padding:10px 14px;border-left:3px solid ${OGUI.borderSel};background:${OGUI.bgRow};color:${OGUI.textWhite};`;
    attackerRow.innerHTML = `
      <span>ATTACKERS</span>
      <span>${driftState.attackersRoundsWon}</span>
      <span>${driftState.attackersAlive}</span>
      <span>$${driftState.attackerEconomy}</span>
      <span>PLANT</span>
    `;
    this.tableEl.appendChild(attackerRow);

    const defenderRow = document.createElement('div');
    defenderRow.style.cssText = `display:grid;grid-template-columns:2fr repeat(4,1fr);gap:12px;padding:10px 14px;border-left:3px solid transparent;color:${OGUI.textSec};`;
    defenderRow.innerHTML = `
      <span>DEFENDERS</span>
      <span>${driftState.defendersRoundsWon}</span>
      <span>${driftState.defendersAlive}</span>
      <span>$${driftState.defenderEconomy}</span>
      <span>DEFUSE</span>
    `;
    this.tableEl.appendChild(defenderRow);
  }

  private _attachState(): void {
    this.unsubscribeFns.push(this.stateManager.subscribe('game.players', () => {
      if (this.visible) this.render();
    }));
    this.unsubscribeFns.push(this.stateManager.subscribe('game.round', () => {
      if (this.visible) this.render();
    }));
    this.unsubscribeFns.push(this.stateManager.subscribe('game.mode', () => {
      if (this.visible) this.render();
    }));
    this.unsubscribeFns.push(this.stateManager.subscribe('driftBomb.scoreboard', () => {
      if (this.visible) this.render();
    }));
  }

  private _attachKeyboard(): void {
    this.keyDownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        this.show();
      }
    };
    this.keyUpHandler = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        this.hide();
      }
    };
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
  }

  private _escape(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private _applyRootStyle(): void {
    const style = this.root.style;
    style.position = 'fixed';
    style.top = '32px';
    style.left = '50%';
    style.transform = 'translateX(-50%)';
    style.width = 'min(960px, 92vw)';
    style.maxHeight = '70vh';
    style.display = 'flex';
    style.flexDirection = 'column';
    style.overflow = 'hidden';
    style.zIndex = '9200';
    style.border = `1px solid ${OGUI.border}`;
    style.background = OGUI.bgBase;
    style.backdropFilter = 'blur(4px)';
    style.boxShadow = '0 20px 60px rgba(0,0,0,0.45)';
    style.fontFamily = OGUI.font;
    style.userSelect = 'none';
    style.pointerEvents = 'none';
  }

  private _applyTitleStyle(): void {
    const style = this.titleEl.style;
    style.padding = '14px 18px 6px';
    style.color = OGUI.textHead;
    style.fontSize = '18px';
    style.fontWeight = 'bold';
    style.letterSpacing = '4px';
  }

  private _applyMetaStyle(): void {
    const style = this.metaEl.style;
    style.padding = '0 18px 12px';
    style.color = OGUI.textSec;
    style.fontSize = '11px';
    style.letterSpacing = '1px';
  }

  private _applyTableStyle(): void {
    const style = this.tableEl.style;
    style.display = 'flex';
    style.flexDirection = 'column';
    style.overflowY = 'auto';
  }

  private _applyFooterStyle(): void {
    const style = this.footerEl.style;
    style.padding = '10px 18px 14px';
    style.color = OGUI.textDim;
    style.fontSize = '10px';
    style.letterSpacing = '1px';
  }
}