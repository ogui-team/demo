import * as Engine from '../../0-foundation/foundation/Engine';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  cloneTropicalHorrorArchetypeAppearance,
  getTropicalHorrorArchetype,
  listTropicalHorrorArchetypes,
  persistTropicalHorrorArchetypeSelection,
  resolveTropicalHorrorArchetypeId,
  type TropicalHorrorArchetypeId,
} from '../../2-systems/ArchetypeDefinitions';
import { HostedRoomConfig, LobbyPlayer, LobbyState, MultiplayerClient, ServerInfo } from '../../3-network/network/MultiplayerClient';
import { NetworkConnectionResolver } from '../../3-network/network/NetworkConnectionResolver';
import { SCHEMA_PATHS } from '../../0-foundation/foundation/state/hydrateStateManager';
import { gameBus, setContext } from '@engine/1-kernel/core/public-api';
import { OGUI } from './OGUITheme';

export interface ServerBrowserConfig {
  httpUrl: string;
  wsUrl: string;
  availableMaps?: string[];
  hostLobby?: (payload: { playerName: string; config: HostedRoomConfig; wsUrl: string; httpUrl: string; backendFingerprint: string }) => void;
  joinLobby?: (payload: { playerName: string; roomId: string | null; wsUrl: string; httpUrl: string; backendFingerprint: string; allowLateJoin: boolean }) => void;
}

type BrowserScreen = 'list' | 'lobby';

export class ServerBrowser {
  private static readonly STORAGE_KEY = 'ps1-engine.serverBrowser.visible';
  private root: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private contentEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private dialogEl: HTMLDivElement;

  private client: MultiplayerClient;
  private config: ServerBrowserConfig;

  private screen: BrowserScreen = 'list';
  private servers: ServerInfo[] = [];
  private selectedServerIndex = 0;
  private lobbyState: LobbyState | null = null;
  private visible = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private readyState = false;
  private isHost = false;
  private hostingDialogVisible = false;

  private onCloseCallback: (() => void) | null = null;
  private onGameStartCallback: ((data: { map: string; mode: string; sessionId: string }) => void) | null = null;
  private mapsProvider: (() => string[]) | null = null;
  private resolvedWsUrl: string;
  private resolvedHttpUrl: string;
  private resolvedBackendFingerprint: string;

  constructor(config: ServerBrowserConfig, client?: MultiplayerClient) {
    this.config = config;
    this.client = client ?? new MultiplayerClient();
    this.resolvedWsUrl = config.wsUrl;
    this.resolvedHttpUrl = config.httpUrl;
    this.resolvedBackendFingerprint = this.buildBackendFingerprint(this.resolvedHttpUrl, this.resolvedWsUrl);

    this.root = document.createElement('div');
    this.headerEl = document.createElement('div');
    this.contentEl = document.createElement('div');
    this.statusEl = document.createElement('div');
    this.footerEl = document.createElement('div');
    this.dialogEl = document.createElement('div');

    this._applyRootStyle();
    this._applyHeaderStyle();
    this._applyContentStyle();
    this._applyStatusStyle();
    this._applyFooterStyle();
    this._applyDialogStyle();

    this.root.appendChild(this.headerEl);
    this.root.appendChild(this.contentEl);
    this.root.appendChild(this.statusEl);
    this.root.appendChild(this.footerEl);
    this.root.appendChild(this.dialogEl);

    this.contentEl.addEventListener('mouseover', (event: MouseEvent) => {
      const row = (event.target as HTMLElement).closest('[data-row-index]') as HTMLElement | null;
      if (!row) return;
      const index = Number(row.dataset.rowIndex);
      if (!Number.isNaN(index)) {
        this.selectedServerIndex = index;
        this._updateSelection();
      }
    });

    this.contentEl.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      const action = (event.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (action) {
        if (action.dataset.archetypeId) {
          this._selectLobbyArchetype(action.dataset.archetypeId);
          return;
        }
        this._handleAction(action.dataset.action ?? '');
        return;
      }

      const row = (event.target as HTMLElement).closest('[data-row-index]') as HTMLElement | null;
      if (!row) return;
      const index = Number(row.dataset.rowIndex);
      if (!Number.isNaN(index)) {
        this.selectedServerIndex = index;
        this._joinSelected();
      }
    });

