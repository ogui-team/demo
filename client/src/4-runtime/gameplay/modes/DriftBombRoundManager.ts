/**
 * DRIFT BOMB ROUND MANAGER
 * Orchestrates the complete Drift Bomb match lifecycle
 *
 * Phases:
 * - IDLE: No match active
 * - BUY_PHASE: Players equip weapons (20 seconds)
 * - ACTION_PHASE: Attackers plant, defenders intercept (120 seconds)
 * - PLANTING: Bomb transitions to planted state
 * - DRIFTING: Bomb moves along route (30 seconds)
 * - DEFUSING: Defender tethered to bomb (40 seconds max)
 * - ROUND_END: Winners determined
 *
 * Authority: All state mutations are immutable snapshots
 * Determinism: All timers use frame-indexed counters for replay safety
 */

import { logEvent } from '@engine/1-kernel/core/public-api';

export interface DriftBombPosition {
  x: number;
  y: number;
  z: number;
  epoch: number;
}

export type DriftBombRoundPhase =
  | 'idle'
  | 'buy_phase'
  | 'action_phase'
  | 'planting'
  | 'drifting'
  | 'defusing'
  | 'round_end';

export type WinReason =
  | 'attackers_defused_bomb'
  | 'defenders_eliminated_all'
  | 'defenders_defused'
  | 'bomb_detonated'
  | 'time_expired'
  | 'round_reset';

export interface DriftBombTeamScore {
  teamId: 'attackers' | 'defenders';
  alive: number;
  eliminated: number;
  roundsWon: number;
  economy: number; // Total credits available
  spent: number;   // Credits spent this round
}

export interface DriftBombRoundState {
  phase: DriftBombRoundPhase;
  elapsedSeconds: number;
  maxPhaseSeconds: number;

  // Participants
  attackers: Set<string>; // Player IDs
  defenders: Set<string>;
  alivePlayers: Map<string, 'attacker' | 'defender'>;
  eliminatedPlayers: Set<string>;

  // Objective state
  bombPlantedAt?: number; // Frame when bomb was planted
  bombPlantedBy?: string; // Attacker ID
  bombPosition?: DriftBombPosition;
  driftingUntilFrame?: number;
  defusingBy?: string; // Defender ID currently defusing
  defuseStartFrame?: number;

  // Scoring
  attackerScore: DriftBombTeamScore;
  defenderScore: DriftBombTeamScore;
  roundNumber: number;

  // Match end
  matchWinner?: 'attackers' | 'defenders' | 'draw';
  roundWinner?: 'attackers' | 'defenders';
  winReason?: WinReason;
}

const DEFAULT_BUY_PHASE_SECONDS = 20;
const DEFAULT_ACTION_PHASE_SECONDS = 120;
const DEFAULT_DRIFT_SECONDS = 30;
const DEFAULT_DEFUSE_SECONDS = 40;
const DEFAULT_ROUND_END_SECONDS = 5;

export class DriftBombRoundManager {
  private _state: DriftBombRoundState;
  private _frameCounter = 0;
  private _phaseStartFrame = 0;

  constructor() {
    this._state = this.createDefaultState();
  }

  private createDefaultState(): DriftBombRoundState {
    return {
      phase: 'idle',
      elapsedSeconds: 0,
      maxPhaseSeconds: 0,
      attackers: new Set(),
      defenders: new Set(),
      alivePlayers: new Map(),
      eliminatedPlayers: new Set(),
      attackerScore: {
        teamId: 'attackers',
        alive: 0,
        eliminated: 0,
        roundsWon: 0,
        economy: 2400,
        spent: 0,
      },
      defenderScore: {
        teamId: 'defenders',
        alive: 0,
        eliminated: 0,
        roundsWon: 0,
        economy: 2400,
        spent: 0,
      },
      roundNumber: 1,
    };
  }

