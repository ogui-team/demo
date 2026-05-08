/**
 * ============================================================================
 * KernelCommandTypes.ts - DOD Command Definitions
 * ============================================================================
 *
 * Command-based architecture: All system interactions go through typed commands
 * pushed to the kernel command queue. No direct method calls between systems.
 *
 * Pattern:
 * 1. System A creates a command: { type: APPLY_DAMAGE, entityHandle, damage }
 * 2. Command pushed to kernel.commands queue
 * 3. HealthSystem.execute() processes all APPLY_DAMAGE commands
 * 4. HealthSystem writes directly to HealthStorage buffers
 * 5. KernelValidator checks buffer integrity after each system
 */

export enum KernelCommandType {
  // Health system
  APPLY_DAMAGE = 'APPLY_DAMAGE',
  APPLY_HEALING = 'APPLY_HEALING',
  KILL_ENTITY = 'KILL_ENTITY',

  // Movement system
  APPLY_VELOCITY = 'APPLY_VELOCITY',
  APPLY_IMPULSE = 'APPLY_IMPULSE',
  SET_POSITION = 'SET_POSITION',

  // Weapon system
  FIRE_WEAPON = 'FIRE_WEAPON',
  CREATE_PROJECTILE = 'CREATE_PROJECTILE',

  // Inventory system
  ADD_ITEM = 'ADD_ITEM',
  REMOVE_ITEM = 'REMOVE_ITEM',
  SWAP_ITEMS = 'SWAP_ITEMS',

  // Utility
  ENTITY_EVENT = 'ENTITY_EVENT',
}

// ─── Base Command ────────────────────────────────────────────────────────────

export interface KernelCommand<T extends KernelCommandType = KernelCommandType> {
  type: T;
  tick: number;
  source: string; // System name that issued the command
  executed?: boolean;
  error?: string;
}

// ─── Health Commands ────────────────────────────────────────────────────────

export interface ApplyDamageCommand extends KernelCommand<KernelCommandType.APPLY_DAMAGE> {
  entityHandle: number;
  damage: number;
  damageType?: string;
  instigator?: number; // Entity handle of attacker
}

export interface ApplyHealingCommand extends KernelCommand<KernelCommandType.APPLY_HEALING> {
  entityHandle: number;
  amount: number;
}

export interface KillEntityCommand extends KernelCommand<KernelCommandType.KILL_ENTITY> {
  entityHandle: number;
  instigator?: number;
}

// ─── Movement Commands ────────────────────────────────────────────────────────

export interface ApplyVelocityCommand extends KernelCommand<KernelCommandType.APPLY_VELOCITY> {
  entityHandle: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface ApplyImpulseCommand extends KernelCommand<KernelCommandType.APPLY_IMPULSE> {
  entityHandle: number;
  ix: number;
  iy: number;
  iz: number;
}

export interface SetPositionCommand extends KernelCommand<KernelCommandType.SET_POSITION> {
  entityHandle: number;
  x: number;
  y: number;
  z: number;
}

// ─── Weapon Commands ───────────────────────────────────────────────────────

export interface FireWeaponCommand extends KernelCommand<KernelCommandType.FIRE_WEAPON> {
  entityHandle: number;
  weaponId: string;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface CreateProjectileCommand extends KernelCommand<KernelCommandType.CREATE_PROJECTILE> {
  ownerId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
}

// ─── Inventory Commands ───────────────────────────────────────────────────

export interface AddItemCommand extends KernelCommand<KernelCommandType.ADD_ITEM> {
  entityHandle: number;
  itemId: number;
  quantity: number;
}

export interface RemoveItemCommand extends KernelCommand<KernelCommandType.REMOVE_ITEM> {
  entityHandle: number;
  itemId: number;
  quantity: number;
}

// ─── Event Command ──────────────────────────────────────────────────────

export interface EntityEventCommand extends KernelCommand<KernelCommandType.ENTITY_EVENT> {
  entityHandle: number;
  eventName: string;
  payload?: Record<string, unknown>;
}

// ─── Union Type ──────────────────────────────────────────────────────────────

export type AnyKernelCommand =
  | ApplyDamageCommand
  | ApplyHealingCommand
  | KillEntityCommand
  | ApplyVelocityCommand
  | ApplyImpulseCommand
  | SetPositionCommand
  | FireWeaponCommand
  | CreateProjectileCommand
  | AddItemCommand
  | RemoveItemCommand
  | EntityEventCommand;

/**
 * Command factory functions for convenient command creation
 */
export const KernelCommands = {
  applyDamage(
    entityHandle: number,
    damage: number,
    source: string,
    tick: number,
    damageType?: string,
    instigator?: number,
  ): ApplyDamageCommand {
    return {
      type: KernelCommandType.APPLY_DAMAGE,
      entityHandle,
      damage,
      damageType,
      instigator,
      source,
      tick,
    };
  },

  applyHealing(entityHandle: number, amount: number, source: string, tick: number): ApplyHealingCommand {
    return {
      type: KernelCommandType.APPLY_HEALING,
      entityHandle,
      amount,
      source,
      tick,
    };
  },

  fireWeapon(
    entityHandle: number,
    weaponId: string,
    targetX: number,
    targetY: number,
    targetZ: number,
    source: string,
    tick: number,
  ): FireWeaponCommand {
    return {
      type: KernelCommandType.FIRE_WEAPON,
      entityHandle,
      weaponId,
      targetX,
      targetY,
      targetZ,
      source,
      tick,
    };
  },

  setPosition(
    entityHandle: number,
    x: number,
    y: number,
    z: number,
    source: string,
    tick: number,
  ): SetPositionCommand {
    return {
      type: KernelCommandType.SET_POSITION,
      entityHandle,
      x,
      y,
      z,
      source,
      tick,
    };
  },

  createProjectile(
    ownerId: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    damage: number,
    source: string,
    tick: number,
  ): CreateProjectileCommand {
    return {
      type: KernelCommandType.CREATE_PROJECTILE,
      ownerId,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      damage,
      source,
      tick,
    };
  },
};
