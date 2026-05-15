import type { TropicalHorrorArchetypeId, Vector3, WorldProductionSyncPayload } from '@shared/contracts';
import type { GameModeId, RoundState } from '@shared/contracts';
import type { ClientToServerMessage } from '@shared/contracts';
export type { Vector3 as Vec3 } from '@shared/contracts';
type Vec3 = Vector3;
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { logEvent } from '@engine/1-kernel/core/public-api';
import { SNAPSHOT_DELTA_MODE, SNAPSHOT_SCHEMA_VERSION, isSupportedSnapshotSchema } from './SnapshotContract';
import { networkTrafficDebugger } from './NetworkTrafficDebugger';

interface CollisionAuthorityAdapter {
  getHandshake(): { version: number; checksum: string };
}

export interface ServerInfo {
  id: string;
  name: string;
  map: string;
  mode: string;
  players: number;
  maxPlayers: number;
  status: string;
  killLimit: number;
  roundDurationSec: number;
  ping: number;
  backendFingerprint?: string;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  ping: number;
  ready: boolean;
  isHost: boolean;
  archetypeId?: TropicalHorrorArchetypeId;
}

export interface LobbyState {
  roomId?: string;
  roomName?: string;
  backendFingerprint?: string;
  players: LobbyPlayer[];
  selectedMap: string;
  selectedMode: string;
  status?: 'waiting' | 'countdown' | 'in_game';
  countdown: number;
  killLimit?: number;
  roundDurationSec?: number;
  maxPlayers?: number;
}

export interface WorldEntity {
  id: string;
  type?: string;
  name?: string;
  position?: Vec3;
  rotation?: Vec3;
  velocity?: Vec3;
  isCrouching?: boolean;
  isGrounded?: boolean;
  isAirborne?: boolean;
  health?: number;
  maxHealth?: number;
  shield?: number;
  maxShield?: number;
  mana?: number;
  maxMana?: number;
  state?: string;
  dead?: boolean;
  kills?: number;
  deaths?: number;
  level?: number;
  exp?: number;
  ping?: number;
  equipment?: string[];
  activeWeaponId?: string;
  currentAmmo?: number;
  reserveAmmo?: number;
  isReloading?: boolean;
  isPlayerControlled?: boolean;
}

export interface AuthoritativeGameplayEvent {
  type: 'weapon_equip' | 'weapon_reload' | 'player_shoot' | 'use_ability';
  playerId?: string;
  shooterId?: string;
  weaponId?: string;
  equipment?: string[];
  origin?: Vec3;
  direction?: Vec3;
  hitId?: string | null;
  shotId?: string;
  abilityId?: string;
  cooldown?: number;
  movementIntent?: {
    horizontalImpulse: number;
    direction: Vec3;
    jump?: boolean;
    crouch?: boolean;
    verticalImpulse?: number;
  };
  timestamp?: number;
}

export interface AuthoritativeSnapshotPayload {
  tick: number;
  ack: number;
  lastProcessedInput?: number;
  lastProcessedInputTick?: number;
  localPlayerId?: string;
  entities: WorldEntity[];
  round?: RoundState;
  events: AuthoritativeGameplayEvent[];
  timestamp?: number;
}

interface SnapshotEnvelope {
  schemaVersion?: number;
  deltaMode?: string;
  tick?: number;
  ack?: number;
  lastProcessedInput?: number;
  lastProcessedInputTick?: number;
  localPlayerId?: string;
  entities?: unknown;
  round?: unknown;
  events?: unknown;
  timestamp?: number;
}

export interface WorldObjectData {
  id: string;
  entityType: string;
  position: Vec3;
  rotation: Vec3;
  renderData: { meshType: string; color: number; geometry: Record<string, unknown> };
}

export interface InitialMapSyncPayload {
  version: 'editor-scene-v1';
  savedAt: number;
  entityCount: number;
  entities: Array<{
    sourceEntityId: string;
    kind: 'prefab' | 'triggerVolume' | 'light' | 'entity';
    entityType: string;
    prefabId?: string | null;
    authority: 'local' | 'replicated';
    transform: {
      position: Vec3;
      rotation: Vec3;
      scale: Vec3;
    };
    components: Record<string, Record<string, unknown>>;
  }>;
  productionSync?: WorldProductionSyncPayload | null;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump?: boolean;
  sprint?: boolean;
  crouch?: boolean;
  movementIntent?: {
    jump?: boolean;
    crouch?: boolean;
  };
  airControl?: boolean;
  yaw: number;
  pitch?: number;
  predictedPos?: Vec3;
}

export type MultiplayerModeId = GameModeId;
export type { RoundState };

export interface HostedRoomConfig {
  name: string;
  map: string;
  mode: MultiplayerModeId;
  killLimit: number;
  roundDurationSec: number;
  maxPlayers: number;
}

export interface InventorySyncPayload {
  inventory: Record<string, unknown>;
}

export interface MultiplayerDebugStats {
  pingMs: number;
  packetsInPerSec: number;
  packetsOutPerSec: number;
  latencySimulation: string;
  interpolationDelayMs: number;
}

export interface MultiplayerProtocolDiagnostics {
  recentIncoming: Array<{
    receivedAt: number;
    type: string;
    parseOk: boolean;
    rawPreview: string;
  }>;
}

type EventMap = {
  auth_context: {
    identitySnapshot: { userId: string; isGuest: boolean; permissions: string[] };
    sessionId: string | null;
  };
  connected: { playerId: string; roomId: string; hosted?: boolean };
  disconnected: { reason: string };
  connection_lost: { reason: string; code?: number; wasClean?: boolean };
  lobby_update: LobbyState;
  game_start: { map: string; mode: string; sessionId: string; late?: boolean };
  authoritative_snapshot: AuthoritativeSnapshotPayload;
  full_sync_data: {
    playerId: string | null;
    tick: number;
    ack: number;
    entityCount: number;
    timestamp: number;
    entities: WorldEntity[];
    localPlayerId?: string;
  };
  entity_spawned: { entityId: string; playerId: string | null; position?: Vec3; isPlayerControlled?: boolean; timestamp: number };
  player_leave: { playerId: string };
  player_killed: { killerId: string; targetId: string; stats?: unknown };
  player_died: { playerId: string; killedBy: string };
  player_respawn: { playerId: string; position: Vec3 };
  player_shoot: { shooterId: string; origin: Vec3; direction: Vec3; hitId: string | null; weapon: string };
  player_reload: { playerId: string; weaponId: string };
  player_equip: { playerId: string; weaponId: string; equipment: string[] };
  round_start: { round: RoundState };
  round_end: { round: RoundState; winner?: { id?: string } | null };
  score_update: { players: any[] };
  inventory_sync: InventorySyncPayload;
  inventory_error: { reason: string };
  damage_taken: { amount: number; sourceId: string; health: number; armor: number };
  pong: { rtt: number };
  error: { message: string; code?: string };
  world_object_place: { object: WorldObjectData };
  world_object_remove: { id: string };
  world_object_update: { object: WorldObjectData };
  world_state: { objects: WorldObjectData[] };
  initial_map_sync: { mapData: InitialMapSyncPayload; timestamp: number };
  action_sent: { action: string; data: Record<string, unknown> };
  ability_state_sync: {
    playerId: string;
    abilityId: string;
    cooldown?: number;
    tags?: string[];
    movementIntent?: {
      horizontalImpulse: number;
      direction: Vec3;
      jump?: boolean;
      crouch?: boolean;
      verticalImpulse?: number;
    };
  };
  ammo_state_sync: {
    playerId: string;
    weaponId: string;
    current?: number;
    max?: number;
    reserve?: number;
    isReloading?: boolean;
  };
  inventory_state_sync: { playerId: string; equipped?: string[]; activeSlot?: string };
  attribute_state_sync: {
    playerId: string;
    health?: number;
    maxHealth?: number;
    shield?: number;
    maxShield?: number;
    mana?: number;
    maxMana?: number;
  };
  /** ─ AUTHORITY-BASED BINDING: Server confirmed authority mapping for local player */
  spawn_authority: {
    playerId: string;
    entityId: string;
    authority: string;
    timestamp: number;
  };
  /** Emitted when a remote player broadcasts their AvatarAppearance. */
  player_appearance: {
    playerId: string;
    appearance: {
      modelVariant?: string;
      textureStyle?: string;
      bodyColor?: number;
      accentColor?: number;
      skinColor?: number;
      legColor?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      heightScale?: number;
      widthScale?: number;
    };
  };
  tick_sync: { tick: number; timestamp: number; tickRate: number };
};

