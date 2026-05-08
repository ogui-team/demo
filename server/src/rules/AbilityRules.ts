import { type Vec3 } from '../sessionContracts';

export type MovementStatusId = 'status_rooted' | 'status_chilled' | 'status_electrocuted';

export interface PlayerMovementStatus {
  statusId: MovementStatusId;
  expiresAt: number;
  sourceAbilityId?: string;
}

export interface PlayerStatusMovementModifier {
  speedMultiplier?: number;
  blockMovement?: boolean;
  impulseOverride?: Vec3;
}

export interface PlayerDebugStatusOverride {
  rooted: boolean;
  chilled: boolean;
  electrocuted: boolean;
  speedMultiplier: number;
  impulseMagnitude: number;
}

export interface AbilityStatusApplicationProfile {
  kind: 'aoe_sphere' | 'aoe_ring' | 'hitscan';
  statusId: MovementStatusId;
  radius?: number;
  innerRadius?: number;
  range?: number;
}

export type AbilityDelivery = 'Hitscan' | 'Projectile' | 'AoE' | 'Summon';

export interface AbilityValidationProfile {
  delivery: AbilityDelivery;
  cooldownSec: number;
  manaCost: number;
  maxRange?: number;
  maxRadius?: number;
  projectileSpeed?: number;
  maxLifetimeSec?: number;
  maxActiveSummons?: number;
}

export const ABILITY_VALIDATION_PROFILES: Readonly<Record<string, AbilityValidationProfile>> = {
  ability_shoot_pistol: { delivery: 'Hitscan', cooldownSec: 0.4, manaCost: 0, maxRange: 90 },
  ability_shoot_shotgun: { delivery: 'Hitscan', cooldownSec: 1.05, manaCost: 0, maxRange: 34 },
  ability_assault_rifle: { delivery: 'Hitscan', cooldownSec: 0.12, manaCost: 0, maxRange: 140 },
  ability_sniper_shot: { delivery: 'Hitscan', cooldownSec: 2.5, manaCost: 15, maxRange: 180 },
  ability_lightning_chain: { delivery: 'Hitscan', cooldownSec: 3.5, manaCost: 35, maxRange: 26 },
  ability_launch_grenade: { delivery: 'Projectile', cooldownSec: 1.33, manaCost: 20, maxRange: 60, projectileSpeed: 18, maxLifetimeSec: 3 },
  ability_fireball:       { delivery: 'Projectile', cooldownSec: 1.8, manaCost: 0,  maxRange: 90, projectileSpeed: 30, maxLifetimeSec: 3 },
  ability_flare_shot: { delivery: 'Projectile', cooldownSec: 1.0, manaCost: 10, maxRange: 80, projectileSpeed: 24, maxLifetimeSec: 3.5 },
  ability_ice_lance: { delivery: 'Projectile', cooldownSec: 2.2, manaCost: 18, maxRange: 70, projectileSpeed: 28, maxLifetimeSec: 2.5 },
  ability_arcane_burst: { delivery: 'AoE', cooldownSec: 5, manaCost: 30, maxRange: 14, maxRadius: 8 },
  ability_poison_nova: { delivery: 'AoE', cooldownSec: 7, manaCost: 40, maxRange: 10, maxRadius: 10 },
  ability_shield_dash: { delivery: 'AoE', cooldownSec: 6, manaCost: 25, maxRange: 12, maxRadius: 5 },
  ability_holy_smite: { delivery: 'AoE', cooldownSec: 6, manaCost: 28, maxRange: 18, maxRadius: 6 },
  ability_incineration_cone: { delivery: 'AoE', cooldownSec: 4.2, manaCost: 22, maxRange: 16, maxRadius: 7 },
  ability_arc_ring: { delivery: 'AoE', cooldownSec: 5.4, manaCost: 24, maxRange: 16, maxRadius: 8 },
  ability_summon_skeleton: { delivery: 'Summon', cooldownSec: 8, manaCost: 30, maxRange: 6, maxActiveSummons: 3, maxLifetimeSec: 30 },
  ability_summon_fire_imp: { delivery: 'Summon', cooldownSec: 12, manaCost: 45, maxRange: 8, maxActiveSummons: 2, maxLifetimeSec: 45 },
  ability_summon_ice_golem: { delivery: 'Summon', cooldownSec: 20, manaCost: 60, maxRange: 8, maxActiveSummons: 1, maxLifetimeSec: 60 },
  ability_summon_shadow_wraith: { delivery: 'Summon', cooldownSec: 18, manaCost: 50, maxRange: 10, maxActiveSummons: 2, maxLifetimeSec: 45 },
  ability_summon_guardian_drone: { delivery: 'Summon', cooldownSec: 14, manaCost: 40, maxRange: 10, maxActiveSummons: 2, maxLifetimeSec: 40 },
};

export const MOVEMENT_STATUS_DURATIONS_MS: Readonly<Record<MovementStatusId, number>> = {
  status_rooted: 2000,
  status_chilled: 3000,
  status_electrocuted: 800,
};

export const ABILITY_STATUS_APPLICATIONS: Readonly<Partial<Record<string, AbilityStatusApplicationProfile>>> = {
  ability_arcane_burst: { kind: 'aoe_sphere', statusId: 'status_rooted', radius: 6 },
  ability_arc_ring: { kind: 'aoe_ring', statusId: 'status_electrocuted', innerRadius: 3, radius: 9 },
  ability_lightning_chain: { kind: 'hitscan', statusId: 'status_electrocuted', range: 18 },
};