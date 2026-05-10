import { WebSocket } from 'ws';
import type { TropicalHorrorArchetypeId, Vector3 as Vec3, LobbyStatus, GameModeId, RoundStatus, GamePhase, RoundState } from '@shared/contracts';
export type { Vec3, LobbyStatus, GameModeId, RoundStatus, GamePhase, RoundState };

export interface RoomCreateOptions {
  name?: string;
  map?: string;
  mode?: GameModeId;
  maxPlayers?: number;
  killLimit?: number;
  roundDurationSec?: number;
  spawnPoints?: Vec3[];
}

export interface LobbyPlayerState {
  id: string;
  name: string;
  ping: number;
  ready: boolean;
  isHost: boolean;
  ws: WebSocket;
  appearance?: Record<string, unknown> | null;
  archetypeId: TropicalHorrorArchetypeId;
}

export interface LobbyRoom {
  id: string;
  name: string;
  players: Map<string, LobbyPlayerState>;
  selectedMap: string;
  selectedMode: GameModeId;
  status: LobbyStatus;
  countdown: number;
  hostId: string;
  maxPlayers: number;
  killLimit: number;
  roundDurationSec: number;
  spawnPoints: Vec3[];
}

const DEFAULT_SPAWN_POINTS: Vec3[] = [
  { x: 0, y: 1, z: 0 },
  { x: 8, y: 1, z: 0 },
  { x: -8, y: 1, z: 0 },
  { x: 0, y: 1, z: 8 },
  { x: 0, y: 1, z: -8 },
  { x: 6, y: 1, z: 6 },
  { x: -6, y: 1, z: -6 },
  { x: 6, y: 1, z: -6 },
];

function createCircularSpawnPoints(radius: number): Vec3[] {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      y: 1,
      z: Math.sin(angle) * radius,
    };
  });
}

const DEFAULT_ARENA_SPAWN_POINTS: Vec3[] = createCircularSpawnPoints(16);

const FOREST_ARENA_SPAWN_POINTS: Vec3[] = createCircularSpawnPoints(24);

export function getDefaultSpawnPointsForMap(mapId: string): Vec3[] {
  switch (mapId) {
    case 'forest_arena':
      return FOREST_ARENA_SPAWN_POINTS.map((point) => ({ ...point }));
    case 'map_default':
      return DEFAULT_ARENA_SPAWN_POINTS.map((point) => ({ ...point }));
    default:
      return DEFAULT_SPAWN_POINTS.map((point) => ({ ...point }));
  }
}