type EventCallback<K extends keyof EventMap> = (data: EventMap[K]) => void;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  private _playerId = '';
  private _roomId = '';
  private _connected = false;
  private _inGame = false;
  private _rtt = 0;
  private _lastPingTs = 0;

  private _serverUrl = '';
  private _playerName = '';
  private _pendingJoinRoomId: string | undefined;
  private _pendingAllowLateJoin = false;
  private _pendingHostConfig: HostedRoomConfig | null = null;
  private _reconnectAttempts = 0;
  private readonly _maxReconnectAttempts = 5;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  private _collisionAuthoritySystem: CollisionAuthorityAdapter | null = null;
  private _reconnectSuspended = false;
  private systemContext: SystemContext | null = null;

  private _incomingPacketTimes: number[] = [];
  private _outgoingPacketTimes: number[] = [];
  private _lastWorldDeltaAt = 0;
  private _interpolationDelayMs = 0;
  private _latencySimulationLabel = 'off';
  private _entitySyncCache: Map<string, Partial<WorldEntity>> = new Map();
  private _spawnDiagnosticsSeenPlayers = new Set<string>();
  private _lastLobbyState: LobbyState | null = null;
  private _lastRoundState: RoundState | null = null;
  private _lastAuthoritativeSnapshot: AuthoritativeSnapshotPayload | null = null;
  private _lastAuthoritativeSnapshotAt = 0;
  private _lastValidSnapshotTick: number | null = null;
  private _lastEmptySnapshotRecoveryAt = 0;
  private _pendingEmptySnapshotRecovery = false;
  private _recentIncoming: Array<{ receivedAt: number; type: string; parseOk: boolean; rawPreview: string }> = [];
  private _pendingJoinAppearance: Record<string, unknown> | null = null;
  private _pendingJoinArchetypeId: TropicalHorrorArchetypeId | null = null;
  private _identitySnapshot: { userId: string; isGuest: boolean; permissions: string[] } | null = null;

  on<K extends keyof EventMap>(event: K, callback: EventCallback<K>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(callback);
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<K>): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    for (const callback of callbacks) {
      (callback as EventCallback<K>)(data);
    }
  }

  async fetchServers(httpUrl: string): Promise<ServerInfo[]> {
    try {
      const response = await fetch(`${httpUrl}/servers`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return (json.servers ?? []) as ServerInfo[];
    } catch (error) {
      console.error('[MultiplayerClient] Failed to fetch servers', error);
      return [];
    }
  }

  joinRoom(wsUrl: string, playerName: string, roomId?: string, allowLateJoin = false): void {
    this._pendingHostConfig = null;
    this._pendingJoinRoomId = roomId;
    this._pendingAllowLateJoin = allowLateJoin;
    gameBus.emit('networkLifecycle', {
      source: 'MultiplayerClient',
      state: 'join_requested',
      detail: wsUrl,
      playerId: this._playerId,
      roomId: roomId ?? null,
    });
    this._connect(wsUrl, playerName, allowLateJoin);
  }

  setPendingJoinAppearance(appearance: Record<string, unknown> | null): void {
    this._pendingJoinAppearance = appearance ? { ...appearance } : null;
  }

  setPendingJoinArchetypeId(archetypeId: TropicalHorrorArchetypeId | null): void {
    this._pendingJoinArchetypeId = archetypeId;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this._collisionAuthoritySystem) {
      this._collisionAuthoritySystem = (ctx.systems.collisionAuthoritySystem as CollisionAuthorityAdapter | null | undefined) ?? null;
    }
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
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this._connected ? 'connected' : 'idle',
      active: this._connected,
      metrics: {
        playerId: this._playerId,
        roomId: this._roomId,
        inGame: this._inGame,
        reconnectAttempts: this._reconnectAttempts,
        hasCollisionAuthority: this._collisionAuthoritySystem !== null,
        hasSystemContext: this.systemContext !== null,
        ...this.getDebugStats(),
      },
    };
  }

  setCollisionAuthoritySystem(system: CollisionAuthorityAdapter | null): void {
    this._collisionAuthoritySystem = system;
  }

  hostRoom(wsUrl: string, playerName: string, config: HostedRoomConfig): void {
    this._pendingJoinRoomId = undefined;
    this._pendingAllowLateJoin = false;
    this._pendingHostConfig = config;
    gameBus.emit('networkLifecycle', {
      source: 'MultiplayerClient',
      state: 'host_requested',
      detail: wsUrl,
      playerId: this._playerId,
    });
    this._connect(wsUrl, playerName);
  }

  disconnect(): void {
    if (this._reconnectTimer) {
      Engine.timer.clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._stopPing();
    this._reconnectAttempts = this._maxReconnectAttempts;
    this._reconnectSuspended = true;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._inGame = false;
    this._resetSessionCaches();
    this.emit('disconnected', { reason: 'disconnected_by_client' });
    gameBus.emit('networkLifecycle', {
      source: 'MultiplayerClient',
      state: 'disconnected',
      playerId: this._playerId,
      roomId: this._roomId,
    });
  }

  dispose(): void {
    this.disconnect();
    this.listeners.clear();
    this._entitySyncCache.clear();
    this._spawnDiagnosticsSeenPlayers.clear();
    this._incomingPacketTimes.length = 0;
    this._outgoingPacketTimes.length = 0;
    this._recentIncoming.length = 0;
    this._pendingHostConfig = null;
    this._pendingJoinRoomId = undefined;
    this._pendingJoinAppearance = null;
    this._pendingJoinArchetypeId = null;
    this.systemContext = null;
    this._collisionAuthoritySystem = null;
  }

  sendMovementCommand(command: { seq: number; ts: number; input: InputState }): void {
    if (!this._connected || !this._inGame) return;
    this._send({
      type: 'PLAYER_INPUT',
      seq: command.seq,
      ts: command.ts,
      input: command.input,
    });
  }

  setReady(ready: boolean): void {
    this._send({ type: 'ACTION', action: 'LOBBY_READY', data: { ready } });
  }

  sendLobbyAction(action: string, data: Record<string, unknown>): void {
    this.emit('action_sent', { action, data });
    this._send({ type: 'ACTION', action, data });
  }

  sendGameplayCommand(command: string, data: Record<string, unknown>): void {
    this.emit('action_sent', { action: `gameplay:${command}`, data });
    
    // Track outgoing command for network sync debugging
    networkTrafficDebugger.trackOutgoing(
      'GAMEPLAY_COMMAND',
      data,
      command,
      this._playerId,
      (data.entityId as string | undefined) || undefined,
    );
    
    this._send({ type: 'GAMEPLAY_COMMAND', command, data });
  }

  /**
   * Broadcast local player avatar appearance to all peers in the room.
   * The server must handle ACTION: PLAYER_APPEARANCE and forward it as
   * PLAYER_APPEARANCE to all other clients.
   */
  sendAppearance(appearance: {
    modelVariant?: string;
    textureStyle?: string;
    bodyColor?: number;
    accentColor?: number;
    skinColor?: number;
    legColor?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    heightScale?: number;
    widthScale?: number;
  }): void {
    this._send({ type: 'ACTION', action: 'PLAYER_APPEARANCE', data: { appearance } });
  }

  /**
   * Additive sync hook for ability runtime state (cooldowns/tags/current cast).
   */
  sendAbilityStateSync(data: {
    abilityId: string;
    cooldown?: number;
    tags?: string[];
  }): void {
    this.sendLobbyAction('ABILITY_STATE_SYNC', {
      playerId: this._playerId,
      ...data,
    });
  }

  /**
   * Additive sync hook for inventory/equipment snapshots.
   */
  sendInventoryStateSync(data: {
    equipped?: string[];
    activeSlot?: string;
  }): void {
    this.sendLobbyAction('INVENTORY_STATE_SYNC', {
      playerId: this._playerId,
      ...data,
    });
  }

  /**
   * Additive sync hook for vitals channels (health/shield/mana).
   */
  sendAttributeStateSync(data: {
    health?: number;
    maxHealth?: number;
    shield?: number;
    maxShield?: number;
    mana?: number;
    maxMana?: number;
  }): void {
    this.sendLobbyAction('ATTRIBUTE_STATE_SYNC', {
      playerId: this._playerId,
      ...data,
    });
  }

  setMap(mapId: string): void {
    this._send({ type: 'ACTION', action: 'LOBBY_MAP', data: { mapId } });
  }

  setMode(mode: MultiplayerModeId): void {
    this._send({ type: 'ACTION', action: 'LOBBY_MODE', data: { mode } });
  }

  updateSettings(settings: Partial<HostedRoomConfig>): void {
    this._send({ type: 'ACTION', action: 'LOBBY_SETTINGS', data: settings });
  }

  sendDamage(targetId: string, amount = 25): void {
    this._send({ type: 'ACTION', action: 'PLAYER_DAMAGE', data: { targetId, amount } });
  }

  requestRespawn(): void {
    this._send({ type: 'ACTION', action: 'RESPAWN_REQUEST', data: {} });
  }

  requestFullSync(): void {
    this._send({ type: 'FULL_SYNC_REQ' });
  }

  sendWorldObjectPlace(obj: WorldObjectData): void {
    this._send({ type: 'ACTION', action: 'WORLD_OBJECT_PLACE', data: obj });
  }

  sendWorldObjectRemove(id: string): void {
    this._send({ type: 'ACTION', action: 'WORLD_OBJECT_REMOVE', data: { id } });
  }

  sendWorldObjectUpdate(obj: WorldObjectData): void {
    this._send({ type: 'ACTION', action: 'WORLD_OBJECT_UPDATE', data: obj });
  }

  get playerId(): string { return this._playerId; }
  get roomId(): string { return this._roomId; }
  get connected(): boolean { return this._connected; }
  get inGame(): boolean { return this._inGame; }
  get rtt(): number { return this._rtt; }
  get identitySnapshot(): { userId: string; isGuest: boolean; permissions: string[] } | null {
    return this._identitySnapshot
      ? {
          userId: this._identitySnapshot.userId,
          isGuest: this._identitySnapshot.isGuest,
          permissions: [...this._identitySnapshot.permissions],
        }
      : null;
  }
  getLastLobbyState(): LobbyState | null { return this._lastLobbyState ? { ...this._lastLobbyState, players: [...this._lastLobbyState.players] } : null; }
  getLastRoundState(): RoundState | null { return this._lastRoundState ? { ...this._lastRoundState } : null; }
  getLastAuthoritativeSnapshot(): AuthoritativeSnapshotPayload | null {
    return this._lastAuthoritativeSnapshot
      ? {
          ...this._lastAuthoritativeSnapshot,
          entities: this._lastAuthoritativeSnapshot.entities.map((entity) => ({ ...entity })),
          events: this._lastAuthoritativeSnapshot.events.map((event) => ({ ...event })),
          round: this._lastAuthoritativeSnapshot.round ? { ...this._lastAuthoritativeSnapshot.round } : undefined,
        }
      : null;
  }
  getLastAuthoritativeSnapshotAgeMs(): number | null {
    return this._lastAuthoritativeSnapshotAt > 0 ? Engine.time.now() - this._lastAuthoritativeSnapshotAt : null;
  }
  getLastValidSnapshotTick(): number | null {
    return this._lastValidSnapshotTick;
  }

  getServerHttpBaseUrl(): string | null {
    if (!this._serverUrl) return null;
    try {
      const parsed = new URL(this._serverUrl, window.location.href);
      parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  getProtocolDiagnostics(): MultiplayerProtocolDiagnostics {
    return {
      recentIncoming: this._recentIncoming.map((entry) => ({ ...entry })),
    };
  }

  setLatencySimulationLabel(label: string): void {
    this._latencySimulationLabel = label;
  }

  getDebugStats(): MultiplayerDebugStats {
    const now = Engine.time.now();
    this._incomingPacketTimes = this._incomingPacketTimes.filter((ts) => now - ts <= 1000);
    this._outgoingPacketTimes = this._outgoingPacketTimes.filter((ts) => now - ts <= 1000);
    if (this._lastWorldDeltaAt > 0) {
      this._interpolationDelayMs = now - this._lastWorldDeltaAt;
    }

    return {
      pingMs: this._rtt,
      packetsInPerSec: this._incomingPacketTimes.length,
      packetsOutPerSec: this._outgoingPacketTimes.length,
      latencySimulation: this._latencySimulationLabel,
      interpolationDelayMs: this._interpolationDelayMs,
    };
  }

  private _connect(wsUrl: string, playerName: string, allowLateJoin = false): void {
    if (this.ws) this.disconnect();

    this._serverUrl = wsUrl;
    this._playerName = playerName;
    this._playerId = `player_${Engine.time.now()}_${Engine.random.next().toString(36).slice(2, 6)}`;
    this._reconnectAttempts = 0;
    this._reconnectSuspended = false;
    this._doConnect(allowLateJoin);
  }

  private _getProtocolHandshake(): Record<string, unknown> {
    const collisionHandshake = this._collisionAuthoritySystem?.getHandshake();
    return {
      collisionAuthority: collisionHandshake
        ? {
            version: collisionHandshake.version,
            checksum: collisionHandshake.checksum,
          }
        : undefined,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    };
  }

  private _handleProtocolMismatch(message: string, code = 'PROTOCOL_MISMATCH'): void {
    this._reconnectSuspended = true;
    this._reconnectAttempts = this._maxReconnectAttempts;
    this.emit('error', { message, code });
    gameBus.emit('networkLifecycle', {
      source: 'MultiplayerClient',
      state: 'protocol_mismatch',
      detail: message,
      playerId: this._playerId,
      roomId: this._roomId,
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  private _validateServerProtocol(protocol: Record<string, unknown> | undefined): boolean {
    if (!protocol) return true;
    const snapshotSchemaVersion = typeof protocol.snapshotSchemaVersion === 'number'
      ? protocol.snapshotSchemaVersion
      : undefined;
    if (!isSupportedSnapshotSchema(snapshotSchemaVersion)) {
      this._handleProtocolMismatch(`Unsupported snapshot schema version: ${String(snapshotSchemaVersion)}`);
      return false;
    }

    const expectedCollision = this._collisionAuthoritySystem?.getHandshake();
    const serverCollision = protocol.collisionAuthority as Record<string, unknown> | undefined;
    if (expectedCollision && serverCollision) {
      const serverVersion = typeof serverCollision.version === 'number' ? serverCollision.version : undefined;
      const serverChecksum = typeof serverCollision.checksum === 'string' ? serverCollision.checksum : undefined;
      if (serverVersion !== expectedCollision.version || serverChecksum !== expectedCollision.checksum) {
        this._handleProtocolMismatch('Collision authority checksum mismatch');
        return false;
      }
    }

    return true;
  }

  private _buildWebSocketUrl(): string {
    const jwt = this._readStoredJwt();
    if (!jwt) {
      return this._serverUrl;
    }

    try {
      const parsed = new URL(this._serverUrl, window.location.href);
      parsed.searchParams.set('token', jwt);
      return parsed.toString();
    } catch {
      return this._serverUrl;
    }
  }

  private _readStoredJwt(): string | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      return window.localStorage.getItem('sdk.auth.jwt');
    } catch {
      return null;
    }
  }

  private _doConnect(allowLateJoin = this._pendingAllowLateJoin): void {
    try {
      this.ws = new WebSocket(this._buildWebSocketUrl());
    } catch (error) {
      this.emit('error', { message: `Connection failed: ${String(error)}` });
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this._reconnectAttempts = 0;
      logEvent('network', 'WebSocket connected');
      gameBus.emit('networkLifecycle', {
        source: 'MultiplayerClient',
        state: 'connected',
        playerId: this._playerId,
        roomId: this._roomId,
      });
      if (this._pendingHostConfig) {
        this._send({
          type: 'HOST_GAME',
          playerId: this._playerId,
          name: this._playerName,
          settings: this._pendingHostConfig,
          appearance: this._pendingJoinAppearance,
          archetypeId: this._pendingJoinArchetypeId,
          protocol: this._getProtocolHandshake(),
        });
      } else {
        this._send({
          type: 'PLAYER_JOIN',
          playerId: this._playerId,
          name: this._playerName,
          roomId: this._pendingJoinRoomId,
          allowLateJoin,
          appearance: this._pendingJoinAppearance,
          archetypeId: this._pendingJoinArchetypeId,
          protocol: this._getProtocolHandshake(),
        });
      }
      this._startPing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this._handleMessage(String(event.data));
    };

    this.ws.onclose = (event: CloseEvent) => {
      this._connected = false;
      this._inGame = false;
      this._stopPing();
      this._resetSessionCaches();
      const closeReason = event.reason || 'connection_closed';
      const closeCode = event.code ?? 0;
      logEvent('network', 'WebSocket disconnected', { closeCode, closeReason });
      console.warn('[MultiplayerClient] WebSocket closed', { closeCode, closeReason, wasClean: event.wasClean });
      const payload = { reason: closeReason, code: closeCode, wasClean: event.wasClean };
      const willReconnect = !this._reconnectSuspended && this._reconnectAttempts < this._maxReconnectAttempts;
      if (willReconnect) {
        this.emit('connection_lost', payload);
      } else {
        this.emit('disconnected', { reason: closeReason });
      }
      gameBus.emit('networkLifecycle', {
        source: 'MultiplayerClient',
        state: 'connection_closed',
        playerId: this._playerId,
        roomId: this._roomId,
        closeCode,
        closeReason,
        wasClean: event.wasClean,
      });
      if (!this._reconnectSuspended) {
        this._tryReconnect();
      }
    };

    this.ws.onerror = () => {
      logEvent('network', 'WebSocket error');
      this.emit('error', { message: 'WebSocket error' });
    };
  }

  private _handleMessage(raw: string): void {
    this._incomingPacketTimes.push(Engine.time.now());
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this._recordIncoming(raw, 'parse_error', false);
      return;
    }

    this._recordIncoming(raw, typeof msg?.type === 'string' ? msg.type : 'unknown', true);

    switch (msg.type) {
      case 'AUTH_CONTEXT': {
        const identitySnapshot = this._normalizeIdentitySnapshot(msg.identitySnapshot);
        if (!identitySnapshot) {
          break;
        }
        this._identitySnapshot = identitySnapshot;
        (window as any).__serverIdentitySnapshot = identitySnapshot;
        if (typeof (window as any).__applyServerIdentitySnapshot === 'function') {
          (window as any).__applyServerIdentitySnapshot(identitySnapshot, identitySnapshot.isGuest ? 'guest' : null);
        }
        this.emit('auth_context', {
          identitySnapshot,
          sessionId: typeof msg.sessionId === 'string' ? msg.sessionId : null,
        });
        break;
      }
      case 'LOBBY_UPDATE':
        this._lastLobbyState = msg.lobby as LobbyState;
        this.emit('lobby_update', msg.lobby as LobbyState);
        break;
      case 'JOIN_ACK':
        if (!this._validateServerProtocol(msg.protocol as Record<string, unknown> | undefined)) break;
        if (this._pendingJoinRoomId && msg.roomId !== this._pendingJoinRoomId) {
          console.warn('[MultiplayerClient] JOIN_ACK room mismatch; rejecting stale/foreign lobby ack', {
            expectedRoomId: this._pendingJoinRoomId,
            receivedRoomId: msg.roomId,
            playerId: msg.playerId,
          });
          this.emit('error', {
            message: 'Join acknowledgement did not match the requested room',
            code: 'JOIN_ROOM_MISMATCH',
          });
          this.disconnect();
          break;
        }
        this._applyIdentitySnapshot(msg.identitySnapshot);
        this._playerId = msg.playerId;
        this._roomId = msg.roomId;
        this._pendingJoinRoomId = msg.roomId;
        if (!this._connected) {
          this._connected = true;
        }
        logEvent('network', `JOIN_ACK ${this._roomId}`);
        console.log('[MultiplayerClient] JOIN_ACK', {
          playerId: this._playerId,
          roomId: this._roomId,
          hosted: msg.hosted,
          identitySnapshot: msg.identitySnapshot,
          protocol: msg.protocol,
        });
        this.emit('connected', { playerId: this._playerId, roomId: this._roomId, hosted: msg.hosted });
        break;
      case 'GAME_START':
        if (!this._validateServerProtocol(msg.protocol as Record<string, unknown> | undefined)) break;
        if (!msg.late) {
          const gameSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
          const expectedSessionId = this._roomId || this._pendingJoinRoomId || '';
          if (!expectedSessionId || gameSessionId !== expectedSessionId) {
            console.warn('[MultiplayerClient] Ignoring GAME_START due to session mismatch', {
              expectedSessionId,
              receivedSessionId: gameSessionId,
              late: !!msg.late,
              playerId: this._playerId,
            });
            this.emit('error', {
              message: 'Ignored GAME_START for mismatched or unknown room session',
              code: 'GAME_START_SESSION_MISMATCH',
            });
            break;
          }
          if (!this._playerId) {
            console.warn('[MultiplayerClient] Ignoring GAME_START because local player identity is not bound yet');
            this.emit('error', {
              message: 'Ignored GAME_START before JOIN_ACK identity binding completed',
              code: 'GAME_START_BEFORE_JOIN_ACK',
            });
            break;
          }
        }
        this._applyIdentitySnapshot(msg.identitySnapshot);
        this._inGame = true;
        this._entitySyncCache.clear();
        logEvent('network', `GAME_START ${msg.map ?? 'unknown'}`);
        console.log('[MultiplayerClient] GAME_START', {
          map: msg.map,
          mode: msg.mode,
          sessionId: msg.sessionId,
          late: !!msg.late,
          playerId: msg.playerId,
          identitySnapshot: msg.identitySnapshot,
          protocol: msg.protocol,
        });
        // Late join: server sends playerId + roomId directly in GAME_START
        if (msg.late) {
          this._playerId = msg.playerId ?? this._playerId;
          this._roomId   = msg.sessionId;
          this._pendingJoinRoomId = msg.sessionId;
          this._connected = true;
          this.emit('connected', { playerId: this._playerId, roomId: this._roomId, hosted: false });
        }
        this.emit('game_start', { map: msg.map, mode: msg.mode, sessionId: msg.sessionId, late: !!msg.late });
        break;
      case 'AUTHORITATIVE_SNAPSHOT':
        this._handleAuthoritativeSnapshot(msg);
        break;
      case 'FULL_SYNC_DATA': {
        const payload = this._normalizeSnapshotPayload(msg);
        console.log('[MultiplayerClient] FULL_SYNC_DATA', {
          localPlayerId: payload.localPlayerId,
          connectedPlayerId: this._playerId,
          roomId: this._roomId,
          tick: payload.tick,
          entityCount: payload.entities.length,
          hasRound: !!payload.round,
        });
        const shouldEmitAsAuthoritative = this._lastValidSnapshotTick == null
          || payload.tick > this._lastValidSnapshotTick;
        if (shouldEmitAsAuthoritative) {
          this._emitSnapshotPayload(payload);
        }
        const resolvedLocalPlayerId = typeof payload.localPlayerId === 'string'
          ? payload.localPlayerId
          : (this._playerId || null);
        const eventPayload = {
          playerId: resolvedLocalPlayerId,
          tick: payload.tick,
          ack: payload.ack,
          entityCount: payload.entities.length,
          timestamp: payload.timestamp ?? Engine.time.now(),
          entities: payload.entities.map((entity) => ({ ...entity })),
          localPlayerId: typeof payload.localPlayerId === 'string' ? payload.localPlayerId : undefined,
        };
        this.emit('full_sync_data', eventPayload);
        gameBus.emit('FULL_SYNC_DATA', {
          playerId: resolvedLocalPlayerId,
          tick: eventPayload.tick,
          entityCount: eventPayload.entityCount,
          timestamp: eventPayload.timestamp,
          entities: eventPayload.entities.map((entity) => ({ ...entity })),
          localPlayerId: eventPayload.localPlayerId ?? resolvedLocalPlayerId,
        });
        gameBus.emit('FULL_SYNC_READY', {
          tick: eventPayload.tick,
          entityCount: eventPayload.entityCount,
          timestamp: eventPayload.timestamp,
        });
        gameBus.emit('FORCE_SNAPSHOT', {
          source: 'full_sync_data',
          timestamp: eventPayload.timestamp,
          snapshot: this._toForcedNetworkSnapshot(payload),
        });
        break;
      }
      case 'INITIAL_MAP_SYNC': {
        const payload = {
          mapData: msg.mapData as InitialMapSyncPayload,
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Engine.time.now(),
        };
        this.emit('initial_map_sync', payload);
        gameBus.emit('INITIAL_MAP_SYNC', payload);
        break;
      }
      case 'ENTITY_SPAWNED': {
        const spawnEvent = {
          entityId: String(msg.entityId ?? ''),
          playerId: typeof msg.playerId === 'string' ? msg.playerId : null,
          position: msg.position as Vec3 | undefined,
          isPlayerControlled: typeof msg.isPlayerControlled === 'boolean' ? msg.isPlayerControlled : undefined,
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Engine.time.now(),
        };
        this.emit('entity_spawned', spawnEvent);
        gameBus.emit('ENTITY_SPAWNED', {
          ...spawnEvent,
          source: 'server_entity_spawned',
        });
        break;
      }
      case 'WORLD_DELTA':
        this._handleLegacyWorldDelta(msg);
        break;
      case 'PLAYER_LEAVE':
        this.emit('player_leave', { playerId: msg.playerId });
        break;
      case 'PLAYER_KILLED':
        this.emit('player_killed', { killerId: msg.killerId, targetId: msg.targetId, stats: msg.stats });
        break;
      case 'PLAYER_DIED':
        this.emit('player_died', { playerId: msg.playerId, killedBy: msg.killedBy });
        break;
      case 'PLAYER_RESPAWN':
        this.emit('player_respawn', { playerId: msg.playerId, position: msg.position });
        break;
      case 'PLAYER_SHOOT':
        this.emit('player_shoot', {
          shooterId: msg.shooterId,
          origin: msg.origin as Vec3,
          direction: msg.direction as Vec3,
          hitId: msg.hitId ?? null,
          weapon: msg.weapon ?? 'pistol',
        });
        break;
      case 'PLAYER_RELOAD':
        this.emit('player_reload', {
          playerId: msg.playerId as string,
          weaponId: (msg.weaponId as string) ?? 'pistol',
        });
        break;
      case 'PLAYER_EQUIP':
        this.emit('player_equip', {
          playerId: msg.playerId as string,
          weaponId: (msg.weaponId as string) ?? 'pistol',
          equipment: Array.isArray(msg.equipment) ? msg.equipment as string[] : [],
        });
        break;
      case 'ROUND_START':
        this._lastRoundState = msg.round as RoundState;
        this.emit('round_start', { round: msg.round as RoundState });
        break;
      case 'ROUND_END':
        this._lastRoundState = msg.round as RoundState;
        this.emit('round_end', { round: msg.round as RoundState, winner: msg.winner ?? null });
        break;
      case 'SCORE_UPDATE':
        this.emit('score_update', { players: msg.players ?? [] });
        break;
      case 'INVENTORY_SYNC':
        const inventorySyncPayload = { inventory: (msg.inventory ?? {}) as Record<string, unknown> };
        this.emit('inventory_sync', inventorySyncPayload);
        // BRIDGE to gameBus: Enable all domains (InventorySystem, UI, diagnostics, etc) to hear this event
        gameBus.emit('networkInventorySyncReceived', {
          inventory: inventorySyncPayload.inventory,
          timestamp: Engine.time.now(),
        });
        break;
      case 'INVENTORY_ERROR':
        const inventoryErrorPayload = { reason: (msg.reason as string) ?? 'unknown' };
        this.emit('inventory_error', inventoryErrorPayload);
        gameBus.emit('networkInventoryError', {
          reason: inventoryErrorPayload.reason,
          timestamp: Engine.time.now(),
        });
        break;
      case 'DAMAGE_TAKEN':
        this.emit('damage_taken', { amount: msg.amount, sourceId: msg.sourceId, health: msg.health, armor: msg.armor });
        break;
      case 'WORLD_OBJECT_PLACE':
        this.emit('world_object_place', { object: msg.object as WorldObjectData });
        break;
      case 'WORLD_OBJECT_REMOVE':
        this.emit('world_object_remove', { id: msg.id as string });
        break;
      case 'WORLD_OBJECT_UPDATE':
        this.emit('world_object_update', { object: msg.object as WorldObjectData });
        break;
      case 'WORLD_STATE':
        this.emit('world_state', { objects: (msg.objects ?? []) as WorldObjectData[] });
        break;
      case 'ABILITY_STATE_SYNC':
        this.emit('ability_state_sync', {
          playerId: msg.playerId as string,
          abilityId: msg.abilityId as string,
          cooldown: typeof msg.cooldown === 'number' ? msg.cooldown : undefined,
          tags: Array.isArray(msg.tags) ? msg.tags as string[] : undefined,
          movementIntent: this.parseMovementIntent(msg.movementIntent),
        });
        break;
      case 'AMMO_STATE_SYNC':
        this.emit('ammo_state_sync', {
          playerId: msg.playerId as string,
          weaponId: msg.weaponId as string,
          current: typeof msg.current === 'number' ? msg.current : undefined,
          max: typeof msg.max === 'number' ? msg.max : undefined,
          reserve: typeof msg.reserve === 'number' ? msg.reserve : undefined,
          isReloading: typeof msg.isReloading === 'boolean' ? msg.isReloading : undefined,
        });
        break;
      case 'INVENTORY_STATE_SYNC':
        this.emit('inventory_state_sync', {
          playerId: msg.playerId as string,
          equipped: Array.isArray(msg.equipped) ? msg.equipped as string[] : undefined,
          activeSlot: typeof msg.activeSlot === 'string' ? msg.activeSlot : undefined,
        });
        // BRIDGE to gameBus: Notify all domains of inventory state changes
        gameBus.emit('networkInventorySyncReceived', {
          inventory: {
            playerId: msg.playerId,
            equipped: msg.equipped,
            activeSlot: msg.activeSlot,
          },
          timestamp: Engine.time.now(),
        });
        break;
      case 'ATTRIBUTE_STATE_SYNC':
        this.emit('attribute_state_sync', {
          playerId: msg.playerId as string,
          health: typeof msg.health === 'number' ? msg.health : undefined,
          maxHealth: typeof msg.maxHealth === 'number' ? msg.maxHealth : undefined,
          shield: typeof msg.shield === 'number' ? msg.shield : undefined,
          maxShield: typeof msg.maxShield === 'number' ? msg.maxShield : undefined,
          mana: typeof msg.mana === 'number' ? msg.mana : undefined,
          maxMana: typeof msg.maxMana === 'number' ? msg.maxMana : undefined,
        });
        break;
      case 'PLAYER_APPEARANCE':
        // Broadcast from server when a peer changes their avatar appearance.
        if (typeof msg.playerId === 'string' && msg.appearance && typeof msg.appearance === 'object') {
          this.emit('player_appearance', {
            playerId: msg.playerId as string,
            appearance: msg.appearance as Record<string, unknown>,
          });
        }
        break;

      case 'SPAWN_AUTHORITY':
        // ─ AUTHORITY-BASED BINDING: Server confirms which entity belongs to which player
        if (typeof msg.playerId === 'string') {
          console.log('[MultiplayerClient] SPAWN_AUTHORITY received', {
            playerId: msg.playerId,
            entityId: msg.entityId,
            authority: msg.authority,
            timestamp: msg.timestamp,
            localPlayerId: this._playerId,
          });

          // ─ CRITICAL VALIDATION: Only accept SPAWN_AUTHORITY if playerId matches our local player ID.
          // In rare races, the authority packet may arrive before the JOIN_ACK has finished processing.
          if (msg.playerId === this._playerId || !this._playerId) {
            if (!this._playerId) {
              console.warn('[MultiplayerClient] SPAWN_AUTHORITY accepted before JOIN_ACK; assigning local playerId from authority packet', {
                receivedPlayerId: msg.playerId,
              });
              this._playerId = msg.playerId;
            }

            this.emit('spawn_authority', {
              playerId: msg.playerId,
              entityId: msg.entityId as string,
              authority: msg.authority,
              timestamp: msg.timestamp,
            });
            gameBus.emit('SPAWN_AUTHORITY_VALIDATED', {
              playerId: msg.playerId,
              entityId: msg.entityId,
              authority: msg.authority,
            });
          } else {
            console.warn('[MultiplayerClient] SPAWN_AUTHORITY rejected: playerId mismatch', {
              expectedPlayerId: this._playerId,
              receivedPlayerId: msg.playerId,
            });
          }
        }
        break;

      case 'COMMAND_AUTHORIZED':
        // Server validates and broadcasts back the authorized command to all clients
        // This ensures clients see their commands executed by the authoritative server
        networkTrafficDebugger.trackIncoming(
          'COMMAND_AUTHORIZED',
          msg.data ?? {},
          msg.command,
          msg.playerId,
          (msg.data?.entityId as string | undefined) || undefined,
        );
        gameBus.emit('networkLifecycle', {
          source: 'MultiplayerClient',
          state: 'command_authorized',
          detail: msg.command,
          playerId: msg.playerId,
        });
        break;

      case 'PONG': {
        const rtt = Engine.time.now() - Number(msg.clientTs ?? this._lastPingTs);
        this._rtt = rtt;
        this.emit('pong', { rtt });
        break;
      }
      case 'TICK_SYNC': {
        // Server broadcast: tells us current server tick and rate
        // We use this to keep interpolation timing in sync
        const serverTick = typeof msg.tick === 'number' ? msg.tick : null;
        const serverTimestamp = typeof msg.timestamp === 'number' ? msg.timestamp : null;
        const serverTickRate = typeof msg.targetTickRate === 'number' ? msg.targetTickRate : 60;
        if (serverTick !== null && serverTimestamp !== null) {
          this.emit('tick_sync', { tick: serverTick, timestamp: serverTimestamp, tickRate: serverTickRate });
        }
        break;
      }
      case 'ERROR':
        if (msg.code === 'PROTOCOL_MISMATCH') {
          this._handleProtocolMismatch(msg.message ?? 'Protocol mismatch', 'PROTOCOL_MISMATCH');
          break;
        }
        if (msg.code === 'ROOM_UNAVAILABLE' || msg.code === 'NO_ROOMS_AVAILABLE') {
          // Ensure failed lobby joins do not linger on a half-open socket.
          this._reconnectSuspended = true;
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }
        this.emit('error', { message: msg.message ?? 'Unknown server error', code: typeof msg.code === 'string' ? msg.code : undefined });
        break;
      default:
        break;
    }
  }

  private _normalizeIdentitySnapshot(value: unknown): { userId: string; isGuest: boolean; permissions: string[] } | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = value as { userId?: unknown; isGuest?: unknown; permissions?: unknown };
    if (typeof candidate.userId !== 'string') {
      return null;
    }

    return {
      userId: candidate.userId,
      isGuest: Boolean(candidate.isGuest),
      permissions: Array.isArray(candidate.permissions)
        ? candidate.permissions.filter((permission): permission is string => typeof permission === 'string')
        : [],
    };
  }

  private _applyIdentitySnapshot(value: unknown): void {
    const identitySnapshot = this._normalizeIdentitySnapshot(value);
    if (!identitySnapshot) {
      return;
    }

    this._identitySnapshot = identitySnapshot;
    (window as any).__serverIdentitySnapshot = identitySnapshot;
    if (typeof (window as any).__applyServerIdentitySnapshot === 'function') {
      (window as any).__applyServerIdentitySnapshot(identitySnapshot, identitySnapshot.isGuest ? 'guest' : null);
    }
  }

  private _recordIncoming(raw: string, type: string, parseOk: boolean): void {
    this._recentIncoming.push({
      receivedAt: Engine.time.now(),
      type,
      parseOk,
      rawPreview: raw.slice(0, 160),
    });
    while (this._recentIncoming.length > 20) {
      this._recentIncoming.shift();
    }
  }

  private _handleAuthoritativeSnapshot(msg: SnapshotEnvelope): void {
    if (!isSupportedSnapshotSchema(typeof msg.schemaVersion === 'number' ? msg.schemaVersion : undefined)) {
      this._handleProtocolMismatch(`Unsupported snapshot schema version: ${String(msg.schemaVersion)}`);
      return;
    }
    if (msg.deltaMode !== SNAPSHOT_DELTA_MODE) {
      this._handleProtocolMismatch(`Unsupported snapshot delta mode: ${String(msg.deltaMode)}`);
      return;
    }
    this._emitSnapshotPayload(this._normalizeSnapshotPayload(msg));
  }

  private _handleLegacyWorldDelta(msg: SnapshotEnvelope): void {
    this._emitSnapshotPayload(this._normalizeSnapshotPayload(msg));
  }

  private _normalizeSnapshotPayload(msg: SnapshotEnvelope): AuthoritativeSnapshotPayload {
    const entities = Array.isArray(msg.entities) ? msg.entities as WorldEntity[] : [];
    const round = msg.round && typeof msg.round === 'object' ? msg.round as RoundState : undefined;
    const events = Array.isArray(msg.events) ? msg.events as AuthoritativeGameplayEvent[] : [];

    return {
      tick: typeof msg.tick === 'number' ? msg.tick : 0,
      ack: typeof msg.ack === 'number' ? msg.ack : 0,
      lastProcessedInput: typeof (msg as { lastProcessedInput?: unknown }).lastProcessedInput === 'number'
        ? (msg as { lastProcessedInput: number }).lastProcessedInput
        : undefined,
      lastProcessedInputTick: typeof msg.lastProcessedInputTick === 'number' ? msg.lastProcessedInputTick : undefined,
      localPlayerId: typeof msg.localPlayerId === 'string' ? msg.localPlayerId : undefined,
      entities,
      round,
      events,
      timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : undefined,
    };
  }

  private _emitSnapshotPayload(payload: AuthoritativeSnapshotPayload): void {
    if (payload.entities.length === 0) {
      this._lastWorldDeltaAt = Engine.time.now();
      this._shouldRecoverFromEmptySnapshot(payload);
      return;
    }

    this._pendingEmptySnapshotRecovery = false;
    this._lastWorldDeltaAt = Engine.time.now();
    this._lastAuthoritativeSnapshot = {
      ...payload,
      entities: payload.entities.map((entity) => ({ ...entity })),
      events: payload.events.map((event) => ({ ...event })),
      round: payload.round ? { ...payload.round } : undefined,
    };
    this._lastAuthoritativeSnapshotAt = this._lastWorldDeltaAt;
    this._lastValidSnapshotTick = payload.tick;

    const playerEntities = payload.entities.filter((entity) => entity.type === 'player');
    for (const entity of playerEntities) {
      if (this._spawnDiagnosticsSeenPlayers.has(entity.id)) continue;
      this._spawnDiagnosticsSeenPlayers.add(entity.id);
      console.log('[SpawnDiagnostics] PLAYER SPAWN REQUEST', {
        source: 'multiplayer_client_snapshot',
        playerId: entity.id,
        type: entity.type,
        hasPosition: !!entity.position,
        hasRotation: !!entity.rotation,
        equipment: entity.equipment ?? [],
        activeWeaponId: entity.activeWeaponId ?? null,
      });
    }

    if (payload.round) {
      this._lastRoundState = payload.round;
    }

    this.emit('authoritative_snapshot', payload);

    for (const entity of payload.entities) {
      this._emitDerivedEntitySyncEvents(entity);
    }
    for (const event of payload.events) {
      this._emitAuthoritativeGameplayEvent(event);
    }
  }

  private _shouldRecoverFromEmptySnapshot(payload: AuthoritativeSnapshotPayload): void {
    if (payload.entities.length > 0) {
      this._pendingEmptySnapshotRecovery = false;
      return;
    }

    const lifecyclePhase = typeof window !== 'undefined'
      ? (window as any).lifecycleOrchestrator?.getPhase?.() ?? null
      : null;
    const snapshotLocalPlayerId = typeof payload.localPlayerId === 'string' ? payload.localPlayerId : null;
    const effectiveLocalPlayerId = snapshotLocalPlayerId ?? (this._playerId || null);
    const lastSnapshotHadLocalPlayer = !!effectiveLocalPlayerId && !!this._lastAuthoritativeSnapshot?.entities.some(
      (entity) => entity.id === effectiveLocalPlayerId || entity.isPlayerControlled === true,
    );
    const hasCommittedNonEmptySnapshot = (this._lastAuthoritativeSnapshot?.entities.length ?? 0) > 0;
    const entityMapDiverged = this._inGame
      && !!effectiveLocalPlayerId
      && (
        snapshotLocalPlayerId === this._playerId
        || snapshotLocalPlayerId === null
        || lastSnapshotHadLocalPlayer
        || this._entitySyncCache.size > 0
      );
    const now = Engine.time.now();

    if (hasCommittedNonEmptySnapshot) {
      return;
    }

    if (
      entityMapDiverged
      && !this._pendingEmptySnapshotRecovery
      && now - this._lastEmptySnapshotRecoveryAt >= 750
    ) {
      this._lastEmptySnapshotRecoveryAt = now;
      this._pendingEmptySnapshotRecovery = true;
      console.warn('[SnapshotReconciliation] Empty snapshot diverged from local entity map; requesting FULL_SYNC_REQ', {
        tick: payload.tick,
        ack: payload.ack,
        lifecyclePhase,
        playerId: this._playerId || null,
        snapshotLocalPlayerId,
        lastSnapshotHadLocalPlayer,
        cachedEntityCount: this._entitySyncCache.size,
        timestamp: now,
      });
      this.requestFullSync();
      return;
    }

    console.info('[SnapshotReconciliation] Empty snapshot received, maintaining current world state', {
      tick: payload.tick,
      ack: payload.ack,
      lifecyclePhase,
      playerId: this._playerId || null,
      snapshotLocalPlayerId,
      entityMapDiverged,
      timestamp: now,
      reason: entityMapDiverged
        ? 'Full sync request already throttled; preserving current state until reply arrives'
        : 'Empty snapshot is normal; server entity relevance filtering at work',
    });
  }

  private _toForcedNetworkSnapshot(payload: AuthoritativeSnapshotPayload): {
    tick: number;
    timestamp: number;
    ackInputSeq: number;
    lastProcessedInput?: number;
    lastProcessedInputTick?: number;
    entities: Array<{
      entityId: string;
      tick: number;
      transform?: {
        position: Vec3;
        rotation: Vec3;
      };
      velocity?: Vec3;
      replicated?: Record<string, unknown>;
    }>;
  } {
    return {
      tick: payload.tick,
      timestamp: payload.timestamp ?? Engine.time.now(),
      ackInputSeq: payload.ack,
      ...(typeof payload.lastProcessedInput === 'number' && { lastProcessedInput: payload.lastProcessedInput }),
      ...(typeof payload.lastProcessedInputTick === 'number' && { lastProcessedInputTick: payload.lastProcessedInputTick }),
      entities: payload.entities
        .filter((entity) => entity.position && entity.rotation)
        .map((entity) => ({
          entityId: entity.id,
          tick: payload.tick,
          transform: entity.position && entity.rotation
            ? {
                position: entity.position,
                rotation: entity.rotation,
              }
            : undefined,
          velocity: entity.velocity,
          replicated: {
            ...(entity.isPlayerControlled !== undefined && { isPlayerControlled: entity.isPlayerControlled }),
            movementState: {
              ...(entity.isCrouching !== undefined && { isCrouching: entity.isCrouching === true }),
              ...(entity.isGrounded !== undefined && { isGrounded: entity.isGrounded === true }),
              ...(entity.isAirborne !== undefined && { isAirborne: entity.isAirborne === true }),
            },
          },
        })),
    };
  }

  private _emitDerivedEntitySyncEvents(entity: WorldEntity): void {
    const previous: Partial<WorldEntity> = this._entitySyncCache.get(entity.id) ?? {};
    const merged: WorldEntity = { ...previous, ...entity };
    this._entitySyncCache.set(entity.id, merged);

    const equipmentChanged = JSON.stringify(merged.equipment ?? []) !== JSON.stringify(previous.equipment ?? []);
    const activeWeaponChanged = merged.activeWeaponId !== previous.activeWeaponId;
    if ((equipmentChanged || activeWeaponChanged) && merged.activeWeaponId) {
      this.emit('inventory_state_sync', {
        playerId: entity.id,
        equipped: merged.equipment,
        activeSlot: merged.activeWeaponId,
      });
    }

    const ammoChanged = merged.currentAmmo !== previous.currentAmmo
      || merged.reserveAmmo !== previous.reserveAmmo
      || merged.isReloading !== previous.isReloading
      || merged.activeWeaponId !== previous.activeWeaponId;
    if (ammoChanged && merged.activeWeaponId) {
      this.emit('ammo_state_sync', {
        playerId: entity.id,
        weaponId: merged.activeWeaponId,
        current: merged.currentAmmo,
        reserve: merged.reserveAmmo,
        isReloading: merged.isReloading,
      });
    }

    const vitalsChanged = merged.health !== previous.health
      || merged.maxHealth !== previous.maxHealth
      || merged.shield !== previous.shield
      || merged.maxShield !== previous.maxShield
      || merged.mana !== previous.mana
      || merged.maxMana !== previous.maxMana;
    if (vitalsChanged) {
      this.emit('attribute_state_sync', {
        playerId: entity.id,
        health: merged.health,
        maxHealth: merged.maxHealth,
        shield: merged.shield,
        maxShield: merged.maxShield,
        mana: merged.mana,
        maxMana: merged.maxMana,
      });
    }
  }

  private _emitAuthoritativeGameplayEvent(event: AuthoritativeGameplayEvent): void {
    switch (event.type) {
      case 'weapon_equip':
        this.emit('player_equip', {
          playerId: event.playerId ?? '',
          weaponId: event.weaponId ?? 'pistol',
          equipment: event.equipment ?? [],
        });
        break;
      case 'weapon_reload':
        this.emit('player_reload', {
          playerId: event.playerId ?? '',
          weaponId: event.weaponId ?? 'pistol',
        });
        break;
      case 'player_shoot':
        this.emit('player_shoot', {
          shooterId: event.shooterId ?? event.playerId ?? '',
          origin: event.origin ?? { x: 0, y: 0, z: 0 },
          direction: event.direction ?? { x: 0, y: 0, z: -1 },
          hitId: event.hitId ?? null,
          weapon: event.weaponId ?? 'pistol',
        });
        break;
      case 'use_ability':
        if (!event.playerId || !event.abilityId) break;
        this.emit('ability_state_sync', {
          playerId: event.playerId,
          abilityId: event.abilityId,
          cooldown: event.cooldown,
          movementIntent: event.movementIntent,
        });
        break;
      default:
        break;
    }
  }

  private _tryReconnect(): void {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) return;
    this._reconnectAttempts += 1;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 10000);
    this._reconnectTimer = Engine.timer.setTimeout(() => {
      gameBus.emit('networkLifecycle', {
        source: 'MultiplayerClient',
        state: 'reconnect_attempt',
        detail: String(this._reconnectAttempts),
        playerId: this._playerId,
        roomId: this._roomId,
      });
      this._doConnect();
    }, delay);
  }

  private _resetSessionCaches(): void {
    this._entitySyncCache.clear();
    this._lastLobbyState = null;
    this._lastRoundState = null;
    this._lastAuthoritativeSnapshot = null;
    this._lastAuthoritativeSnapshotAt = 0;
    this._lastValidSnapshotTick = null;
    this._lastEmptySnapshotRecoveryAt = 0;
    this._pendingEmptySnapshotRecovery = false;
    this._recentIncoming = [];
    this._incomingPacketTimes = [];
    this._outgoingPacketTimes = [];
    this._lastWorldDeltaAt = 0;
    this._interpolationDelayMs = 0;
  }

  private _startPing(): void {
    this._stopPing();
    this._pingInterval = Engine.timer.setInterval(() => {
      this._lastPingTs = Engine.time.now();
      this._send({ type: 'PING', ts: this._lastPingTs });
    }, 2000);
  }

  private _stopPing(): void {
    if (this._pingInterval) {
      Engine.timer.clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  private parseMovementIntent(raw: unknown): { horizontalImpulse: number; direction: Vec3 } | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const candidate = raw as {
      horizontalImpulse?: unknown;
      direction?: Partial<Vec3>;
    };
    if (typeof candidate.horizontalImpulse !== 'number') return undefined;
    const direction = candidate.direction;
    if (!direction || typeof direction.x !== 'number' || typeof direction.y !== 'number' || typeof direction.z !== 'number') {
      return undefined;
    }
    return {
      horizontalImpulse: candidate.horizontalImpulse,
      direction: { x: direction.x, y: direction.y, z: direction.z },
    };
  }

  private _send(message: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._outgoingPacketTimes.push(Engine.time.now());
      this.ws.send(JSON.stringify(message));
    }
  }
}