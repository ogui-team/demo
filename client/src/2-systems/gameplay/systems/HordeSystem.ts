import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { EntityHandle } from '@engine/1-kernel/core/public-api';
import type { SpawnSystem } from './SpawnSystem';
import type { DummyEnemyVariantId } from './DummyEnemySystem';
import type { GameModeSystem } from '../game/GameModeSystem';

interface HordeSystemConfig {
  spawnSystem: SpawnSystem;
  gameModeSystem: GameModeSystem;
}

interface HordeEnemyProfile {
  enemyType: 'default' | 'flyingMask';
  variantId: DummyEnemyVariantId;
}

interface HordeArcadeEntry {
  rank: number;
  playerId: string;
  name: string;
  kills: number;
  points: number;
}

const WAVE_DELAY_MIN = 2.0;
const WAVE_DELAY_MAX = 3.0;
const MAX_WAVES = 10;

export class HordeSystem {
  private readonly spawnSystem: SpawnSystem;
  private readonly gameModeSystem: GameModeSystem;
  private readonly activeEnemies = new Set<EntityHandle>();
  private controllerGameplayActive = false;
  private controllerGameMode: string | null = null;
  private waveIndex = 0;
  private nextWaveTimer = 0;
  private active = false;
  private started = false;
  private isVictory = false;
  private kills = 0;
  private points = 0;
  private streak = 0;
  private maxStreak = 0;
  private lastAward = 0;

  constructor(config: HordeSystemConfig) {
    this.spawnSystem = config.spawnSystem;
    this.gameModeSystem = config.gameModeSystem;

    const gameBusAny = gameBus as any;
    gameBusAny.on('hordeStartRequested', this.onHordeStartRequested);
    gameBusAny.on('DUMMY_DIED', this.onDummyDied);
  }

  getCapabilities() {
    return {
      usesEventBus: true,
      exposesDebug: true,
      deterministic: false,
      usesNetworkFacade: false,
    };
  }

