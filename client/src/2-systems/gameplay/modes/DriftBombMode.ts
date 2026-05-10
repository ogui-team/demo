/**
 * DRIFT BOMB GAME MODE
 * Counter-Strike inspired competitive bomb defusal mode
 *
 * Full match lifecycle:
 * - Players split into ATTACKERS (bomb planters) and DEFENDERS (interceptors)
 * - Buy phase (20 sec): Players purchase weapons/utility
 * - Action phase (120 sec): Attackers plant bomb, defenders intercept
 * - Drifting (30 sec): Bomb moves along route
 * - Defusing (40 sec max): Defender tethered to bomb attempts defusal
 * - Round end: Winners determined, scores updated
 * - Match end: Best-of series complete
 *
 * Authority: Single-writer pattern through GameModeContext
 * Determinism: Frame-indexed timers for replay safety
 */

import {
  BaseGameMode,
  type GameModeContext,
  type SpawnLoadout,
} from '../game/GameModeSystem';
import { DriftBombRoundManager, type DriftBombRoundPhase } from '../../../4-runtime/gameplay/modes/DriftBombRoundManager';
import { logEvent } from '@engine/1-kernel/core/public-api';

interface PlayerTeamAssignment {
  playerId: string;
  team: 'attacker' | 'defender';
  spawned: boolean;
}

export class DriftBombMode extends BaseGameMode {
  readonly name = 'drift_bomb';
  readonly displayName = 'Drift Bomb';

  private roundManager = new DriftBombRoundManager();
  private playerAssignments = new Map<string, PlayerTeamAssignment>();
  private localSpawnWeaponOverrides = new Map<string, string[]>();
  private lastPhase: DriftBombRoundPhase = 'idle';
  private roundStartTime = 0;
  private matchScore = { attackers: 0, defenders: 0 };
  private contextRef: GameModeContext | null = null;
  private awaitingLocalSetup = false;

  protected onInit(ctx: GameModeContext): void {
    this.contextRef = ctx;
    ctx.broadcastEvent('match_start', { mode: this.name });

    // Initialize match with current players
    const players = ctx.getPlayers();
    const playerIds = players.map((p) => p.id);
    this.playerAssignments.clear();

    // Solo/offline Drift Bomb needs a spectator pre-round until team selection.
    if (playerIds.length <= 1) {
      this.roundManager.initializeMatch([]);
      this.awaitingLocalSetup = true;
      this.lastPhase = 'idle';
      this.roundStartTime = Engine.time.now();
      console.log('[DriftBombMode] Waiting for local team selection before spawning player.');
      logEvent('drift_bomb', 'Awaiting local team selection');
      return;
    }

    this.awaitingLocalSetup = false;
    this.roundManager.initializeMatch(playerIds);

    // Assign teams and create assignment map
    for (const player of players) {
      const team = this.roundManager.getTeam(player.id);
      if (team) {
        this.playerAssignments.set(player.id, {
          playerId: player.id,
          team,
          spawned: false,
        });
      }
    }

    // Start first round
    this.roundManager.startNextRound();
    this.roundStartTime = Engine.time.now();
    this.lastPhase = 'buy_phase';

    console.log('[DriftBombMode] Match initialized — buy phase active.');
    logEvent('drift_bomb', 'Match started');
  }

  onPlayerJoin(ctx: GameModeContext, playerId: string): void {
    const players = ctx.getPlayers();

    // If match not yet started, reinitialize with new player count
    if (this.lastPhase === 'idle') {
      this.onInit(ctx);
      return;
    }

    // Late join: assign to smaller team
    const attackerCount = Array.from(this.playerAssignments.values()).filter((e) => e.team === 'attacker').length;
    const defenderCount = Array.from(this.playerAssignments.values()).filter((e) => e.team === 'defender').length;
    const team = attackerCount <= defenderCount ? 'attacker' : 'defender';

    this.playerAssignments.set(playerId, {
      playerId,
      team,
      spawned: false,
    });

    // Spawn late-joined player at appropriate spawn point
    ctx.spawnPlayer(playerId);

    console.log(`[DriftBombMode] Player "${playerId}" joined as ${team}`);
    logEvent('drift_bomb', 'Player joined');
  }

