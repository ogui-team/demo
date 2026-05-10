import * as THREE from 'three';
import { Entity, Vector3 } from '../../../1-kernel/core/Entity';
import { SceneGraph } from '../../../1-kernel/core/SceneGraph';
import { gameBus } from '../../../1-kernel/core/EventBus';
import type { SystemCapabilities, SystemContext } from '../../../1-kernel/core/types';
import { createBoxCollider, createCapsuleCollider, createSphereCollider } from '../game/components/ColliderComponent';
import { createRenderComponent } from '../game/components/RenderComponent';
import type { MultiplayerEventSource } from '../../../3-network/network/MultiplayerContracts';
import { registerBuiltinModelAssets } from '../../../assets/models';
import { BUILTIN_PREFABS } from '../../../assets/prefabs';
import type {
  AnimationComponentData,
  Input2DComponentData,
  Physics2DBodyData,
  SpritePrefabData,
  TilemapPrefabData,
  UIPrefabData,
} from '../../../4-runtime/ui/2d/TwoDTypes';
import { PickupComponent } from './components/PickupComponent';
import type { InteractableComponent } from './components/InteractableComponent';
import { hasAsset, invalidateAsset, listRegisteredAssets } from './AssetRegistry';

type ColliderShape = 'box' | 'sphere' | 'capsule';

interface PrefabColliderDefinition {
  shape: ColliderShape;
  size: {
    width?: number;
    height?: number;
    depth?: number;
    radius?: number;
    capsuleRadius?: number;
    capsuleHeight?: number;
  };
}

export interface PrefabComponentDefinition {
  name: string;
  data: Record<string, unknown>;
}

export interface PrefabRuntimeMetadata {
  biomeCompatibility?: string[];
  surfaceTypes?: string[];
  affinities?: string[];
  traits?: string[];
  navigationFlags?: string[];
  streamingCost?: number;
  encounterAffinity?: string[];
  materialAffinity?: string[];
  audioSurfaceType?: string;
  gpuInstancing?: boolean;
  renderCompatibility?: string[];
  aiMetadata?: Record<string, unknown>;
  gameplay?: Record<string, unknown>;
  collisionClass?: string;
  destruction?: {
    state?: string;
    variants?: string[];
  };
  traversal?: {
    walkable?: boolean;
    climbable?: boolean;
    jumpable?: boolean;
    occludesSight?: boolean;
  };
}

export interface PrefabEditorMetadata {
  category?: string;
  displayName?: string;
  description?: string;
  iconKey?: string;
  tags?: string[];
}

export interface PrefabMetadata {
  runtimeMetadata?: PrefabRuntimeMetadata;
  editorMetadata?: PrefabEditorMetadata;
}

function normalizeTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  return normalized === '' ? null : normalized;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return [...seen].sort();
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function computePrefabContentHash(prefab: PrefabDefinition): string {
  const content = {
    name: prefab.name,
    entityType: prefab.entityType,
    assetKey: prefab.assetKey,
    color: prefab.color,
    networked: prefab.networked,
    spawnWeight: prefab.spawnWeight,
    minSpacing: prefab.minSpacing,
    maxDrawDistance: prefab.maxDrawDistance,
    collider: prefab.collider,
    pickup: prefab.pickup,
    interactable: prefab.interactable,
    components: prefab.components,
    tags: normalizeTags(prefab.tags ?? []),
    metadata: prefab.metadata?.runtimeMetadata ?? {},
    children: prefab.children?.map((child) => ({ ...child, contentHash: undefined })),
  };
  return computeHash(stableStringify(content));
}