  update(dt: number): void {
    this.syncControllerState();
    if (!this.active || !this.started) return;

    if (this.waveIndex === 0) {
      this.beginNextWave();
      return;
    }

    if (this.activeEnemies.size === 0) {
      this.nextWaveTimer -= dt;
      if (this.nextWaveTimer <= 0) {
        this.beginNextWave();
      }
    }
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      active: this.active,
      started: this.started,
      mode: this.controllerGameMode,
      gameplayActive: this.controllerGameplayActive,
      wave: this.waveIndex,
      kills: this.kills,
      points: this.points,
      streak: this.streak,
      enemiesRemaining: this.activeEnemies.size,
      nextWaveTimer: Number(this.nextWaveTimer.toFixed(2)),
    };
  }

  getEncounterState(): {
    active: boolean;
    started: boolean;
    wave: number;
    kills: number;
    enemiesRemaining: number;
    nextWaveTimer: number;
    status: 'idle' | 'active' | 'victory';
  } {
    return {
      active: this.active,
      started: this.started,
      wave: this.waveIndex,
      kills: this.kills,
      enemiesRemaining: this.activeEnemies.size,
      nextWaveTimer: this.nextWaveTimer,
      status: this.isVictory ? 'victory' : (this.active ? 'active' : 'idle'),
    };
  }

  restartFromWaveOne(): boolean {
    this.syncControllerState();
    if (!this.isControllerHordeActive()) {
      return false;
    }

    (gameBus as any).emit('hordeClearEnemiesRequested');
    this.stopHorde();
    this.prepareHorde();
    this.started = true;
    this.emitWaveState('initiated');
    this.beginNextWave();
    return true;
  }

  private onHordeStartRequested = (): void => {
    this.syncControllerState();
    if (!this.isControllerHordeActive() || !this.active || this.started) return;
    this.started = true;
    gameBus.emit('HORDE_STARTED', {
      wave: this.waveIndex,
      kills: this.kills,
      timestamp: Engine.time.now(),
    });
    this.emitWaveState('initiated');
    this.beginNextWave();
  };

  private onDummyDied = (payload: { handle: EntityHandle }): void => {
    this.syncControllerState();
    if (!this.isControllerHordeActive() || !this.active || !this.started) return;
    this.activeEnemies.delete(payload.handle);
    this.kills += 1;
    const killAward = this.computeKillAward();
    this.points += killAward;
    this.lastAward = killAward;
    this.streak += 1;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    const liveCount = this.activeEnemies.size;
    this.emitWaveState('active', {
      enemyCount: liveCount,
      pointsAwarded: killAward,
    });
    if (liveCount === 0) {
      this.streak = 0;
      if (this.waveIndex >= MAX_WAVES) {
        this.declareVictory();
      } else {
        this.scheduleNextWave();
      }
    }
  };

  private prepareHorde(): void {
    this.activeEnemies.clear();
    this.waveIndex = 0;
    this.nextWaveTimer = 0;
    this.kills = 0;
    this.points = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.lastAward = 0;
    this.active = true;
    this.started = false;
    this.isVictory = false;
    this.emitWaveState('waiting_to_start');
  }

  private stopHorde(): void {
    const endedEncounter = this.active || this.started || this.isVictory;
    this.active = false;
    this.started = false;
    this.activeEnemies.clear();
    this.nextWaveTimer = 0;
    // Don't overwrite the victory status with 'stopped'.
    if (!this.isVictory) {
      this.emitWaveState('stopped');
    }
    if (endedEncounter) {
      gameBus.emit('ENCOUNTER_FINISHED', {
        encounterType: 'horde',
        status: 'stopped',
        wave: this.waveIndex,
        kills: this.kills,
        timestamp: Engine.time.now(),
      });
    }
  }

  private declareVictory(): void {
    this.isVictory = true;
    this.active = false;
    this.activeEnemies.clear();
    this.nextWaveTimer = 0;
    this.emitWaveState('victory', { enemyCount: 0 });
    gameBus.emit('ENCOUNTER_FINISHED', {
      encounterType: 'horde',
      status: 'victory',
      wave: this.waveIndex,
      kills: this.kills,
      timestamp: Engine.time.now(),
    });
    gameBus.emit('gameModeEnded', { modeName: 'horde', winnerId: null, reason: 'victory' });
  }

  private scheduleNextWave(): void {
    this.nextWaveTimer = WAVE_DELAY_MIN + Engine.random.next() * (WAVE_DELAY_MAX - WAVE_DELAY_MIN);
    this.emitWaveState('waiting', { nextWaveIn: Number(this.nextWaveTimer.toFixed(2)) });
  }

  private beginNextWave(): void {
    this.waveIndex += 1;
    const count = 3 + this.waveIndex * 2;
    const origin = this.getWaveOrigin();
    const radius = 3.5 + this.waveIndex * 0.75;

    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const preferredPosition = {
        x: origin.x + Math.cos(angle) * (radius + (i % 3) * 0.5),
        y: origin.y,
        z: origin.z + Math.sin(angle) * (radius + (i % 3) * 0.5),
      };
      const profile = this.getEnemyProfileForWave(this.waveIndex, i);
      const spawnPosition = this.spawnSystem.findSpawnPosition({
        clearance: profile.enemyType === 'flyingMask' ? 1.5 : 1.2,
        preferredPosition,
        maxAttempts: 32,
      });
      // Skip spawning if the fallback position is elevated (y > 4), which means
      // all valid positions were occupied and the result would be invalid.
      if (spawnPosition.y > origin.y + 3.5) {
        console.warn('[HordeSystem] Spawn skipped — no valid position found for enemy', i);
        continue;
      }
      const handle = this.spawnSystem.spawnEnemy({
        enemyType: profile.enemyType,
        variantId: profile.variantId,
        position: { x: spawnPosition.x, y: origin.y, z: spawnPosition.z },
      });
      if (handle !== null) {
        this.activeEnemies.add(handle);
      }
    }

    this.nextWaveTimer = 0;
    this.emitWaveState('active', { enemyCount: this.activeEnemies.size });
  }

  private computeKillAward(): number {
    const base = 100;
    const waveBonus = Math.max(0, (this.waveIndex - 1) * 20);
    const streakTier = Math.min(5, Math.floor(this.streak / 5));
    const streakBonus = streakTier * 25;
    return base + waveBonus + streakBonus;
  }

  private emitWaveState(
    status: 'waiting_to_start' | 'waiting' | 'active' | 'stopped' | 'initiated' | 'victory',
    extras: Record<string, unknown> = {},
  ): void {
    gameBus.emit('hordeWaveState', {
      wave: this.waveIndex,
      status,
      kills: this.kills,
      points: this.points,
      streak: this.streak,
      maxStreak: this.maxStreak,
      lastAward: this.lastAward,
      ...extras,
    });
    this.publishArcadeScore(status);
  }

  private publishArcadeScore(status: 'waiting_to_start' | 'waiting' | 'active' | 'stopped' | 'initiated' | 'victory'): void {
    const stateManager = Engine.getStateManagerInstance();
    if (!stateManager?.set) {
      return;
    }

    const players = (stateManager.getRaw?.('game.players') as Array<Record<string, unknown>> | null) ?? [];
    const localPlayerId = this.resolveLocalPlayerId(stateManager);
    const leaderboard = this.buildArcadeLeaderboard(players, localPlayerId);

    stateManager.set('horde.arcade', {
      wave: this.waveIndex,
      kills: this.kills,
      points: this.points,
      streak: this.streak,
      maxStreak: this.maxStreak,
      lastAward: this.lastAward,
      status,
      finished: status === 'victory' || status === 'stopped',
      leaderboard,
      updatedAt: Engine.time.now(),
    });
  }

  private resolveLocalPlayerId(stateManager: ReturnType<typeof Engine.getStateManagerInstance>): string | null {
    const runtimePlayerId = Engine.getRuntimePlayerId?.();
    if (typeof runtimePlayerId === 'string' && runtimePlayerId.length > 0) {
      return runtimePlayerId;
    }
    const fallbackPlayerId = stateManager?.getRaw?.('network.localPlayerId');
    return typeof fallbackPlayerId === 'string' && fallbackPlayerId.length > 0 ? fallbackPlayerId : null;
  }

  private buildArcadeLeaderboard(
    players: Array<Record<string, unknown>>,
    localPlayerId: string | null,
  ): HordeArcadeEntry[] {
    const entries: HordeArcadeEntry[] = [];
    const seen = new Set<string>();

    for (const player of players) {
      const playerId = typeof player.id === 'string' ? player.id : null;
      if (!playerId) {
        continue;
      }
      seen.add(playerId);
      const kills = typeof player.kills === 'number' ? player.kills : 0;
      entries.push({
        rank: 0,
        playerId,
        name: this.resolvePlayerName(player),
        kills,
        points: playerId === localPlayerId ? this.points : kills * 100,
      });
    }

    if (localPlayerId && !seen.has(localPlayerId)) {
      entries.push({
        rank: 0,
        playerId: localPlayerId,
        name: 'YOU',
        kills: this.kills,
        points: this.points,
      });
    }

    if (entries.length === 0) {
      entries.push({
        rank: 0,
        playerId: 'local',
        name: 'YOU',
        kills: this.kills,
        points: this.points,
      });
    }

    entries.sort((left, right) => {
      if (right.points !== left.points) {
        return right.points - left.points;
      }
      if (right.kills !== left.kills) {
        return right.kills - left.kills;
      }
      return left.name.localeCompare(right.name);
    });

    return entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  private resolvePlayerName(player: Record<string, unknown>): string {
    const value = typeof player.name === 'string' ? player.name.trim() : '';
    if (value.length > 0) {
      return value;
    }
    const fallback = typeof player.id === 'string' ? player.id : 'PLAYER';
    return fallback.slice(0, 14).toUpperCase();
  }

  private getEnemyProfileForWave(waveIndex: number, index: number): HordeEnemyProfile {
    if (waveIndex <= 1) {
      return { enemyType: 'default', variantId: 'decay-husk' };
    }

    const maskCount = Math.max(1, Math.floor((waveIndex + 1) / 3));
    if (index < maskCount) {
      return { enemyType: 'flyingMask', variantId: 'rot-mask' };
    }

    if (waveIndex >= 3 && index % (waveIndex >= 6 ? 2 : 3) === 0) {
      return { enemyType: 'default', variantId: 'canopy-stalker' };
    }

    return { enemyType: 'default', variantId: 'decay-husk' };
  }

  private getWaveOrigin(): { x: number; y: number; z: number } {
    const localPlayer = Engine.getEntityManager()?.getEntities().find((entity) => entity.hasComponent('localPlayer'));
    const preferredPosition = localPlayer ? localPlayer.getPosition() : { x: 0, y: 1, z: 0 };
    return this.spawnSystem.findSpawnPosition({ tag: 'player', clearance: 2, preferredPosition });
  }

  private syncControllerState(): void {
    const stateManager = Engine.getStateManagerInstance();
    const gameplayActive = stateManager?.getRaw('gameplay.active') === true;
    const rawMode = stateManager?.getRaw('game.mode');
    const gameMode = typeof rawMode === 'string' && rawMode.length > 0 ? rawMode : null;
    const wasHordeActive = this.isControllerHordeActive();

    this.controllerGameplayActive = gameplayActive;
    this.controllerGameMode = gameMode;

    const isHordeActive = this.isControllerHordeActive();
    if (isHordeActive && !wasHordeActive) {
      this.prepareHorde();
    } else if (!isHordeActive && wasHordeActive) {
      this.stopHorde();
    }
  }

  private isControllerHordeActive(): boolean {
    return this.controllerGameplayActive && this.controllerGameMode === 'horde';
  }
}
