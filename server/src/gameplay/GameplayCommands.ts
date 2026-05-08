import { ABILITY_VALIDATION_PROFILES, type PlayerDebugStatusOverride } from '../rules/AbilityRules';
import { type GameplayEvent, type PlayerMovementIntent } from './GameplayTypes';
import { type Vec3 } from '../sessionContracts';
import { buildDebugStatusOverride, refreshPlayerStatusMovementModifier, type StatusTrackedPlayer } from './StatusRuntime';
import { getWeaponRule, sanitizeWeaponId } from '../rules/WeaponRules';
import { ensureWeaponState, type WeaponRuntimeState } from '../rules/WeaponRuntime';

export type GameplayCommand = 'weapon_equip' | 'weapon_reload' | 'player_shoot' | 'use_ability' | 'debug_set_status_movement';

export interface GameplayCommandActor extends StatusTrackedPlayer {
  id: string;
  dead: boolean;
  equipment: string[];
  mana: number;
  attackSpeed: number;
  pendingMovementIntent?: PlayerMovementIntent | null;
}

interface GameplayCommandExecutionOptions<TActor extends GameplayCommandActor> {
  actor: TActor;
  command: GameplayCommand;
  data: Record<string, unknown>;
  weaponStates: Map<string, WeaponRuntimeState>;
  canUseWeapons: (actor: TActor) => boolean;
  syncPlayerEntity: (playerId: string) => void;
  pushGameplayEvent: (event: GameplayEvent) => void;
  dispatchGameplayCommand: (command: GameplayCommand, data: Record<string, unknown>) => void;
  sanitizeOrigin: (actor: TActor, raw: unknown) => Vec3;
  sanitizeDirection: (raw: unknown) => Vec3;
  sanitizeTimestamp: (raw: unknown) => number;
  validateHitscan: (playerId: string, weaponId: string, origin: Vec3, direction: Vec3, timestamp: number) => string | null;
  applyDamage: (targetId: string, amount: number, sourceId: string) => void;
  validateAbilityUse: (actor: TActor, abilityId: string, data: Record<string, unknown>, now: number) => { accepted: boolean; cooldownSec: number; manaCost: number };
  resolveAbilityProjectileTarget: (playerId: string, origin: Vec3, direction: Vec3, range: number, timestamp: number) => string | null;
  buildAbilityMovementIntent: (actor: TActor, abilityId: string, data: Record<string, unknown>) => PlayerMovementIntent | undefined;
  applyAbilityMovementStatuses: (actor: TActor, abilityId: string, data: Record<string, unknown>, now: number) => void;
  readFiniteNumber: (value: unknown) => number | undefined;
  clamp01: (value: number) => number;
  allowDebugStatusHooks: boolean;
}

