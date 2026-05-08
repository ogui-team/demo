export type WeaponDamageType = 'bullet' | 'explosion' | 'melee' | 'fire' | 'poison' | 'fall' | 'generic';

export type FireMode = 'hitscan' | 'projectile' | 'burst';

export interface WeaponAnimationState {
  equipClip?: string;
  fireClip?: string;
  reloadClip?: string;
}

export interface WeaponProjectileDefinition {
  speed: number;
  lifetime: number;
  radius: number;
  splashRadius?: number;
  splashDamage?: number;
  gravityScale?: number;
}

export interface WeaponDefinition {
  name: string;
  type?: 'hitscan' | 'projectile';
  fireMode: FireMode;
  damage: number;
  damageType?: WeaponDamageType;
  fireRate: number;
  recoil?: number;
  range?: number;
  pellets?: number;
  spread?: number;
  magazineSize?: number;
  reserveAmmoCap?: number;
  initialReserveAmmo?: number;
  ammoPerShot?: number;
  autoReload?: boolean;
  reloadTime?: number;
  burstCount?: number;
  burstInterval?: number;
  pickupPrefab?: string;
  projectileAssetKey?: string;
  projectilePrefab?: string;
  inventorySlot?: number;
  animation?: WeaponAnimationState;
  projectile?: WeaponProjectileDefinition;
}

export interface AuthoritativeWeaponRule {
  fireRate: number;
  reloadTime: number;
  magazineSize: number;
  reserveAmmo: number;
  damage: number;
  range: number;
  projectileSpeed: number | null;
  projectileLifetime: number | null;
}

