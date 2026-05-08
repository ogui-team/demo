import { gameBus } from '@engine/1-kernel/core/public-api';
import type { AvatarAppearance } from './AvatarBuilder';
import type { TropicalHorrorArchetypeId } from '@engine/2-systems/ArchetypeDefinitions';

/**
 * GameModeSystem
 * ==============
 * Plugin-style game mode registry and runner.
 *
 * A GameMode is a plain interface:
 *   name, onStart, onUpdate, onPlayerJoin, onPlayerDeath, onEnd
 *
 * Modes are registered by name and switched at runtime. The active mode
 * receives a `GameModeContext` that lets it mutate scores, spawn objects,
 * broadcast events and query players — without coupling to any specific
 * engine module.
 *
 * Usage
 * ─────
 * const modes = new GameModeSystem();
 *
 * // Provide the context implementation
 * modes.setContext({
 *   getPlayers:   () => [...],
 *   addScore:     (id, n) => ...,
 *   spawnPlayer:  (id) => ...,
 *   broadcastEvent: (t, d) => mpClient.sendAction(t, d),
 * });
 *
 * // Register built-in modes
 * modes.registerMode(new FFAMode());
 * modes.registerMode(new SurvivalMode());
 *
 * // Activate when the match starts
 * modes.activate('ffa');
 *
 * // Drive from game loop
 * engine.onEngineUpdate((dt) => modes.update(dt));
 *
 * // Forward events
 * modes.notifyPlayerJoin(playerId);
 * modes.notifyPlayerDeath(playerId, killerId);
 */

// ─── Context injected into modes ─────────────────────────────────────────────

export interface PlayerInfo {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  health: number;
  team?: string;
}

export interface GameModeContext {
  /** Return a snapshot of all current players. */
  getPlayers(): PlayerInfo[];
  /** Add (positive) or subtract (negative) score for a player. */
  addScore(playerId: string, delta: number): void;
  /** Set score outright. */
  setScore(playerId: string, score: number): void;
  /** Respawn/teleport a player. */
  spawnPlayer(playerId: string): void;
  /** Broadcast a custom event to all clients (topic + payload). */
  broadcastEvent(topic: string, data: unknown): void;
  /** End the match / round. */
  endMatch(winnerId: string | null, reason?: string): void;
  /** Optional engine snapshot hooks for mode transitions. */
  captureSnapshot?(): unknown;
  restoreSnapshot?(snapshot: unknown): void;
}

export interface GameModeSnapshot {
  activeMode: string | null;
  running: boolean;
  payload: unknown;
}

// ─── Spawn loadout ───────────────────────────────────────────────────────────

/**
 * Items and stats a player receives when spawning (or respawning).
 * Returned by `BaseGameMode.getSpawnLoadout()`.
 */
export interface SpawnLoadout {
  /** WeaponSystem IDs to give. First entry is auto-equipped. */
  weapons:      string[];
  /** Preset ammo per weapon (current / reserve). Omit to use weapon defaults. */
  startAmmo?:   Record<string, { current: number; reserve: number }>;
  /** Override max health for this game mode. */
  maxHealth?:   number;
  /** Override max mana for this game mode. */
  maxMana?:     number;
  /** Optional shield capacity to initialise on spawn. */
  maxShield?:  number;
  /** Optional spawn armor value passed into HealthSystem. */
  armor?: number;
  /** Optional movement speed profile for runtime metadata. */
  moveSpeed?: number;
  /** Optional damage multiplier profile for runtime metadata. */
  damageMultiplier?: number;
  /** Optional attack-speed profile for runtime metadata. */
  attackSpeed?: number;
  /** Optional player class / archetype label for runtime metadata. */
  playerClass?: string;
  /** Optional archetype identity merged in by bootstrap/runtime. */
  archetypeId?: TropicalHorrorArchetypeId;
  /** Optional appearance profile applied to the local runtime state. */
  appearance?: AvatarAppearance;
  /** Optional condition tags seeded into AbilitySystem on spawn. */
  conditionTags?: string[];
}

