import * as Engine from '../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { logEvent } from '@engine/1-kernel/core/public-api';
import type { Entity } from '@engine/1-kernel/core/public-api';
import type { PrefabSystem } from '../../2-systems/gameplay/systems/PrefabSystem';
import type { NetworkSyncSystem } from '../../3-network/network/NetworkSyncSystem';
import type { AbilitySystem } from '../../2-systems/gameplay/systems/gas/AbilitySystem';
import type { InventorySystem } from '../../2-systems/gameplay/systems/InventorySystem';
import type { DataRegistry } from '../../2-systems/gameplay/systems/gas/DataRegistry';
import type { EntityAttributeStore } from '../../2-systems/gameplay/systems/gas/AttributeContainer';
import type { ItemInstanceSystem } from '../../2-systems/gameplay/systems/gas/ItemInstanceSystem';
import type { AbilityTemplate } from '../../2-systems/gameplay/systems/gas/CombatTypes';

interface TestSuiteControllerConfig {
  prefabSystem: PrefabSystem;
  networkSyncSystem: NetworkSyncSystem;
  abilitySystem: AbilitySystem;
  inventorySystem: InventorySystem;
  itemInstanceSystem: ItemInstanceSystem;
  dataRegistry: DataRegistry;
  attributes: EntityAttributeStore;
  getRuntimePlayerId: () => string | null;
}

interface SmokeResult {
  ok: boolean;
  message: string;
}

const TEST_ABILITY_ID = 'ability_test_dummy';
const FATAL_EVENT_TYPE = 'FATAL_TEST_FAILURE';

const TEST_PREFABS: string[] = [
  'universal_dummy',
  'ctf_flag_test',
  'health_shrine_test',
  'loot_spawner_test',
  'test_container_anchor',
];

const TEST_PREFAB_POSITIONS: Record<string, { x: number; y: number; z: number }> = {
  universal_dummy: { x: 6, y: 1, z: 3 },
  ctf_flag_test: { x: -6, y: 1, z: 3 },
  health_shrine_test: { x: -2, y: 1, z: -6 },
  loot_spawner_test: { x: 4, y: 1, z: -6 },
  test_container_anchor: { x: 0, y: 1, z: 8 },
};

class DummyAbilityInjector {
  private readonly abilitySystem: AbilitySystem;
  private readonly dataRegistry: DataRegistry;
  private readonly attributes: EntityAttributeStore;
  private readonly injectedEntityIds = new Set<string>();
  private fireHookBound = false;

  constructor(config: { abilitySystem: AbilitySystem; dataRegistry: DataRegistry; attributes: EntityAttributeStore }) {
    this.abilitySystem = config.abilitySystem;
    this.dataRegistry = config.dataRegistry;
    this.attributes = config.attributes;
  }

  initialize(): void {
    this.ensureTestAbilityTemplate();
    if (!this.fireHookBound) {
      this.abilitySystem.onFire(({ abilityId, casterId }) => {
        if (abilityId !== TEST_ABILITY_ID) return;
        console.log('Ability Fired', { casterId, abilityId });
      });
      this.fireHookBound = true;
    }
  }

  inject(entity: Entity): void {
    if (this.injectedEntityIds.has(entity.id)) return;

    const abilityData = entity.getComponent('ability')?.data as { abilityIds?: unknown } | undefined;
    const existingAbilityIdsRaw = abilityData?.abilityIds;
    const existingAbilityIds = Array.isArray(existingAbilityIdsRaw)
      ? existingAbilityIdsRaw.filter((id): id is string => typeof id === 'string')
      : [];
    const abilityIds = existingAbilityIds.includes(TEST_ABILITY_ID) ? existingAbilityIds : [...existingAbilityIds, TEST_ABILITY_ID];

    entity.addComponent({
      name: 'ability',
      data: {
        type: 'ability',
        abilityIds,
        profileId: 'universal_dummy',
      },
    });

    if (!entity.hasComponent('health')) {
      entity.addComponent({
        name: 'health',
        data: {
          type: 'health',
          hp: 100,
          maxHp: 100,
          level: 1,
        },
      });
    }

    this.attributes.ensure(entity.id, {
      Health: 100,
      MaxHealth: 100,
      Mana: 100,
      MaxMana: 100,
      Shield: 0,
      MaxShield: 0,
    });

    this.injectedEntityIds.add(entity.id);

    const origin = entity.getPosition();
    const fired = this.abilitySystem.activateAbility(
      entity.id,
      TEST_ABILITY_ID,
      origin,
      { x: 0, y: 0, z: -1 },
      ['player', 'world'],
    );

    console.group('[EngineSmokeTest] DummyAbilityInjector');
    console.log('dummyEntity', entity.id);
    console.log('abilityInjected', abilityIds.includes(TEST_ABILITY_ID));
    console.log('abilityFired', fired);
    console.groupEnd();
  }

