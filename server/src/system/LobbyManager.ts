import { WebSocket } from 'ws';
import {
  type LobbyPlayerState,
  getDefaultSpawnPointsForMap,
  type GameModeId,
  type LobbyRoom,
  type RoomCreateOptions,
} from '../sessionContracts';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  cloneTropicalHorrorArchetypeAppearance,
  resolveTropicalHorrorArchetypeId,
  type TropicalHorrorArchetypeId,
} from '@shared/contracts';

export class LobbyManager {
  private rooms: Map<string, LobbyRoom> = new Map();
  private wsToRoom: Map<WebSocket, string> = new Map();
  private roomCounter = 0;
  private countdownTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private onStartFn?: (room: LobbyRoom) => void;

  /** votes[roomId][playerId] = mapId */
  private votes: Map<string, Map<string, string>> = new Map();

  onGameStart(fn: (room: LobbyRoom) => void): void {
    this.onStartFn = fn;
  }

  createRoom(options: RoomCreateOptions = {}): LobbyRoom {
    const id = `lobby_${++this.roomCounter}`;
    const room: LobbyRoom = {
      id,
      name: options.name?.trim() || `Server ${id}`,
      players: new Map(),
      selectedMap: options.map ?? 'map_default',
      selectedMode: options.mode ?? 'ffa',
      status: 'waiting',
      countdown: -1,
      hostId: '',
      maxPlayers: Math.max(2, Math.min(16, options.maxPlayers ?? 8)),
      killLimit: Math.max(1, Math.min(100, options.killLimit ?? 10)),
      roundDurationSec: Math.max(30, Math.min(1800, options.roundDurationSec ?? 180)),
      spawnPoints: options.spawnPoints && options.spawnPoints.length > 0
        ? options.spawnPoints.map((point) => ({ ...point }))
        : getDefaultSpawnPointsForMap(options.map ?? 'map_default'),
    };

    this.rooms.set(id, room);
    this.votes.set(id, new Map());
    return room;
  }

  getOrCreateRoom(defaultMap: string, defaultMode: GameModeId): LobbyRoom {
    this.pruneDisconnectedRooms();
    for (const room of this.rooms.values()) {
      if (room.status === 'waiting' && room.players.size < room.maxPlayers) {
        return room;
      }
    }

    return this.createRoom({ map: defaultMap, mode: defaultMode });
  }

  getRoom(roomId: string): LobbyRoom | undefined {
    this.pruneDisconnectedRooms();
    return this.rooms.get(roomId);
  }

  joinRoom(
    ws: WebSocket,
    roomId: string,
    playerId: string,
    playerName: string,
    appearance?: Record<string, unknown> | null,
    archetypeId?: TropicalHorrorArchetypeId | null,
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.status === 'in_game' || room.players.size >= room.maxPlayers) return false;

    const isHost = room.players.size === 0;
    const resolvedArchetypeId = resolveTropicalHorrorArchetypeId(archetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
    room.players.set(playerId, {
      id: playerId,
      name: playerName,
      ping: 0,
      ready: false,
      isHost,
      ws,
      // Fall back to the archetype's canonical appearance so syncJoinedPlayerState
      // always has non-null data to broadcast — preventing the 'blue pill' fallback.
      appearance: appearance ? { ...appearance } : { ...cloneTropicalHorrorArchetypeAppearance(resolvedArchetypeId) },
      archetypeId: resolvedArchetypeId,
    });
    if (isHost) room.hostId = playerId;

    this.wsToRoom.set(ws, roomId);
    this._broadcastLobbyState(room);
    return true;
  }

  leaveRoom(ws: WebSocket): void {
    const roomId = this.wsToRoom.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    this.wsToRoom.delete(ws);
    for (const [id, player] of room.players) {
      if (player.ws === ws) {
        room.players.delete(id);
        break;
      }
    }

    if (room.hostId && !room.players.has(room.hostId) && room.players.size > 0) {
      const newHost = room.players.values().next().value;
      if (newHost) {
        newHost.isHost = true;
        room.hostId = newHost.id;
      }
    }

    if (room.players.size === 0) {
      this._cancelCountdown(room);
      this.rooms.delete(roomId);
      this.votes.delete(roomId);
    } else {
      this._broadcastLobbyState(room);
    }
  }

