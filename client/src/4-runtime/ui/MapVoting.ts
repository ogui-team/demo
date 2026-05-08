/**
 * MapVoting
 * Full-screen overlay allowing players to vote for the next map.
 *
 * Features:
 *  - Displays available maps as clickable cards
 *  - Sends MAP_VOTE action to server via MultiplayerClient
 *  - Receives live vote tallies from LOBBY_UPDATE (lobby state field `votes`)
 *  - Highlights the winning map in real-time
 *  - Fires onMapSelected() callback when server finalises the map
 *  - PS1 / terminal visual aesthetic consistent with the rest of the engine
 *
 * Server-side protocol:
 *   C→S  { type: 'ACTION', action: 'MAP_VOTE', data: { mapId } }
 *   The server records the vote, picks the winner when the match starts.
 *   Server broadcasts the tally inside `LOBBY_UPDATE.lobby.votes`
 *   field:  votes: Record<mapId, number>
 */

import type { MultiplayerClient, LobbyState } from '../../3-network/network/MultiplayerClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MapDef {
  id: string;
  label: string;
  desc?: string;
  /** Optional preview image URL. */
  thumb?: string;
}

export interface MapVotingConfig {
  maps: MapDef[];
  localPlayerId: string;
  enableLogging?: boolean;
}

// ─── MapVoting ────────────────────────────────────────────────────────────────

export class MapVoting {
  private client: MultiplayerClient;
  private cfg: Required<MapVotingConfig>;

  private root: HTMLElement | null = null;
  private myVote: string | null = null;
  private voteTallies: Record<string, number> = {};
  private totalVotes = 0;

  private mapSelectedCallbacks: Set<(mapId: string) => void> = new Set();