  private ensureTestAbilityTemplate(): void {
    if (this.dataRegistry.getAbility(TEST_ABILITY_ID)) return;

    const template: AbilityTemplate = {
      id: TEST_ABILITY_ID,
      label: 'Test Ability',
      delivery: 'Hitscan',
      damage: 0,
      damageType: 'Physical',
      cost: 0,
      costType: 'Mana',
      cooldown: 0,
      hitscan: {
        range: 4,
        spread: 0,
        pellets: 1,
      },
      description: 'Smoke-test ability for runtime actor injection validation.',
    };

    this.dataRegistry.patchAbility(template);
  }
}

class TestInventoryBridge {
  private readonly itemInstanceSystem: ItemInstanceSystem;
  private readonly inventorySystem: InventorySystem;

  constructor(config: { itemInstanceSystem: ItemInstanceSystem; inventorySystem: InventorySystem }) {
    this.itemInstanceSystem = config.itemInstanceSystem;
    this.inventorySystem = config.inventorySystem;
  }

  run(localPlayerId: string): SmokeResult {
    this.itemInstanceSystem.initPlayer(localPlayerId);
    this.inventorySystem.initPlayer(localPlayerId);

    const spawned = this.itemInstanceSystem.createInstance('base_pistol', 1, 'Common');
    if (!spawned) {
      return { ok: false, message: 'Unable to create Level 1 ItemInstance (base_pistol)' };
    }

    spawned.affixes = [
      ...spawned.affixes,
      {
        templateId: 'affix_swift',
        tier: 'Minor',
        rollMultiplier: 1,
      },
    ];

    (spawned as unknown as Record<string, unknown>).debugModifier = 'Debug Modifier';

    const addedToBackpack = this.itemInstanceSystem.addToBackpack(localPlayerId, spawned.uuid);
    const backpack = this.itemInstanceSystem.getBackpack(localPlayerId);
    const backpackBound = backpack.some((instance) => instance.uuid === spawned.uuid);

    console.group('[EngineSmokeTest] InventoryBridge');
    console.log('playerId', localPlayerId);
    console.log('itemInstanceUuid', spawned.uuid);
    console.log('addedToBackpack', addedToBackpack);
    console.log('backpackBound', backpackBound);
    console.groupEnd();

    if (!addedToBackpack || !backpackBound) {
      return { ok: false, message: `ItemInstance ${spawned.uuid} failed backpack binding for player ${localPlayerId}` };
    }

    return { ok: true, message: `ItemInstance ${spawned.uuid} bound to ${localPlayerId}` };
  }
}

class VisibilityDebugger {
  private readonly networkSyncSystem: NetworkSyncSystem;

  constructor(networkSyncSystem: NetworkSyncSystem) {
    this.networkSyncSystem = networkSyncSystem;
  }

  run(localPlayerId: string | null): void {
    const diagnostics = this.networkSyncSystem.getDiagnostics() as { bindings?: Array<Record<string, unknown>> };
    const bindings = Array.isArray(diagnostics.bindings) ? diagnostics.bindings : [];
    const entityManager = Engine.getEntityManager();
    const renderer = Engine.getEntityRenderer();
    if (!entityManager || !renderer) return;

    console.group('[EngineSmokeTest] VisibilityDebugger');

    for (const binding of bindings) {
      const playerId = typeof binding.playerId === 'string' ? binding.playerId : null;
      const entityId = typeof binding.entityId === 'string' ? binding.entityId : null;
      if (!playerId || !entityId) continue;
      if (localPlayerId && playerId === localPlayerId) continue;

      const entity = entityManager.getEntity(entityId);
      if (!entity || entity.type !== 'RemotePlayer') continue;

      const renderData = entity.getComponent('render')?.data as { active?: boolean } | undefined;
      const mesh = renderer.getMeshForEntity(entityId);
      const renderInactive = renderData?.active === false || mesh?.visible === false;

      if (!entity.isActive || renderInactive) {
        const detail = {
          playerId,
          entityId,
          entityActive: entity.isActive,
          meshVisible: mesh?.visible ?? null,
          renderActiveFlag: renderData?.active,
        };
        logEvent('VISIBILITY_WARNING', `RemotePlayer hidden/inactive: ${playerId} (${entityId})`);
        console.warn('[VisibilityDebugger] RemotePlayer hidden/inactive', detail);
      }
    }

    console.groupEnd();
  }
}

