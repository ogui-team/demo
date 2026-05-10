import type { RoundState } from '../gameplay/session';

export interface JoinAckEvent {
  type: 'JOIN_ACK';
  playerId: string;
  roomId: string;
  hosted?: boolean;
  protocol?: Record<string, unknown>;
}

export interface LobbyUpdateEvent {
  type: 'LOBBY_UPDATE';
  lobby: Record<string, unknown>;
}

export interface GameStartEvent {
  type: 'GAME_START';
  map: string;
  mode: string;
  sessionId: string;
  playerId?: string;
  late?: boolean;
  protocol?: Record<string, unknown>;
}

export interface SnapshotEnvelopeEvent {
  type: 'AUTHORITATIVE_SNAPSHOT' | 'WORLD_DELTA' | 'FULL_SYNC_DATA';
  schemaVersion?: number;
  deltaMode?: string;
  tick?: number;
  ack?: number;
  timestamp?: number;
  entities?: unknown;
  events?: unknown;
  round?: RoundState | unknown;
  lastProcessedInput?: number;
  lastProcessedInputTick?: number;
  localPlayerId?: string;
}

export interface InitialMapSyncEvent {
  type: 'INITIAL_MAP_SYNC';
  mapData: Record<string, unknown>;
}

export interface PlayerLeaveEvent {
  type: 'PLAYER_LEAVE';
  playerId: string;
}

export interface PlayerKilledEvent {
  type: 'PLAYER_KILLED';
  killerId: string;
  targetId: string;
  stats?: unknown;
}

export interface PlayerDiedEvent {
  type: 'PLAYER_DIED';
  playerId: string;
  killedBy: string;
}

export interface PlayerRespawnEvent {
  type: 'PLAYER_RESPAWN';
  playerId: string;
  position?: { x: number; y: number; z: number };
}

export interface RoundStartEvent {
  type: 'ROUND_START';
  round: RoundState;
}

export interface RoundEndEvent {
  type: 'ROUND_END';
  round: RoundState;
  winner?: { id?: string } | null;
}

export interface ScoreUpdateEvent {
  type: 'SCORE_UPDATE';
  players: unknown[];
}

export interface InventorySyncEvent {
  type: 'INVENTORY_SYNC';
  inventory: Record<string, unknown>;
}

export interface InventoryErrorEvent {
  type: 'INVENTORY_ERROR';
  reason: string;
}

export interface PongEvent {
  type: 'PONG';
  clientTs: number;
}

export interface TickSyncEvent {
  type: 'TICK_SYNC';
  tick: number;
  timestamp: number;
  targetTickRate?: number;
}

export interface ErrorEvent {
  type: 'ERROR';
  message?: string;
  code?: string;
}

export type ServerToClientMessage =
  | JoinAckEvent
  | LobbyUpdateEvent
  | GameStartEvent
  | SnapshotEnvelopeEvent
  | InitialMapSyncEvent
  | PlayerLeaveEvent
  | PlayerKilledEvent
  | PlayerDiedEvent
  | PlayerRespawnEvent
  | RoundStartEvent
  | RoundEndEvent
  | ScoreUpdateEvent
  | InventorySyncEvent
  | InventoryErrorEvent
  | PongEvent
  | TickSyncEvent
  | ErrorEvent
  | ({ type: string } & Record<string, unknown>);

export type ServerToClientMessageType = ServerToClientMessage['type'];