    // Footer buttons (JOIN / HOST / REFRESH / BACK) live in footerEl, so they
    // need their own delegated handler.
    this.footerEl.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      const action = (event.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!action) return;
      this._handleAction(action.dataset.action ?? '');
    });

    this.keyHandler = (event: KeyboardEvent) => this._onKey(event);
    window.addEventListener('keydown', this.keyHandler);

    this.client.on('connected', (data) => {
      this.isHost = !!data.hosted;
      this.lobbyState = this.client.getLastLobbyState() ?? this.lobbyState;
      this.statusEl.textContent = data.hosted
        ? `Hosting ${data.roomId} as ${data.playerId}`
        : `Connected to ${data.roomId} as ${data.playerId}`;
      this.screen = 'lobby';
      this._renderLobby();
    });
    this.client.on('lobby_update', (lobby) => {
      this.lobbyState = lobby;
      this.readyState = !!lobby.players.find((player) => player.id === this.client.playerId)?.ready;
      // Keep isHost in sync (may change if original host leaves)
      this.isHost = !!lobby.players.find((player) => player.id === this.client.playerId)?.isHost;
      this.statusEl.textContent = this._getLobbyStatusText(lobby);
      if (this.visible && this.screen !== 'lobby') {
        this.screen = 'lobby';
      }
      if (this.screen === 'lobby') this._renderLobby();
    });
    this.client.on('game_start', (data) => {
      this.statusEl.textContent = `Match live on ${data.map}`;
      this.hide();
      this.onGameStartCallback?.(data);
    });
    this.client.on('disconnected', () => {
      void this.reopenToServerList('Disconnected');
    });
    this.client.on('error', (data) => {
      this.statusEl.textContent = data.message;
    });

    document.body.appendChild(this.root);
    this.hide();

    // Do not auto-restore visibility on construction; explicit UI actions only.
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  onGameStart(callback: (data: { map: string; mode: string; sessionId: string }) => void): void {
    this.onGameStartCallback = callback;
  }

  /** Provide a callback that returns the current list of saved map names. Called lazily when the host dialog opens. */
  setMapsProvider(provider: () => string[]): void {
    this.mapsProvider = provider;
  }

  getClient(): MultiplayerClient {
    return this.client;
  }

  async show(): Promise<void> {
    this.visible = true;
    window.localStorage.setItem(ServerBrowser.STORAGE_KEY, '1');
    setContext('ui');
    this.root.style.display = 'flex';
    this.screen = 'list';
    this._hideHostDialog();
    await this.refreshServers();
    this._startAutoRefresh();
  }

  hide(): void {
    this.visible = false;
    window.localStorage.setItem(ServerBrowser.STORAGE_KEY, '0');
    setContext(Engine.getAuthoritativeInputContext());
    this.root.style.display = 'none';
    this._hideHostDialog();
    this._stopAutoRefresh();
  }

  async reopenToServerList(status = 'Disconnected', refresh = true): Promise<void> {
    this.visible = true;
    window.localStorage.setItem(ServerBrowser.STORAGE_KEY, '1');
    setContext('ui');
    this.root.style.display = 'flex';
    this.screen = 'list';
    this._hideHostDialog();
    this.statusEl.textContent = status;
    this._renderServerList();
    this._startAutoRefresh();
    if (refresh) {
      await this.refreshServers();
    }
  }

  async refreshServers(): Promise<void> {
    this.statusEl.textContent = 'Refreshing…';
    setContext('ui');

    // Keep refresh/join/host on the same resolved target so the list and join
    // action always point at the identical backend instance.
    const { httpUrl, wsUrl } = this.resolveConnectionTargets();
    this.resolvedHttpUrl = httpUrl;
    this.resolvedWsUrl = wsUrl;
    this.resolvedBackendFingerprint = this.buildBackendFingerprint(httpUrl, wsUrl);

    let servers = await this.client.fetchServers(httpUrl);
    servers = servers.filter((server) => server.id !== 'auto');

    this.servers = servers;
    this.selectedServerIndex = Math.min(this.selectedServerIndex, Math.max(0, this.servers.length - 1));
    this._renderServerList();
    this.statusEl.textContent = `${this.servers.length} server(s) available`;
  }

  destroy(): void {
    this.client.disconnect();
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this._stopAutoRefresh();
    this.root.remove();
  }

  private _renderServerList(): void {
    this.headerEl.textContent = 'SERVER BROWSER';
    this.contentEl.innerHTML = '';

    const tableHeader = document.createElement('div');
    tableHeader.style.cssText = `display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:12px;padding:8px 14px;border-bottom:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-size:11px;letter-spacing:1px;`;
    tableHeader.innerHTML = '<span>Server</span><span>Status</span><span>Map</span><span>Players</span><span>Limit</span><span>Time</span>';
    this.contentEl.appendChild(tableHeader);

    if (this.servers.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `padding:16px;color:${OGUI.textDim};text-align:center;`;
      empty.textContent = 'No hosted rooms found';
      this.contentEl.appendChild(empty);
    }

    this.servers.forEach((server, index) => {
      const row = document.createElement('div');
      const selected = index === this.selectedServerIndex;
      row.dataset.rowIndex = String(index);
      const statusLabel = server.status === 'in_game'
        ? 'IN PROGRESS'
        : server.status === 'countdown'
          ? 'STARTING'
          : 'WAITING';
      row.style.cssText = `display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:12px;padding:10px 14px;cursor:pointer;border-left:3px solid ${selected ? OGUI.borderSel : 'transparent'};background:${selected ? OGUI.bgSelected : 'transparent'};color:${selected ? OGUI.textWhite : OGUI.textSec};`;
      row.innerHTML = `
        <span>${this._escape(server.name)}</span>
        <span>${this._escape(statusLabel)}</span>
        <span>${this._escape(server.map)}</span>
        <span>${server.players}/${server.maxPlayers}</span>
        <span>${server.killLimit}</span>
        <span>${Math.round(server.roundDurationSec / 60)}m</span>
      `;
      this.contentEl.appendChild(row);
    });

    this.footerEl.innerHTML = '';
    this._addButton('join', 'JOIN');
    this._addButton('join_in_progress', 'JOIN IN PROGRESS');
    this._addButton('host', 'HOST GAME');
    this._addButton('refresh', 'REFRESH [R]');
    this._addButton('close', 'BACK [ESC]');
  }

  private _renderLobby(): void {
    const lobbyState = this.lobbyState ?? this.client.getLastLobbyState();
    const selectedArchetypeId = this._getSelectedLobbyArchetypeId(lobbyState);
    const selectedArchetype = getTropicalHorrorArchetype(selectedArchetypeId);
    const activeRoomId = lobbyState?.roomId ?? this.client.roomId ?? 'unknown';
    const activeBackendFingerprint = this.getActiveBackendFingerprint(lobbyState);
    this.headerEl.textContent = this.lobbyState?.roomName
      ? `LOBBY / ${this.lobbyState.roomName.toUpperCase()} / ROOM ${activeRoomId} / BACKEND ${activeBackendFingerprint}`
      : `LOBBY / ROOM ${activeRoomId} / BACKEND ${activeBackendFingerprint}`;
    this.contentEl.innerHTML = '';

    const info = document.createElement('div');
    info.style.cssText = `padding:10px 14px;border-bottom:1px solid ${OGUI.borderDim};color:${selectedArchetype.hudTheme.notification};font-size:12px;background:${selectedArchetype.hudTheme.atmosphere}, ${selectedArchetype.hudTheme.background};box-shadow:inset 0 -1px 0 ${selectedArchetype.hudTheme.border};`;
    if (lobbyState) {
      const seconds = lobbyState.countdown > 0 ? ` | START ${lobbyState.countdown}s` : '';
      info.textContent = `MAP ${lobbyState.selectedMap} | MODE ${lobbyState.selectedMode.toUpperCase()} | LIMIT ${lobbyState.killLimit ?? 10} | TIME ${lobbyState.roundDurationSec ?? 180}s${seconds}`;
    } else {
      info.textContent = 'Waiting for lobby data…';
    }
    this.contentEl.appendChild(info);

    const ritualDeck = document.createElement('div');
    ritualDeck.style.cssText = `padding:16px 14px 18px;border-bottom:1px solid ${OGUI.borderDim};background:${selectedArchetype.hudTheme.atmosphere}, linear-gradient(180deg, rgba(5,5,5,0.88) 0%, rgba(12,12,12,0.96) 100%);`;

    const ritualHeader = document.createElement('div');
    ritualHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px;';
    ritualHeader.innerHTML = `
      <div>
        <div style="color:${selectedArchetype.hudTheme.notification};font-size:11px;letter-spacing:2px;margin-bottom:4px;">TROPICAL HORROR SELECTION SUITE</div>
        <div style="color:${selectedArchetype.hudTheme.text};font-size:22px;letter-spacing:1px;line-height:1.1;">${this._escape(selectedArchetype.displayName)}</div>
        <div style="color:${OGUI.textSec};font-size:11px;letter-spacing:1px;margin-top:4px;">${this._escape(selectedArchetype.title)} • ${this._escape(selectedArchetype.subtitle)}</div>
      </div>
      <div style="max-width:300px;color:${OGUI.textPri};font-size:11px;line-height:1.55;text-align:right;">${this._escape(selectedArchetype.description)}</div>
    `;
    ritualDeck.appendChild(ritualHeader);

    const altarGrid = document.createElement('div');
    altarGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;';

    listTropicalHorrorArchetypes().forEach((archetype) => {
      const isSelected = archetype.id === selectedArchetypeId;
      const altar = document.createElement('button');
      altar.type = 'button';
      altar.dataset.action = 'select_archetype';
      altar.dataset.archetypeId = archetype.id;
      altar.style.cssText = `display:flex;flex-direction:column;gap:10px;padding:14px 14px 12px;border:1px solid ${isSelected ? archetype.hudTheme.border : OGUI.borderDim};border-left:4px solid ${isSelected ? archetype.hudTheme.accent : 'transparent'};background:${archetype.hudTheme.atmosphere}, ${archetype.hudTheme.panel};box-shadow:${isSelected ? `0 0 0 1px ${archetype.hudTheme.shadow}, 0 14px 30px rgba(0,0,0,0.28)` : 'inset 0 1px 0 rgba(255,255,255,0.04)'};color:${archetype.hudTheme.text};cursor:pointer;text-align:left;font-family:${OGUI.font};transition:transform 0.08s ease, border-color 0.08s ease, box-shadow 0.08s ease;`;
      altar.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div>
            <div style="color:${archetype.hudTheme.notification};font-size:10px;letter-spacing:2px;margin-bottom:5px;">${isSelected ? 'ACTIVE ALTAR' : 'RITUAL ALTAR'}</div>
            <div style="font-size:18px;line-height:1.1;">${this._escape(archetype.stats.classLabel)}</div>
            <div style="color:${OGUI.textSec};font-size:10px;letter-spacing:1px;margin-top:4px;">${this._escape(archetype.displayName)}</div>
          </div>
          <div style="width:14px;height:14px;border-radius:999px;background:${archetype.hudTheme.accent};box-shadow:0 0 18px ${archetype.hudTheme.shadow};opacity:${isSelected ? '1' : '0.55'};"></div>
        </div>
        <div style="color:${OGUI.textPri};font-size:10px;line-height:1.5;min-height:45px;">${this._escape(archetype.subtitle)}</div>
        <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:6px;font-size:10px;color:${OGUI.textPri};">
          <span>HP ${archetype.stats.maxHealth}</span>
          <span>MANA ${archetype.stats.maxMana}</span>
          <span>DMG x${archetype.stats.damageMultiplier.toFixed(2)}</span>
          <span>ROF x${archetype.stats.attackSpeed.toFixed(2)}</span>
        </div>
        <div style="padding-top:8px;border-top:1px solid ${isSelected ? archetype.hudTheme.border : OGUI.borderDim};color:${archetype.hudTheme.notification};font-size:10px;letter-spacing:1px;">LOADOUT · ${this._escape(archetype.spawn.weapons.join(' / ').toUpperCase())}</div>
      `;
      altarGrid.appendChild(altar);
    });

    ritualDeck.appendChild(altarGrid);

    const ritualSummary = document.createElement('div');
    ritualSummary.style.cssText = `margin-top:12px;padding:12px 14px;border:1px solid ${selectedArchetype.hudTheme.border};background:${selectedArchetype.hudTheme.panel};display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);`;
    ritualSummary.innerHTML = `
      <div><div style="color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">VITALS</div><div style="color:${selectedArchetype.hudTheme.text};font-size:12px;margin-top:4px;">${selectedArchetype.stats.maxHealth} HP · ${selectedArchetype.stats.maxShield} SHIELD</div></div>
      <div><div style="color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">CHANNELS</div><div style="color:${selectedArchetype.hudTheme.text};font-size:12px;margin-top:4px;">${selectedArchetype.stats.maxMana} MANA · ${(selectedArchetype.stats.armor * 100).toFixed(0)}% MITIGATION</div></div>
      <div><div style="color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">RITUAL TAGS</div><div style="color:${selectedArchetype.hudTheme.text};font-size:12px;margin-top:4px;">${this._escape(selectedArchetype.spawn.conditionTags.join(' · '))}</div></div>
    `;
    ritualDeck.appendChild(ritualSummary);
    this.contentEl.appendChild(ritualDeck);

    const header = document.createElement('div');
    header.style.cssText = `display:grid;grid-template-columns:2fr 1.2fr 0.8fr 1fr;gap:12px;padding:8px 14px;border-bottom:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-size:11px;letter-spacing:1px;`;
    header.innerHTML = '<span>Player</span><span>Ritual</span><span>Ping</span><span>Status</span>';
    this.contentEl.appendChild(header);

    (lobbyState?.players ?? []).forEach((player: LobbyPlayer) => {
      const mine = player.id === this.client.playerId;
      const playerArchetype = getTropicalHorrorArchetype(resolveTropicalHorrorArchetypeId(player.archetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID);
      const row = document.createElement('div');
      row.style.cssText = `display:grid;grid-template-columns:2fr 1.2fr 0.8fr 1fr;gap:12px;padding:10px 14px;color:${mine ? OGUI.textWhite : OGUI.textSec};border-left:3px solid ${mine ? playerArchetype.hudTheme.accent : 'transparent'};background:${mine ? 'rgba(255,255,255,0.02)' : 'transparent'};`;
      row.innerHTML = `
        <span>${this._escape(player.name)}${player.isHost ? ' [HOST]' : ''}</span>
        <span style="color:${playerArchetype.hudTheme.notification}">${this._escape(playerArchetype.stats.classLabel.toUpperCase())}</span>
        <span>${player.ping}ms</span>
        <span style="color:${player.ready ? OGUI.ok : OGUI.warn}">${player.ready ? 'READY' : 'WAITING'}</span>
      `;
      this.contentEl.appendChild(row);
    });

    if ((lobbyState?.players?.length ?? 0) === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `padding:14px;color:${OGUI.textDim};font-size:11px;text-align:center;`;
      empty.textContent = 'Awaiting lobby roster…';
      this.contentEl.appendChild(empty);
    }

    this.footerEl.innerHTML = '';
    this._addButton('ready', this.readyState ? 'UNREADY [SPACE]' : 'READY [SPACE]');
    if (this.isHost) {
      this._addButton('force_start', '▶ START GAME', true);
    }
    this._addButton('leave', 'LEAVE [ESC]');
  }

  private _getLobbyStatusText(lobby: LobbyState): string {
    if (lobby.status === 'countdown' && lobby.countdown > 0) {
      return `Match starts in ${lobby.countdown}s`;
    }
    if (lobby.status === 'in_game') {
      return `Match live on ${lobby.selectedMap}`;
    }
    const readyPlayers = lobby.players.filter((player) => player.ready).length;
    const totalPlayers = lobby.maxPlayers ?? lobby.players.length;
    return `${readyPlayers}/${lobby.players.length} ready • ${lobby.players.length}/${totalPlayers} players`;
  }

  private _getSelectedLobbyArchetypeId(lobbyState: LobbyState | null): TropicalHorrorArchetypeId {
    const playerArchetypeId = lobbyState?.players.find((player) => player.id === this.client.playerId)?.archetypeId;
    return resolveTropicalHorrorArchetypeId(playerArchetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
  }

  private _selectLobbyArchetype(rawArchetypeId: unknown): void {
    const archetypeId = resolveTropicalHorrorArchetypeId(rawArchetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
    const stateManager = Engine.getStateManagerInstance();
    const appearance = cloneTropicalHorrorArchetypeAppearance(archetypeId);

    persistTropicalHorrorArchetypeSelection(typeof window !== 'undefined' ? window.localStorage : null, archetypeId);
    stateManager?.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_ARCHETYPE, archetypeId);
    stateManager?.set(SCHEMA_PATHS.PLAYER_LOCAL_ARCHETYPE, archetypeId);
    stateManager?.set(SCHEMA_PATHS.PLAYERS_LOCAL_ARCHETYPE, archetypeId);
    stateManager?.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_APPEARANCE, { ...appearance });
    stateManager?.set(SCHEMA_PATHS.PLAYER_LOCAL_APPEARANCE, { ...appearance });

    this.client.setPendingJoinArchetypeId(archetypeId);
    this.client.setPendingJoinAppearance({ ...appearance });
    this.client.sendLobbyAction('LOBBY_ARCHETYPE', { archetypeId });

    if (this.lobbyState) {
      this.lobbyState = {
        ...this.lobbyState,
        players: this.lobbyState.players.map((player) => (
          player.id === this.client.playerId
            ? { ...player, archetypeId }
            : player
        )),
      };
    }

    const archetype = getTropicalHorrorArchetype(archetypeId);
    this.statusEl.textContent = `${archetype.displayName} prepared for deployment`;
    gameBus.emit('LIFECYCLE_CHANGED', {
      from: 'LOBBY',
      to: 'LOBBY',
      timestamp: Engine.time.now(),
    });
    this._renderLobby();
  }

  private _handleAction(action: string): void {
    switch (action) {
      case 'join':
        this._joinSelected();
        break;
      case 'join_in_progress':
        this._joinSelected(true);
        break;
      case 'host':
        this._showHostDialog();
        break;
      case 'refresh':
        void this.refreshServers();
        break;
      case 'ready':
        this.readyState = !this.readyState;
        this.client.setReady(this.readyState);
        this._renderLobby();
        break;
      case 'close':
        this.hide();
        this.onCloseCallback?.();
        break;
      case 'force_start':
        if (this.isHost) {
          this.client.sendLobbyAction('LOBBY_FORCE_START', {});
        }
        break;
      case 'leave':
        this.client.disconnect();
        void this.reopenToServerList('Left lobby');
        break;
      default:
        break;
    }
  }

  private _joinSelected(allowLateJoin = false): void {
    const server = this.servers[this.selectedServerIndex];
    if (!server) return;
    if (server.status === 'in_game' && !allowLateJoin) {
      this.statusEl.textContent = 'Selected room is already in progress';
      return;
    }
    const playerName = `Player_${Engine.random.next().toString(36).slice(2, 6)}`;
    this.statusEl.textContent = `Joining ${server.name}…`;
    const targets = this.resolveConnectionTargets();
    const backendFingerprint = server.backendFingerprint ?? this.buildBackendFingerprint(targets.httpUrl, targets.wsUrl);
    this.screen = 'lobby';
    this.lobbyState = null;
    this._renderLobby();
    if (this.config.joinLobby) {
      this.config.joinLobby({
        playerName,
        roomId: server.id,
        wsUrl: targets.wsUrl,
        httpUrl: targets.httpUrl,
        backendFingerprint,
        allowLateJoin,
      });
      return;
    }
    this.client.joinRoom(targets.wsUrl, playerName, server.id, allowLateJoin);
  }

  private _showHostDialog(): void {
    this.hostingDialogVisible = true;
    this.dialogEl.style.display = 'flex';

    const maps = (() => {
      const provided = this.mapsProvider ? this.mapsProvider() : [];
      const fallback = this.config.availableMaps ?? [];
      const combined = [...new Set([...provided, ...fallback])];
      return combined.length > 0 ? combined : ['map_default', 'forest_arena'];
    })();

    // Map metadata: display name, description, colour blocks
    const MAP_INFO: Record<string, { label: string; desc: string; biome: string; previewColors: number[] }> = {
      'forest_arena': {
        label: 'FOREST ARENA',
        desc: 'Seeded outdoor forest. Pine trees, scattered rocks, central spawn ring.',
        biome: 'OUTDOOR / FOREST',
        previewColors: [0x2a4a1e, 0x1a4a18, 0x4a3018, 0x3a2e18],
      },
      'map_default': {
        label: 'DEFAULT',
        desc: 'Basic flat arena. Open layout, ideal for practice.',
        biome: 'FLAT / ARENA',
        previewColors: [0x3a3030, 0x4a4040, 0x302828, 0x505050],
      },
    };

    const defaultConfig: HostedRoomConfig = {
      name: `FFA ${Engine.time.date().toLocaleTimeString()}`,
      map: maps[0],
      mode: 'ffa',
      killLimit: 10,
      roundDurationSec: 180,
      maxPlayers: 8,
    };

    let selectedMapIndex = 0;

    const toHex = (n: number) => '#' + n.toString(16).padStart(6, '0');

    const buildPreviewSVG = (mapName: string): string => {
      const info = MAP_INFO[mapName];
      if (!info) {
        // Generic grid preview for user-saved maps (static SVG, no nested template loops)
        return '<svg width="100%" height="100%" viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg">'
          + '<rect width="80" height="60" fill="#0d0d0d"/>'
          + '<line x1="8"  y1="0" x2="8"  y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="16" y1="0" x2="16" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="24" y1="0" x2="24" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="32" y1="0" x2="32" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="40" y1="0" x2="40" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="48" y1="0" x2="48" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="56" y1="0" x2="56" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="64" y1="0" x2="64" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="72" y1="0" x2="72" y2="60" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="0" y1="8"  x2="80" y2="8"  stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="0" y1="16" x2="80" y2="16" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="0" y1="24" x2="80" y2="24" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="0" y1="32" x2="80" y2="32" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="0" y1="40" x2="80" y2="40" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<line x1="0" y1="48" x2="80" y2="48" stroke="rgba(80,80,80,0.35)" stroke-width="0.5"/>'
          + '<text x="40" y="34" text-anchor="middle" fill="#888" font-size="6" font-family="Courier New">SAVED MAP</text>'
          + '</svg>';
      }
      if (mapName === 'forest_arena') {
        return `<svg width="100%" height="100%" viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg">
          <rect width="80" height="60" fill="#1a2e14"/>
          <rect x="10" y="8"  width="5" height="7"  rx="1" fill="#1a4a18"/>
          <rect x="22" y="5"  width="4" height="9"  rx="1" fill="#0e321a"/>
          <rect x="55" y="10" width="6" height="8"  rx="1" fill="#1a4a18"/>
          <rect x="63" y="7"  width="4" height="10" rx="1" fill="#0e321a"/>
          <rect x="12" y="40" width="5" height="8"  rx="1" fill="#1a4a18"/>
          <rect x="60" y="42" width="6" height="7"  rx="1" fill="#0e321a"/>
          <circle cx="25" cy="48" r="2" fill="#4a3018"/>
          <circle cx="52" cy="44" r="1.5" fill="#4a4a40"/>
          <circle cx="40" cy="30" r="7" fill="none" stroke="#3a5a2a" stroke-width="0.8"/>
          <circle cx="40" cy="30" r="1.5" fill="#3a5a2a"/>
          <text x="40" y="58" text-anchor="middle" fill="#4a6a3a" font-size="4" font-family="Courier New">FOREST ARENA</text>
        </svg>`;
      }
      // map_default
      return `<svg width="100%" height="100%" viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="60" fill="#0d0d0d"/>
        <rect x="5"  y="5"  width="70" height="50" rx="2" fill="none" stroke="rgba(80,80,80,0.35)" stroke-width="0.8"/>
        <rect x="15" y="15" width="20" height="14" rx="1" fill="#1e1e1e"/>
        <rect x="45" y="15" width="20" height="14" rx="1" fill="#1e1e1e"/>
        <rect x="15" y="35" width="20" height="14" rx="1" fill="#1e1e1e"/>
        <rect x="45" y="35" width="20" height="14" rx="1" fill="#1e1e1e"/>
        <circle cx="40" cy="30" r="4" fill="none" stroke="rgba(80,80,80,0.5)" stroke-width="0.8"/>
        <text x="40" y="58" text-anchor="middle" fill="#555" font-size="4" font-family="Courier New">DEFAULT</text>
      </svg>`;
    };

    const renderMapRows = (): string =>
      maps.map((m, i) => {
        const info = MAP_INFO[m];
        const label = info?.label ?? m;
        const isSelected = i === selectedMapIndex;
        return `<div data-map-index="${i}" style="padding:7px 10px;cursor:pointer;border-left:3px solid ${isSelected ? OGUI.borderSel : 'transparent'};background:${isSelected ? OGUI.bgSelected : 'transparent'};color:${isSelected ? OGUI.textWhite : OGUI.textSec};font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${isSelected ? '▶ ' : '  '}${this._escape(label)}
        </div>`;
      }).join('');

    const renderPreview = (): string => {
      const m = maps[selectedMapIndex] ?? 'map_default';
      const info = MAP_INFO[m];
      return `
        <div style="height:140px;overflow:hidden;border-bottom:1px solid ${OGUI.borderDim};background:#080808;">
          ${buildPreviewSVG(m)}
        </div>
        <div style="padding:10px 12px;flex:1;">
          <div style="color:${OGUI.textHead};font-size:12px;letter-spacing:1px;margin-bottom:4px;">${this._escape(info?.label ?? m)}</div>
          <div style="color:${OGUI.textSec};font-size:10px;margin-bottom:4px;">${this._escape(info?.biome ?? 'CUSTOM MAP')}</div>
          <div style="color:${OGUI.textPri};font-size:10px;line-height:1.5;">${this._escape(info?.desc ?? 'User-created map.')}</div>
        </div>
      `;
    };

    this.dialogEl.innerHTML = `
      <div id="cs-host-dlg" style="width:min(680px,95vw);background:${OGUI.bgBase};border:1px solid ${OGUI.border};box-shadow:0 24px 60px rgba(0,0,0,0.7);display:flex;flex-direction:column;pointer-events:auto;font-family:${OGUI.font};">

        <!-- Title bar -->
        <div style="padding:8px 14px;background:${OGUI.bgPanel};border-bottom:1px solid ${OGUI.borderDim};display:flex;justify-content:space-between;align-items:center;">
          <span style="color:${OGUI.textHead};font-size:13px;letter-spacing:3px;font-weight:bold;">CREATE GAME</span>
          <span data-host-action="cancel" style="color:${OGUI.textSec};cursor:pointer;font-size:16px;line-height:1;">✕</span>
        </div>

        <!-- Body: map list | preview -->
        <div style="display:flex;min-height:220px;border-bottom:1px solid ${OGUI.borderDim};">
          <!-- Map list -->
          <div id="cs-map-list" style="width:180px;min-width:140px;overflow-y:auto;background:#080808;border-right:1px solid ${OGUI.borderDim};max-height:320px;">
            <div style="padding:5px 10px;color:${OGUI.textDim};font-size:10px;letter-spacing:1px;border-bottom:1px solid ${OGUI.borderDim};">CHOOSE MAP</div>
            <div id="cs-map-rows">${renderMapRows()}</div>
          </div>
          <!-- Map preview + info -->
          <div id="cs-map-preview" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">${renderPreview()}</div>
        </div>

        <!-- Settings row -->
        <div style="padding:12px 14px;border-bottom:1px solid ${OGUI.borderDim};display:flex;flex-direction:column;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:4px;color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">ROOM NAME
            <input data-host-field="name" value="${this._escapeAttribute(defaultConfig.name)}" style="padding:7px 10px;background:${OGUI.bgBase};border:1px solid ${OGUI.border};color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;outline:none;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">SERVER IP (optional - auto-detect if blank)
            <input data-host-field="serverIp" placeholder="192.168.x.x or leave blank" style="padding:7px 10px;background:${OGUI.bgBase};border:1px solid ${OGUI.border};color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;outline:none;" />
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
            <label style="display:flex;flex-direction:column;gap:4px;color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">GAME TYPE
              <select data-host-field="mode" style="padding:7px 10px;background:${OGUI.bgBase};border:1px solid ${OGUI.border};color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;outline:none;">
                <option value="ffa">Free For All</option>
                <option value="horde">Horde</option>
                <option value="drift_bomb">Drift Bomb</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">KILL LIMIT
              <input data-host-field="killLimit" type="number" min="1" max="100" value="${defaultConfig.killLimit}" style="padding:7px 10px;background:${OGUI.bgBase};border:1px solid ${OGUI.border};color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;outline:none;" />
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">ROUND TIME
              <input data-host-field="roundDurationSec" type="number" min="30" max="1800" value="${defaultConfig.roundDurationSec}" style="padding:7px 10px;background:${OGUI.bgBase};border:1px solid ${OGUI.border};color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;outline:none;" />
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:${OGUI.textSec};font-size:10px;letter-spacing:1px;">MAX PLAYERS
              <input data-host-field="maxPlayers" type="number" min="2" max="16" value="${defaultConfig.maxPlayers}" style="padding:7px 10px;background:${OGUI.bgBase};border:1px solid ${OGUI.border};color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;outline:none;" />
            </label>
          </div>
        </div>

        <!-- Buttons -->
        <div style="padding:10px 14px;display:flex;justify-content:flex-end;gap:10px;background:${OGUI.bgPanel};">
          <button data-host-action="cancel" style="padding:8px 18px;background:transparent;border:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-family:${OGUI.font};font-size:11px;cursor:pointer;letter-spacing:1px;">CANCEL</button>
          <button data-host-action="create" style="padding:8px 18px;background:${OGUI.bgSelected};border:1px solid ${OGUI.borderSel};color:${OGUI.textWhite};font-family:${OGUI.font};font-size:11px;cursor:pointer;letter-spacing:1px;">START SERVER  ▶</button>
        </div>
      </div>
    `;

    // ── Map list interactivity ──────────────────────────────────────────────
    const dlg = this.dialogEl.querySelector<HTMLElement>('#cs-host-dlg')!;
    const mapRowsEl = this.dialogEl.querySelector<HTMLElement>('#cs-map-rows')!;
    const previewEl = this.dialogEl.querySelector<HTMLElement>('#cs-map-preview')!;
    const mapField = this.dialogEl.querySelector<HTMLSelectElement | HTMLInputElement>('[data-host-field="map"]') as HTMLInputElement | null;

    const selectMap = (index: number) => {
      selectedMapIndex = Math.max(0, Math.min(maps.length - 1, index));
      mapRowsEl.innerHTML = renderMapRows();
      previewEl.innerHTML = renderPreview();
      // Sync hidden value
      if (mapField) mapField.value = maps[selectedMapIndex];
      // Scroll selected row into view
      const row = mapRowsEl.querySelector<HTMLElement>(`[data-map-index="${selectedMapIndex}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    };

    // Add a hidden input to hold the chosen map value
    const hiddenMapInput = document.createElement('input');
    hiddenMapInput.type = 'hidden';
    hiddenMapInput.setAttribute('data-host-field', 'map');
    hiddenMapInput.value = maps[selectedMapIndex] ?? 'map_default';
    dlg.appendChild(hiddenMapInput);

    mapRowsEl.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-map-index]');
      if (!row) return;
      selectMap(Number(row.dataset.mapIndex));
    });

    // Keyboard within dialog: ↑↓ = map navigation
    dlg.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')   { e.stopPropagation(); selectMap(selectedMapIndex - 1); }
      if (e.key === 'ArrowDown') { e.stopPropagation(); selectMap(selectedMapIndex + 1); }
    });
    dlg.setAttribute('tabindex', '-1');
    dlg.focus();

    // ── Action buttons ─────────────────────────────────────────────────────
    this.dialogEl.querySelector('[data-host-action="cancel"]')?.addEventListener('click', () => this._hideHostDialog());
    this.dialogEl.querySelector('[data-host-action="create"]')?.addEventListener('click', () => {
      const read = (field: string): string =>
        (this.dialogEl.querySelector(`[data-host-field="${field}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
      const hostConfig: HostedRoomConfig = {
        name: read('name').trim() || defaultConfig.name,
        map: read('map') || maps[selectedMapIndex] || defaultConfig.map,
        mode: read('mode') === 'horde'
          ? 'horde'
          : read('mode') === 'drift_bomb'
            ? 'drift_bomb'
            : 'ffa',
        killLimit: Math.max(1, Math.min(100, Number(read('killLimit')) || defaultConfig.killLimit)),
        roundDurationSec: Math.max(30, Math.min(1800, Number(read('roundDurationSec')) || defaultConfig.roundDurationSec)),
        maxPlayers: Math.max(2, Math.min(16, Number(read('maxPlayers')) || defaultConfig.maxPlayers)),
      };
      const playerName = `Host_${Engine.random.next().toString(36).slice(2, 6)}`;
      this.statusEl.textContent = `Hosting ${hostConfig.name}…`;
      
      // Resolve server URL with optional manual override
      const serverIp = read('serverIp').trim();
      const targets = this.resolveConnectionTargets(serverIp || null);
      this.resolvedHttpUrl = targets.httpUrl;
      this.resolvedWsUrl = targets.wsUrl;
      this.resolvedBackendFingerprint = this.buildBackendFingerprint(targets.httpUrl, targets.wsUrl);
      
      if (this.config.hostLobby) {
        this.config.hostLobby({
          playerName,
          config: hostConfig,
          wsUrl: targets.wsUrl,
          httpUrl: targets.httpUrl,
          backendFingerprint: this.resolvedBackendFingerprint,
        });
      } else {
        this.client.hostRoom(targets.wsUrl, playerName, hostConfig);
      }
      this._hideHostDialog();
    });
  }

  private resolveConnectionTargets(manualIp: string | null = null): { httpUrl: string; wsUrl: string } {
    const resolver = new NetworkConnectionResolver();
    const normalizedManualIp = typeof manualIp === 'string' && manualIp.trim().length > 0 ? manualIp.trim() : null;
    if (normalizedManualIp) {
      resolver.setManualServerIP(normalizedManualIp);
    }
    return {
      httpUrl: resolver.resolveHttpUrl(),
      wsUrl: resolver.resolveWebSocketUrl(),
    };
  }

  private buildBackendFingerprint(httpUrl: string, wsUrl: string): string {
    return `${httpUrl}|${wsUrl}`;
  }

  private getActiveBackendFingerprint(lobbyState: LobbyState | null): string {
    if (typeof lobbyState?.backendFingerprint === 'string' && lobbyState.backendFingerprint.trim().length > 0) {
      return lobbyState.backendFingerprint;
    }
    const fromClient = typeof (this.client as any).getServerHttpBaseUrl === 'function'
      ? (this.client as any).getServerHttpBaseUrl()
      : null;
    if (fromClient) {
      return fromClient;
    }
    return this.resolvedBackendFingerprint;
  }

  private _hideHostDialog(): void {
    this.hostingDialogVisible = false;
    this.dialogEl.style.display = 'none';
    this.dialogEl.innerHTML = '';
  }

  private _onKey(event: KeyboardEvent): void {
    if (!this.visible) return;
    if (this.hostingDialogVisible && event.key !== 'Escape') return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        if (this.screen === 'list' && this.servers.length > 0) {
          this.selectedServerIndex = (this.selectedServerIndex - 1 + this.servers.length) % this.servers.length;
          this._updateSelection();
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (this.screen === 'list' && this.servers.length > 0) {
          this.selectedServerIndex = (this.selectedServerIndex + 1) % this.servers.length;
          this._updateSelection();
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (this.screen === 'list') this._joinSelected();
        break;
      case ' ': 
        event.preventDefault();
        if (this.screen === 'lobby') this._handleAction('ready');
        break;
      case 'r':
      case 'R':
        if (this.screen === 'list') void this.refreshServers();
        break;
      case 'Escape':
        event.preventDefault();
        if (this.hostingDialogVisible) {
          this._hideHostDialog();
        } else if (this.screen === 'lobby') {
          this._handleAction('leave');
        } else {
          this._handleAction('close');
        }
        break;
      default:
        break;
    }
  }

  private _updateSelection(): void {
    const rows = this.contentEl.querySelectorAll('[data-row-index]');
    rows.forEach((row) => {
      const el = row as HTMLElement;
      const selected = Number(el.dataset.rowIndex) === this.selectedServerIndex;
      el.style.borderLeftColor = selected ? OGUI.borderSel : 'transparent';
      el.style.background = selected ? OGUI.bgSelected : 'transparent';
      el.style.color = selected ? OGUI.textWhite : OGUI.textSec;
    });
  }

  private _startAutoRefresh(): void {
    this._stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      if (this.screen === 'list' && !this.hostingDialogVisible) {
        void this.refreshServers();
      }
    }, 5000);
  }

  private _stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private _addButton(action: string, label: string, accent = false): void {
    const button = document.createElement('div');
    button.dataset.action = action;
    button.textContent = label;
    if (accent) {
      button.style.cssText = `display:inline-block;padding:8px 20px;margin:4px 6px;border:1px solid ${OGUI.borderSel};color:${OGUI.textWhite};background:${OGUI.bgSelected};cursor:pointer;font-size:11px;letter-spacing:1px;font-weight:bold;font-family:${OGUI.font};`;
      button.addEventListener('mouseenter', () => { button.style.background = 'rgba(160,160,160,0.18)'; });
      button.addEventListener('mouseleave', () => { button.style.background = OGUI.bgSelected; });
    } else {
      button.style.cssText = `display:inline-block;padding:8px 18px;margin:4px 6px;border:1px solid ${OGUI.borderDim};color:${OGUI.textSec};cursor:pointer;font-size:11px;letter-spacing:1px;font-family:${OGUI.font};`;
      button.addEventListener('mouseenter', () => { button.style.borderColor = OGUI.border; button.style.color = OGUI.textPri; });
      button.addEventListener('mouseleave', () => { button.style.borderColor = OGUI.borderDim; button.style.color = OGUI.textSec; });
    }
    this.footerEl.appendChild(button);
  }

  private _escape(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private _escapeAttribute(text: string): string {
    return this._escape(text).replace(/"/g, '&quot;');
  }

  private _applyRootStyle(): void {
    const style = this.root.style;
    style.position = 'fixed';
    style.top = '0';
    style.left = '0';
    style.width = '100vw';
    style.height = '100vh';
    style.display = 'flex';
    style.flexDirection = 'column';
    style.alignItems = 'center';
    style.justifyContent = 'center';
    style.zIndex = String(OGUI.zMenu);
    style.fontFamily = OGUI.font;
    style.backgroundColor = OGUI.bgMenu;
    style.backgroundImage = 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px)';
  }

  private _applyHeaderStyle(): void {
    const style = this.headerEl.style;
    style.fontSize = '20px';
    style.fontWeight = 'bold';
    style.letterSpacing = '4px';
    style.color = OGUI.textHead;
    style.marginBottom = '10px';
  }

  private _applyContentStyle(): void {
    const style = this.contentEl.style;
    style.width = 'min(760px, 92vw)';
    style.maxHeight = '52vh';
    style.overflowY = 'auto';
    style.background = OGUI.bgPanel;
    style.border = `1px solid ${OGUI.border}`;
  }

  private _applyStatusStyle(): void {
    const style = this.statusEl.style;
    style.minHeight = '18px';
    style.marginTop = '10px';
    style.color = OGUI.textSec;
    style.fontSize = '11px';
  }

  private _applyFooterStyle(): void {
    const style = this.footerEl.style;
    style.marginTop = '10px';
    style.display = 'flex';
    style.flexWrap = 'wrap';
    style.justifyContent = 'center';
  }

  private _applyDialogStyle(): void {
    const style = this.dialogEl.style;
    style.position = 'fixed';
    style.inset = '0';
    style.display = 'none';
    style.alignItems = 'center';
    style.justifyContent = 'center';
    style.background = 'rgba(0,0,0,0.45)';
    style.zIndex = '9101';
  }
}