export const DEFAULT_SPAWN_LOADOUT: Readonly<SpawnLoadout> = {
  weapons:   ['pistol'],
  startAmmo: { pistol: { current: 12, reserve: 96 } },
  maxHealth: 100,
  maxMana:   50,
  maxShield: 0,
  conditionTags: [],
};

// ─── GameMode interface ──────────────────────────────────────────────────────

export interface GameMode {
  /** Unique identifier, must match the key used in registerMode. */
  readonly name: string;
  /** Human-readable display name */
  readonly displayName?: string;

  /** Called once when this mode becomes active. */
  onStart(ctx: GameModeContext): void;
  /** Called every frame while the mode is active. */
  onUpdate(ctx: GameModeContext, dt: number): void;
  /** Called when a new player connects or spawns. */
  onPlayerJoin(ctx: GameModeContext, playerId: string): void;
  /** Called when a player is killed (before respawn logic). */
  onPlayerDeath(ctx: GameModeContext, playerId: string, killedBy: string): void;
  /** Called when the mode is deactivated / match ends. */
  onEnd(ctx: GameModeContext): void;

  /**
   * Return the starting loadout for a spawning/respawning player.
   * Optional — engine falls back to `DEFAULT_SPAWN_LOADOUT` when absent.
   */
  getSpawnLoadout?(playerId: string): SpawnLoadout;
}

// ─── GameModeSystem ──────────────────────────────────────────────────────────

type GameModeEventMap = {
  mode_activated: { name: string };
  mode_deactivated: { name: string };
  match_end: { winnerId: string | null; reason: string };
};

type Listener<T> = (data: T) => void;
type SpawnLoadoutResolver = (playerId: string, baseLoadout: SpawnLoadout) => SpawnLoadout;

function cloneStartAmmo(startAmmo?: Record<string, { current: number; reserve: number }>): Record<string, { current: number; reserve: number }> | undefined {
  if (!startAmmo) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(startAmmo).map(([weaponId, ammo]) => [weaponId, { ...ammo }]),
  );
}

function cloneSpawnLoadout(loadout: SpawnLoadout): SpawnLoadout {
  return {
    ...loadout,
    weapons: [...loadout.weapons],
    startAmmo: cloneStartAmmo(loadout.startAmmo),
    appearance: loadout.appearance ? { ...loadout.appearance } : undefined,
    conditionTags: loadout.conditionTags ? [...loadout.conditionTags] : [],
  };
}

export class GameModeSystem {
  private modes: Map<string, GameMode> = new Map();
  private active: GameMode | null = null;
  private context: GameModeContext | null = null;
  private listeners: Map<string, Set<Listener<any>>> = new Map();
  private running = false;
  private spawnLoadoutResolver: SpawnLoadoutResolver | null = null;

  // ─── Setup ──────────────────────────────────────────────────────────

  /**
   * Provide the concrete engine operations.
   * Must be called before activate().
   */
  setContext(ctx: GameModeContext): void {
    this.context = ctx;
  }

  // ─── Mode registry ──────────────────────────────────────────────────

  registerMode(mode: GameMode): void {
    this.modes.set(mode.name, mode);
  }

  unregisterMode(name: string): void {
    if (this.active?.name === name) this.deactivate();
    this.modes.delete(name);
  }

  listModes(): string[] {
    return [...this.modes.keys()];
  }

  getMode(name: string): GameMode | undefined {
    return this.modes.get(name);
  }

  setSpawnLoadoutResolver(resolver: SpawnLoadoutResolver | null): void {
    this.spawnLoadoutResolver = resolver;
  }

  // ─── Activation ─────────────────────────────────────────────────────

