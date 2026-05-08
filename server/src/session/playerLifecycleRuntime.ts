import type { PlayerState } from '../core/GameSession';
import type { Vec3 } from '../sessionContracts';
import { buildPlayerScoreSummary } from './roundLifecycle';
import { resetPlayerRuntimeState } from './playerSessionRuntime';
import { ensureWeaponState, resetWeaponState, type WeaponRuntimeState } from '../rules/WeaponRuntime';

interface ApplyPlayerDamageOptions {
  players: Map<string, PlayerState>;
  targetId: string;
  amount: number;
  sourceId: string;
  killLimit: number;
  now: number;
  getRespawnDelayMs: () => number;
  syncPlayerEntity: (playerId: string) => void;
  broadcastAll: (message: unknown) => void;
  broadcastScoreUpdate: () => void;
  scheduleRespawn: (playerId: string) => void;
  onKillLimitReached: () => void;
  sendDamageTaken: (player: PlayerState, payload: { amount: number; sourceId: string; health: number; armor: number }) => void;
}

interface ScheduleRespawnOptions {
  playerId: string;
  getPlayer: (playerId: string) => PlayerState | undefined;
  isRoundActive: () => boolean;
  respawnPlayer: (playerId: string) => void;
}

interface ProcessRespawnsOptions {
  players: Iterable<PlayerState>;
  now: number;
  isRoundActive: () => boolean;
  respawnPlayer: (playerId: string) => void;
}

interface RespawnPlayerOptions {
  playerId: string;
  players: Map<string, PlayerState>;
  weaponStates: Map<string, WeaponRuntimeState>;
  resolveSpawnPoint: (index: number, excludePlayerId?: string) => Vec3;
  syncPlayerEntity: (playerId: string) => void;
  broadcastAll: (message: unknown) => void;
  broadcastScoreUpdate: () => void;
}

export function applyPlayerDamage(options: ApplyPlayerDamageOptions): void {
  const player = options.players.get(options.targetId);
  if (!player || player.dead) return;

  const mitigatedAmount = Math.max(0, options.amount * (1 - Math.max(0, Math.min(0.95, player.damageReduction))));
  const absorbed = Math.min(player.armor, mitigatedAmount);
  player.armor -= absorbed;
  player.health -= mitigatedAmount - absorbed;
  player.lastUpdate = options.now;

  if (player.health <= 0) {
    player.health = 0;
    player.dead = true;
    player.velocity = { x: 0, y: 0, z: 0 };
    player.deaths += 1;
    player.respawnAt = options.now + options.getRespawnDelayMs();

    const killer = options.players.get(options.sourceId);
    if (killer && killer.id !== player.id) {
      killer.kills += 1;
      killer.exp += 100;
      killer.level = Math.max(1, 1 + Math.floor(killer.exp / 250));
      options.syncPlayerEntity(killer.id);
      options.broadcastAll({
        type: 'PLAYER_KILLED',
        killerId: killer.id,
        targetId: player.id,
        stats: buildPlayerScoreSummary(killer),
      });
    }

    options.syncPlayerEntity(player.id);
    options.broadcastAll({ type: 'PLAYER_DIED', playerId: options.targetId, killedBy: options.sourceId });
    options.broadcastScoreUpdate();

    if (killer && killer.kills >= options.killLimit) {
      options.onKillLimitReached();
      return;
    }

    options.scheduleRespawn(player.id);
    return;
  }

  options.syncPlayerEntity(player.id);
  options.sendDamageTaken(player, {
    amount: mitigatedAmount - absorbed,
    sourceId: options.sourceId,
    health: player.health,
    armor: player.armor,
  });
}

export function processRespawns(options: ProcessRespawnsOptions): void {
  if (!options.isRoundActive()) {
    return;
  }

  for (const player of options.players) {
    if (player.dead && player.respawnAt && player.respawnAt <= options.now) {
      options.respawnPlayer(player.id);
    }
  }
}

export function scheduleRespawn(options: ScheduleRespawnOptions): void {
  const player = options.getPlayer(options.playerId);
  if (!player || !player.respawnAt) return;

  const delay = Math.max(0, player.respawnAt - Date.now());
  setTimeout(() => {
    const current = options.getPlayer(options.playerId);
    if (!current || !current.dead || !options.isRoundActive()) return;
    options.respawnPlayer(options.playerId);
  }, delay);
}

export function respawnPlayer(options: RespawnPlayerOptions): void {
  const player = options.players.get(options.playerId);
  if (!player) return;

  const spawn = options.resolveSpawnPoint(player.deaths + player.kills, player.id);
  resetPlayerRuntimeState(player, spawn);

  const weaponId = player.equipment[0] ?? 'pistol';
  const weaponState = ensureWeaponState(options.weaponStates, player.id, weaponId);
  weaponState.isReloading = false;
  weaponState.reloadEndsAt = 0;
  weaponState.lastShotAt = 0;
  resetWeaponState(options.weaponStates, player.id, weaponId);

  options.syncPlayerEntity(player.id);
  options.broadcastAll({ type: 'PLAYER_RESPAWN', playerId: player.id, position: { ...player.position } });
  options.broadcastScoreUpdate();
}