function migrateLegacyMetadata(prefab: PrefabDefinition): void {
  if (!prefab.metadata || typeof prefab.metadata !== 'object' || Array.isArray(prefab.metadata)) {
    return;
  }

  const runtimeMetadata: Record<string, unknown> = {
    ...(prefab.metadata.runtimeMetadata ?? {}),
  };
  const editorMetadata: Record<string, unknown> = {
    ...(prefab.metadata.editorMetadata ?? {}),
  };

  const legacyRuntimeKeys = new Set([
    'biomeCompatibility',
    'audioSurfaceType',
    'streamingCost',
    'gpuInstancing',
    'renderCompatibility',
    'destruction',
    'traversal',
    'collisionClass',
    'aiMetadata',
    'gameplay',
    'materialAffinity',
    'encounterAffinity',
    'surfaceTypes',
    'affinities',
    'traits',
    'navigationFlags',
  ]);
  const legacyEditorKeys = new Set(['category', 'displayName', 'description', 'iconKey', 'tags']);

  for (const key of Object.keys(prefab.metadata)) {
    if (key === 'runtimeMetadata' || key === 'editorMetadata') {
      continue;
    }
    const value = (prefab.metadata as Record<string, unknown>)[key];
    if (legacyRuntimeKeys.has(key)) {
      runtimeMetadata[key] = value;
      continue;
    }
    if (legacyEditorKeys.has(key)) {
      editorMetadata[key] = value;
      continue;
    }
    // unknown fields are handled later by validation
  }

  prefab.metadata = {
    runtimeMetadata: runtimeMetadata as PrefabRuntimeMetadata,
    editorMetadata: editorMetadata as PrefabEditorMetadata,
  };

  for (const child of prefab.children ?? []) {
    migrateLegacyMetadata(child);
  }
}

export interface PrefabDefinition {
  name: string;
  entityType: string;
  assetKey?: string;
  color?: number;
  networked?: boolean;
  spawnWeight?: number;
  minSpacing?: number;
  maxDrawDistance?: number;
  collider?: PrefabColliderDefinition;
  pickup?: Omit<PickupComponent, 'type'>;
  interactable?: Omit<InteractableComponent, 'type'>;
  components?: PrefabComponentDefinition[];
  tags?: string[];
  metadata?: PrefabMetadata;
  children?: PrefabDefinition[];
  sprite2d?: SpritePrefabData;
  animation2d?: AnimationComponentData;
  tilemap2d?: TilemapPrefabData;
  ui2d?: UIPrefabData;
  physics2d?: Partial<Physics2DBodyData>;
  input2d?: Partial<Input2DComponentData>;
  contentHash?: string;
}

export interface PrefabCreateOptions {
  position: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
  networked?: boolean;
  parentId?: string | null;
  networkEntityId?: string;
}

interface PrefabInstanceRecord {
  prefabName: string;
  objectId: string;
  entityId: string;
}

type PrefabEntityAdapter = Entity;

interface PrefabEntityManagerAdapter {
  onEntityDestroyed(listener: (entity: { id: string }) => void): void;
  getEntity(entityId: string): PrefabEntityAdapter | undefined;
  getEntities(): Iterable<PrefabEntityAdapter>;
  destroyEntity(idOrEntity: string | PrefabEntityAdapter): boolean;
}

type PrefabComponentDef = unknown;

interface ObjectFactoryNode {
  id: string;
  entityId: string;
  children: Array<{ id: string; entityId: string }>;
}

interface ObjectSpawnDef {
  name: string;
  entityType?: string;
  networked?: boolean;
  transform?: {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
  };
  components?: PrefabComponentDef[];
  children?: ObjectSpawnDef[];
}

interface PrefabObjectFactory {
  init?(ctx: SystemContext): void;
  setSystemContext?(ctx: SystemContext): void;
  attachClient?(client: MultiplayerEventSource | null): void;
  update(dt: number): void;
  savePrefab(name: string, def: unknown): void;
  spawn(def: unknown, parentId: string | null): string;
  get(id: string): ObjectFactoryNode | undefined;
  remove(id: string): void;
}

interface PrefabStateStoreAdapter {
  set(path: string, value: unknown): void;
}

interface TwoDPrefabExtensionAdapter {
  validatePrefab?(prefab: PrefabDefinition): string[];
  build2DComponents?(prefab: PrefabDefinition): {
    components: Array<{ name: string; data: Record<string, unknown> }>;
    skipDefaultRender: boolean;
  };
}

