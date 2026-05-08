import { gameBus } from '@engine/1-kernel/core/public-api';
import type { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import type { HealthSystem } from '../systems/HealthSystem';
import type { EntityAttributeStore } from '../systems/gas/AttributeContainer';

export interface AbilityEnemyActorData {
  kind: 'ability_enemy';
  profileId: string;
  level: number;
  abilityId?: string;
  health: number;
  maxHealth: number;
}

interface AbilityEnemyPrefabSpawner {
  createByEntityType(
    entityType: string,
    position: Vector3,
    overrides: { rotation: Vector3; networked: boolean },
  ): Entity | null | undefined;
}

interface AbilityEnemyFactoryConfig {
  prefabSystem: AbilityEnemyPrefabSpawner;
  healthSystem: Pick<HealthSystem, 'get' | 'register' | 'syncVitals'>;
  attributes: Pick<EntityAttributeStore, 'ensure'>;
}

let runtimeConfig: AbilityEnemyFactoryConfig | null = null;

export function configureAbilityEnemyFactory(config: AbilityEnemyFactoryConfig): void {
  runtimeConfig = config;
}

export function spawnAbilityEnemy(position: Vector3, level: number): Entity | null {
  if (!runtimeConfig) {
    console.warn('[AbilityEnemyFactory] Runtime config missing; enemy spawn skipped');
    return null;
  }

  const entity = runtimeConfig.prefabSystem.createByEntityType('Prefab_AbilityEnemyBase', position, {
    rotation: { x: 0, y: 0, z: 0 },
    networked: false,
  }) ?? null;

  if (!entity) {
    return null;
  }

  hydrateAbilityEnemyEntity(entity, createDefaultActorData(level));
  gameBus.emit('ENTITY_SPAWNED', {
    entityId: entity.id,
    playerId: null,
    entityType: entity.type,
    source: 'ability_enemy_factory',
    profileId: 'ability_enemy_base',
    networked: false,
    timestamp: Date.now(),
  });
  return entity;
}

export function hydrateAbilityEnemyEntity(entity: Entity, actor: AbilityEnemyActorData): void {
  entity.addComponent({
    name: 'health',
    data: {
      type: 'health',
      hp: actor.health,
      maxHp: actor.maxHealth,
      level: actor.level,
    },
  });
  entity.addComponent({
    name: 'ability',
    data: {
      type: 'ability',
      abilityIds: actor.abilityId ? [actor.abilityId] : [],
      level: actor.level,
      profileId: actor.profileId,
    },
  });
  // ── Animation State (like player) ───────────────────────────────────────
  entity.addComponent({
    name: 'animation',
    data: {
      type: 'animation',
      state: 'idle',
      crouching: false,
      airborne: false,
    },
  });
  // ── Movement (allows enemy to be pushed/moved, shows animation) ─────────
  entity.addComponent({
    name: 'movement',
    data: {
      type: 'movement',
      velocity: { x: 0, y: 0, z: 0 },
      moveSpeed: 2.5,
      isMoving: false,
    },
  });
  // ── Input (NPC source, allows passive animations) ──────────────────────
  entity.addComponent({
    name: 'input',
    data: {
      type: 'input',
      source: 'npc',
      intent: { x: 0, z: 0 },
    },
  });
  entity.addComponent({
    name: 'replication',
    data: {
      type: 'replication',
      authority: 'server',
      profileId: actor.profileId,
    },
  });

  if (!runtimeConfig) {
    return;
  }

  if (!runtimeConfig.healthSystem.get(entity.id)) {
    runtimeConfig.healthSystem.register(entity.id, {
      maxHp: actor.maxHealth,
      revivable: false,
    });
  }

  runtimeConfig.healthSystem.syncVitals(entity.id, {
    hp: actor.health,
    maxHp: actor.maxHealth,
  });

  const attrs = runtimeConfig.attributes.ensure(entity.id, {
    Health: actor.health,
    MaxHealth: actor.maxHealth,
    Mana: 100,
    MaxMana: 100,
    Shield: 0,
    MaxShield: 0,
  });
  attrs.setBase('Health', actor.health);
  attrs.setBase('MaxHealth', actor.maxHealth);
  attrs.setBase('Mana', 100);
  attrs.setBase('MaxMana', 100);
}

function createDefaultActorData(level: number): AbilityEnemyActorData {
  const maxHealth = 100 + level * 20;
  return {
    kind: 'ability_enemy',
    profileId: 'ability_enemy_base',
    level,
    abilityId: 'ability_shield_dash',
    health: maxHealth,
    maxHealth,
  };
}