  /**
   * Initialize a new match with given players.
   * Splits players into attackers (50%) and defenders (50%).
   */
  initializeMatch(playerIds: string[]): void {
    const mid = Math.ceil(playerIds.length / 2);
    const attackerIds = playerIds.slice(0, mid);
    const defenderIds = playerIds.slice(mid);

    this._state = this.createDefaultState();
    this._state.roundNumber = 1;

    for (const pid of attackerIds) {
      this._state.attackers.add(pid);
      this._state.alivePlayers.set(pid, 'attacker');
    }

    for (const pid of defenderIds) {
      this._state.defenders.add(pid);
      this._state.alivePlayers.set(pid, 'defender');
    }

    this._state.attackerScore.alive = attackerIds.length;
    this._state.defenderScore.alive = defenderIds.length;

    console.log(
      `[DriftBombRoundManager] Match initialized: ${attackerIds.length} attackers, ${defenderIds.length} defenders`
    );
    logEvent('drift_bomb', 'Match initialized');
  }

  /**
   * Start the next round — begins buy phase.
   */
  startNextRound(): void {
    if (this._state.phase === 'round_end') {
      this._state.roundNumber += 1;
    }
    this.enterBuyPhase();
  }

  /**
   * Enter BUY_PHASE — players have 20 seconds to purchase equipment.
   */
  enterBuyPhase(): void {
    this._phaseStartFrame = this._frameCounter;
    this._state.phase = 'buy_phase';
    this._state.elapsedSeconds = 0;
    this._state.maxPhaseSeconds = DEFAULT_BUY_PHASE_SECONDS;
    this._state.bombPlantedAt = undefined;
    this._state.bombPlantedBy = undefined;
    this._state.bombPosition = undefined;
    this._state.driftingUntilFrame = undefined;
    this._state.defusingBy = undefined;
    this._state.defuseStartFrame = undefined;
    this._state.roundWinner = undefined;
    this._state.winReason = undefined;
    this._state.eliminatedPlayers.clear();
    this._state.alivePlayers.clear();

    // Reset alive players from current rosters
    for (const pid of this._state.attackers) {
      this._state.alivePlayers.set(pid, 'attacker');
    }
    for (const pid of this._state.defenders) {
      this._state.alivePlayers.set(pid, 'defender');
    }

    this._state.attackerScore.alive = this._state.attackers.size;
    this._state.defenderScore.alive = this._state.defenders.size;
    this._state.attackerScore.spent = 0;
    this._state.defenderScore.spent = 0;

    console.log(`[DriftBombRoundManager] ROUND ${this._state.roundNumber}: BUY PHASE started`);
    logEvent('drift_bomb', 'Buy phase started');
  }

  /**
   * Transition from BUY_PHASE to ACTION_PHASE after timer expires or skip.
   */
  enterActionPhase(): void {
    this._phaseStartFrame = this._frameCounter;
    this._state.phase = 'action_phase';
    this._state.maxPhaseSeconds = DEFAULT_ACTION_PHASE_SECONDS;

    console.log(`[DriftBombRoundManager] ROUND ${this._state.roundNumber}: ACTION PHASE started`);
    logEvent('drift_bomb', 'Action phase started');
  }

  /**
   * Attacker plants bomb — bomb now placed and begins drifting.
   */
  plantBomb(plantedBy: string, bombPosition: DriftBombPosition): void {
    if (this._state.phase !== 'action_phase') {
      console.warn('[DriftBombRoundManager] Cannot plant outside action phase');
      return;
    }

    this._phaseStartFrame = this._frameCounter;
    this._state.phase = 'planting';
    this._state.maxPhaseSeconds = 0;
    this._state.bombPlantedAt = this._frameCounter;
    this._state.bombPlantedBy = plantedBy;
    this._state.bombPosition = { ...bombPosition };

    console.log(
      `[DriftBombRoundManager] Bomb planted by ${plantedBy} at frame ${this._frameCounter}`
    );
    logEvent('drift_bomb', 'Bomb planted');
  }

  /**
   * Transition bomb from PLANTING to DRIFTING.
   * Bomb will move for ~30 seconds along predetermined route.
   */
  startBombDrift(): void {
    this._phaseStartFrame = this._frameCounter;
    this._state.phase = 'drifting';
    this._state.maxPhaseSeconds = DEFAULT_DRIFT_SECONDS;
    this._state.driftingUntilFrame = this._frameCounter + Math.round(DEFAULT_DRIFT_SECONDS * 60);

    console.log(`[DriftBombRoundManager] Bomb drifting started, will end at frame ${this._state.driftingUntilFrame}`);
    logEvent('drift_bomb', 'Bomb drifting started');
  }