export function executeGameplayCommand<TActor extends GameplayCommandActor>(options: GameplayCommandExecutionOptions<TActor>): void {
  const { actor, command, data } = options;

  switch (command) {
    case 'weapon_equip': {
      if (actor.dead) break;
      const weaponId = sanitizeWeaponId(data.weaponId, actor.equipment[0] ?? 'pistol');
      const weaponState = ensureWeaponState(options.weaponStates, actor.id, weaponId);
      actor.equipment = [weaponId, ...actor.equipment.filter((item) => item !== weaponId)];
      weaponState.equippedWeaponId = weaponId;
      weaponState.isReloading = false;
      weaponState.reloadEndsAt = 0;
      options.syncPlayerEntity(actor.id);
      options.pushGameplayEvent({
        type: 'weapon_equip',
        playerId: actor.id,
        weaponId,
        equipment: [...actor.equipment],
        timestamp: Date.now(),
      });
      break;
    }
    case 'weapon_reload': {
      if (!options.canUseWeapons(actor)) break;
      const weaponId = sanitizeWeaponId(data.weaponId, actor.equipment[0] ?? 'pistol');
      const weaponState = ensureWeaponState(options.weaponStates, actor.id, weaponId);
      const rule = getWeaponRule(weaponId);
      const now = Date.now();
      if (weaponState.isReloading && weaponState.reloadEndsAt > now) break;
      if (weaponState.currentAmmo >= rule.magazineSize || weaponState.reserveAmmo <= 0) break;

      weaponState.equippedWeaponId = weaponId;
      weaponState.isReloading = true;
      weaponState.reloadEndsAt = now + Math.round(rule.reloadTime * 1000);
      options.syncPlayerEntity(actor.id);
      options.pushGameplayEvent({
        type: 'weapon_reload',
        playerId: actor.id,
        weaponId,
        timestamp: now,
      });
      break;
    }
    case 'player_shoot': {
      if (!options.canUseWeapons(actor)) break;
      const weaponId = sanitizeWeaponId(data.weapon, actor.equipment[0] ?? 'pistol');
      const weaponState = ensureWeaponState(options.weaponStates, actor.id, weaponId);
      const rule = getWeaponRule(weaponId);
      const now = Date.now();
      if (weaponState.isReloading && weaponState.reloadEndsAt > now) break;

      const effectiveFireRate = Math.max(0.01, rule.fireRate * Math.max(0.1, actor.attackSpeed || 1));
      const minIntervalMs = Math.max(40, Math.round((1000 / effectiveFireRate) * 0.85));
      if (now - weaponState.lastShotAt < minIntervalMs) break;

      if (weaponState.currentAmmo <= 0) {
        if (weaponState.reserveAmmo > 0) {
          options.dispatchGameplayCommand('weapon_reload', { weaponId });
        }
        break;
      }

      const origin = options.sanitizeOrigin(actor, data.origin);
      const direction = options.sanitizeDirection(data.direction);
      const timestamp = options.sanitizeTimestamp(data.timestamp);
      const shotId = typeof data.shotId === 'string' && data.shotId.trim() ? data.shotId : `shot_${actor.id}_${now}`;

      weaponState.equippedWeaponId = weaponId;
      weaponState.lastShotAt = now;
      weaponState.isReloading = false;
      weaponState.reloadEndsAt = 0;
      weaponState.currentAmmo = Math.max(0, weaponState.currentAmmo - 1);

      const hitId = options.validateHitscan(actor.id, weaponId, origin, direction, timestamp);
      if (hitId) {
        options.applyDamage(hitId, rule.damage, actor.id);
      }

      options.syncPlayerEntity(actor.id);
      options.pushGameplayEvent({
        type: 'player_shoot',
        shooterId: actor.id,
        weaponId,
        origin,
        direction,
        hitId,
        shotId,
        timestamp,
      });
      break;
    }
    case 'use_ability': {
      if (actor.dead) break;
      const abilityId = typeof data.abilityId === 'string' ? data.abilityId.trim() : '';
      if (!abilityId) break;

      const now = Date.now();
      const validation = options.validateAbilityUse(actor, abilityId, data, now);
      if (!validation.accepted) break;

      actor.mana = Math.max(0, actor.mana - validation.manaCost);
      const movementIntent = options.buildAbilityMovementIntent(actor, abilityId, data);
      if (movementIntent) {
        actor.pendingMovementIntent = movementIntent;
      }

      const profile = ABILITY_VALIDATION_PROFILES[abilityId];
      let hitId: string | null = null;
      if (profile?.delivery === 'Projectile') {
        const origin = options.sanitizeOrigin(actor, data.origin);
        const direction = options.sanitizeDirection(data.direction);
        const range = profile.maxRange ?? 0;
        hitId = options.resolveAbilityProjectileTarget(actor.id, origin, direction, range, now);
        if (hitId) {
          options.applyDamage(hitId, 25, actor.id);
        }
      }

      options.applyAbilityMovementStatuses(actor, abilityId, data, now);
      options.syncPlayerEntity(actor.id);
      options.pushGameplayEvent({
        type: 'use_ability',
        playerId: actor.id,
        abilityId,
        cooldown: validation.cooldownSec,
        movementIntent,
        hitId,
        timestamp: now,
      });
      break;
    }
    case 'debug_set_status_movement': {
      if (!options.allowDebugStatusHooks) break;
      actor.debugStatusOverride = buildDebugStatusOverride(data, options.readFiniteNumber, options.clamp01);
      refreshPlayerStatusMovementModifier(actor, Date.now());
      options.syncPlayerEntity(actor.id);
      break;
    }
    default:
      break;
  }
}

export function mapLegacyGameplayAction(action: string): Exclude<GameplayCommand, 'debug_set_status_movement'> | null {
  switch (action) {
    case 'WEAPON_EQUIP':
      return 'weapon_equip';
    case 'WEAPON_RELOAD':
      return 'weapon_reload';
    case 'PLAYER_SHOOT':
      return 'player_shoot';
    case 'USE_ABILITY':
      return 'use_ability';
    default:
      return null;
  }
}