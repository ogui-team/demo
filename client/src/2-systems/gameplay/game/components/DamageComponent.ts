/**
 * DamageComponent
 * Describes the damage this object deals when it hits an entity.
 * Works in conjunction with ColliderComponent (trigger) and ProjectileComponent.
 */

export type DamageType = 'physical' | 'fire' | 'explosion' | 'electric' | 'generic';

export interface DamageComponent {
  readonly type: 'damage';
  amount: number;
  damageType: DamageType;
  /** Radius for area-of-effect damage (0 = point damage) */
  radius?: number;
  /** Whether the component is currently active (e.g. disabled after first hit) */
  active?: boolean;
  /** Source/owner player ID for kill credit */
  sourceId?: string;
}

export function createDamageComponent(
  amount: number,
  damageType: DamageType = 'physical',
  options: Partial<Omit<DamageComponent, 'type' | 'amount' | 'damageType'>> = {},
): DamageComponent {
  return {
    type: 'damage',
    amount,
    damageType,
    radius: 0,
    active: true,
    ...options,
  };
}
