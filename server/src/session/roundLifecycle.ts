import { type LobbyRoom, type RoundState, type Vec3 } from '../sessionContracts';

type RoundEndReason = NonNullable<RoundState['reason']>;

interface ScoreSummaryPlayer {
  id: string;
  name: string;
  health: number;
  armor: number;
  kills: number;
  deaths: number;
  level: number;
  exp: number;
  ping: number;
  equipment: string[];
  dead: boolean;
  position: Vec3;
  rotation: Vec3;
}

interface WinnerCandidate {
  kills: number;
  deaths: number;
  name: string;
}

export function createScheduledRoundState(
  room: Pick<LobbyRoom, 'selectedMode' | 'killLimit' | 'roundDurationSec'>,
  previousRoundNumber: number,
  now: number,
  startDelayMs: number,
): RoundState {
  const roundDurationMs = room.roundDurationSec * 1000;
  const scheduledStartAt = now + startDelayMs;

  return {
    mode: room.selectedMode,
    status: 'warmup',
    phase: 'starting',
    roundNumber: previousRoundNumber + 1,
    killLimit: room.killLimit,
    timeRemainingMs: roundDurationMs,
    startedAt: scheduledStartAt,
    endsAt: scheduledStartAt + roundDurationMs,
    winnerId: null,
    reason: null,
  };
}

export function activateRoundState(roundState: RoundState, startedAt: number, roundDurationMs: number): RoundState {
  return {
    ...roundState,
    status: 'active',
    phase: 'in_round',
    startedAt,
    endsAt: startedAt + roundDurationMs,
    timeRemainingMs: roundDurationMs,
  };
}

export function advanceActiveRoundClock(
  roundState: RoundState,
  now: number,
): { roundState: RoundState; timedOut: boolean } {
  const timeRemainingMs = Math.max(0, roundState.endsAt - now);
  return {
    roundState: {
      ...roundState,
      timeRemainingMs,
    },
    timedOut: timeRemainingMs <= 0,
  };
}

export function completeRoundState(
  roundState: RoundState,
  winnerId: string | null,
  reason: RoundEndReason,
): RoundState {
  return {
    ...roundState,
    status: 'ended',
    phase: 'round_end',
    timeRemainingMs: 0,
    winnerId,
    reason,
  };
}

export function buildPlayerScoreSummary<TPlayer extends ScoreSummaryPlayer>(player: TPlayer): Record<string, unknown> {
  return {
    id: player.id,
    name: player.name,
    health: player.health,
    shield: player.armor,
    kills: player.kills,
    deaths: player.deaths,
    level: player.level,
    exp: player.exp,
    ping: player.ping,
    equipment: [...player.equipment],
    dead: player.dead,
    position: { ...player.position },
    rotation: { ...player.rotation },
  };
}

export function selectRoundWinner<TPlayer extends WinnerCandidate>(players: Iterable<TPlayer>): TPlayer | null {
  const orderedPlayers = Array.from(players);
  if (orderedPlayers.length === 0) {
    return null;
  }

  orderedPlayers.sort((left, right) => right.kills - left.kills || left.deaths - right.deaths || left.name.localeCompare(right.name));
  return orderedPlayers[0] ?? null;
}