function clonePrefab<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isLegacyGruntAssetName(value: string): boolean {
  return value.toLowerCase().includes('grunt');
}

function getLegacyPrefabReplacementName(entityType: string): string | null {
  if (isLegacyGruntAssetName(entityType)) {
    return 'universal_dummy';
  }
  return null;
}

export class PrefabSystem {
  private scene: THREE.Scene;
  private entityManager: PrefabEntityManagerAdapter;
  private stateManager: PrefabStateStoreAdapter;
  private objectCreator: PrefabObjectFactory;
  private sceneGraph: SceneGraph | null;
  private prefabs = new Map<string, PrefabDefinition>();
  private instances = new Map<string, PrefabInstanceRecord>();
  private enableLogging: boolean;
  private systemContext: SystemContext | null = null;
  private client: MultiplayerEventSource | null = null;

  constructor(config: {
    scene: THREE.Scene;
    entityManager: PrefabEntityManagerAdapter;
    stateManager: PrefabStateStoreAdapter;
    objectFactory: PrefabObjectFactory;
    sceneGraph?: SceneGraph | null;
    client?: MultiplayerEventSource;
    enableLogging?: boolean;
  }) {
    this.scene = config.scene;
    this.entityManager = config.entityManager;
    this.stateManager = config.stateManager;
    this.sceneGraph = config.sceneGraph ?? null;
    this.enableLogging = config.enableLogging ?? false;
    this.objectCreator = config.objectFactory;

    registerBuiltinModelAssets();
    this.registerBuiltinPrefabs();
    this.entityManager.onEntityDestroyed((entity) => {
      const instance = this.instances.get(entity.id);
      if (!instance) return;
      this.instances.delete(entity.id);
      this.stateManager.set(`prefabInstances.${entity.id}`, undefined as any);
      gameBus.emit('prefabRemoved', {
        prefabName: instance.prefabName,
        entityId: instance.entityId,
        objectId: instance.objectId,
      });
    });

    gameBus.on('CLEANUP_PLACEHOLDER', ({ entityId, networkEntityId, prefabName }) => {
      const entities = [...this.entityManager.getEntities()];
      for (const entity of entities) {
        if (entity.id === entityId) {
          continue;
        }
        const placeholderData = entity.getComponent('placeholder')?.data;
        if (placeholderData?.isPlaceholder !== true) {
          continue;
        }
        const placeholderNetworkEntityId = typeof placeholderData.networkEntityId === 'string'
          ? placeholderData.networkEntityId
          : null;
        if (networkEntityId && placeholderNetworkEntityId !== networkEntityId) {
          continue;
        }
        this.entityManager.destroyEntity(entity.id);
        console.log('[PrefabSystem] Placeholder cleaned up', {
          placeholderEntityId: entity.id,
          replacementEntityId: entityId,
          networkEntityId,
          prefabName,
        });
      }
    });

    if (config.client) {
      this.attachClient(config.client);
    }
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.objectCreator.setSystemContext?.(ctx);
    this.objectCreator.init?.(ctx);
    if (!this.client) {
      this.attachClient(this.resolveContextClient());
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  attachClient(client: MultiplayerEventSource | null = this.resolveContextClient()): void {
    if (!client || client === this.client) return;
    this.client = client;
    this.getObjectFactory().attachClient?.(client);
  }

  update(dt: number): void {
    this.getObjectFactory().update(dt);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        registeredPrefabs: this.prefabs.size,
        liveInstances: this.instances.size,
        hasSystemContext: this.systemContext !== null,
        hasClient: this.client !== null,
        spawnCount: this.instances.size,
        samplePrefabs: this.listPrefabs().slice(0, 12),
      },
    };
  }

