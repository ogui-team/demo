import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  getTropicalHorrorArchetype,
  type TropicalHorrorArchetypeId,
} from '@engine/2-systems/ArchetypeDefinitions';
import type { Vector3 as Vec3 } from '@shared/contracts';
import type { GameModeId, RoundStatus, RoundPhase, RoundState } from '@shared/contracts';
export type { GameModeId, RoundStatus, RoundPhase, RoundState };

export interface PlayerRuntimeState {
  id: string;
  name: string;
  health: number;
  kills: number;
  deaths: number;
  level: number;
  exp: number;
  ping: number;
  equipment: string[];
  archetypeId: TropicalHorrorArchetypeId;
  archetypeName: string;
  dead: boolean;
  position: Vec3;
  rotation: Vec3;
}

export interface ScoreboardState {
  mode: GameModeId;
  round: RoundState | null;
  players: PlayerRuntimeState[];
}

export function createDefaultRoundState(): RoundState {
  return {
    mode: 'ffa',
    status: 'warmup',
    phase: 'waiting',
    roundNumber: 0,
    killLimit: 10,
    timeRemainingMs: 0,
    startedAt: 0,
    endsAt: 0,
    winnerId: null,
    reason: null,
  };
}

export function createDefaultPlayerState(id: string, name = id): PlayerRuntimeState {
  const archetype = getTropicalHorrorArchetype(DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID);
  return {
    id,
    name,
    health: archetype.stats.maxHealth,
    kills: 0,
    deaths: 0,
    level: 1,
    exp: 0,
    ping: 0,
    equipment: [...archetype.spawn.weapons],
    archetypeId: archetype.id,
    archetypeName: archetype.displayName,
    dead: false,
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

export function sortPlayersForScoreboard(players: PlayerRuntimeState[]): PlayerRuntimeState[] {
  return [...players].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    if (b.level !== a.level) return b.level - a.level;
    return a.name.localeCompare(b.name);
  });
}