  private applyActivation(name: string): void {
    const mode = this.modes.get(name);
    if (!mode) throw new Error(`[GameModeSystem] Unknown mode: "${name}"`);
    if (!this.context) throw new Error('[GameModeSystem] context not set — call setContext() first.');

    if (this.active?.name === name && this.running) {
      return;
    }

    if (this.active) this.applyDeactivation();

    this.active = mode;
    this.running = true;
    mode.onStart(this.context);
    this._emit('mode_activated', { name });
    gameBus.emit('gameModeStarted', { modeName: name });
  }

  private applyDeactivation(): void {
    if (!this.active || !this.context) return;
    const endedName = this.active.name;
    this.active.onEnd(this.context);
    this._emit('mode_deactivated', { name: endedName });
    gameBus.emit('gameModeEnded', { modeName: endedName, winnerId: null, reason: 'deactivated' });
    this.active = null;
    this.running = false;
  }

  /** Activate a named mode. Direct activation is forbidden; EngineController owns runtime game-mode state. */
  activate(_name: string): void {
    throw new Error('[GameModeSystem] Direct mode activation is forbidden. Use EngineController.setGameMode().');
  }

  deactivate(): void {
    throw new Error('[GameModeSystem] Direct mode deactivation is forbidden. Use EngineController.setGameMode().');
  }

  syncFromController(name: string | null): void {
    if (!name) {
      this.applyDeactivation();
      return;
    }
    this.applyActivation(name);
  }

  getActiveName(): string | null {
    return this.active?.name ?? null;
  }

  captureSnapshot(): GameModeSnapshot {
    return {
      activeMode: this.active?.name ?? null,
      running: this.running,
      payload: this.context?.captureSnapshot?.() ?? null,
    };
  }

  restoreSnapshot(snapshot: GameModeSnapshot): void {
    if (snapshot.activeMode) {
      this.applyActivation(snapshot.activeMode);
    } else {
      this.applyDeactivation();
    }
    this.running = snapshot.running;
    if (snapshot.payload !== undefined) {
      this.context?.restoreSnapshot?.(snapshot.payload);
    }
  }

