import {
  ABILITY_STATUS_APPLICATIONS,
  MOVEMENT_STATUS_DURATIONS_MS,
  type MovementStatusId,
  type PlayerMovementStatus,
} from '../rules/AbilityRules';
import { type Vec3 } from '../sessionContracts';
import { refreshPlayerStatusMovementModifier, type StatusTrackedPlayer } from './StatusRuntime';

export interface StatusEffectPlayer extends StatusTrackedPlayer {
  id: string;
  dead: boolean;
  position: Vec3;
  activeMovementStatuses?: PlayerMovementStatus[];
}

interface ApplyAbilityMovementStatusesOptions<TPlayer extends StatusEffectPlayer> {
  actor: TPlayer;
  abilityId: string;
  data: Record<string, unknown>;
  now: number;
  players: Iterable<TPlayer>;
  playerCollisionRadius: number;
  sanitizeOrigin: (actor: TPlayer, raw: unknown) => Vec3;
  sanitizeDirection: (raw: unknown) => Vec3;
  distance: (left: Vec3, right: Vec3) => number;
  validatePlayerRayTarget: (playerId: string, origin: Vec3, direction: Vec3, range: number, timestamp: number) => string | null;
  getPlayerById: (playerId: string) => TPlayer | undefined;
  syncPlayerEntity: (playerId: string) => void;
}

export function applyMovementStatus<TPlayer extends StatusEffectPlayer>(
  player: TPlayer,
  statusId: MovementStatusId,
  now: number,
  syncPlayerEntity: (playerId: string) => void,
  sourceAbilityId?: string,
): void {
  const expiresAt = now + MOVEMENT_STATUS_DURATIONS_MS[statusId];
  const activeStatuses = player.activeMovementStatuses ?? [];
  const existing = activeStatuses.find((status) => status.statusId === statusId);
  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
    existing.sourceAbilityId = sourceAbilityId ?? existing.sourceAbilityId;
  } else {
    activeStatuses.push({ statusId, expiresAt, sourceAbilityId });
  }
  player.activeMovementStatuses = activeStatuses;
  refreshPlayerStatusMovementModifier(player, now);
  syncPlayerEntity(player.id);
}

export function applyAbilityMovementStatuses<TPlayer extends StatusEffectPlayer>(
  options: ApplyAbilityMovementStatusesOptions<TPlayer>,
): void {
  const profile = ABILITY_STATUS_APPLICATIONS[options.abilityId];
  if (!profile) return;

  const origin = options.sanitizeOrigin(options.actor, options.data.origin);
  const direction = options.sanitizeDirection(options.data.direction);

  switch (profile.kind) {
    case 'aoe_sphere': {
      const radius = profile.radius ?? 0;
      for (const target of options.players) {
        if (target.id === options.actor.id || target.dead) continue;
        if (options.distance(origin, target.position) <= radius + options.playerCollisionRadius) {
          applyMovementStatus(target, profile.statusId, options.now, options.syncPlayerEntity, options.abilityId);
        }
      }
      break;
    }
    case 'aoe_ring': {
      const outerRadius = profile.radius ?? 0;
      const innerRadius = profile.innerRadius ?? 0;
      for (const target of options.players) {
        if (target.id === options.actor.id || target.dead) continue;
        const distance = options.distance(origin, target.position);
        if (distance >= innerRadius && distance <= outerRadius + options.playerCollisionRadius) {
          applyMovementStatus(target, profile.statusId, options.now, options.syncPlayerEntity, options.abilityId);
        }
      }
      break;
    }
    case 'hitscan': {
      const hitId = options.validatePlayerRayTarget(options.actor.id, origin, direction, profile.range ?? 18, options.now);
      if (!hitId) break;
      const target = options.getPlayerById(hitId);
      if (target) {
        applyMovementStatus(target, profile.statusId, options.now, options.syncPlayerEntity, options.abilityId);
      }
      break;
    }
    default:
      break;
  }
}