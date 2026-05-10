import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import * as AssetLoader from '../../../2-systems/gameplay/systems/AssetLoader';
import { setContext } from '@engine/1-kernel/core/public-api';
import { logEvent } from '@engine/1-kernel/core/public-api';
import type { StatusMovementDebugState } from '../../runtime/RuntimeAuxiliaryAssembly';
import type { Vector3 as Vec3 } from '@shared/contracts';

interface SpawnableEntity {
  id: string;
  type: string;
  getComponent(name: string): { data?: { type?: string } } | undefined;
}

interface SpawnSystemConsoleAdapter {
  spawnPrefab(prefabName: string, options: { position: Vec3; clearance: number; tag: string }): SpawnableEntity | null;
}

interface WorldObjectAuthorityConsoleAdapter {
  sendPlacedEntity(entity: SpawnableEntity, entityType: string): void;
}

interface InventoryConsoleAdapter {
  initPlayer(playerId: string): void;
  showInventory(playerId: string): string;
}

interface WeaponConsoleAdapter {
  ensurePlayer(playerId: string): void;
  giveWeapon(playerId: string, weaponName: string, reserveAmmo: number): boolean;
  equip(playerId: string, weaponName: string): void;
}

interface UndoRedoConsoleAdapter {
  undo(): boolean;
  redo(): boolean;
}

interface PrefabConsoleAdapter {
  validateAllPrefabs(): Record<string, string[]>;
  hotReloadBuiltinPrefabs(): void;
}

interface SaveLoadConsoleAdapter {
  serializeWorld(): unknown;
}

interface EditorMenuConsoleAdapter {
  refreshSelectedEntity(): void;
  getSelectedEntity(): { id: string } | null;
}

interface NetGraphConsoleAdapter {
  toggle(): void;
  isVisible(): boolean;
}

interface RuntimeIssueInspectorConsoleAdapter {
  toggle(): void;
}

interface ReplayConsoleAdapter {
  startRecording(sessionId: string): void;
  stopRecording(): { events: unknown[]; durationMs: number };
}

interface EngineGameModesConsoleAdapter {
  getMode(name: string): unknown;
  activate(name: string): void;
}

interface RegisterDeveloperConsoleCommandsOptions {
  spawnSystem: SpawnSystemConsoleAdapter;
  worldObjectAuthorityService: WorldObjectAuthorityConsoleAdapter;
  inventorySystem: InventoryConsoleAdapter;
  weaponSystem: WeaponConsoleAdapter;
  undoRedoSystem: UndoRedoConsoleAdapter;
  prefabSystem: PrefabConsoleAdapter;
  saveLoadManager: SaveLoadConsoleAdapter | null;
  setLastEditorSnapshot(snapshot: unknown): void;
  syncEditorPrefabLibrary(): void;
  getActiveRuntimePlayerId(): string | null;
  syncLocalPlayerToAuthoritativeSpawn(position: Vec3, rotation: Vec3): void;
  editorMenu: EditorMenuConsoleAdapter | null;
  netGraph: NetGraphConsoleAdapter;
  runtimeIssueInspector: RuntimeIssueInspectorConsoleAdapter;
  buildRuntimeIssueSnapshot(): Record<string, unknown>;
  replaySystem: ReplayConsoleAdapter;
  getReplaySessionId(): string;
  engineGameModes: EngineGameModesConsoleAdapter;
  networkSyncSystem?: unknown;
  statusMovementDebug: {
    togglePanel(): void;
    getState(): StatusMovementDebugState;
    setConfig(patch: {
      rooted?: boolean;
      chilled?: boolean;
      electrocuted?: boolean;
      speedMultiplier?: number;
      impulseMagnitude?: number;
      feelSpeedMultiplier?: number;
      feelAccelerationMultiplier?: number;
      feelFrictionMultiplier?: number;
      feelFloatiness?: number;
      feelAirControlEnabled?: boolean;
      networkSimulation?: boolean;
      logEachFrame?: boolean;
    }): unknown;
    reset(): unknown;
  };
}

