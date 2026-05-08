import {
  getAuthoritativeWeaponRule,
  sanitizeWeaponId as sanitizeSharedWeaponId,
  type AuthoritativeWeaponRule,
} from '@shared/contracts';

export type ServerWeaponRule = AuthoritativeWeaponRule;

export function getWeaponRule(weaponId: string): ServerWeaponRule {
  return getAuthoritativeWeaponRule(weaponId);
}

export function sanitizeWeaponId(value: unknown, fallback: string): string {
  return sanitizeSharedWeaponId(value, fallback);
}