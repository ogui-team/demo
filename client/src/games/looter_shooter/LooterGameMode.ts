/**
 * LooterGameMode.ts
 *
 * Example game mode for "My Looter Shooter".
 *
 * Demonstrates the `BaseGameMode` API:
 *   - onInit()           — called when the mode is activated
 *   - onPlayerJoin()     — called when a player connects
 *   - onPlayerDeath()    — called when a player dies
 *   - onTick()           — called every frame (deltaTime in seconds)
 *   - getSpawnLoadout()  — returns the weapon/health kit for a spawning player
 */

import {
  BaseGameMode,
  GameModeContext,
  SpawnLoadout,
} from '../../2-systems/gameplay/game/GameModeSystem';

export class LooterFreeplayMode extends BaseGameMode {
  // ── Identity ──────────────────────────────────────────────────────────────

  readonly name        = 'looter_freeplay';
  readonly displayName = 'Looter Freeplay';

  // ── Lifecycle hooks ───────────────────────────────────────────────────────

  protected onInit(ctx: GameModeContext): void {
    ctx.broadcastEvent('match_start', { mode: this.name });

    // Spawn every player that is already connected when the mode activates.
    for (const player of ctx.getPlayers()) {
      ctx.spawnPlayer(player.id);
    }

    console.log('[LooterFreeplayMode] Match started — all players spawned.');
  }

  onPlayerJoin(ctx: GameModeContext, playerId: string): void {
    ctx.spawnPlayer(playerId);
    console.log(`[LooterFreeplayMode] Player "${playerId}" joined and spawned.`);
  }

  onPlayerDeath(ctx: GameModeContext, playerId: string, _killerId?: string): void {
    // Instant-respawn in freeplay — no death timer.
    ctx.spawnPlayer(playerId);
    console.log(`[LooterFreeplayMode] Player "${playerId}" respawned.`);
  }

  onTick(_ctx: GameModeContext, _dt: number): void {
    // Free-play has no win condition; nothing to tick.
  }

  // ── Spawn loadout ─────────────────────────────────────────────────────────

  /**
   * Every player starts with a pistol and a shotgun.
   *
   * Weapon IDs must match keys in `ProjectConfig.weapons` (or the built-in
   * WEAPON_PRESETS in WeaponSystem).
   */
  getSpawnLoadout(_playerId: string): SpawnLoadout {
    return {
      weapons: ['shotgun', 'pistol'],
      startAmmo: {
        shotgun: { current: 6,  reserve: 36 },
        pistol:  { current: 12, reserve: 96 },
      },
      maxHealth: 150,
      maxMana:   50,
    };
  }
}