  /**
   * Defender attaches tether and begins defusing.
   */
  startDefuse(defusingBy: string): void {
    if (this._state.phase !== 'drifting' && this._state.phase !== 'action_phase') {
      console.warn('[DriftBombRoundManager] Cannot defuse outside action/drifting phase');
      return;
    }

    this._phaseStartFrame = this._frameCounter;
    this._state.phase = 'defusing';
    this._state.maxPhaseSeconds = DEFAULT_DEFUSE_SECONDS;
    this._state.defusingBy = defusingBy;
    this._state.defuseStartFrame = this._frameCounter;

    console.log(`[DriftBombRoundManager] Defuse started by ${defusingBy}`);
    logEvent('drift_bomb', 'Defuse started');
  }

  /**
   * Complete bomb defusal — defenders win the round.
   */
  completeBombDefusal(): void {
    if (!this._state.defusingBy) {
      console.warn('[DriftBombRoundManager] No active defuser');
      return;
    }

    this._state.roundWinner = 'defenders';
    this._state.winReason = 'defenders_defused';
    this.endRound();

    console.log(
      `[DriftBombRoundManager] Round ${this._state.roundNumber} won by DEFENDERS (bomb defused)`
    );
    logEvent('drift_bomb', 'Bomb defused');
  }

  /**
   * Detonate bomb — attackers win the round.
   */
  detonateBomb(): void {
    this._state.roundWinner = 'attackers';
    this._state.winReason = 'bomb_detonated';
    this.endRound();

    console.log(`[DriftBombRoundManager] Round ${this._state.roundNumber} won by ATTACKERS (bomb detonated)`);
    logEvent('drift_bomb', 'Bomb detonated');
  }

  setBombPosition(bombPosition: DriftBombPosition): void {
    this._state.bombPosition = { ...bombPosition };
  }

  /**
   * Mark a player as eliminated for this round.
   */
  eliminatePlayer(playerId: string): void {
    if (!this._state.alivePlayers.has(playerId)) {
      console.warn(`[DriftBombRoundManager] Player ${playerId} already eliminated`);
      return;
    }

    const team = this._state.alivePlayers.get(playerId);
    this._state.alivePlayers.delete(playerId);
    this._state.eliminatedPlayers.add(playerId);

    if (team === 'attacker') {
      this._state.attackerScore.alive--;
      this._state.attackerScore.eliminated++;
    } else {
      this._state.defenderScore.alive--;
      this._state.defenderScore.eliminated++;
    }

    console.log(`[DriftBombRoundManager] Player ${playerId} (${team}) eliminated`);
  }

  /**
   * Update per-frame — call this every game tick to advance timers.
   */
  update(deltaSeconds: number): void {
    this._frameCounter++;
    this._state.elapsedSeconds += deltaSeconds;

    const phaseElapsedSeconds = (this._frameCounter - this._phaseStartFrame) / 60; // Assuming 60 FPS

    // Check phase time limits
    if (
      this._state.phase === 'buy_phase' &&
      phaseElapsedSeconds >= DEFAULT_BUY_PHASE_SECONDS
    ) {
      this.enterActionPhase();
    } else if (
      this._state.phase === 'action_phase' &&
      phaseElapsedSeconds >= DEFAULT_ACTION_PHASE_SECONDS
    ) {
      // Time expired — defenders win if bomb not planted
      if (this._state.bombPlantedAt == null) {
        this._state.roundWinner = 'defenders';
        this._state.winReason = 'time_expired';
        this.endRound();
      }
    } else if (
      this._state.phase === 'drifting' &&
      this._state.driftingUntilFrame &&
      this._frameCounter >= this._state.driftingUntilFrame
    ) {
      // Drift ends — bomb detonates if not defused
      if (!this._state.roundWinner) {
        this.detonateBomb();
      }
    } else if (
      this._state.phase === 'defusing' &&
      this._state.defuseStartFrame &&
      (this._frameCounter - this._state.defuseStartFrame) / 60 >= DEFAULT_DEFUSE_SECONDS
    ) {
      // Defuse timer expires — bomb detonates
      if (!this._state.roundWinner) {
        this._state.roundWinner = 'attackers';
        this._state.winReason = 'bomb_detonated';
        this.endRound();
      }
    }

    // Check for team elimination
    if (
      this._state.attackerScore.alive === 0 &&
      this._state.phase !== 'round_end' &&
      this._state.bombPlantedAt == null
    ) {
      this._state.roundWinner = 'defenders';
      this._state.winReason = 'defenders_eliminated_all';
      this.endRound();
    }

    if (
      this._state.defenderScore.alive === 0 &&
      this._state.phase !== 'round_end' &&
      this._state.bombPlantedAt != null
    ) {
      this._state.roundWinner = 'attackers';
      this._state.winReason = 'attackers_defused_bomb';
      this.endRound();
    }
  }

