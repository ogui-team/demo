import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { AuthoritativeSnapshotPayload, LobbyState, MultiplayerEventSource, WorldEntity } from '../../../3-network/network/MultiplayerContracts';
import { gameBus } from '@engine/1-kernel/core/public-api';
import {
  createDefaultPlayerState,
  createDefaultRoundState,
  PlayerRuntimeState,
  RoundPhase,
  RoundState,
  sortPlayersForScoreboard,
} from './PlayerState';
import { getTropicalHorrorArchetype, type TropicalHorrorArchetypeId } from '@engine/2-systems/ArchetypeDefinitions';

export type GameLifecycleState = 'idle' | 'lobby' | 'loading' | 'active' | 'round_over';

type GameModeEventMap = {
  player_killed: { killerId: string; targetId: string };
  player_died: { playerId: string; killedBy: string };
  round_start: { round: RoundState };
  round_end: { round: RoundState; winnerId: string | null };
  round_phase_changed: { round: RoundState; previousPhase: RoundPhase | null; nextPhase: RoundPhase };
  score_update: { players: PlayerRuntimeState[] };
  lifecycle_state_changed: { state: GameLifecycleState; previousState: GameLifecycleState; reason: string };
  initialize_round: { round: RoundState; reason: 'round_start' | 'snapshot_active' };
};

type Listener<K extends keyof GameModeEventMap> = (payload: GameModeEventMap[K]) => void;

interface GameModeStateStoreAdapter {
  update(patch: Record<string, unknown>): void;
}

export class GameModeManager {
  private stateManager: GameModeStateStoreAdapter;
  private currentMode: 'ffa' | 'horde' | 'drift_bomb' = 'ffa';
  private currentRound: RoundState = createDefaultRoundState();
  private players: Map<string, PlayerRuntimeState> = new Map();
  private listeners: Map<string, Set<Function>> = new Map();
  private client: MultiplayerEventSource | null = null;
  private disposers: Array<() => void> = [];
  private lifecycleState: GameLifecycleState = 'idle';
  private lastInitializeKey: string | null = null;
  private systemContext: SystemContext | null = null;

