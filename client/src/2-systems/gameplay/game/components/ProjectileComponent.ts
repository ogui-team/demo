/**
 * ProjectileComponent
 * Turns any EngineObject into a moving projectile.
 *
 * The ObjectCreatorSystem reads this component each frame and updates
 * the object's position via the TransformSystem.  When lifetime expires
 * or a hit is detected the object is destroyed.
 */

export interface ProjectileComponent {
  readonly type: 'projectile';
  /** Initial speed in units/second */
  speed: number;
  /** Normalised direction vector (set at spawn time from shooter's camera forward) */
  direction: { x: number; y: number; z: number };
  /** Remaining lifetime in seconds */
  lifetime: number;
  /** Maximum lifetime in seconds */
  maxLifetime: number;
  /** Gravity multiplier (0 = no gravity, 1 = full) */
  gravity?: number;
  /** ID of entity that fired this projectile (for hit attribution) */
  ownerId?: string;
  /** Damage dealt on hit (forwarded to DamageComponent if present) */
  impactDamage?: number;
  /** Whether to destroy the projectile on first hit */
  destroyOnImpact?: boolean;
  /** Whether the projectile has already hit something this tick */
  spent?: boolean;
}

export function createProjectileComponent(
  speed: number,
  direction: { x: number; y: number; z: number },
  lifetime = 3,
  options: Partial<Omit<ProjectileComponent, 'type' | 'speed' | 'direction' | 'lifetime' | 'maxLifetime'>> = {},
): ProjectileComponent {
  return {
    type: 'projectile',
    speed,
    direction: { ...direction },
    lifetime,
    maxLifetime: lifetime,
    gravity: 0,
    destroyOnImpact: true,
    ...options,
  };
}