  // ─── Frame update ───────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.running || !this.active || !this.context) return;
    this.active.onUpdate(this.context, dt);
  }

  // ─── Event forwarding ───────────────────────────────────────────────

  notifyPlayerJoin(playerId: string): void {
    if (!this.running || !this.active || !this.context) return;
    this.active.onPlayerJoin(this.context, playerId);
  }

  notifyPlayerDeath(playerId: string, killedBy: string): void {
    if (!this.running || !this.active || !this.context) return;
    this.active.onPlayerDeath(this.context, playerId, killedBy);
  }

  /**
   * Retrieve the spawn loadout for `playerId` from the active mode.
   * Falls back to `DEFAULT_SPAWN_LOADOUT` when no mode is active or the mode
   * does not override `getSpawnLoadout`.
   */
  getSpawnLoadout(playerId: string): SpawnLoadout {
    const baseLoadout = cloneSpawnLoadout(this.active?.getSpawnLoadout?.(playerId) ?? DEFAULT_SPAWN_LOADOUT);
    return this.spawnLoadoutResolver?.(playerId, baseLoadout) ?? baseLoadout;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: this.running ? 'active' : 'idle',
      active: this.running,
      metrics: {
        modeCount: this.modes.size,
        activeMode: this.active?.name ?? null,
        running: this.running,
        listenerCount: Array.from(this.listeners.values()).reduce((sum, bucket) => sum + bucket.size, 0),
      },
    };
  }

  // ─── Listeners ──────────────────────────────────────────────────────

  on<K extends keyof GameModeEventMap>(event: K, handler: Listener<GameModeEventMap[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private _emit<K extends keyof GameModeEventMap>(event: K, data: GameModeEventMap[K]): void {
    this.listeners.get(event)?.forEach((h) => h(data));
  }
}

// ─── Built-in modes ──────────────────────────────────────────────────────────

// ── Free For All ─────────────────────────────────────────────────────────────

export class FFAMode implements GameMode {
  readonly name: string = 'ffa';
  readonly displayName: string = 'Free For All';

  private killLimit: number;
  private roundTimeSec: number;
  private elapsed = 0;
  private endCalled = false;

  constructor(options: { killLimit?: number; roundTimeSec?: number } = {}) {
    this.killLimit = options.killLimit ?? 10;
    this.roundTimeSec = options.roundTimeSec ?? 180;
  }

  onStart(ctx: GameModeContext): void {
    this.elapsed = 0;
    this.endCalled = false;
    ctx.broadcastEvent('match_start', { mode: this.name, killLimit: this.killLimit, timeSec: this.roundTimeSec });
  }

  onUpdate(ctx: GameModeContext, dt: number): void {
    if (this.endCalled) return;
    this.elapsed += dt;

    // Time limit
    if (this.elapsed >= this.roundTimeSec) {
      const players = ctx.getPlayers().sort((a, b) => b.kills - a.kills);
      const winner = players[0]?.id ?? null;
      this.endCalled = true;
      ctx.endMatch(winner, 'time_limit');
      return;
    }

    // Kill limit
    const leader = ctx.getPlayers().find((p) => p.kills >= this.killLimit);
    if (leader) {
      this.endCalled = true;
      ctx.endMatch(leader.id, 'kill_limit');
    }
  }

  onPlayerJoin(ctx: GameModeContext, playerId: string): void {
    ctx.spawnPlayer(playerId);
  }

  onPlayerDeath(ctx: GameModeContext, playerId: string, killedBy: string): void {
    if (killedBy && killedBy !== playerId) {
      ctx.addScore(killedBy, 1);
    }
    // Respawn after short delay (caller is expected to implement the delay)
    ctx.spawnPlayer(playerId);
  }

  onEnd(_ctx: GameModeContext): void {
    this.endCalled = true;
  }
}

// ── Survival (last-alive wins) ────────────────────────────────────────────────

export class SurvivalMode implements GameMode {
  readonly name = 'survival';
  readonly displayName = 'Survival';

  private alivePlayers: Set<string> = new Set();
  private endCalled = false;

  onStart(ctx: GameModeContext): void {
    this.endCalled = false;
    this.alivePlayers = new Set(ctx.getPlayers().map((p) => p.id));
    ctx.broadcastEvent('match_start', { mode: this.name });
  }

  onUpdate(_ctx: GameModeContext, _dt: number): void {
    // Win condition checked reactively in onPlayerDeath
  }

  onPlayerJoin(_ctx: GameModeContext, playerId: string): void {
    // Late joiners become spectators — do not respawn into survival
    this.alivePlayers.delete(playerId);
  }

  onPlayerDeath(ctx: GameModeContext, playerId: string, _killedBy: string): void {
    if (this.endCalled) return;
    this.alivePlayers.delete(playerId);

    if (this.alivePlayers.size === 1) {
      const [winnerId] = this.alivePlayers;
      this.endCalled = true;
      ctx.endMatch(winnerId, 'last_alive');
    } else if (this.alivePlayers.size === 0) {
      this.endCalled = true;
      ctx.endMatch(null, 'draw');
    }
    // No respawn in survival
  }

  onEnd(_ctx: GameModeContext): void {
    this.endCalled = true;
    this.alivePlayers.clear();
  }
}

export class FreeplayMode implements GameMode {
  readonly name: string = 'freeplay';
  readonly displayName: string = 'Freeplay';

  onStart(ctx: GameModeContext): void {
    ctx.broadcastEvent('mode_start', { mode: this.name });
    for (const player of ctx.getPlayers()) {
      ctx.spawnPlayer(player.id);
    }
  }
  onUpdate(_ctx: GameModeContext, _dt: number): void {}
  onPlayerJoin(ctx: GameModeContext, playerId: string): void { ctx.spawnPlayer(playerId); }
  onPlayerDeath(ctx: GameModeContext, playerId: string): void { ctx.spawnPlayer(playerId); }
  onEnd(_ctx: GameModeContext): void {}
}

export class HordeMode extends FreeplayMode {
  readonly name = 'horde';
  readonly displayName = 'Horde Mode';

  getSpawnLoadout(playerId: string): SpawnLoadout {
    return {
      weapons: ['pistol', 'shotgun', 'debug_fireball'],
      startAmmo: {
        pistol: { current: 16, reserve: 120 },
        shotgun: { current: 8, reserve: 32 },
      },
      maxHealth: 140,
      maxMana: 50,
      maxShield: 0,
      conditionTags: [],
    };
  }
}

export class RoundBasedMode extends FFAMode {
  readonly name = 'round';
  readonly displayName = 'Round Based';
}

export class SandboxMode implements GameMode {
  readonly name = 'sandbox';
  readonly displayName = 'Sandbox';

  onStart(ctx: GameModeContext): void {
    ctx.broadcastEvent('mode_start', { mode: this.name, snapshot: ctx.captureSnapshot?.() ?? null });
  }
  onUpdate(_ctx: GameModeContext, _dt: number): void {}
  onPlayerJoin(ctx: GameModeContext, playerId: string): void { ctx.spawnPlayer(playerId); }
  onPlayerDeath(_ctx: GameModeContext, _playerId: string): void {}
  onEnd(_ctx: GameModeContext): void {}
}

// ── Custom (extensible base) ──────────────────────────────────────────────────

/**
 * Extend this for custom game modes without boilerplate.
 *
 * All lifecycle methods have empty defaults so you only override what you need.
 * The additional hooks below (`onMatchEnd`, `onPlayerRespawn`, `getSpawnLoadout`)
 * are specific to this engine's feature set and have no counterpart in the minimal
 * `GameMode` interface — they are opt-in.
 *
 * @example
 * // client/src/games/my_game/MyGameMode.ts
 * export class MyGameMode extends BaseGameMode {
 *   readonly name = 'my_mode';
 *
 *   protected onInit(ctx: GameModeContext): void {
 *     ctx.broadcastEvent('match_start', { mode: this.name });
 *   }
 *
 *   getSpawnLoadout(_playerId: string): SpawnLoadout {
 *     return { weapons: ['shotgun', 'pistol'], maxHealth: 150 };
 *   }
 * }
 */
export abstract class BaseGameMode implements GameMode {
  abstract readonly name: string;
  readonly displayName?: string;

  protected ctx: GameModeContext | null = null;
  protected elapsed = 0;

  // ── Required GameMode lifecycle (all have safe defaults) ─────────────────

  onStart(ctx: GameModeContext): void {
    this.ctx = ctx;
    this.elapsed = 0;
    this.onInit(ctx);
  }

  onUpdate(ctx: GameModeContext, dt: number): void {
    this.elapsed += dt;
    this.onTick(ctx, dt);
  }

  onPlayerJoin(_ctx: GameModeContext, _playerId: string): void {}
  onPlayerDeath(_ctx: GameModeContext, _playerId: string, _killedBy: string): void {}

  onEnd(ctx: GameModeContext): void {
    this.onMatchEnd(ctx, null);
    this.ctx = null;
  }

  // ── Extended lifecycle hooks (engine-specific, opt-in) ────────────────────

  /** Called when the match ends (win condition reached or forced stop). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMatchEnd(_ctx: GameModeContext, _winnerId: string | null): void {}

  /** Called by SpawnSystem after a player successfully (re)spawns. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPlayerRespawn(_ctx: GameModeContext, _playerId: string): void {}

  /**
   * Return the starting inventory for a spawning/respawning player.
   * Override to customise per-game starting loadout.
   */
  getSpawnLoadout(_playerId: string): SpawnLoadout {
    return { ...DEFAULT_SPAWN_LOADOUT };
  }

  // ── Internal override hooks (simpler API) ─────────────────────────────────

  /** Override for mode startup logic. Replaces `onStart` boilerplate. */
  protected onInit(_ctx: GameModeContext): void {}
  /** Override for per-frame logic. Replaces `onUpdate` boilerplate. */
  protected onTick(_ctx: GameModeContext, _dt: number): void {}
}