  constructor(stateManager: GameModeStateStoreAdapter) {
    this.stateManager = stateManager;
    this._commitState();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.client) {
      this.attachClient(this.resolveContextClient());
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  attachClient(client: MultiplayerEventSource | null = this.resolveContextClient()): void {
    if (!client || client === this.client) return;

    this.detachClient();
    this.client = client;

    const onConnected = (): void => {
      this._setLifecycleState('lobby', 'connected');
    };
    const onDisconnected = (): void => {
      this.players.clear();
      this.currentRound = createDefaultRoundState();
      this.lastInitializeKey = null;
      this._commitState();
      this._setLifecycleState('idle', 'disconnected');
    };
    const onLobby = (lobby: LobbyState): void => this._applyLobbyState(lobby);
    const onGameStart = (): void => {
      this._setLifecycleState('loading', 'game_start');
    };
    const onSnapshot = (payload: AuthoritativeSnapshotPayload): void => {
      this._applyWorldEntities(payload.entities);
      if (payload.round) {
        if (payload.round.phase === 'in_round' && this.currentRound.phase !== 'in_round') {
          this._emitInitializeRound(payload.round, 'snapshot_active');
        }
        const shouldEmitStart = this.currentRound.phase !== 'in_round' && payload.round.phase === 'in_round';
        this._setRound(payload.round, shouldEmitStart);
      }
    };
    const onRoundStart = (payload: { round?: RoundState }): void => {
      const round = payload.round ?? this.currentRound;
      if (round.phase === 'in_round') {
        this._emitInitializeRound(round, 'round_start');
        this.startRound(round);
        return;
      }
      this._setRound(round, false);
    };
    const onRoundEnd = (payload: { round?: RoundState; winner?: { id?: string } | null }): void => {
      const round = payload.round ?? this.currentRound;
      this.endRound(round, payload.winner?.id ?? round.winnerId ?? null);
    };
    const onScoreUpdate = (payload: { players: PlayerRuntimeState[] }): void => this._applyScoreUpdate(payload.players);
    const onPlayerKilled = (payload: { killerId: string; targetId: string }): void => {
      this.emit('player_killed', payload);
    };
    const onPlayerLeave = (payload: { playerId: string }): void => {
      this.players.delete(payload.playerId);
      this._commitState();
    };
    const onPlayerDied = (payload: { playerId: string; killedBy: string }): void => {
      const player = this.players.get(payload.playerId);
      if (player) {
        this.players.set(payload.playerId, { ...player, dead: true, health: 0 });
        this._commitState();
      }
      this.emit('player_died', payload);
    };
    const onPlayerRespawn = (payload: { playerId: string; position: { x: number; y: number; z: number } }): void => {
      const player = this.players.get(payload.playerId);
      if (player) {
        this.players.set(payload.playerId, {
          ...player,
          dead: false,
          health: 100,
          position: { ...payload.position },
        });
        this._commitState();
      }
    };
    const onPlayerEquip = (payload: { playerId: string; weaponId: string; equipment: string[] }): void => {
      const player = this.players.get(payload.playerId);
      if (!player) return;
      this.players.set(payload.playerId, {
        ...player,
        equipment: payload.equipment.length > 0 ? [...payload.equipment] : [payload.weaponId, ...player.equipment.filter((id) => id !== payload.weaponId)],
      });
      this._commitState();
    };
    const onPong = (payload: { rtt: number }): void => {
      const localPlayer = this.client?.playerId ? this.players.get(this.client.playerId) : null;
      if (localPlayer && this.client) {
        this.players.set(localPlayer.id, { ...localPlayer, ping: payload.rtt });
        this._commitState();
      }
    };

    client.on('connected', onConnected);
    client.on('disconnected', onDisconnected);
    client.on('lobby_update', onLobby);
    client.on('game_start', onGameStart);
    client.on('authoritative_snapshot', onSnapshot);
    client.on('round_start', onRoundStart);
    client.on('round_end', onRoundEnd);
    client.on('score_update', onScoreUpdate);
    client.on('player_killed', onPlayerKilled);
    client.on('player_leave', onPlayerLeave);
    client.on('player_died', onPlayerDied);
    client.on('player_respawn', onPlayerRespawn);
    client.on('player_equip', onPlayerEquip);
    client.on('pong', onPong);

    this.disposers.push(
      () => client.off('connected', onConnected),
      () => client.off('disconnected', onDisconnected),
      () => client.off('lobby_update', onLobby),
      () => client.off('game_start', onGameStart),
      () => client.off('authoritative_snapshot', onSnapshot),
      () => client.off('round_start', onRoundStart),
      () => client.off('round_end', onRoundEnd),
      () => client.off('score_update', onScoreUpdate),
      () => client.off('player_killed', onPlayerKilled),
      () => client.off('player_leave', onPlayerLeave),
      () => client.off('player_died', onPlayerDied),
      () => client.off('player_respawn', onPlayerRespawn),
      () => client.off('player_equip', onPlayerEquip),
      () => client.off('pong', onPong),
    );
  }

  startRound(round?: RoundState): void {
    this._setRound(round ?? { ...this.currentRound, status: 'active', phase: 'in_round' }, true);
  }

  endRound(round?: RoundState, winnerId: string | null = null): void {
    const nextRound: RoundState = {
      ...(round ?? this.currentRound),
      status: 'ended',
      phase: 'round_end',
      winnerId,
    };
    this._setRound(nextRound, false);
    this.emit('round_end', { round: nextRound, winnerId });
  }

  restartRound(round?: RoundState): void {
    this.startRound(round ?? { ...this.currentRound, status: 'active', phase: 'in_round' });
  }

  getPlayers(): PlayerRuntimeState[] {
    return sortPlayersForScoreboard(Array.from(this.players.values()));
  }

  getPlayer(id: string): PlayerRuntimeState | undefined {
    return this.players.get(id);
  }

  setPlayerArchetype(playerId: string, archetypeId: TropicalHorrorArchetypeId): void {
    const current = this.players.get(playerId) ?? createDefaultPlayerState(playerId, playerId);
    const archetype = getTropicalHorrorArchetype(archetypeId);
    this.players.set(playerId, {
      ...current,
      archetypeId: archetype.id,
      archetypeName: archetype.displayName,
      equipment: current.equipment.length > 0 ? current.equipment : [...archetype.spawn.weapons],
    });
    this._commitState();
  }

  getRound(): RoundState {
    return { ...this.currentRound };
  }

  getLifecycleState(): GameLifecycleState {
    return this.lifecycleState;
  }

  resetSessionState(reason = 'runtime_reset'): void {
    this.players.clear();
    this.currentRound = createDefaultRoundState();
    this.lastInitializeKey = null;
    this._commitState();
    this._setLifecycleState('idle', reason);
  }

  on<K extends keyof GameModeEventMap>(event: K, listener: Listener<K>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
  }

  off<K extends keyof GameModeEventMap>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener);
  }

  destroy(): void {
    this.detachClient();
    this.listeners.clear();
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      lifecycleState: this.lifecycleState,
      roundStatus: this.currentRound.status,
      roundNumber: this.currentRound.roundNumber,
      playerCount: this.players.size,
      hasClient: this.client !== null,
      hasSystemContext: this.systemContext !== null,
      listenerGroups: this.listeners.size,
      trackedPlayerIds: [...this.players.keys()].slice(0, 16),
    };
  }

  private emit<K extends keyof GameModeEventMap>(event: K, payload: GameModeEventMap[K]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      (listener as Listener<K>)(payload);
    }
  }

  private detachClient(): void {
    while (this.disposers.length > 0) {
      this.disposers.pop()?.();
    }
    this.client = null;
  }

  private resolveContextClient(): MultiplayerEventSource | null {
    return (this.systemContext?.network.getClient() as MultiplayerEventSource | null) ?? null;
  }

  private _applyLobbyState(lobby: LobbyState): void {
    const nextPlayers = new Map<string, PlayerRuntimeState>();
    for (const player of lobby.players) {
      const current = this.players.get(player.id) ?? createDefaultPlayerState(player.id, player.name);
      nextPlayers.set(player.id, {
        ...current,
        name: player.name,
        ping: player.ping,
      });
    }
    this.players = nextPlayers;
    if (lobby.status === 'in_game' || lobby.countdown > 0) {
      this._setLifecycleState('loading', lobby.status === 'in_game' ? 'lobby_in_game' : 'lobby_countdown');
    } else {
      this._setLifecycleState('lobby', 'lobby_update');
    }
    this._commitState();
  }

  private _applyWorldEntities(entities: WorldEntity[]): void {
    for (const entity of entities) {
      if (!entity.id) continue;
      const current = this.players.get(entity.id) ?? createDefaultPlayerState(entity.id, entity.name ?? entity.id);
      this.players.set(entity.id, {
        ...current,
        name: entity.name ?? current.name,
        health: entity.health ?? current.health,
        kills: typeof entity.kills === 'number' ? entity.kills : current.kills,
        deaths: typeof entity.deaths === 'number' ? entity.deaths : current.deaths,
        level: typeof entity.level === 'number' ? entity.level : current.level,
        exp: typeof entity.exp === 'number' ? entity.exp : current.exp,
        ping: typeof entity.ping === 'number' ? entity.ping : current.ping,
        equipment: Array.isArray(entity.equipment) ? [...entity.equipment] as string[] : current.equipment,
        dead: typeof entity.dead === 'boolean' ? entity.dead : current.dead,
        position: entity.position ? { ...entity.position } : current.position,
        rotation: entity.rotation ? { ...entity.rotation } : current.rotation,
      });
    }
    this._commitState();
  }

  private _applyScoreUpdate(players: PlayerRuntimeState[]): void {
    for (const player of players) {
      const current = this.players.get(player.id) ?? createDefaultPlayerState(player.id, player.name);
      this.players.set(player.id, {
        ...current,
        ...player,
        equipment: [...player.equipment],
        position: { ...player.position },
        rotation: { ...player.rotation },
      });
    }
    const sortedPlayers = this.getPlayers();
    this._commitState();
    this.emit('score_update', { players: sortedPlayers });
  }

  private _setRound(round: RoundState, emitStart: boolean): void {
    const previousPhase = this.currentRound.phase ?? null;
    this.currentRound = { ...round };
    this.currentMode = round.mode;
    if (round.phase === 'starting') {
      this._setLifecycleState('loading', 'round_prepare');
    } else if (round.phase === 'in_round' || round.status === 'active') {
      this._setLifecycleState('active', emitStart ? 'round_start' : 'round_sync');
    } else if (round.phase === 'round_end' || round.status === 'ended') {
      this._setLifecycleState('round_over', 'round_end');
    }
    this._commitState();
    if (previousPhase !== round.phase) {
      this.emit('round_phase_changed', {
        round: { ...this.currentRound },
        previousPhase,
        nextPhase: round.phase,
      });
    }
    if (emitStart) {
      this.emit('round_start', { round: this.currentRound });
    }
  }

  private _emitInitializeRound(round: RoundState, reason: 'round_start' | 'snapshot_active'): void {
    const key = `${round.roundNumber}:${round.startedAt}:${round.phase}`;
    if (this.lastInitializeKey === key) return;
    this.lastInitializeKey = key;
    this._setLifecycleState('loading', reason);
    this.emit('initialize_round', { round: { ...round }, reason });
  }

  private _setLifecycleState(state: GameLifecycleState, reason: string): void {
    if (this.lifecycleState === state) return;
    const previousState = this.lifecycleState;
    this.lifecycleState = state;
    gameBus.emit('ROUND_TRANSITION', {
      from: previousState,
      to: state,
      reason,
      roundNumber: this.currentRound.roundNumber,
    });
    this.emit('lifecycle_state_changed', { state, previousState, reason });
  }

  private _commitState(): void {
    // Controller-owned game.* publication was removed from GameModeManager.
  }
}
