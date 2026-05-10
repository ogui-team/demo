/**
 * Shared session/game-state contracts — canonical source of truth for both
 * client and server. Do not duplicate these types locally; always import from
 * '@shared/contracts'.
 */

export type LobbyStatus = 'waiting' | 'countdown' | 'in_game';
export type GameModeId = 'ffa' | 'horde' | 'drift_bomb';
export type RoundStatus = 'warmup' | 'active' | 'ended';

/**
 * The macro phase of a round. Server calls this `GamePhase`; the client
 * historically aliased it as `RoundPhase`. Both names are exported so
 * existing code compiles without renaming.
 */
export type GamePhase = 'waiting' | 'starting' | 'in_round' | 'round_end';
export type RoundPhase = GamePhase;

export interface RoundState {
  mode: GameModeId;
  status: RoundStatus;
  phase: GamePhase;
  roundNumber: number;
  killLimit: number;
  timeRemainingMs: number;
  startedAt: number;
  endsAt: number;
  winnerId: string | null;
  reason: 'timer' | 'kill_limit' | 'manual' | null;
}