  onPlayerDeath(ctx: GameModeContext, playerId: string, _killerId?: string): void {
    // In Drift Bomb, players are eliminated for the round (no respawn)
    this.roundManager.eliminatePlayer(playerId);

    const state = this.roundManager.getState();
    console.log(
      `[DriftBombMode] Player "${playerId}" eliminated. Attackers alive: ${state.attackerScore.alive}, Defenders alive: ${state.defenderScore.alive}`
    );
    logEvent('drift_bomb', 'Player eliminated');
  }

  onTick(ctx: GameModeContext, dt: number): void {
    if (this.awaitingLocalSetup) {
      this.broadcastRoundState(ctx);
      return;
    }

    // Update round manager each frame
    this.roundManager.update(dt);

    const currentState = this.roundManager.getState();
    const currentPhase = currentState.phase;

    // Handle phase transitions
    if (currentPhase !== this.lastPhase) {
      this.handlePhaseTransition(ctx, this.lastPhase, currentPhase);
      this.lastPhase = currentPhase;
    }

    // Phase-specific updates
    switch (currentPhase) {
      case 'buy_phase':
        // Placeholder: Buy menu managed by UI layer
        break;

      case 'action_phase':
        // Players are free to move and plant/intercept bomb
        break;

      case 'planting':
        // Bomb transitioning to planted state (1-2 frame delay)
        this.roundManager.startBombDrift();
        break;

      case 'drifting':
        // Bomb moving along route (handled by bomb controller)
        break;

      case 'defusing':
        // Defuse attempt in progress (tracked by defuse mechanic)
        break;

      case 'round_end':
        // Wait for UI to show scoreboard, then transition to next round
        const timeSinceEnd = (Engine.time.now() - this.roundStartTime) / 1000;
        if (timeSinceEnd > 5) {
          // After 5 seconds, prepare next round
          this.prepareNextRound(ctx);
        }
        break;

      case 'idle':
        // No-op
        break;
    }

    // Update HUD with current state
    this.broadcastRoundState(ctx);
  }

  private handlePhaseTransition(
    ctx: GameModeContext,
    fromPhase: DriftBombRoundPhase,
    toPhase: DriftBombRoundPhase
  ): void {
    console.log(`[DriftBombMode] Phase transition: ${fromPhase} -> ${toPhase}`);

    switch (toPhase) {
      case 'buy_phase':
        ctx.broadcastEvent('phase_change', { phase: 'buy_phase' });
        this.roundStartTime = Engine.time.now();
        console.log('[DriftBombMode] BUY PHASE: Players have 20 seconds to buy equipment');
        break;

      case 'action_phase':
        ctx.broadcastEvent('phase_change', { phase: 'action_phase' });
        this.roundStartTime = Engine.time.now();
        console.log('[DriftBombMode] ACTION PHASE: Attackers attempt to plant bomb');
        break;

      case 'drifting':
        ctx.broadcastEvent('phase_change', { phase: 'drifting' });
        this.roundStartTime = Engine.time.now();
        console.log('[DriftBombMode] DRIFTING: Bomb is moving along route');
        break;

      case 'defusing':
        ctx.broadcastEvent('phase_change', { phase: 'defusing' });
        this.roundStartTime = Engine.time.now();
        console.log('[DriftBombMode] DEFUSING: Defender attempting to defuse while tethered');
        break;

      case 'round_end':
        this.roundStartTime = Engine.time.now();
        ctx.broadcastEvent('round_end', {
          winner: this.roundManager.getState().roundWinner,
          reason: this.roundManager.getState().winReason,
        });

        const state = this.roundManager.getState();
        if (state.roundWinner === 'attackers') {
          this.matchScore.attackers++;
        } else {
          this.matchScore.defenders++;
        }

        console.log(
          `[DriftBombMode] ROUND END: ${state.roundWinner} won (${state.winReason}). Match score: ${this.matchScore.attackers} - ${this.matchScore.defenders}`
        );
        break;
    }

    logEvent('drift_bomb', 'Phase changed');
  }