  constructor(client: MultiplayerClient, cfg: MapVotingConfig) {
    this.client = client;
    this.cfg = {
      maps: cfg.maps,
      localPlayerId: cfg.localPlayerId,
      enableLogging: cfg.enableLogging ?? false,
    };

    this._injectStyles();
    this._wireEvents();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  mount(): void {
    if (this.root) return;
    this._buildDOM();
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
  }

  isVisible(): boolean { return !!this.root; }

  // ─── Vote ────────────────────────────────────────────────────────────────────

  /**
   * Cast or change the local player's vote. Sends the action to the server.
   */
  vote(mapId: string): void {
    if (!this.cfg.maps.find((m) => m.id === mapId)) return;
    this.myVote = mapId;
    this._sendVote(mapId);
    this._refreshCards();
    this._log(`Voted for map: ${mapId}`);
  }

  // ─── Events ──────────────────────────────────────────────────────────────────

  onMapSelected(cb: (mapId: string) => void): () => void {
    this.mapSelectedCallbacks.add(cb);
    return () => this.mapSelectedCallbacks.delete(cb);
  }

  // ─── Network ─────────────────────────────────────────────────────────────────

  private _sendVote(mapId: string): void {
    // MultiplayerClient doesn't expose a generic sendAction, so we use setMap
    // (host-only on server currently). For voting we send a custom ACTION via
    // the same pattern MultiplayerClient uses internally.
    const ws = (this.client as any).ws as WebSocket | null;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ACTION',
        action: 'MAP_VOTE',
        data: { mapId },
      }));
    }
  }

  private _wireEvents(): void {
    this.client.on('lobby_update', (lobby: LobbyState) => {
      const votesData = (lobby as any).votes as Record<string, number> | undefined;
      if (votesData) {
        this.voteTallies = votesData;
        this.totalVotes = Object.values(votesData).reduce((s, n) => s + n, 0);
        this._refreshCards();
      }

      // When server selected a map (matching the voted winner)
      const serverMap = (lobby as any).selectedMap as string | undefined;
      if (serverMap && (lobby as any).mapFinalised) {
        for (const cb of this.mapSelectedCallbacks) cb(serverMap);
      }
    });
  }

  // ─── DOM ─────────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    this.root = document.createElement('div');
    this.root.id = 'map-voting-overlay';

    const header = document.createElement('div');
    header.id = 'map-voting-header';
    header.innerHTML =
      `<div style="font-size:18px;letter-spacing:5px;text-transform:uppercase;color:#00ffcc;` +
      `text-shadow:0 0 12px #00ffcc">MAP VOTE</div>` +
      `<div style="font-size:11px;letter-spacing:2px;color:#3a8a7a;margin-top:6px">` +
      `Click a map to cast your vote</div>`;
    this.root.appendChild(header);

    const grid = document.createElement('div');
    grid.id = 'map-voting-grid';
    this.root.appendChild(grid);

    const footer = document.createElement('div');
    footer.id = 'map-voting-footer';
    footer.style.cssText =
      'font-size:10px;color:#3a8a7a;letter-spacing:2px;margin-top:18px;text-align:center';
    footer.textContent = 'Most-voted map will be selected when the match starts.';
    this.root.appendChild(footer);

    document.body.appendChild(this.root);
    this._renderCards();
  }

  private _renderCards(): void {
    const grid = document.getElementById('map-voting-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const map of this.cfg.maps) {
      const card = this._buildCard(map);
      grid.appendChild(card);
    }
  }

  private _buildCard(map: MapDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'map-vote-card';
    card.dataset['mapId'] = map.id;

    const votes = this.voteTallies[map.id] ?? 0;
    const pct = this.totalVotes > 0 ? Math.round((votes / this.totalVotes) * 100) : 0;
    const isMyVote = this.myVote === map.id;

    card.style.cssText = [
      `background:${isMyVote ? '#0a1f0a' : '#0d0d0d'}`,
      `border:2px solid ${this._cardBorderColor(map.id)}`,
      'padding:14px 16px',
      'cursor:pointer',
      'min-width:140px',
      'transition:border-color 0.15s,background 0.15s',
    ].join(';');

    card.innerHTML =
      `<div style="font-size:13px;letter-spacing:1px;color:#00ff41">${map.label}</div>` +
      (map.desc ? `<div style="font-size:10px;color:#3a6a3a;margin-top:3px">${map.desc}</div>` : '') +
      `<div class="vote-bar-wrap" style="margin-top:10px;height:4px;background:#1a2a1a;border-radius:2px">` +
      `<div class="vote-bar" style="height:4px;width:${pct}%;background:#00ff41;` +
      `border-radius:2px;transition:width 0.3s"></div></div>` +
      `<div style="font-size:11px;color:#557a55;margin-top:5px">${votes} vote${votes !== 1 ? 's' : ''} (${pct}%)` +
      (isMyVote ? ' <span style="color:#00ff41">✓ YOU</span>' : '') + '</div>';

    card.addEventListener('click', () => this.vote(map.id));
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = '#00ff41';
      card.style.background = '#0f1f0f';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = this._cardBorderColor(map.id);
      card.style.background = this.myVote === map.id ? '#0a1f0a' : '#0d0d0d';
    });

    return card;
  }

  private _refreshCards(): void {
    for (const map of this.cfg.maps) {
      const card = this.root?.querySelector<HTMLElement>(
        `.map-vote-card[data-map-id="${map.id}"]`,
      );
      if (!card) continue;

      const votes = this.voteTallies[map.id] ?? 0;
      const pct = this.totalVotes > 0 ? Math.round((votes / this.totalVotes) * 100) : 0;
      const isMyVote = this.myVote === map.id;

      card.style.borderColor = this._cardBorderColor(map.id);
      card.style.background = isMyVote ? '#0a1f0a' : '#0d0d0d';

      const bar = card.querySelector<HTMLElement>('.vote-bar');
      if (bar) bar.style.width = `${pct}%`;

      const label = card.querySelector<HTMLElement>('div:last-child');
      if (label) {
        label.innerHTML =
          `${votes} vote${votes !== 1 ? 's' : ''} (${pct}%)` +
          (isMyVote ? ' <span style="color:#00ff41">✓ YOU</span>' : '');
      }
    }
  }

  /** Border colour: gold for current top vote, green for own vote, dim otherwise. */
  private _cardBorderColor(mapId: string): string {
    const topMap = this._getLeadingMap();
    if (topMap === mapId && this.totalVotes > 0) return '#ffdd00';
    if (this.myVote === mapId) return '#00ff41';
    return '#1a3a1a';
  }

  private _getLeadingMap(): string | null {
    let top: string | null = null;
    let topCount = 0;
    for (const [id, count] of Object.entries(this.voteTallies)) {
      if (count > topCount) { topCount = count; top = id; }
    }
    return top;
  }

  private _injectStyles(): void {
    if (document.getElementById('map-voting-styles')) return;
    const style = document.createElement('style');
    style.id = 'map-voting-styles';
    style.textContent = `
      #map-voting-overlay {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: fixed;
        inset: 0;
        z-index: 9990;
        background: rgba(0,0,0,0.9);
        font-family: 'Courier New', Courier, monospace;
        padding: 40px 20px;
        overflow-y: auto;
      }
      #map-voting-header {
        text-align: center;
        margin-bottom: 28px;
      }
      #map-voting-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        justify-content: center;
        max-width: 800px;
      }
    `;
    document.head.appendChild(style);
  }

  private _log(msg: string): void {
    if (this.cfg.enableLogging) console.log(`[MapVoting] ${msg}`);
  }
}