  handleLobbyAction(ws: WebSocket, action: string, data: Record<string, unknown>): void {
    const roomId = this.wsToRoom.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    let actor: LobbyPlayerState | undefined;
    for (const player of room.players.values()) {
      if (player.ws === ws) {
        actor = player;
        break;
      }
    }

    switch (action) {
      case 'LOBBY_READY':
        if (actor) actor.ready = !!data.ready;
        this._checkAllReady(room);
        break;
      case 'LOBBY_FORCE_START':
        if (actor?.isHost && room.status === 'waiting') {
          this._startCountdown(room, 0);
        }
        break;
      case 'LOBBY_MAP':
        if (actor?.isHost && typeof data.mapId === 'string') {
          room.selectedMap = data.mapId;
          room.spawnPoints = getDefaultSpawnPointsForMap(room.selectedMap);
        }
        break;
      case 'LOBBY_MODE':
        if (actor?.isHost && (data.mode === 'ffa' || data.mode === 'horde' || data.mode === 'drift_bomb')) {
          room.selectedMode = data.mode;
        }
        break;
      case 'LOBBY_SETTINGS':
        if (actor?.isHost) {
          if (typeof data.name === 'string' && data.name.trim()) room.name = data.name.trim();
          if (typeof data.killLimit === 'number') room.killLimit = Math.max(1, Math.min(100, data.killLimit));
          if (typeof data.roundDurationSec === 'number') room.roundDurationSec = Math.max(30, Math.min(1800, data.roundDurationSec));
          if (typeof data.maxPlayers === 'number') room.maxPlayers = Math.max(2, Math.min(16, data.maxPlayers));
        }
        break;
      case 'LOBBY_ARCHETYPE': {
        const nextArchetypeId = resolveTropicalHorrorArchetypeId(data.archetypeId);
        if (actor && nextArchetypeId) {
          actor.archetypeId = nextArchetypeId;
          // Keep appearance in sync so syncJoinedPlayerState broadcasts the right
          // visual to any player who joins after the archetype switch.
          actor.appearance = { ...cloneTropicalHorrorArchetypeAppearance(nextArchetypeId) };
        }
        break;
      }
      case 'MAP_VOTE': {
        if (typeof data.mapId === 'string' && data.mapId.trim()) {
          const roomVotes = this.votes.get(roomId);
          if (roomVotes && actor) {
            roomVotes.set(actor.id, data.mapId);
          }
        }
        break;
      }
      default:
        break;
    }

    this._broadcastLobbyState(room);
  }

  updatePing(ws: WebSocket, ping: number): void {
    const roomId = this.wsToRoom.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const player of room.players.values()) {
      if (player.ws === ws) {
        player.ping = ping;
        break;
      }
    }
  }

  getRoomForWs(ws: WebSocket): LobbyRoom | undefined {
    const id = this.wsToRoom.get(ws);
    return id ? this.rooms.get(id) : undefined;
  }

  listRooms(): LobbyRoom[] {
    this.pruneDisconnectedRooms();
    return Array.from(this.rooms.values());
  }

  broadcastRoomState(roomId: string): boolean {
    this.pruneDisconnectedRooms();
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }
    this._broadcastLobbyState(room);
    return true;
  }

  pruneDisconnectedRooms(): void {
    for (const [roomId, room] of this.rooms.entries()) {
      for (const [playerId, player] of room.players.entries()) {
        if (player.ws.readyState === WebSocket.OPEN) {
          continue;
        }

        room.players.delete(playerId);
        this.wsToRoom.delete(player.ws);
      }

      if (room.hostId && !room.players.has(room.hostId) && room.players.size > 0) {
        const newHost = room.players.values().next().value;
        if (newHost) {
          newHost.isHost = true;
          room.hostId = newHost.id;
        }
      }

      if (room.players.size > 0) {
        continue;
      }

      this._cancelCountdown(room);
      this.rooms.delete(roomId);
      this.votes.delete(roomId);
    }
  }

  private _checkAllReady(room: LobbyRoom): void {
    if (room.players.size < 1) return;

    const allReady = Array.from(room.players.values()).every((player) => player.ready);
    if (allReady && room.status === 'waiting') {
      this._startCountdown(room);
    } else if (!allReady && room.status === 'countdown') {
      this._cancelCountdown(room);
      this._broadcastLobbyState(room);
    }
  }

  private _startCountdown(room: LobbyRoom, seconds = 3): void {
    room.status = 'countdown';
    room.countdown = seconds;
    this._broadcastLobbyState(room);

    const timer = setInterval(() => {
      room.countdown -= 1;
      this._broadcastLobbyState(room);

      if (room.countdown <= 0) {
        clearInterval(timer);
        this.countdownTimers.delete(room.id);
        room.status = 'in_game';
        room.countdown = -1;

        const roomVotes = this.votes.get(room.id);
        if (roomVotes && roomVotes.size > 0) {
          const tallies: Record<string, number> = {};
          for (const mapId of roomVotes.values()) {
            tallies[mapId] = (tallies[mapId] ?? 0) + 1;
          }
          const winner = Object.entries(tallies).sort((a, b) => b[1] - a[1])[0];
          if (winner) {
            room.selectedMap = winner[0];
            room.spawnPoints = getDefaultSpawnPointsForMap(room.selectedMap);
          }
          roomVotes.clear();
        }

        this._broadcastLobbyState(room);
        this.onStartFn?.(room);
      }
    }, 1000);

    this.countdownTimers.set(room.id, timer);
  }

  private _cancelCountdown(room: LobbyRoom): void {
    const timer = this.countdownTimers.get(room.id);
    if (timer) {
      clearInterval(timer);
      this.countdownTimers.delete(room.id);
    }
    room.status = 'waiting';
    room.countdown = -1;
  }

  private _broadcastLobbyState(room: LobbyRoom): void {
    const roomVotes = this.votes.get(room.id);
    const voteTallies: Record<string, number> = {};
    if (roomVotes) {
      for (const mapId of roomVotes.values()) {
        voteTallies[mapId] = (voteTallies[mapId] ?? 0) + 1;
      }
    }

    const payload = JSON.stringify({
      type: 'LOBBY_UPDATE',
      lobby: {
        roomId: room.id,
        roomName: room.name,
        players: Array.from(room.players.values()).map(({ ws: _ws, ...rest }) => rest),
        selectedMap: room.selectedMap,
        selectedMode: room.selectedMode,
        status: room.status,
        countdown: room.countdown,
        killLimit: room.killLimit,
        roundDurationSec: room.roundDurationSec,
        maxPlayers: room.maxPlayers,
        votes: voteTallies,
      },
    });

    for (const player of room.players.values()) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(payload);
      }
    }
  }
}