export const WEAPON_PRESETS: Readonly<Record<string, WeaponDefinition>> = {
  pistol: {
    name: 'Pistol',
    type: 'hitscan',
    fireMode: 'hitscan',
    damage: 25,
    damageType: 'bullet',
    fireRate: 2.5,
    recoil: 0.12,
    range: 90,
    spread: 0.01,
    pellets: 1,
    magazineSize: 12,
    reserveAmmoCap: 96,
    initialReserveAmmo: 48,
    autoReload: true,
    reloadTime: 1.2,
    animation: { equipClip: 'pistol_equip', fireClip: 'pistol_fire', reloadClip: 'pistol_reload' },
  },
  shotgun: {
    name: 'Shotgun',
    type: 'hitscan',
    fireMode: 'hitscan',
    damage: 14,
    damageType: 'bullet',
    fireRate: 0.95,
    recoil: 0.32,
    range: 34,
    spread: 0.09,
    pellets: 8,
    magazineSize: 6,
    reserveAmmoCap: 36,
    initialReserveAmmo: 24,
    autoReload: true,
    reloadTime: 2.35,
    pickupPrefab: 'pickup_shotgun',
    animation: { equipClip: 'shotgun_equip', fireClip: 'shotgun_fire', reloadClip: 'shotgun_reload' },
  },
  rifle: {
    name: 'Rifle',
    type: 'hitscan',
    fireMode: 'hitscan',
    damage: 18,
    damageType: 'bullet',
    fireRate: 7,
    recoil: 0.08,
    range: 140,
    spread: 0.008,
    pellets: 1,
    magazineSize: 30,
    reserveAmmoCap: 150,
    initialReserveAmmo: 120,
    autoReload: true,
    reloadTime: 2.1,
    animation: { equipClip: 'rifle_equip', fireClip: 'rifle_fire', reloadClip: 'rifle_reload' },
  },
  burstRifle: {
    name: 'Burst Rifle',
    type: 'hitscan',
    fireMode: 'burst',
    damage: 16,
    damageType: 'bullet',
    fireRate: 3,
    recoil: 0.1,
    range: 130,
    spread: 0.01,
    pellets: 1,
    magazineSize: 24,
    reserveAmmoCap: 120,
    initialReserveAmmo: 96,
    autoReload: true,
    reloadTime: 2,
    burstCount: 3,
    burstInterval: 0.08,
    animation: { equipClip: 'burst_equip', fireClip: 'burst_fire', reloadClip: 'burst_reload' },
  },
  grenadeLauncher: {
    name: 'Grenade Launcher',
    type: 'projectile',
    fireMode: 'projectile',
    damage: 85,
    damageType: 'explosion',
    fireRate: 0.75,
    recoil: 0.45,
    magazineSize: 4,
    reserveAmmoCap: 24,
    initialReserveAmmo: 12,
    autoReload: true,
    reloadTime: 2.8,
    projectileAssetKey: 'model_barrel_rust',
    projectile: { speed: 18, lifetime: 3.5, radius: 0.18, splashRadius: 4.5, splashDamage: 85, gravityScale: 0.55 },
    animation: { equipClip: 'grenade_equip', fireClip: 'grenade_fire', reloadClip: 'grenade_reload' },
  },
  debug_fireball: {
    name: 'Fireball Tome',
    type: 'projectile',
    fireMode: 'projectile',
    damage: 25,
    damageType: 'fire',
    fireRate: 0.9,
    recoil: 0.05,
    range: 36,
    magazineSize: -1,
    reserveAmmoCap: -1,
    initialReserveAmmo: -1,
    autoReload: false,
    inventorySlot: 2,
    projectile: { speed: 20, lifetime: 2.8, radius: 0.14, splashRadius: 1.8, splashDamage: 18, gravityScale: 0.02 },
    animation: { equipClip: 'spellbook_equip', fireClip: 'spellbook_cast' },
  },
  flareGun: {
    name: 'Flare Gun',
    type: 'projectile',
    fireMode: 'projectile',
    damage: 40,
    damageType: 'fire',
    fireRate: 1,
    recoil: 0.2,
    magazineSize: 1,
    reserveAmmoCap: 12,
    initialReserveAmmo: 8,
    autoReload: true,
    reloadTime: 1.4,
    projectileAssetKey: 'model_hanging_light',
    projectile: { speed: 22, lifetime: 2.6, radius: 0.12, splashRadius: 0, gravityScale: 0.1 },
    animation: { equipClip: 'flare_equip', fireClip: 'flare_fire', reloadClip: 'flare_reload' },
  },
  macuahuitl: {
    name: 'Macuahuitl',
    type: 'hitscan',
    fireMode: 'hitscan',
    damage: 52,
    damageType: 'melee',
    fireRate: 1.3,
    recoil: 0.22,
    range: 3.4,
    spread: 0.03,
    pellets: 1,
    magazineSize: -1,
    reserveAmmoCap: -1,
    initialReserveAmmo: -1,
    autoReload: false,
    inventorySlot: 0,
    animation: { equipClip: 'macuahuitl_equip', fireClip: 'macuahuitl_swing' },
  },
  spiritSwarmStaff: {
    name: 'Spirit-Swarm Staff',
    type: 'projectile',
    fireMode: 'projectile',
    damage: 28,
    damageType: 'fire',
    fireRate: 1.65,
    recoil: 0.08,
    magazineSize: -1,
    reserveAmmoCap: -1,
    initialReserveAmmo: -1,
    autoReload: false,
    projectile: { speed: 13, lifetime: 3.4, radius: 0.18, splashRadius: 1.8, splashDamage: 18, gravityScale: 0.02 },
    inventorySlot: 1,
    animation: { equipClip: 'staff_equip', fireClip: 'staff_cast' },
  },
  poisonBlowgun: {
    name: 'Poison Blowgun',
    type: 'hitscan',
    fireMode: 'hitscan',
    damage: 19,
    damageType: 'poison',
    fireRate: 2.6,
    recoil: 0.04,
    range: 140,
    spread: 0.005,
    pellets: 1,
    magazineSize: 6,
    reserveAmmoCap: 42,
    initialReserveAmmo: 42,
    autoReload: true,
    reloadTime: 1.5,
    inventorySlot: 1,
    animation: { equipClip: 'blowgun_equip', fireClip: 'blowgun_fire', reloadClip: 'blowgun_reload' },
  },
};

const DEFAULT_WEAPON_ID = 'pistol';

export function getWeaponDefinition(weaponId: string): WeaponDefinition {
  return WEAPON_PRESETS[weaponId] ?? WEAPON_PRESETS[DEFAULT_WEAPON_ID];
}

export function sanitizeWeaponId(value: unknown, fallback: string): string {
  const weaponId = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return WEAPON_PRESETS[weaponId] ? weaponId : fallback;
}

export function getAuthoritativeWeaponRule(weaponId: string): AuthoritativeWeaponRule {
  const definition = getWeaponDefinition(weaponId);
  const pellets = Math.max(1, definition.pellets ?? 1);
  return {
    fireRate: definition.fireRate,
    reloadTime: definition.reloadTime ?? 0,
    magazineSize: definition.magazineSize ?? -1,
    reserveAmmo: definition.initialReserveAmmo ?? definition.reserveAmmoCap ?? -1,
    damage: definition.damage * pellets,
    range: definition.range ?? 0,
    projectileSpeed: definition.projectile?.speed ?? null,
    projectileLifetime: definition.projectile?.lifetime ?? null,
  };
}