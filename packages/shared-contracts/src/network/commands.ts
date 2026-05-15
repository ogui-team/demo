export type ClientActionType =
  | 'LOBBY_READY'
  | 'LOBBY_MAP'
  | 'LOBBY_MODE'
  | 'LOBBY_SETTINGS'
  | 'MAP_VOTE'
  | 'LOBBY_FORCE_START'
  | 'LOBBY_ARCHETYPE'
  | 'PLAYER_APPEARANCE'
  | 'RESPAWN_REQUEST'
  | 'WORLD_OBJECT_PLACE'
  | 'WORLD_OBJECT_REMOVE'
  | 'WORLD_OBJECT_UPDATE'
  | 'ABILITY_STATE_SYNC'
  | 'INVENTORY_STATE_SYNC'
  | 'ATTRIBUTE_STATE_SYNC'
  | 'PLAYER_DAMAGE'
  | 'PLAYER_MODE_CHANGE'
  | string;

export interface HostGameCommand {
  type: 'HOST_GAME';
  playerId?: string;
  name?: string;
  settings?: unknown;
  appearance?: unknown;
  archetypeId?: string | null;
  protocol?: Record<string, unknown>;
}

export interface PlayerJoinCommand {
  type: 'PLAYER_JOIN';
  playerId?: string;
  name?: string;
  roomId?: string;
  allowLateJoin?: boolean;
  appearance?: unknown;
  archetypeId?: string | null;
  protocol?: Record<string, unknown>;
}

export interface PlayerInputCommand {
  type: 'PLAYER_INPUT';
  seq: number;
  ts: number;
  input?: unknown;
}

export interface GameplayCommandMessage {
  type: 'GAMEPLAY_COMMAND';
  command: string;
  data: unknown;
}

export interface DevCommandMessage {
  type: 'DEV_COMMAND';
  command: string;
  data?: unknown;
}

export interface FullSyncRequestMessage {
  type: 'FULL_SYNC_REQ';
}

export interface ActionCommandMessage {
  type: 'ACTION';
  action: ClientActionType;
  data: unknown;
}

export interface PingCommandMessage {
  type: 'PING';
  ts: number;
}

export interface InventoryRequestMessage {
  type: 'INVENTORY_REQUEST';
}

export interface InventoryMoveMessage {
  type: 'INVENTORY_MOVE';
  instanceId: string;
  toX: number;
  toY: number;
}

export interface InventoryEquipMessage {
  type: 'INVENTORY_EQUIP';
  instanceId: string;
  slot?: 'weapon' | 'armor';
}

export interface InventoryDropMessage {
  type: 'INVENTORY_DROP';
  instanceId: string;
}

export type ClientToServerMessage =
  | HostGameCommand
  | PlayerJoinCommand
  | PlayerInputCommand
  | GameplayCommandMessage
  | DevCommandMessage
  | FullSyncRequestMessage
  | ActionCommandMessage
  | PingCommandMessage
  | InventoryRequestMessage
  | InventoryMoveMessage
  | InventoryEquipMessage
  | InventoryDropMessage;

export type ClientToServerMessageType = ClientToServerMessage['type'];