export class TestSuiteController {
  private readonly prefabSystem: PrefabSystem;
  private readonly getRuntimePlayerId: () => string | null;
  private readonly dummyAbilityInjector: DummyAbilityInjector;
  private readonly inventoryBridge: TestInventoryBridge;
  private readonly visibilityDebugger: VisibilityDebugger;

  constructor(config: TestSuiteControllerConfig) {
    this.prefabSystem = config.prefabSystem;
    this.getRuntimePlayerId = config.getRuntimePlayerId;
    this.dummyAbilityInjector = new DummyAbilityInjector({
      abilitySystem: config.abilitySystem,
      dataRegistry: config.dataRegistry,
      attributes: config.attributes,
    });
    this.inventoryBridge = new TestInventoryBridge({
      itemInstanceSystem: config.itemInstanceSystem,
      inventorySystem: config.inventorySystem,
    });
    this.visibilityDebugger = new VisibilityDebugger(config.networkSyncSystem);

    this.dummyAbilityInjector.initialize();

    gameBus.on('prefabCreated', ({ prefabName, entityId }) => {
      if (prefabName !== 'universal_dummy') return;
      const entity = Engine.getEntityManager()?.getEntity(entityId);
      if (!entity) return;
      this.dummyAbilityInjector.inject(entity);
    });
  }

  async runEngineStartSmokeTest(): Promise<boolean> {
    console.group('[EngineSmokeTest] ENGINE_START');
    logEvent('ENGINE_START', 'Engine smoke test sequence started');

    const bindingResult = this.bindFlatMapAnchors();
    if (!bindingResult.ok) {
      this.reportFatal(bindingResult.message);
      console.groupEnd();
      return false;
    }

    this.injectExistingDummies();

    const runtimePlayerId = this.getRuntimePlayerId();
    if (!runtimePlayerId) {
      this.reportFatal('Runtime player id missing during smoke test');
      console.groupEnd();
      return false;
    }

    const inventoryResult = this.inventoryBridge.run(runtimePlayerId);
    if (!inventoryResult.ok) {
      this.reportFatal(inventoryResult.message);
      console.groupEnd();
      return false;
    }

    this.visibilityDebugger.run(runtimePlayerId);
    logEvent('ENGINE_SMOKE_TEST_OK', 'Flat map smoke-test sequence completed successfully');
    console.info('[EngineSmokeTest] PASS');
    console.groupEnd();
    return true;
  }

  private bindFlatMapAnchors(): SmokeResult {
    const entityManager = Engine.getEntityManager();
    if (!entityManager) {
      return { ok: false, message: 'EntityManager unavailable for smoke test' };
    }

    for (const prefabId of TEST_PREFABS) {
      const existing = this.findEntityByPrefab(prefabId);
      if (existing) continue;

      const created = this.prefabSystem.tryCreate(
        prefabId,
        TEST_PREFAB_POSITIONS[prefabId] ?? { x: 0, y: 1, z: 0 },
        { networked: false },
      );

      const testPref = prefabId.startsWith('test_') || prefabId.includes('_test');
      if (!created && testPref) {
        return { ok: false, message: `test prefab bind failed: ${prefabId}` };
      }
    }

    return { ok: true, message: 'Flat map anchors bound' };
  }

  private injectExistingDummies(): void {
    const entities = Engine.getEntityManager()?.getEntities() ?? [];
    for (const entity of entities) {
      const prefabName = this.getPrefabName(entity);
      if (prefabName !== 'universal_dummy') continue;
      this.dummyAbilityInjector.inject(entity);
    }
  }

  private getPrefabName(entity: Entity): string | null {
    const data = entity.getComponent('prefab')?.data as { prefabName?: unknown } | undefined;
    return typeof data?.prefabName === 'string' ? data.prefabName : null;
  }

  private findEntityByPrefab(prefabName: string): Entity | null {
    const entities = Engine.getEntityManager()?.getEntities() ?? [];
    for (const entity of entities) {
      if (this.getPrefabName(entity) === prefabName) return entity;
    }
    return null;
  }

  private reportFatal(message: string): void {
    const formatted = `[EngineSmokeTest] ${message}`;
    logEvent(FATAL_EVENT_TYPE, formatted);
    console.error(`${FATAL_EVENT_TYPE}: ${formatted}`);
    Engine.getDebugOverlay()?.show();
  }
}
