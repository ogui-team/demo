import {
  BaseGameMode,
  type GameModeContext,
  type SpawnLoadout,
} from './GameModeSystem';

export class HordeGameMode extends BaseGameMode {
  readonly name = 'horde';
  readonly displayName = 'Horde Mode';

  protected onInit(ctx: GameModeContext): void {
    ctx.broadcastEvent('match_start', { mode: this.name });

    for (const player of ctx.getPlayers()) {
      ctx.spawnPlayer(player.id);
    }

    console.log('[HordeGameMode] Horde arena ready — press Z to begin.');
  }

  onPlayerJoin(ctx: GameModeContext, playerId: string): void {
    ctx.spawnPlayer(playerId);
    console.log(`[HordeGameMode] Player "${playerId}" joined and spawned.`);
  }

  onPlayerDeath(ctx: GameModeContext, playerId: string, _killerId?: string): void {
    ctx.spawnPlayer(playerId);
    console.log(`[HordeGameMode] Player "${playerId}" respawned.`);
  }

  onTick(_ctx: GameModeContext, _dt: number): void {
    // Wave logic lives in HordeSystem; nothing to do here.
  }

  getSpawnLoadout(_playerId: string): SpawnLoadout {
    return {
      weapons: ['debug_fireball', 'shotgun', 'pistol'],
      startAmmo: {
        shotgun: { current: 8, reserve: 48 },
        pistol: { current: 16, reserve: 120 },
      },
      maxHealth: 100,
      maxMana: 50,
      maxShield: 0,
      conditionTags: [],
    };
  }
}