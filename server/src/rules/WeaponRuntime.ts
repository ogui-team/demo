import { getWeaponRule } from './WeaponRules';

export interface WeaponRuntimeState {
  equippedWeaponId: string;
  lastShotAt: number;
  reloadEndsAt: number;
  currentAmmo: number;
  reserveAmmo: number;
  isReloading: boolean;
}

export function ensureWeaponState(
  weaponStates: Map<string, WeaponRuntimeState>,
  playerId: string,
  weaponId: string,
): WeaponRuntimeState {
  const existing = weaponStates.get(playerId);
  if (existing) {
    existing.equippedWeaponId = weaponId || existing.equippedWeaponId;
    return existing;
  }

  const resolvedWeaponId = weaponId || 'pistol';
  const rule = getWeaponRule(resolvedWeaponId);
  const created: WeaponRuntimeState = {
    equippedWeaponId: resolvedWeaponId,
    lastShotAt: 0,
    reloadEndsAt: 0,
    currentAmmo: rule.magazineSize,
    reserveAmmo: rule.reserveAmmo,
    isReloading: false,
  };
  weaponStates.set(playerId, created);
  return created;
}

export function resetWeaponState(
  weaponStates: Map<string, WeaponRuntimeState>,
  playerId: string,
  weaponId: string,
): void {
  const weaponState = ensureWeaponState(weaponStates, playerId, weaponId);
  const rule = getWeaponRule(weaponId);
  weaponState.equippedWeaponId = weaponId;
  weaponState.currentAmmo = rule.magazineSize;
  weaponState.reserveAmmo = rule.reserveAmmo;
  weaponState.isReloading = false;
  weaponState.reloadEndsAt = 0;
  weaponState.lastShotAt = 0;
}

export function updateWeaponRuntime(
  weaponStates: Map<string, WeaponRuntimeState>,
  now: number,
): string[] {
  const updatedPlayerIds: string[] = [];
  for (const [playerId, weaponState] of weaponStates) {
    if (!weaponState.isReloading || weaponState.reloadEndsAt > now) continue;
    const rule = getWeaponRule(weaponState.equippedWeaponId);
    const neededAmmo = Math.max(0, rule.magazineSize - weaponState.currentAmmo);
    const refill = Math.min(neededAmmo, weaponState.reserveAmmo);
    weaponState.currentAmmo += refill;
    weaponState.reserveAmmo -= refill;
    weaponState.isReloading = false;
    weaponState.reloadEndsAt = 0;
    updatedPlayerIds.push(playerId);
  }
  return updatedPlayerIds;
}