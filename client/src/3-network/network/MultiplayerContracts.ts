import type { TropicalHorrorArchetypeId, Vector3 as Vec3 } from '@shared/contracts';
import type { PlayerRuntimeState, RoundState } from '../../2-systems/gameplay/game/PlayerState';
import type { StatusMovementModifier } from './MovementModifierContracts';

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
  statusMovementModifier?: StatusMovementModifier;
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
  timestamp?: number;
}

export interface AuthoritativeSnapshotPayload {
  tick: number;
  ack: number;
  lastProcessedInput?: number;
  lastProcessedInputTick?: number;
  entities: WorldEntity[];
  round?: RoundState;
  events: AuthoritativeGameplayEvent[];
  timestamp?: number;
}

export interface WorldObjectData {
  id: string;
  entityType: string;
  position: Vec3;
  rotation: Vec3;
  renderData: {
    meshType: string;
    color: number;
    geometry: Record<string, unknown>;
  };
}

export interface GameplayCommandTransport {
  connected?: boolean;
  sendGameplayCommand(type: string, payload: Record<string, unknown>): void;
}

export interface MultiplayerEventMap {
  connected: { playerId: string; roomId: string; hosted?: boolean };
  disconnected: { reason: string };
  lobby_update: LobbyState;
  game_start: { map: string; mode: string; sessionId: string; late?: boolean };
  authoritative_snapshot: AuthoritativeSnapshotPayload;
  player_leave: { playerId: string };
  player_killed: { killerId: string; targetId: string; stats?: unknown };
  player_died: { playerId: string; killedBy: string };
  player_respawn: { playerId: string; position: Vec3 };
  player_shoot: { shooterId: string; origin: Vec3; direction: Vec3; hitId: string | null; weapon: string };
  player_reload: { playerId: string; weaponId: string };
  player_equip: { playerId: string; weaponId: string; equipment: string[] };
  round_start: { round: RoundState };
  round_end: { round: RoundState; winner?: { id?: string } | null };
  score_update: { players: PlayerRuntimeState[] };
  pong: { rtt: number };
  world_object_place: { object: WorldObjectData };
  world_object_update: { object: WorldObjectData };
  world_object_remove: { id: string };
  world_state: { objects: WorldObjectData[] };
}

export interface MultiplayerEventSource extends GameplayCommandTransport {
  playerId?: string;
  on<K extends keyof MultiplayerEventMap>(event: K, listener: (payload: MultiplayerEventMap[K]) => void): void;
  off<K extends keyof MultiplayerEventMap>(event: K, listener: (payload: MultiplayerEventMap[K]) => void): void;
}

export interface WorldObjectTransport extends MultiplayerEventSource {
  sendWorldObjectPlace(object: WorldObjectData): void;
  sendWorldObjectUpdate(object: WorldObjectData): void;
  sendWorldObjectRemove(id: string): void;
}