export function registerDeveloperConsoleCommands(options: RegisterDeveloperConsoleCommandsOptions): void {
  const devConsole = Engine.getConsole();
  if (!devConsole) return;

  const {
    spawnSystem,
    worldObjectAuthorityService,
    inventorySystem,
    weaponSystem,
    undoRedoSystem,
    prefabSystem,
    saveLoadManager,
    setLastEditorSnapshot,
    syncEditorPrefabLibrary,
    getActiveRuntimePlayerId,
    syncLocalPlayerToAuthoritativeSpawn,
    editorMenu,
    netGraph,
    runtimeIssueInspector,
    buildRuntimeIssueSnapshot,
    replaySystem,
    getReplaySessionId,
    engineGameModes,
    statusMovementDebug,
  } = options;

  devConsole.register('list_entities', 'List current ECS entities', () => {
    const em = Engine.getEntityManager();
    if (!em) return 'EntityManager unavailable';
    const entities = em.getEntities();
    if (entities.length === 0) return 'No entities';
    return entities
      .slice(0, 40)
      .map((entity) => `${entity.id}  ${entity.type}`)
      .join('\n');
  });

  devConsole.register('inspect', 'Inspect entity: inspect <id>', (args) => {
    const id = args[0];
    if (!id) return 'Usage: inspect <id>';
    const entity = Engine.getEntityManager()?.getEntity(id);
    if (!entity) return `Entity not found: ${id}`;
    return JSON.stringify(entity.toJSON(), null, 2);
  });

  devConsole.register('spawn', 'Spawn prefab-ish entity: spawn <cube|sphere|capsule>', (args) => {
    const meshType = (args[0] ?? 'cube').toLowerCase();
    const menu = Engine.getEditorMenu();
    if (!menu) return 'Editor spawn system unavailable';
    const entity = menu.spawnObject(meshType);
    if (!entity) return `Unsupported spawn type: ${meshType}`;
    logEvent('engine', `Spawned entity ${entity.id} (${meshType})`);
    return `Spawned ${entity.id}`;
  });

  devConsole.register('spawnPrefab', 'Spawn registered prefab: spawnPrefab <name>', (args) => {
    const prefabName = args[0];
    if (!prefabName) return 'Usage: spawnPrefab <name>';

    const camera = Engine.getEngineCamera();
    const forward = camera ? camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(0, 0, -1);
    const spawnPosition = camera
      ? {
          x: camera.position.x + forward.x * 3,
          y: Math.max(0, camera.position.y - 1.2 + forward.y * 3),
          z: camera.position.z + forward.z * 3,
        }
      : { x: 0, y: 0, z: -3 };

    const entity = spawnSystem.spawnPrefab(prefabName, { position: spawnPosition, clearance: 1.5, tag: 'prefab' });
    if (!entity) return `Unknown prefab: ${prefabName}`;
    worldObjectAuthorityService.sendPlacedEntity(entity, entity.getComponent('tag')?.data?.type || entity.type);

    logEvent('engine', `Spawned prefab ${prefabName} as ${entity.id}`);
    return `Spawned prefab ${prefabName} as ${entity.id}`;
  });

  devConsole.register('giveWeapon', 'Give weapon to player: giveWeapon <weaponName> [playerId]', (args) => {
    const weaponName = args[0];
    const targetPlayerId = args[1] ?? getActiveRuntimePlayerId();
    if (!weaponName) return 'Usage: giveWeapon <weaponName> [playerId]';
    if (!targetPlayerId) return 'No player available';

    inventorySystem.initPlayer(targetPlayerId);
    weaponSystem.ensurePlayer(targetPlayerId);
    const granted = weaponSystem.giveWeapon(targetPlayerId, weaponName, 48);
    if (!granted) return `Unknown weapon: ${weaponName}`;
    weaponSystem.equip(targetPlayerId, weaponName);
    logEvent('engine', `Granted ${weaponName} to ${targetPlayerId}`);
    return `Granted ${weaponName} to ${targetPlayerId}`;
  });

  devConsole.register('showInventory', 'Show player inventory: showInventory [playerId]', (args) => {
    const targetPlayerId = args[0] ?? getActiveRuntimePlayerId();
    if (!targetPlayerId) return 'No player available';
    inventorySystem.initPlayer(targetPlayerId);
    return inventorySystem.showInventory(targetPlayerId);
  });

  devConsole.register('teleport', 'Teleport camera or runtime player: teleport <x> <y> <z>', (args) => {
    if (args.length < 3) return 'Usage: teleport <x> <y> <z>';
    const [x, y, z] = args.map(Number);
    if ([x, y, z].some(Number.isNaN)) return 'Coordinates must be numbers';
    syncLocalPlayerToAuthoritativeSpawn({ x, y, z }, { x: 0, y: 0, z: 0 });
    return `Teleported to ${x}, ${y}, ${z}`;
  });

  devConsole.register('undo', 'Undo last editor action', () => {
    return undoRedoSystem.undo() ? 'Undo applied' : 'Nothing to undo';
  });

  devConsole.register('redo', 'Redo last editor action', () => {
    return undoRedoSystem.redo() ? 'Redo applied' : 'Nothing to redo';
  });

  devConsole.register('validate_prefabs', 'Validate all registered prefabs', () => {
    const results = prefabSystem.validateAllPrefabs();
    return Object.entries(results)
      .map(([name, issues]) => `${name}: ${issues.length === 0 ? 'ok' : issues.join(', ')}`)
      .join('\n');
  });

  devConsole.register('hot_reload_prefabs', 'Hot reload builtin prefabs and asset templates', () => {
    prefabSystem.hotReloadBuiltinPrefabs();
    syncEditorPrefabLibrary();
    return 'Builtin prefabs reloaded';
  });

  devConsole.register('save_state', 'Save full engine state: save_state <name>', (args) => {
    const name = args[0] ?? 'autosave';
    return Engine.saveMap(name) ? `Saved ${name}` : `Failed to save ${name}`;
  });

  devConsole.register('load_state', 'Load full engine state: load_state <name>', (args) => {
    const name = args[0] ?? 'autosave';
    const result = Engine.loadMap(name);
    if (result.success) {
      setLastEditorSnapshot(saveLoadManager?.serializeWorld() ?? null);
      return `Loaded ${name}`;
    }
    return `Failed to load ${name}`;
  });

  devConsole.register('parent', 'Parent entity to another: parent <childId> <parentId>', (args) => {
    const childId = args[0];
    const parentId = args[1];
    if (!childId || !parentId) return 'Usage: parent <childId> <parentId>';
    const sceneGraph = Engine.getSceneGraph();
    if (!sceneGraph) return 'SceneGraph unavailable';
    sceneGraph.reparent(childId, parentId);
    editorMenu?.refreshSelectedEntity();
    return `Parented ${childId} -> ${parentId}`;
  });

  devConsole.register('unparent', 'Unparent entity: unparent <entityId>', (args) => {
    const entityId = args[0] ?? editorMenu?.getSelectedEntity()?.id;
    if (!entityId) return 'Usage: unparent <entityId>';
    const sceneGraph = Engine.getSceneGraph();
    if (!sceneGraph) return 'SceneGraph unavailable';
    sceneGraph.reparent(entityId, undefined);
    editorMenu?.refreshSelectedEntity();
    return `Unparented ${entityId}`;
  });

  devConsole.register('list_systems', 'List runtime systems and status', () => {
    return (Engine.getEngineDiagnostics()?.getDiagnostics().activeSystems ?? []).join('\n') || 'No active systems';
  });

  devConsole.register('kill', 'Destroy entity: kill <id>', (args) => {
    const id = args[0];
    if (!id) return 'Usage: kill <id>';
    const ok = Engine.getEntityManager()?.destroyEntity(id) ?? false;
    if (ok) logEvent('engine', `Destroyed entity ${id}`);
    return ok ? `Destroyed ${id}` : `Entity not found: ${id}`;
  });

  devConsole.register('set_context', 'Force input context: set_context <editor|game|ui>', (args) => {
    const ctx = (args[0] ?? '').toLowerCase();
    if (ctx !== 'editor' && ctx !== 'game' && ctx !== 'ui') return 'Usage: set_context <editor|game|ui>';
    setContext(ctx);
    logEvent('engine', `Input context forced to ${ctx}`);
    return `Input context set to ${ctx}`;
  });

  devConsole.register('toggle_debug', 'Toggle master debug overlay', () => {
    Engine.getDebugOverlay()?.toggle();
    return `Debug overlay ${Engine.getDebugOverlay()?.isVisible() ? 'enabled' : 'disabled'}`;
  });

  devConsole.register('toggle_netgraph', 'Toggle multiplayer netgraph overlay', () => {
    netGraph.toggle();
    return `Netgraph ${netGraph.isVisible() ? 'enabled' : 'disabled'}`;
  });

  devConsole.register('toggle_issue_inspector', 'Toggle the runtime issue inspector overlay', () => {
    runtimeIssueInspector.toggle();
    return 'Issue inspector toggled';
  });

  devConsole.register('toggle_status_movement_debug', 'Toggle the status movement debug panel [F7]', () => {
    statusMovementDebug.togglePanel();
    return 'Status movement debug panel toggled';
  });

  devConsole.register('status_movement_state', 'Dump current movement intent and status modifier state', () => {
    return JSON.stringify(statusMovementDebug.getState(), null, 2);
  });

  devConsole.register('status_movement_probe', 'Dump local player transform plus movement authority probe data', () => {
    const report = buildRuntimeIssueSnapshot();
    return JSON.stringify({
      localPlayer: report['localPlayer'] ?? null,
      networkSync: report['networkSync'] ?? null,
      statusMovement: statusMovementDebug.getState(),
    }, null, 2);
  });

  devConsole.register('status_movement_flag', 'Set debug status flag: status_movement_flag <rooted|chilled|electrocuted> <on|off>', (args) => {
    const key = (args[0] ?? '').toLowerCase();
    const value = (args[1] ?? '').toLowerCase();
    if (!['rooted', 'chilled', 'electrocuted'].includes(key)) {
      return 'Usage: status_movement_flag <rooted|chilled|electrocuted> <on|off>';
    }
    if (value !== 'on' && value !== 'off') {
      return 'Usage: status_movement_flag <rooted|chilled|electrocuted> <on|off>';
    }
    statusMovementDebug.setConfig({ [key]: value === 'on' } as {
      rooted?: boolean;
      chilled?: boolean;
      electrocuted?: boolean;
    });
    return JSON.stringify(statusMovementDebug.getState(), null, 2);
  });

  devConsole.register('status_movement_speed', 'Set chilled speed multiplier: status_movement_speed <0..1>', (args) => {
    const value = Number(args[0]);
    if (!Number.isFinite(value)) return 'Usage: status_movement_speed <0..1>';
    statusMovementDebug.setConfig({ speedMultiplier: value });
    return JSON.stringify(statusMovementDebug.getState(), null, 2);
  });

  devConsole.register('status_movement_impulse', 'Set electrocuted impulse magnitude: status_movement_impulse <magnitude>', (args) => {
    const value = Number(args[0]);
    if (!Number.isFinite(value)) return 'Usage: status_movement_impulse <magnitude>';
    statusMovementDebug.setConfig({ impulseMagnitude: value });
    return JSON.stringify(statusMovementDebug.getState(), null, 2);
  });

  devConsole.register('status_movement_network', 'Toggle authoritative multiplayer simulation: status_movement_network <on|off>', (args) => {
    const value = (args[0] ?? '').toLowerCase();
    if (value !== 'on' && value !== 'off') return 'Usage: status_movement_network <on|off>';
    statusMovementDebug.setConfig({ networkSimulation: value === 'on' });
    return JSON.stringify(statusMovementDebug.getState(), null, 2);
  });

  devConsole.register('status_movement_reset', 'Reset all status movement debug settings', () => {
    statusMovementDebug.reset();
    return JSON.stringify(statusMovementDebug.getState(), null, 2);
  });

  devConsole.register('issue_report', 'Dump the current runtime issue report as JSON', () => {
    return JSON.stringify(buildRuntimeIssueSnapshot(), null, 2);
  });

  devConsole.register('reload_assets', 'Clear the asset registry', () => {
    AssetLoader.dispose();
    prefabSystem.hotReloadBuiltinPrefabs();
    logEvent('engine', 'Asset registry cleared');
    return 'Asset registry cleared';
  });

  devConsole.register('replay_start', 'Start local replay recording', () => {
    replaySystem.startRecording(getReplaySessionId());
    logEvent('engine', 'Replay recording started');
    return 'Replay recording started';
  });

  devConsole.register('replay_stop', 'Stop replay recording', () => {
    const recording = replaySystem.stopRecording();
    logEvent('engine', `Replay recording stopped (${recording.events.length} events)`);
    return `Replay stopped - ${recording.events.length} events, ${Math.round(recording.durationMs)} ms`;
  });

  devConsole.register('gamemode', 'Set active mode name: gamemode <freeplay|sandbox|round|ffa>', (args) => {
    const mode = (args[0] ?? '').toLowerCase();
    if (!mode) return 'Usage: gamemode <freeplay|sandbox|round|ffa>';
    if (!engineGameModes.getMode(mode)) return `Unsupported mode: ${mode}`;
    Engine.getEngineController()?.setGameMode(mode, 'dev-console');
    logEvent('engine', `Gamemode set to ${mode}`);
    return `Gamemode set to ${mode}`;
  });

  // ── GAS debug commands ──────────────────────────────────────────────────────

  const resolveDebugPlayerId = (args: string[]): string | null => {
    if (args[1]) {
      return args[1];
    }

    const active = getActiveRuntimePlayerId();
    if (active) {
      return active;
    }

    const inventoryGridManager = Engine.getInventoryGridManager();
    if (inventoryGridManager) {
      return inventoryGridManager.getPlayerId();
    }

    return null;
  };

  devConsole.register('gas_list', 'List all GAS item IDs (use with gas_give / gas_spawn)', () => {
    const registry = Engine.getGasDataRegistry();
    if (!registry) return 'GAS registry unavailable';
    const items = registry.listItems();
    if (!items.length) return 'No GAS items registered';
    return items.map((i) => `${i.id}  [${i.category ?? i.equipSlot}]  ${i.label}`).join('\n');
  });

  devConsole.register('gas_give', 'Give GAS item to player: gas_give <itemId> [playerId]', (args) => {
    const itemId = args[0];
    if (!itemId) return 'Usage: gas_give <itemId> [playerId]  (use gas_list to see all IDs)';
    const playerId = resolveDebugPlayerId(args);
    if (!playerId) return 'No active player. Start freeplay or specify a playerId.';
    const registry = Engine.getGasDataRegistry();
    const gasItems = Engine.getGasItemSystem();
    const gasAttrs = Engine.getGasAttributeStore();
    if (!registry || !gasItems || !gasAttrs) return 'GAS systems unavailable';
    const template = registry.getItem(itemId);
    if (!template) return `Unknown GAS item: ${itemId}  (use gas_list to see all IDs)`;
    gasItems.initPlayer(playerId);
    gasAttrs.ensure(playerId);
    const instance = gasItems.createInstance(itemId);
    if (!instance) return `Failed to create instance of ${itemId}`;
    gasItems.addToBackpack(playerId, instance.uuid);
    const slot = template.equipSlot;
    if (slot && slot !== 'None') {
      const inv = gasItems.getInventory(playerId);
      if (inv && !inv.equipped[slot as keyof typeof inv.equipped]) {
        gasItems.equip(playerId, instance.uuid, slot as Parameters<typeof gasItems.equip>[2]);
      }
    }
    logEvent('engine', `gas_give: ${itemId} → ${playerId}`);
    return `Gave "${template.label}" (slot: ${slot ?? 'none'}) to ${playerId}`;
  });

  devConsole.register('gas_give_all', 'Give every GAS item to player: gas_give_all [playerId]', (args) => {
    const playerId = resolveDebugPlayerId(args);
    if (!playerId) return 'No active player. Start freeplay or specify a playerId.';
    const registry = Engine.getGasDataRegistry();
    const gasItems = Engine.getGasItemSystem();
    const gasAttrs = Engine.getGasAttributeStore();
    if (!registry || !gasItems || !gasAttrs) return 'GAS systems unavailable';
    gasItems.initPlayer(playerId);
    gasAttrs.ensure(playerId);
    const given: string[] = [];
    for (const template of registry.listItems()) {
      const instance = gasItems.createInstance(template.id);
      if (!instance) continue;
      gasItems.addToBackpack(playerId, instance.uuid);
      const slot = template.equipSlot;
      if (slot && slot !== 'None') {
        const inv = gasItems.getInventory(playerId);
        if (inv && !inv.equipped[slot as keyof typeof inv.equipped]) {
          gasItems.equip(playerId, instance.uuid, slot as Parameters<typeof gasItems.equip>[2]);
        }
      }
      given.push(template.id);
    }
    logEvent('engine', `gas_give_all: ${given.length} items → ${playerId}`);
    return `Gave ${given.length} items: ${given.join(', ')}`;
  });

  devConsole.register('gas_spawn', 'Spawn GAS item pickup in world: gas_spawn <itemId>', (args) => {
    const itemId = args[0];
    if (!itemId) return 'Usage: gas_spawn <itemId>  (use gas_list to see all IDs)';
    const prefabName = `pickup_${itemId}`;
    const camera = Engine.getEngineCamera();
    const forward = camera
      ? camera.getWorldDirection(new THREE.Vector3())
      : new THREE.Vector3(0, 0, -1);
    const spawnPos = camera
      ? {
          x: camera.position.x + forward.x * 3,
          y: Math.max(0, camera.position.y - 1 + forward.y * 3),
          z: camera.position.z + forward.z * 3,
        }
      : { x: 0, y: 0, z: -3 };
    const entity = spawnSystem.spawnPrefab(prefabName, { position: spawnPos, clearance: 1.5, tag: 'pickup' });
    if (!entity) return `No prefab for "${prefabName}". Use gas_give instead.`;
    worldObjectAuthorityService.sendPlacedEntity(entity, 'pickup');
    logEvent('engine', `gas_spawn: ${prefabName} at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)})`);
    return `Spawned ${prefabName} at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)})`;
  });
}
