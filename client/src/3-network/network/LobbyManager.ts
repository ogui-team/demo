/**
 * LobbyManager  (client-side)
 * Orchestrates the full match lifecycle.
 *
 * Match states:
 *   idle → lobby → starting → in_game → post_game → lobby → …
 *
 * Responsibilities:
 *  - Connect / disconnect the MultiplayerClient
 *  - Gate which UI panels are visible at each stage
 *  - Expose events so the engine can react (mode switch, HUD toggle, etc.)
 *  - Handle ready-toggle, map voting hand-off, and post-game return
 *
 * The actual DOM lobby UI is provided by the active multiplayer client UI.
 * LobbyManager layers on top of that transport/runtime state.
 */

import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { LobbyState, MultiplayerEventMap } from './MultiplayerContracts';
import type { RoundState } from '../../2-systems/gameplay/game/PlayerState';
import type { MapVoting } from '../../4-runtime/ui/MapVoting';

type LobbyManagerEventMap = MultiplayerEventMap & {
  error: { message: string; code?: string };
};

interface LobbyClientAdapter {
  joinRoom(serverUrl: string, playerName: string, roomId?: string): void;
  disconnect(): void;
  setReady(ready: boolean): void;
  on<K extends keyof LobbyManagerEventMap>(event: K, listener: (payload: LobbyManagerEventMap[K]) => void): void;
}

export type MatchState = 'idle' | 'lobby' | 'starting' | 'in_game' | 'post_game';

export interface LobbyManagerConfig {
  /** WebSocket URL of the game server. */
  serverUrl: string;
  /** Display name for the local player. */
  playerName: string;
  /** Optional room ID to join directly. If omitted, joins any available room. */
  roomId?: string;
  /** Optional map voting configuration. */
  mapVoting?: MapVoting;
  /** Optional GameModeManager to fire round events into. */
  gameModeManager?: unknown;
  /** Show / hide HUD on state changes via this callback. */
  onHUDVisible?: (visible: boolean) => void;
  /** Called when the engine should switch to play/editor mode. */
  onModeChange?: (mode: 'play' | 'editor') => void;
  enableLogging?: boolean;
}

type StateChangeCallback = (newState: MatchState, prevState: MatchState) => void;
type GameStartCallback = (map: string, mode: string) => void;
type GameEndCallback = (round: RoundState, winner: { id?: string } | null) => void;

// ─── LobbyManager ─────────────────────────────────────────────────────────────

export class LobbyManager {
  private client: LobbyClientAdapter;
  private cfg: LobbyManagerConfig;
  private systemContext: SystemContext | null = null;

  private _state: MatchState = 'idle';
  private _lobbyState: LobbyState | null = null;
  private _countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private _postGameTimer: ReturnType<typeof setTimeout> | null = null;

  private _stateCallbacks: Set<StateChangeCallback> = new Set();
  private _gameStartCallbacks: Set<GameStartCallback> = new Set();
  private _gameEndCallbacks: Set<GameEndCallback> = new Set();

  // UI references (optional – injected after construction)
  private _lobbyOverlay: HTMLElement | null = null;
  private _postGameOverlay: HTMLElement | null = null;

