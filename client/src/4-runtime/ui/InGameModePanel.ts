/**
 * InGameModePanel
 * Toggled with O key during a match. Lets the local player switch between:
 *   play       – normal FPS (default)
 *   spectator  – free-fly camera, no hitbox, invisible to others
 *   editor     – editor fly-cam + object placement (host-only or if allowed)
 *
 * On mode change the server is told via PLAYER_MODE_CHANGE action so it can:
 *   • mark the player as dead/spectating (no hit registration)
 *   • respawn them when switching back to play
 */

import { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import * as Engine from '../../0-foundation/foundation/Engine';
import { setContext } from '@engine/1-kernel/core/public-api';
import { OGUI } from './OGUITheme';
import { EventListenerRegistry } from '../../1-kernel/core/EventListenerRegistry';

export type InGamePlayerMode = 'play' | 'spectator' | 'editor';

interface ModeOption {
  id: InGamePlayerMode;
  label: string;
  description: string;
  /** Modes that cannot be entered (e.g. editor locked to host only) */
  locked?: boolean;
  lockedReason?: string;
}

const BASE_STYLE = `
  position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
  background:${OGUI.bgPanel};
  border:1px solid ${OGUI.border};
  box-shadow:0 24px 60px rgba(0,0,0,0.7);
  width:min(480px,92vw);
  font-family:${OGUI.font};
  color:${OGUI.textPri};
  z-index:${OGUI.zMenu};
  display:flex;flex-direction:column;
  user-select:none;
  -webkit-user-select:none;
  outline:none;
`;

export class InGameModePanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private currentMode: InGamePlayerMode = 'play';
  private selectedIndex = 0;
  private listenerRegistry = new EventListenerRegistry();

  private client: MultiplayerClient | null = null;
  private onModeChangeCallback: ((mode: InGamePlayerMode) => void) | null = null;

  /** Whether this player is the session host (editor mode only available to host by default) */
  private isHost = false;

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.keyHandler = (e) => this._onKey(e);
    // Tier 0A: Track keyboard listener via EventListenerRegistry
    this.listenerRegistry.addEventListener(window, 'keydown', this.keyHandler);
  }

  attachClient(client: MultiplayerClient, isHost = false): void {
    this.client = client;
    this.isHost = isHost;
  }

  onModeChange(cb: (mode: InGamePlayerMode) => void): void {
    this.onModeChangeCallback = cb;
  }

  setCurrentMode(mode: InGamePlayerMode): void {
    this.currentMode = mode;
    const modes = this._modes();
    this.selectedIndex = modes.findIndex((m) => m.id === mode);
    if (this.selectedIndex < 0) this.selectedIndex = 0;
    if (this.visible) this._render();
  }

  setHostStatus(host: boolean): void {
    this.isHost = host;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    setContext('ui');
    if (!this.el) this._createEl();
    this._render();
    this.el!.style.display = 'flex';
    this.el!.focus();
  }

  hide(): void {
    this.visible = false;
    if (this.el) this.el.style.display = 'none';
    setContext(Engine.getAuthoritativeInputContext());
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  isVisible(): boolean { return this.visible; }

  destroy(): void {
    // Tier 0A: Dispose all tracked event listeners
    this.listenerRegistry.dispose();
    
    // Legacy cleanup for safety
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.el?.remove();
    this.el = null;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _modes(): ModeOption[] {
    return [
      {
        id: 'play',
        label: 'PLAY MODE',
        description: 'Standard FPS — move, shoot, die, respawn.',
      },
      {
        id: 'spectator',
        label: 'SPECTATOR',
        description: 'Free-fly camera. No hitbox. Cannot deal or receive damage.',
      },
      {
        id: 'editor',
        label: 'EDITOR MODE',
        description: 'Place objects and edit the level. Only the host can enable this.',
        locked: !this.isHost,
        lockedReason: 'HOST ONLY',
      },
    ];
  }

  private _createEl(): void {
    this.el = document.createElement('div');
    this.el.style.cssText = BASE_STYLE;
    this.el.tabIndex = -1;
    document.body.appendChild(this.el);
  }

  private _render(): void {
    if (!this.el) return;
    const modes = this._modes();

    const rows = modes
      .map((m, i) => {
        const sel = i === this.selectedIndex;
        const active = m.id === this.currentMode;
        const bg = sel ? OGUI.bgSelected : 'transparent';
        const borderL = sel ? OGUI.borderSel : active ? OGUI.ok : 'transparent';
        const textColor = m.locked ? OGUI.textDim : sel ? OGUI.textWhite : active ? OGUI.textAct : OGUI.textSec;
        const badge = active ? ` <span style="color:${OGUI.ok};font-size:10px;">[ACTIVE]</span>` : '';
        const lock = m.locked ? ` <span style="color:${OGUI.warn};font-size:10px;">[${m.lockedReason}]</span>` : '';
        return `
          <div data-mode-index="${i}" style="
            background:${bg};
            border-left:3px solid ${borderL};
            padding:14px 18px;
            cursor:${m.locked ? 'not-allowed' : 'pointer'};
            display:flex;flex-direction:column;gap:4px;
          ">
            <div style="font-size:14px;color:${textColor};letter-spacing:1px;">${m.label}${badge}${lock}</div>
            <div style="font-size:10px;color:${OGUI.textDim};">${m.description}</div>
          </div>
        `;
      })
      .join('');

    this.el.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid ${OGUI.borderDim};display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${OGUI.textHead};font-size:14px;letter-spacing:2px;font-weight:bold;">PLAYER MODE</span>
        <span style="color:${OGUI.textDim};font-size:10px;">↑↓ SELECT · ENTER/CLICK APPLY · O/ESC CLOSE</span>
      </div>
      <div style="display:flex;flex-direction:column;">${rows}</div>
      <div style="padding:10px 18px;border-top:1px solid ${OGUI.borderDim};display:flex;justify-content:flex-end;gap:10px;">
        <button data-panel-action="cancel" style="padding:8px 14px;background:transparent;border:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-family:${OGUI.font};cursor:pointer;font-size:11px;">CANCEL [ESC]</button>
        <button data-panel-action="apply" style="padding:8px 14px;background:${OGUI.bgSelected};border:1px solid ${OGUI.borderSel};color:${OGUI.textWhite};font-family:${OGUI.font};cursor:pointer;font-size:11px;">APPLY [ENTER]</button>
      </div>
    `;

    // Row click handlers [Tier 0A: Tracked listeners]
    this.el.querySelectorAll('[data-mode-index]').forEach((row) => {
      this.listenerRegistry.addEventListener(row, 'mousedown', (e) => {
        e.preventDefault();
        const idx = Number((row as HTMLElement).dataset.modeIndex);
        const mode = modes[idx];
        if (!mode || mode.locked) return;
        if (e.type === 'mousedown') {
          this.selectedIndex = idx;
          this._render();
        }
      });
      this.listenerRegistry.addEventListener(row, 'dblclick', (e) => {
        e.preventDefault();
        const idx = Number((row as HTMLElement).dataset.modeIndex);
        const mode = modes[idx];
        if (!mode || mode.locked) return;
        this.selectedIndex = idx;
        this._applySelected();
      });
    });

    // Action buttons [Tier 0A: Tracked listeners]
    const applyBtn = this.el.querySelector('[data-panel-action="apply"]');
    if (applyBtn) {
      this.listenerRegistry.addEventListener(applyBtn, 'mousedown', (e) => {
        e.preventDefault();
        this._applySelected();
      });
    }
    const cancelBtn = this.el.querySelector('[data-panel-action="cancel"]');
    if (cancelBtn) {
      this.listenerRegistry.addEventListener(cancelBtn, 'mousedown', (e) => {
        e.preventDefault();
        this.hide();
      });
    }
  }

  private _applySelected(): void {
    const modes = this._modes();
    const chosen = modes[this.selectedIndex];
    if (!chosen || chosen.locked) return;
    if (chosen.id === this.currentMode) { this.hide(); return; }

    this.currentMode = chosen.id;
    this.hide();

    // Tell the server
    if (this.client?.connected) {
      this.client.sendLobbyAction('PLAYER_MODE_CHANGE', { mode: chosen.id });
    }

    this.onModeChangeCallback?.(chosen.id);
  }

  private _onKey(e: KeyboardEvent): void {
    if (e.key === 'o' || e.key === 'O') {
      // Only act when in-game (caller controls that via show/hide)
      // but panel itself will toggle via this key
      return; // handled by index.ts keydown — panel.toggle()
    }
    if (!this.visible) return;

    const modes = this._modes();
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + modes.length) % modes.length;
        this._render();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % modes.length;
        this._render();
        break;
      case 'Enter':
        e.preventDefault();
        this._applySelected();
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
    }
  }
}