  /**
   * End the current round — award economy, determine next round.
   */
  private endRound(): void {
    this._phaseStartFrame = this._frameCounter;
    this._state.phase = 'round_end';
    this._state.maxPhaseSeconds = DEFAULT_ROUND_END_SECONDS;

    if (this._state.roundWinner === 'attackers') {
      this._state.attackerScore.roundsWon++;
      // Award economy to attackers
      this._state.attackerScore.economy += 3200;
      // Penalty to defenders
      this._state.defenderScore.economy = Math.max(
        1400,
        this._state.defenderScore.economy - 800
      );
    } else {
      this._state.defenderScore.roundsWon++;
      // Award economy to defenders
      this._state.defenderScore.economy += 3200;
      // Penalty to attackers
      this._state.attackerScore.economy = Math.max(
        1400,
        this._state.attackerScore.economy - 800
      );
    }

    console.log(
      `[DriftBombRoundManager] Round ${this._state.roundNumber} ended: ${this._state.roundWinner} won (${this._state.winReason})`
    );
    console.log(
      `[DriftBombRoundManager] Score: Attackers ${this._state.attackerScore.roundsWon}, Defenders ${this._state.defenderScore.roundsWon}`
    );

    logEvent('drift_bomb', 'Round ended');
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  getState(): DriftBombRoundState {
    // Return immutable snapshot
    return Object.freeze({
      ...this._state,
      bombPosition: this._state.bombPosition ? { ...this._state.bombPosition } : undefined,
      attackers: new Set(this._state.attackers),
      defenders: new Set(this._state.defenders),
      alivePlayers: new Map(this._state.alivePlayers),
      eliminatedPlayers: new Set(this._state.eliminatedPlayers),
    });
  }

  getPhase(): DriftBombRoundPhase {
    return this._state.phase;
  }

  getRoundNumber(): number {
    return this._state.roundNumber;
  }

  getTeam(playerId: string): 'attacker' | 'defender' | null {
    if (this._state.attackers.has(playerId)) return 'attacker';
    if (this._state.defenders.has(playerId)) return 'defender';
    return null;
  }

  isPlayerAlive(playerId: string): boolean {
    return this._state.alivePlayers.has(playerId);
  }

  getAttackersAlive(): number {
    return this._state.attackerScore.alive;
  }

  getDefendersAlive(): number {
    return this._state.defenderScore.alive;
  }

  getPhaseTimeRemaining(): number {
    const elapsed = (this._frameCounter - this._phaseStartFrame) / 60;
    return Math.max(0, this._state.maxPhaseSeconds - elapsed);
  }

  getAttackerEconomy(): number {
    return this._state.attackerScore.economy - this._state.attackerScore.spent;
  }

  getDefenderEconomy(): number {
    return this._state.defenderScore.economy - this._state.defenderScore.spent;
  }

  isBombPlanted(): boolean {
    return this._state.bombPlantedAt != null;
  }

  isBombDrifting(): boolean {
    return this._state.phase === 'drifting';
  }

  isDefusingActive(): boolean {
    return this._state.phase === 'defusing';
  }

  getDefuser(): string | null {
    return this._state.defusingBy ?? null;
  }

  getFrameCounter(): number {
    return this._frameCounter;
  }

  /**
   * Override team assignments for local/solo play (team-select UI).
   * Replaces the attackers and defenders sets directly.
   */
  reassignTeams(attackers: Set<string>, defenders: Set<string>): void {
    this._state.attackers = new Set(attackers);
    this._state.defenders = new Set(defenders);
    this._state.attackerScore.alive = attackers.size;
    this._state.defenderScore.alive = defenders.size;
  }
}