  registerPrefab(name: string, definition: PrefabDefinition): void {
    if (isLegacyGruntAssetName(name) || isLegacyGruntAssetName(definition.entityType)) {
      throw new Error(`FATAL_ASSET_ERROR: Legacy grunt asset registration blocked (${name})`);
    }
    const prefab = clonePrefab({ ...definition, name });
    migrateLegacyMetadata(prefab);
    prefab.tags = normalizeTags(prefab.tags ?? []);
    prefab.contentHash = computePrefabContentHash(prefab);
    const issues = this.validatePrefabDefinition(prefab);
    const fatalIssue = issues.some((issue) => issue.startsWith('Unknown metadata namespace:') || issue.startsWith('Invalid metadata field:'));
    if (fatalIssue) {
      throw new Error(`Prefab registration failed for ${name}: ${issues.join('; ')}`);
    }
    this.prefabs.set(name, prefab);
    this.getObjectFactory().savePrefab(name, this.toSpawnDef(prefab, { x: 0, y: 0, z: 0 }));
    this.stateManager.set(`prefabRegistry.${name}`, prefab);
    this.stateManager.set(`prefabRegistryValidation.${name}`, issues);
  }

  registerBuiltinPrefabs(): void {
    Object.entries(BUILTIN_PREFABS).forEach(([name, definition]) => {
      this.registerPrefab(name, definition as PrefabDefinition);
    });
  }

  listPrefabs(): string[] {
    return [...this.prefabs.keys()].sort();
  }

  findPrefabNameByEntityType(entityType: string): string | null {
    const legacyReplacement = getLegacyPrefabReplacementName(entityType);
    if (legacyReplacement && this.prefabs.has(legacyReplacement)) {
      return legacyReplacement;
    }

    for (const [name, prefab] of this.prefabs) {
      if (prefab.entityType === entityType) return name;
    }
    return null;
  }

  getPrefab(name: string): PrefabDefinition | undefined {
    const prefab = this.prefabs.get(name);
    return prefab ? clonePrefab(prefab) : undefined;
  }

  create(prefabName: string, position: Vector3, overrides: Partial<PrefabCreateOptions> = {}): Entity {
    if (isLegacyGruntAssetName(prefabName)) {
      throw new Error(`FATAL_ASSET_ERROR: Legacy grunt prefab creation blocked (${prefabName})`);
    }
    const prefab = this.prefabs.get(prefabName);
    if (!prefab) {
      throw new Error(`Unknown prefab: ${prefabName}`);
    }

    console.log('[SpawnDiagnostics] PREFAB RESOLVED', {
      requestedPrefabId: prefabName,
      entityType: prefab.entityType,
      assetKey: prefab.assetKey ?? null,
      position,
    });

    const objectFactory = this.getObjectFactory();
    const objectId = objectFactory.spawn(this.toSpawnDef(prefab, position, overrides), overrides.parentId ?? null);
    const object = objectFactory.get(objectId);
    if (!object) {
      throw new Error(`Failed to create prefab: ${prefabName}`);
    }

    const entity = this.entityManager.getEntity(object.entityId);
    if (!entity) {
      throw new Error(`Prefab entity missing after spawn: ${prefabName}`);
    }

    if (prefab.pickup) {
      entity.addComponent({ name: 'pickup', data: { type: 'pickup', ...clonePrefab(prefab.pickup) } });
    }

    if (prefab.interactable) {
      entity.addComponent({ name: 'interactable', data: { type: 'interactable', ...clonePrefab(prefab.interactable) } });
    }

    entity.addComponent({
      name: 'prefab',
      data: {
        prefabName,
        tags: normalizeTags(prefab.tags ?? []),
        metadata: clonePrefab(prefab.metadata?.runtimeMetadata ?? {}),
        contentHash: prefab.contentHash,
      },
    });
    if (this.isPlaceholderPrefab(prefabName, prefab)) {
      entity.addComponent({
        name: 'placeholder',
        data: {
          isPlaceholder: true,
          prefabName,
          entityType: prefab.entityType,
          networkEntityId: overrides.networkEntityId ?? entity.id,
        },
      });
    }
    this.instances.set(entity.id, { prefabName, objectId, entityId: entity.id });
    this.stateManager.set(`prefabInstances.${entity.id}`, {
      prefabName,
      objectId,
      entityId: entity.id,
    });
    gameBus.emit('prefabCreated', {
      prefabName,
      entityId: entity.id,
      objectId,
    });

    this.linkHierarchy(objectId);

    if (this.enableLogging) {
      console.log(`[PrefabSystem] Spawned ${prefabName} as ${entity.id}`);
    }

    if (prefab.entityType === 'player' && !this.isPlaceholderPrefab(prefabName, prefab)) {
      gameBus.emit('CLEANUP_PLACEHOLDER', {
        entityId: entity.id,
        networkEntityId: overrides.networkEntityId ?? entity.id,
        prefabName,
        timestamp: Engine.time.now(),
      });
    }

    return entity;
  }