  constructor(client: LobbyClientAdapter, cfg: LobbyManagerConfig) {
    this.client = client;
    this.cfg = cfg;

    this._wireClientEvents();
    this._buildPostGameOverlay();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this._state,
      active: this._state !== 'idle',
      metrics: {
        state: this._state,
        lobbyPlayerCount: this._lobbyState?.players.length ?? 0,
        hasLobbyOverlay: this._lobbyOverlay !== null,
        hasPostGameOverlay: this._postGameOverlay !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Connect to the server and enter the lobby state. */
  async connect(): Promise<void> {
    if (this._state !== 'idle') return;
    this._log(`Connecting to ${this.cfg.serverUrl} as "${this.cfg.playerName}"`);
    this.client.joinRoom(this.cfg.serverUrl, this.cfg.playerName, this.cfg.roomId);
  }

  /** Cleanly disconnect and return to idle. */
  disconnect(): void {
    this._cancelTimers();
    this.client.disconnect();
    this._setState('idle');
    this._hidePostGame();
    this._log('Disconnected');
  }

  /** Toggle this player's ready state. */
  setReady(ready: boolean): void {
    this.client.setReady(ready);
  }

  /** Vote for a map (relayed to server during lobby). */
  voteMap(mapId: string): void {
    this.cfg.mapVoting?.vote(mapId);
  }

  get state(): MatchState { return this._state; }
  get lobbyState(): LobbyState | null { return this._lobbyState; }
  get isInGame(): boolean { return this._state === 'in_game'; }

  // ─── Events ─────────────────────────────────────────────────────────────────

  onStateChange(cb: StateChangeCallback): () => void {
    this._stateCallbacks.add(cb);
    return () => this._stateCallbacks.delete(cb);
  }

  onGameStart(cb: GameStartCallback): () => void {
    this._gameStartCallbacks.add(cb);
    return () => this._gameStartCallbacks.delete(cb);
  }

  onGameEnd(cb: GameEndCallback): () => void {
    this._gameEndCallbacks.add(cb);
    return () => this._gameEndCallbacks.delete(cb);
  }

  // ─── Wire MultiplayerClient events ──────────────────────────────────────────

  private _wireClientEvents(): void {
    this.client.on('connected', (_payload) => {
      this._log('Connected to server');
      this._setState('lobby');
      this._showLobbyUI();
    });

    this.client.on('disconnected', (_payload) => {
      this._log('Disconnected from server');
      this._cancelTimers();
      this._setState('idle');
      this._hideLobbyUI();
    });

    this.client.on('lobby_update', (lobby: LobbyState) => {
      this._lobbyState = lobby;
      this._updateLobbyStatus(lobby);

      // Detect countdown starting
      if (lobby.countdown > 0 && this._state === 'lobby') {
        this._setState('starting');
        this._onCountdownStart(lobby.countdown);
      } else if (lobby.countdown < 0 && this._state === 'starting') {
        // Countdown was cancelled (someone unreadied)
        this._setState('lobby');
        this._cancelTimers();
      }
    });

    this.client.on('game_start', (payload) => {
      this._log(`Game starting — map: ${payload.map}, mode: ${payload.mode}`);

      this._cancelTimers();
      this._hideLobbyUI();
      this.cfg.mapVoting?.destroy();

      this._setState('in_game');
      this.cfg.onModeChange?.('play');
      this.cfg.onHUDVisible?.(true);

      for (const cb of this._gameStartCallbacks) cb(payload.map, payload.mode);
    });

    this.client.on('round_end', (payload) => {
      if (this._state !== 'in_game') return;
      this._log('Round ended');
      this._setState('post_game');
      this.cfg.onHUDVisible?.(false);
      this._showPostGame(payload.round, payload.winner ?? null);

      for (const cb of this._gameEndCallbacks) cb(payload.round, payload.winner ?? null);

      // Auto-return to lobby after 7 seconds
      this._postGameTimer = setTimeout(() => this._returnToLobby(), 7000);
    });

    this.client.on('error', (payload) => {
      this._log(`Server error: ${payload.message}`);
    });
  }

  // ─── State machine helpers ──────────────────────────────────────────────────

  private _setState(next: MatchState): void {
    if (next === this._state) return;
    const prev = this._state;
    this._state = next;
    gameBus.emit('stateMutation', {
      source: 'lobbyManager',
      path: 'multiplayer.lobby.state',
      changedCount: 1,
    });
    this._log(`State: ${prev} → ${next}`);
    for (const cb of this._stateCallbacks) cb(next, prev);
  }

  private _onCountdownStart(seconds: number): void {
    this._log(`Match starting in ${seconds}s`);
    this._updateLobbyCountdown(seconds);
  }

  private _updateLobbyCountdown(seconds: number): void {
    const el = document.querySelector<HTMLElement>('#lobby-status');
    if (el) {
      el.textContent = seconds > 0 ? `Starting in ${seconds}...` : 'GO!';
      el.style.color = '#ff2200';
    }
  }

  private _updateLobbyStatus(lobby: LobbyState): void {
    const el = document.querySelector<HTMLElement>('#lobby-status');
    if (!el) return;

    if (lobby.status === 'countdown' && lobby.countdown > 0) {
      this._updateLobbyCountdown(lobby.countdown);
      return;
    }

    if (lobby.status === 'in_game') {
      el.textContent = 'Match live';
      el.style.color = '#00ff41';
      return;
    }

    const readyPlayers = lobby.players.filter((player) => player.ready).length;
    el.textContent = `${readyPlayers}/${lobby.players.length} ready`;
    el.style.color = '#cccccc';
  }

  private _returnToLobby(): void {
    this._hidePostGame();
    this._setState('lobby');
    this.cfg.onModeChange?.('editor');
    this.cfg.onHUDVisible?.(false);
    this._showLobbyUI();
    this._log('Returned to lobby');
  }

  private _cancelTimers(): void {
    if (this._countdownTimer) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
    if (this._postGameTimer)  { clearTimeout(this._postGameTimer);  this._postGameTimer  = null; }
  }

  // ─── Lobby overlay ──────────────────────────────────────────────────────────

  private _showLobbyUI(): void {
    const el = document.getElementById('lobby-root') ?? document.getElementById('main-menu-overlay');
    if (el) {
      this._lobbyOverlay = el;
      el.style.display = 'flex';
    }
  }

  private _hideLobbyUI(): void {
    if (this._lobbyOverlay) {
      this._lobbyOverlay.style.display = 'none';
      this._lobbyOverlay = null;
    }
  }

  // ─── Post-game overlay ──────────────────────────────────────────────────────

  private _buildPostGameOverlay(): void {
    if (document.getElementById('postgame-overlay')) return;

    const el = document.createElement('div');
    el.id = 'postgame-overlay';
    Object.assign(el.style, {
      display: 'none',
      position: 'fixed',
      inset: '0',
      zIndex: '9500',
      background: 'rgba(0,0,0,0.88)',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: '"Courier New", Courier, monospace',
      color: '#00ff41',
      flexDirection: 'column',
      gap: '12px',
    });

    el.innerHTML = `
      <div id="postgame-title" style="font-size:28px;letter-spacing:6px;text-shadow:0 0 20px #00ff41">ROUND OVER</div>
      <div id="postgame-winner" style="font-size:15px;color:#ffdd00;letter-spacing:2px;margin-top:4px"></div>
      <div id="postgame-scores" style="margin-top:16px;min-width:300px"></div>
      <div id="postgame-countdown" style="font-size:11px;color:#555;margin-top:20px;letter-spacing:2px">Returning to lobby...</div>
    `;

    document.body.appendChild(el);
    this._postGameOverlay = el;
  }

  private _showPostGame(round: RoundState, winner: { id?: string } | null): void {
    const el = this._postGameOverlay ?? document.getElementById('postgame-overlay');
    if (!el) return;

    const winnerEl = el.querySelector<HTMLElement>('#postgame-winner');
    if (winnerEl) {
      winnerEl.textContent = winner?.id
        ? `WINNER: ${winner.id}`
        : round.reason === 'timer' ? 'TIME LIMIT REACHED' : 'ROUND ENDED';
    }

    el.style.display = 'flex';

    // Countdown refresh
    let remaining = 7;
    const cdEl = el.querySelector<HTMLElement>('#postgame-countdown');
    const interval = setInterval(() => {
      remaining -= 1;
      if (cdEl) cdEl.textContent = `Returning to lobby in ${remaining}s...`;
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
  }

  private _hidePostGame(): void {
    const el = this._postGameOverlay ?? document.getElementById('postgame-overlay');
    if (el) el.style.display = 'none';
  }

  private _log(msg: string): void {
    if (this.cfg.enableLogging) console.log(`[LobbyManager] ${msg}`);
  }
}