  private prepareNextRound(ctx: GameModeContext): void {
    const state = this.roundManager.getState();

    // Check if match is over (best of 5: first to 3)
    if (this.matchScore.attackers >= 3 || this.matchScore.defenders >= 3) {
      const winner = this.matchScore.attackers >= 3 ? 'attackers' : 'defenders';
      ctx.broadcastEvent('match_end', JSON.stringify({ winner, finalScore: this.matchScore }));
      console.log(`[DriftBombMode] MATCH OVER: ${winner} won!`);
      logEvent('drift_bomb', 'Match ended');
      return;
    }

    // Swap teams for next round
    const temp = this.matchScore.attackers;
    const attackerIds = Array.from(state.attackers);
    const defenderIds = Array.from(state.defenders);

    this.playerAssignments.clear();
    for (const pid of defenderIds) {
      this.playerAssignments.set(pid, { playerId: pid, team: 'attacker', spawned: false });
    }
    for (const pid of attackerIds) {
      this.playerAssignments.set(pid, { playerId: pid, team: 'defender', spawned: false });
    }

    // Clear previous round state
    for (const player of ctx.getPlayers()) {
      if (this.playerAssignments.has(player.id)) {
        ctx.spawnPlayer(player.id);
      }
    }

    // Start next round
    this.roundManager.startNextRound();
    this.roundStartTime = Engine.time.now();
    this.lastPhase = 'buy_phase';

    console.log(`[DriftBombMode] Starting round ${this.roundManager.getRoundNumber()}`);
    logEvent('drift_bomb', 'Round started');
  }

  private broadcastRoundState(ctx: GameModeContext): void {
    const state = this.roundManager.getState();
    const timeRemaining = this.roundManager.getPhaseTimeRemaining();

    ctx.broadcastEvent('round_state_update', {
      phase: state.phase,
      round: state.roundNumber,
      timeRemaining,
      attackersAlive: state.attackerScore.alive,
      defendersAlive: state.defenderScore.alive,
      bombPlanted: !!state.bombPlantedAt,
      defusingActive: state.phase === 'defusing',
    });
  }

  getSpawnLoadout(playerId: string): SpawnLoadout {
    const overriddenWeapons = this.localSpawnWeaponOverrides.get(playerId) ?? null;
    const weapons = overriddenWeapons && overriddenWeapons.length > 0
      ? [...overriddenWeapons]
      : ['pistol'];

    // Loadout depends on team
    return {
      weapons,
      startAmmo: {
        pistol: { current: 24, reserve: 120 },
      },
      maxHealth: 100,
      maxMana: 0,
      maxShield: 0,
      conditionTags: [],
    };
  }

  // ─── External API (for UI/Systems) ─────────────────────────────────────

  public getRoundManager(): DriftBombRoundManager {
    return this.roundManager;
  }

  public getTeam(playerId: string): 'attacker' | 'defender' | null {
    return this.roundManager.getTeam(playerId);
  }

  public getMatchScore(): { attackers: number; defenders: number } {
    return { ...this.matchScore };
  }
  /**
   * Override team assignment for a local player (called by team-select UI).
   * Updates both the playerAssignments map and the round manager's team sets.
   */
  public setLocalTeam(playerId: string, team: 'attacker' | 'defender'): void {
    // Update local assignment map
    this.playerAssignments.set(playerId, { playerId, team, spawned: false });
    // Update round manager sets so getTeam() reflects the new assignment
    const state = this.roundManager.getState();
    const attackers = new Set(state.attackers);
    const defenders = new Set(state.defenders);
    if (team === 'attacker') {
      attackers.add(playerId);
      defenders.delete(playerId);
    } else {
      defenders.add(playerId);
      attackers.delete(playerId);
    }
    this.roundManager.reassignTeams(attackers, defenders);
    logEvent('drift_bomb', `Local player team set: ${team}`);
  }

  public setLocalSpawnWeapons(playerId: string, weapons: string[]): void {
    this.localSpawnWeaponOverrides.set(playerId, [...weapons]);
  }

  public beginLocalMatch(playerId: string, team: 'attacker' | 'defender'): void {
    if (!this.contextRef) {
      console.warn('[DriftBombMode] Cannot begin local match without an active context.');
      return;
    }

    this.awaitingLocalSetup = false;
    this.setLocalTeam(playerId, team);
    this.contextRef.spawnPlayer(playerId);
    this.roundManager.startNextRound();
    this.roundStartTime = Engine.time.now();
    this.lastPhase = 'idle';
    logEvent('drift_bomb', 'Local match started');
  }
}