  createByEntityType(entityType: string, position: Vector3, overrides: Partial<PrefabCreateOptions> = {}): Entity | null {
    const netId = typeof overrides.networkEntityId === 'string' ? overrides.networkEntityId : null;
    if (getLegacyPrefabReplacementName(entityType)) {
      console.warn('[PrefabSystem] Dropping legacy grunt snapshot entity', {
        entityType,
        networkEntityId: netId,
      });
      gameBus.emit('STALE_SNAPSHOT_ENTITY_DROPPED', {
        entityType,
        netId,
        timestamp: Engine.time.now(),
      });
      return null;
    }

    const prefabName = this.findPrefabNameByEntityType(entityType);
    if (!prefabName) {
      console.warn(`[DANGER] Dropping stale entity from snapshot: ${entityType}`, {
        netId,
        source: 'prefab_lookup',
        reason: 'no_registered_prefab_drop',
        registeredPrefabs: this.prefabs.size,
      });
      gameBus.emit('STALE_SNAPSHOT_ENTITY_DROPPED', {
        entityType,
        netId,
        timestamp: Engine.time.now(),
      });
      return null;
    }

    return this.create(prefabName, position, overrides);
  }

  /**
   * Wrapper for create() with try/catch error handling.
   * Returns the created entity on success, null on failure.
   * Logs the error but does not throw.
   */
  tryCreate(prefabName: string, position: Vector3, overrides: Partial<PrefabCreateOptions> = {}): Entity | null {
    try {
      return this.create(prefabName, position, overrides);
    } catch (error) {
      console.error(`[PrefabSystem] tryCreate failed for "${prefabName}":`, error);
      return null;
    }
  }

  duplicate(entityId: string, position?: Vector3): Entity | null {
    const record = this.instances.get(entityId);
    if (!record) return null;

    const currentEntity = this.entityManager.getEntity(entityId);
    const currentPosition = currentEntity?.getPosition() ?? { x: 0, y: 0, z: 0 };
    return this.create(record.prefabName, position ?? currentPosition);
  }

  remove(entityId: string): boolean {
    const record = this.instances.get(entityId);
    if (!record) return false;
    this.getObjectFactory().remove(record.objectId);
    return true;
  }

  getObjectCreator(): PrefabObjectFactory {
    return this.getObjectFactory();
  }

  logPrefabs(): string {
    const names = this.listPrefabs();
    const summary = names.map((name) => {
      const prefab = this.prefabs.get(name)!;
      return `${name} -> ${prefab.entityType}${prefab.pickup ? ' [pickup]' : ''}`;
    }).join('\n');
    console.log(summary || '[PrefabSystem] No prefabs registered');
    return summary;
  }

