import { type Vec3 } from '../sessionContracts';

export interface GameplayEvent {
  type: 'weapon_equip' | 'weapon_reload' | 'player_shoot' | 'use_ability';
  playerId?: string;
  shooterId?: string;
  weaponId?: string;
  equipment?: string[];
  origin?: Vec3;
  direction?: Vec3;
  hitId?: string | null;
  shotId?: string;
  abilityId?: string;
  cooldown?: number;
  movementIntent?: PlayerMovementIntent;
  timestamp: number;
}

export interface PlayerMovementIntent {
  horizontalImpulse: number;
  direction: Vec3;
  jump: boolean;
  crouch: boolean;
  verticalImpulse?: number;
}