  validateAllPrefabs(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [name, prefab] of this.prefabs) {
      out[name] = this.validatePrefabDefinition(prefab);
    }
    this.stateManager.set('prefabRegistryValidation', out);
    return out;
  }

  hotReloadBuiltinPrefabs(): void {
    for (const asset of listRegisteredAssets()) {
      invalidateAsset(asset.key);
    }
    this.prefabs.clear();
    this.registerBuiltinPrefabs();
  }

  rebuildFromEntityManager(): void {
    this.instances.clear();
    for (const entity of this.entityManager.getEntities()) {
      const prefabName = entity.getComponent('prefab')?.data?.prefabName as string | undefined;
      if (!prefabName) continue;
      this.instances.set(entity.id, {
        prefabName,
        objectId: entity.id,
        entityId: entity.id,
      });
    }
  }

  exportState(): { registry: Record<string, PrefabDefinition>; validation: Record<string, string[]> } {
    const registry: Record<string, PrefabDefinition> = {};
    for (const [name, prefab] of this.prefabs) {
      registry[name] = clonePrefab(prefab);
    }
    return {
      registry,
      validation: this.validateAllPrefabs(),
    };
  }

  importState(state: { registry?: Record<string, PrefabDefinition> } | undefined): void {
    if (state?.registry) {
      for (const [name, prefab] of Object.entries(state.registry)) {
        this.registerPrefab(name, prefab);
      }
    }
    this.rebuildFromEntityManager();
  }

  private resolveContextClient(): MultiplayerEventSource | null {
    return (this.systemContext?.network.getClient() as MultiplayerEventSource | null) ?? null;
  }

  private validatePrefabDefinition(prefab: PrefabDefinition): string[] {
    const issues: string[] = [];
    if (!prefab.entityType.trim()) issues.push('Missing entityType');
    if (prefab.assetKey && !hasAsset(prefab.assetKey)) issues.push(`Missing assetKey: ${prefab.assetKey}`);
    if (prefab.collider && !['box', 'sphere', 'capsule'].includes(prefab.collider.shape)) {
      issues.push(`Unsupported collider shape: ${prefab.collider.shape}`);
    }
    if ((prefab.spawnWeight ?? 1) <= 0) issues.push('spawnWeight must be > 0');
    if ((prefab.minSpacing ?? 0) < 0) issues.push('minSpacing must be >= 0');
    if (prefab.tags && !Array.isArray(prefab.tags)) {
      issues.push('tags must be an array of strings');
    }
    if (prefab.metadata !== undefined) {
      if (typeof prefab.metadata !== 'object' || prefab.metadata === null || Array.isArray(prefab.metadata)) {
        issues.push('metadata must be an object');
      } else {
        for (const key of Object.keys(prefab.metadata)) {
          if (key !== 'runtimeMetadata' && key !== 'editorMetadata') {
            issues.push(`Unknown metadata namespace: ${key}`);
          }
        }
        issues.push(...this.validateRuntimeMetadata(prefab.metadata.runtimeMetadata, 'metadata.runtimeMetadata'));
        issues.push(...this.validateEditorMetadata(prefab.metadata.editorMetadata, 'metadata.editorMetadata'));
      }
    }
    if (this.isTwoDPrefab(prefab)) {
      const extension = this.getTwoDPrefabExtension();
      if (!extension) {
        issues.push('2D prefab extension is not registered');
      } else {
        issues.push(...(extension.validatePrefab?.(prefab) ?? []));
      }
    }
    for (const child of prefab.children ?? []) {
      issues.push(...this.validatePrefabDefinition(child).map((issue) => `child:${child.name}:${issue}`));
    }
    return issues;
  }

  private validateRuntimeMetadata(metadata: PrefabRuntimeMetadata | undefined, path: string): string[] {
    const issues: string[] = [];
    if (metadata === undefined) return issues;
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return [`${path} must be an object`];
    }
    const allowed = new Set([
      'biomeCompatibility',
      'surfaceTypes',
      'affinities',
      'traits',
      'navigationFlags',
      'streamingCost',
      'encounterAffinity',
      'materialAffinity',
      'audioSurfaceType',
      'gpuInstancing',
      'renderCompatibility',
      'destruction',
      'traversal',
      'collisionClass',
      'aiMetadata',
      'gameplay',
    ]);
    for (const key of Object.keys(metadata)) {
      if (!allowed.has(key)) {
        issues.push(`Invalid metadata field: ${path}.${key}`);
      }
    }
    if (metadata.biomeCompatibility && !Array.isArray(metadata.biomeCompatibility)) {
      issues.push(`${path}.biomeCompatibility must be an array of strings`);
    }
    if (metadata.surfaceTypes && !Array.isArray(metadata.surfaceTypes)) {
      issues.push(`${path}.surfaceTypes must be an array of strings`);
    }
    if (metadata.affinities && !Array.isArray(metadata.affinities)) {
      issues.push(`${path}.affinities must be an array of strings`);
    }
    if (metadata.traits && !Array.isArray(metadata.traits)) {
      issues.push(`${path}.traits must be an array of strings`);
    }
    if (metadata.navigationFlags && !Array.isArray(metadata.navigationFlags)) {
      issues.push(`${path}.navigationFlags must be an array of strings`);
    }
    if (metadata.streamingCost !== undefined && typeof metadata.streamingCost !== 'number') {
      issues.push(`${path}.streamingCost must be a number`);
    }
    if (metadata.audioSurfaceType !== undefined && typeof metadata.audioSurfaceType !== 'string') {
      issues.push(`${path}.audioSurfaceType must be a string`);
    }
    if (metadata.gpuInstancing !== undefined && typeof metadata.gpuInstancing !== 'boolean') {
      issues.push(`${path}.gpuInstancing must be a boolean`);
    }
    if (metadata.renderCompatibility && !Array.isArray(metadata.renderCompatibility)) {
      issues.push(`${path}.renderCompatibility must be an array of strings`);
    }
    if (metadata.destruction !== undefined && (typeof metadata.destruction !== 'object' || metadata.destruction === null || Array.isArray(metadata.destruction))) {
      issues.push(`${path}.destruction must be an object`);
    }
    if (metadata.traversal !== undefined && (typeof metadata.traversal !== 'object' || metadata.traversal === null || Array.isArray(metadata.traversal))) {
      issues.push(`${path}.traversal must be an object`);
    }
    if (metadata.aiMetadata !== undefined && (typeof metadata.aiMetadata !== 'object' || metadata.aiMetadata === null || Array.isArray(metadata.aiMetadata))) {
      issues.push(`${path}.aiMetadata must be an object`);
    }
    if (metadata.gameplay !== undefined && (typeof metadata.gameplay !== 'object' || metadata.gameplay === null || Array.isArray(metadata.gameplay))) {
      issues.push(`${path}.gameplay must be an object`);
    }
    if (metadata.collisionClass !== undefined && typeof metadata.collisionClass !== 'string') {
      issues.push(`${path}.collisionClass must be a string`);
    }
    return issues;
  }

  private validateEditorMetadata(metadata: PrefabEditorMetadata | undefined, path: string): string[] {
    const issues: string[] = [];
    if (metadata === undefined) return issues;
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return [`${path} must be an object`];
    }
    const allowed = new Set(['category', 'displayName', 'description', 'iconKey', 'tags']);
    for (const key of Object.keys(metadata)) {
      if (!allowed.has(key)) {
        issues.push(`Invalid metadata field: ${path}.${key}`);
      }
    }
    if (metadata.tags && !Array.isArray(metadata.tags)) {
      issues.push(`${path}.tags must be an array of strings`);
    }
    return issues;
  }

  private getPrefabRuntimeMetadata(prefabName: string): PrefabRuntimeMetadata {
    return this.prefabs.get(prefabName)?.metadata?.runtimeMetadata ?? {};
  }

  getSurfaceType(entity: Entity): string | null {
    const metadata = entity.getComponent('prefab')?.data?.metadata as PrefabRuntimeMetadata | undefined;
    return metadata?.surfaceTypes?.[0] ?? null;
  }

  hasTrait(entity: Entity, trait: string): boolean {
    const metadata = entity.getComponent('prefab')?.data?.metadata as PrefabRuntimeMetadata | undefined;
    const traits = metadata?.traits;
    return Array.isArray(traits) && traits.includes(trait);
  }

  getStreamingCost(prefabName: string): number | null {
    return this.getPrefabRuntimeMetadata(prefabName).streamingCost ?? null;
  }

  getEncounterAffinity(entity: Entity): string[] {
    const metadata = entity.getComponent('prefab')?.data?.metadata as PrefabRuntimeMetadata | undefined;
    const encounterAffinity = metadata?.encounterAffinity;
    return Array.isArray(encounterAffinity) ? [...encounterAffinity] : [];
  }

  getPrefabContentHash(prefabName: string): string | null {
    return this.prefabs.get(prefabName)?.contentHash ?? null;
  }

  private linkHierarchy(rootObjectId: string): void {
    if (!this.sceneGraph) return;
    const root = this.getObjectFactory().get(rootObjectId);
    if (!root) return;
    for (const child of root.children) {
      this.sceneGraph.reparent(child.entityId, root.entityId);
      this.linkHierarchy(child.id);
    }
  }

  private getObjectFactory(): PrefabObjectFactory {
    return (this.systemContext?.systems?.objectCreatorSystem as PrefabObjectFactory | undefined)
      ?? (this.systemContext?.systems?.objectCreator as PrefabObjectFactory | undefined)
      ?? this.objectCreator;
  }

  private getTwoDPrefabExtension(): TwoDPrefabExtensionAdapter | null {
    return (this.systemContext?.systems?.spritePrefabExtension as TwoDPrefabExtensionAdapter | undefined) ?? null;
  }

  private isTwoDPrefab(prefab: PrefabDefinition): boolean {
    return prefab.entityType === 'sprite'
      || prefab.entityType === 'tilemap'
      || prefab.entityType === 'ui'
      || !!prefab.sprite2d
      || !!prefab.animation2d
      || !!prefab.tilemap2d
      || !!prefab.ui2d
      || !!prefab.physics2d
      || !!prefab.input2d;
  }

  private isPlaceholderPrefab(prefabName: string, prefab: PrefabDefinition): boolean {
    return prefabName === 'universal_dummy' || prefab.assetKey === 'placeholder_dummy';
  }

  private toSpawnDef(prefab: PrefabDefinition, position: Vector3, overrides: Partial<PrefabCreateOptions> = {}): ObjectSpawnDef {
    const components: PrefabComponentDef[] = [];
    const twoDResult = this.isTwoDPrefab(prefab)
      ? this.getTwoDPrefabExtension()?.build2DComponents?.(prefab) ?? null
      : null;

    if (!twoDResult?.skipDefaultRender) {
      components.push(createRenderComponent(
        prefab.assetKey ? 'custom' : 'box',
        prefab.color ?? 0xffffff,
        prefab.assetKey ? { assetKey: prefab.assetKey } : { width: 1, height: 1, depth: 1 },
      ));
    }

    if (twoDResult?.components?.length) {
      components.push(...twoDResult.components);
    }

    if (prefab.components?.length) {
      components.push(...prefab.components.map((component) => ({
        name: component.name,
        data: component.data,
      })));
    }

    if (prefab.collider) {
      if (prefab.collider.shape === 'sphere') {
        components.push(createSphereCollider(prefab.collider.size.radius ?? 0.5));
      } else if (prefab.collider.shape === 'capsule') {
        components.push(createCapsuleCollider(
          prefab.collider.size.capsuleRadius ?? 0.4,
          prefab.collider.size.capsuleHeight ?? 1.2,
        ));
      } else {
        components.push(createBoxCollider(
          prefab.collider.size.width ?? 1,
          prefab.collider.size.height ?? 1,
          prefab.collider.size.depth ?? 1,
        ));
      }
    }

    return {
      name: prefab.name,
      entityType: prefab.entityType,
      networked: overrides.networked ?? prefab.networked ?? true,
      transform: {
        position,
        rotation: overrides.rotation ?? { x: 0, y: 0, z: 0 },
        scale: overrides.scale ?? { x: 1, y: 1, z: 1 },
      },
      components,
      children: prefab.children?.map((child) => this.toSpawnDef(child, { x: 0, y: 0, z: 0 })),
    };
  }
}