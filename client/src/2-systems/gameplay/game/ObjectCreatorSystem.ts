/**
 * ObjectCreatorSystem
 * Composite object spawning, component management, save/load and multiplayer sync.
 *
 * An EngineObject is a tree of typed component bags attached to an entity.
 * Any EngineObject can be serialised to JSON ("prefab") and later re-spawned.
 *
 * Integration points
 * ──────────────────
 * • EntityManager  — creates the underlying entity
 * • EntityRenderer — syncs the visual mesh from RenderComponent
 * • StateManager   — all component data is committed here (source of truth)
 * • THREE.Scene    — projectile groups are added/removed directly
 * • MultiplayerClient — optionally passed to broadcast spawn/remove events
 *
 * Usage (minimal)
 * ───────────────
 * const ocs = new ObjectCreatorSystem(scene, entityManager, entityRenderer, stateManager);
 * const id = ocs.spawn({ name: 'TestBox', components: [createRenderComponent('box', 0xff4444)] });
 * ocs.update(dt); // call each frame
 */

import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { WorldObjectData, WorldObjectTransport } from '../../../3-network/network/MultiplayerContracts';
import { RenderComponent } from './components/RenderComponent';
import { ColliderComponent } from './components/ColliderComponent';
import { ProjectileComponent } from './components/ProjectileComponent';
import { DamageComponent } from './components/DamageComponent';
import { ScriptComponent, ScriptContext, ScriptRegistry } from './components/ScriptComponent';

interface ObjectEntityAdapter {
  id: string;
  addComponent(component: { name: string; data: unknown }): void;
  setPosition(position: { x: number; y: number; z: number }): void;
  setRotation(rotation: { x: number; y: number; z: number }): void;
}

interface EntityManagerAdapter {
  createEntity(entityType: string, config: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }): ObjectEntityAdapter;
  getEntity(entityId: string): ObjectEntityAdapter | undefined;
  destroyEntity(entity: string | ObjectEntityAdapter): void;
}

interface EntityRendererAdapter {
  syncEntity(entity: ObjectEntityAdapter): void;
}

interface ObjectCreatorStateStoreAdapter {
  set(path: string, value: unknown): void;
  getState(path?: string): unknown;
}

// ─── Component union ─────────────────────────────────────────────────────────

export type Component =
  | RenderComponent
  | ColliderComponent
  | ProjectileComponent
  | DamageComponent
  | ScriptComponent;

// ─── Core type ───────────────────────────────────────────────────────────────

export interface EngineObjectTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale:    { x: number; y: number; z: number };
}

/**
 * The serialisable definition used to spawn or save an object.
 * Children are also SpawnDefs so prefabs compose recursively.
 */
export interface SpawnDef {
  /** Stable human-readable name */
  name: string;
  /** Entity type string (e.g. 'WorldItem', 'Projectile') */
  entityType?: string;
  transform?: Partial<EngineObjectTransform>;
  components?: Component[];
  children?: SpawnDef[];
  /** Reference to a saved prefab (overridden by inline fields) */
  prefabRef?: string;
  /** Multiplayer sync: if false this object is local-only (default true) */
  networked?: boolean;
  /** Procedural seed — passed to ScriptComponents that use it */
  seed?: number;
}

/** Runtime record managed by ObjectCreatorSystem */
export interface EngineObject {
  /** UUID assigned at spawn time */
  id: string;
  name: string;
  entityType: string;
  /** ECS entity ID in EntityManager */
  entityId: string;
  transform: EngineObjectTransform;
  components: Map<string, Component>;
  children: EngineObject[];
  parentId: string | null;
  prefabRef: string | null;
  networked: boolean;
  /** Convenience accessors */
  addChild(child: EngineObject): void;
  addComponent(component: Component): void;
  removeComponent(componentType: string): void;
  getComponent<T extends Component>(componentType: string): T | undefined;
}

// ─── Prefab store ─────────────────────────────────────────────────────────────

type PrefabStore = Map<string, SpawnDef>;

// ─── ObjectCreatorSystem ─────────────────────────────────────────────────────

export class ObjectCreatorSystem {
  private scene: THREE.Scene;
  private entityManager: EntityManagerAdapter;
  private entityRenderer: EntityRendererAdapter;
  private stateManager: ObjectCreatorStateStoreAdapter;
  private legacyClient: WorldObjectTransport | null = null;
  private systemContext: SystemContext | null = null;

  /** All live objects keyed by their id */
  private objects: Map<string, EngineObject> = new Map();
  /** THREE.Group per object (visual layer) */
  private groups: Map<string, THREE.Group> = new Map();

  /** Named prefabs saved in this session */
  private prefabs: PrefabStore = new Map();

  /** Pending remove list, processed at end of each update tick */
  private _toRemove: string[] = [];

  constructor(
    scene: THREE.Scene,
    entityManager: EntityManagerAdapter,
    entityRenderer: EntityRendererAdapter,
    stateManager: ObjectCreatorStateStoreAdapter,
  ) {
    this.scene = scene;
    this.entityManager = entityManager;
    this.entityRenderer = entityRenderer;
    this.stateManager = stateManager;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    const contextClient = ctx.network.getClient() as WorldObjectTransport | null;
    if (contextClient) {
      this.attachClient(contextClient);
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  attachClient(client: WorldObjectTransport | null): void {
    if (!client || client === this.legacyClient) return;
    this.legacyClient = client;
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
        objectCount: this.objects.size,
        prefabCount: this.prefabs.size,
        pendingRemovals: this._toRemove.length,
        hasSystemContext: this.systemContext !== null,
        hasWorldTransport: this.getWorldTransport() !== null,
      },
    };
  }

  private isFallbackPrimitiveMeshType(meshType: unknown): meshType is 'box' | 'sphere' | 'capsule' {
    return meshType === 'box' || meshType === 'sphere' || meshType === 'capsule';
  }

  // ─── Spawn ───────────────────────────────────────────────────────────────

  /**
   * Spawn an EngineObject from a SpawnDef.
   * Returns the id of the root object.
   */
  spawn(def: SpawnDef, parentId: string | null = null): string {
    // Merge prefab if referenced
    const resolved: SpawnDef = def.prefabRef
      ? { ...this.prefabs.get(def.prefabRef), ...def }
      : def;

    const id = _genId();
    const entityType = resolved.entityType ?? 'WorldObject';
    const transform = this._resolveTransform(resolved.transform);

    // ECS entity
    const entity = this.entityManager.createEntity(entityType, {
      position: transform.position,
      rotation: transform.rotation,
    });

    const obj = this._makeObject(id, resolved.name, entityType, entity.id, transform, parentId, resolved);

    // Sync render component if present
    const renderComp = obj.getComponent<RenderComponent>('render');
    if (renderComp) {
      entity.addComponent({ name: 'render', data: renderComp });
      this.entityRenderer.syncEntity(entity);
    }

    // Build Three.js group for projectile/runtime tracking
    const group = new THREE.Group();
    group.position.set(transform.position.x, transform.position.y, transform.position.z);
    group.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    group.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
    group.userData.objectId = id;
    this.scene.add(group);
    this.groups.set(id, group);

    this.objects.set(id, obj);

    // Commit to StateManager
    this._commitObject(obj);
    gameBus.emit('stateMutation', {
      source: 'objectCreatorSystem',
      path: `objects.${id}`,
      changedCount: 1,
    });

    // Spawn children
    for (const childDef of resolved.children ?? []) {
      const childId = this.spawn(childDef, id);
      const childObj = this.objects.get(childId);
      if (childObj) obj.children.push(childObj);
    }

    // Notify multiplayer
    const transport = this.getWorldTransport();
    if ((resolved.networked ?? true) && transport?.connected) {
      const renderData = renderComp ?? { meshType: 'box', color: 0xffffff, geometry: {} };
      if (!renderComp) {
        const details = {
          source: 'object_creator_spawn',
          objectId: id,
          entityType,
          reason: 'missing_render_component',
          meshType: 'box',
        };
        console.error('[SpawnDiagnostics] FATAL_PREFAB_MISSING', details);
        throw new Error(`FATAL_PREFAB_MISSING: render component missing for ${entityType}`);
      }
      transport.sendWorldObjectPlace({
        id,
        entityType,
        position: transform.position,
        rotation: transform.rotation,
        renderData: renderData as any,
      });
    }

    return id;
  }

  /** Internal: spawn an object received from the server (no re-broadcast) */
  spawnFromRemote(data: WorldObjectData): void {
    if (this.objects.has(data.id)) return;
    if (this.isFallbackPrimitiveMeshType(data.renderData?.meshType)) {
      const details = {
        source: 'object_creator_spawn_from_remote',
        objectId: data.id,
        entityType: data.entityType,
        meshType: data.renderData?.meshType,
      };
      console.error('[SpawnDiagnostics] FATAL_PREFAB_MISSING', details);
      throw new Error(`FATAL_PREFAB_MISSING: remote render data invalid for ${data.entityType}`);
    }
    const entity = this.entityManager.createEntity(data.entityType, {
      position: data.position,
      rotation: data.rotation,
    });
    entity.addComponent({ name: 'render', data: data.renderData });
    this.entityRenderer.syncEntity(entity);

    const transform = this._resolveTransform({ position: data.position, rotation: data.rotation });
    const obj = this._makeObject(data.id, data.entityType, data.entityType, entity.id, transform, null, { name: data.entityType, networked: false });

    const group = new THREE.Group();
    group.position.set(data.position.x, data.position.y, data.position.z);
    group.userData.objectId = data.id;
    this.scene.add(group);
    this.groups.set(data.id, group);
    this.objects.set(data.id, obj);
    this._commitObject(obj);
    gameBus.emit('stateMutation', {
      source: 'objectCreatorSystem',
      path: `objects.${data.id}`,
      changedCount: 1,
    });
    console.log('[SpawnDiagnostics] ENTITY CREATED', {
      source: 'object_creator_spawn_from_remote',
      objectId: data.id,
      entityId: entity.id,
      entityType: data.entityType,
      meshType: data.renderData?.meshType ?? 'unknown',
    });
  }

  // ─── Remove ──────────────────────────────────────────────────────────────

  remove(id: string, broadcast = true): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    // Remove children first
    for (const child of [...obj.children]) {
      this.remove(child.id, false);
    }

    // Destroy ECS entity
    this.entityManager.destroyEntity(obj.entityId);

    // Remove THREE.Group from scene
    const group = this.groups.get(id);
    if (group) {
      this.scene.remove(group);
      _disposeGroup(group);
      this.groups.delete(id);
    }

    this.objects.delete(id);
    this.stateManager.set(`objects.${id}`, undefined as any);
    gameBus.emit('stateMutation', {
      source: 'objectCreatorSystem',
      path: `objects.${id}`,
      changedCount: 1,
    });

    const transport = this.getWorldTransport();
    if (broadcast && obj.networked && transport?.connected) {
      transport.sendWorldObjectRemove(id);
    }
  }

  removeAll(): void {
    for (const id of [...this.objects.keys()]) this.remove(id, false);
  }

  updateTransform(
    id: string,
    position: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number },
    broadcast = true,
  ): boolean {
    const obj = this.objects.get(id);
    if (!obj) return false;

    obj.transform.position = { ...position };
    if (rotation) {
      obj.transform.rotation = { ...rotation };
    }

    const entity = this.entityManager.getEntity(obj.entityId);
    entity?.setPosition({ ...obj.transform.position });
    if (rotation) entity?.setRotation({ ...obj.transform.rotation });

    const group = this.groups.get(id);
    if (group) {
      group.position.set(position.x, position.y, position.z);
      if (rotation) {
        group.rotation.set(rotation.x, rotation.y, rotation.z);
      }
    }

    this._commitObject(obj);
    if (broadcast) {
      gameBus.emit('stateMutation', {
        source: 'objectCreatorSystem',
        path: `objects.${id}.transform`,
        changedCount: 1,
      });
    }

    const transport = this.getWorldTransport();
    if (broadcast && obj.networked && transport?.connected) {
      const renderComp = obj.getComponent<RenderComponent>('render');
      if (renderComp) {
        transport.sendWorldObjectUpdate({
          id,
          entityType: obj.entityType,
          position: obj.transform.position,
          rotation: obj.transform.rotation,
          renderData: renderComp as any,
        });
      }
    }

    return true;
  }

  // ─── Per-frame update ────────────────────────────────────────────────────

  update(dt: number): void {
    const clampedDt = Math.min(dt, 0.1);

    for (const [id, obj] of this.objects) {
      this._tickProjectile(id, obj, clampedDt);
      this._tickScript(id, obj, clampedDt);
    }

    // Flush deferred removals
    for (const id of this._toRemove) this.remove(id);
    this._toRemove.length = 0;
  }

  // ─── Prefab API ──────────────────────────────────────────────────────────

  savePrefab(name: string, def: SpawnDef): void {
    this.prefabs.set(name, { ...def, prefabRef: undefined });
    this.stateManager.set(`prefabs.${name}`, def);
    gameBus.emit('stateMutation', {
      source: 'objectCreatorSystem',
      path: `prefabs.${name}`,
      changedCount: 1,
    });
  }

  loadPrefab(name: string): SpawnDef | undefined {
    return this.prefabs.get(name);
  }

  listPrefabs(): string[] {
    return [...this.prefabs.keys()];
  }

  // ─── JSON save/load ──────────────────────────────────────────────────────

  exportPrefab(name: string): string {
    const def = this.prefabs.get(name);
    if (!def) throw new Error(`Prefab not found: ${name}`);
    return JSON.stringify(def, null, 2);
  }

  importPrefab(json: string): string {
    const def = JSON.parse(json) as SpawnDef;
    if (!def.name) throw new Error('Prefab JSON missing "name" field');
    this.savePrefab(def.name, def);
    return def.name;
  }

  exportAllPrefabs(): string {
    const out: Record<string, SpawnDef> = {};
    for (const [k, v] of this.prefabs) out[k] = v;
    return JSON.stringify(out, null, 2);
  }

  importAllPrefabs(json: string): void {
    const map = JSON.parse(json) as Record<string, SpawnDef>;
    for (const [k, v] of Object.entries(map)) this.savePrefab(k, v);
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  get(id: string): EngineObject | undefined { return this.objects.get(id); }
  getAll(): EngineObject[] { return [...this.objects.values()]; }
  getByType(entityType: string): EngineObject[] {
    return [...this.objects.values()].filter((o) => o.entityType === entityType);
  }
  getGroup(id: string): THREE.Group | undefined { return this.groups.get(id); }

  private getWorldTransport(): WorldObjectTransport | null {
    return (this.systemContext?.network.getClient() as WorldObjectTransport | null) ?? this.legacyClient;
  }

  // ─── Private: tick subsystems ─────────────────────────────────────────────

  private _tickProjectile(id: string, obj: EngineObject, dt: number): void {
    const proj = obj.getComponent<ProjectileComponent>('projectile');
    if (!proj || proj.spent) return;

    proj.lifetime -= dt;
    if (proj.lifetime <= 0) { this._toRemove.push(id); return; }

    const speed = proj.speed * dt;
    const grav = (proj.gravity ?? 0) * 9.8 * dt;

    obj.transform.position.x += proj.direction.x * speed;
    obj.transform.position.y += proj.direction.y * speed - grav;
    obj.transform.position.z += proj.direction.z * speed;

    const group = this.groups.get(id);
    if (group) {
      group.position.set(obj.transform.position.x, obj.transform.position.y, obj.transform.position.z);
    }

    // Update ECS entity
    const entity = this.entityManager.getEntity(obj.entityId);
    entity?.setPosition({ ...obj.transform.position });
  }

  private _tickScript(id: string, obj: EngineObject, dt: number): void {
    const script = obj.getComponent<ScriptComponent>('script');
    if (!script) return;

    script.elapsed = (script.elapsed ?? 0) + dt;
    const fn = ScriptRegistry.resolve(script.scriptId);
    if (!fn) return;

    let destroyed = false;
    const ctx: ScriptContext = {
      objectId: id,
      elapsed: script.elapsed,
      dt,
      get: (key) => this.stateManager.getState(`objects.${id}.${key}`),
      set: (key, value) => { this.stateManager.set(`objects.${id}.${key}`, value); },
      destroy: () => { destroyed = true; },
    };
    fn(ctx);
    if (destroyed) this._toRemove.push(id);
  }

  // ─── Private: helpers ─────────────────────────────────────────────────────

  private _makeObject(
    id: string,
    name: string,
    entityType: string,
    entityId: string,
    transform: EngineObjectTransform,
    parentId: string | null,
    def: SpawnDef,
  ): EngineObject {
    const components = new Map<string, Component>();
    for (const c of def.components ?? []) {
      components.set(c.type, c);
    }

    const obj: EngineObject = {
      id,
      name,
      entityType,
      entityId,
      transform,
      components,
      children: [],
      parentId,
      prefabRef: def.prefabRef ?? null,
      networked: def.networked ?? true,
      addChild(child) { this.children.push(child); },
      addComponent(comp) { this.components.set(comp.type, comp); },
      removeComponent(compType) { this.components.delete(compType); },
      getComponent<T extends Component>(compType: string): T | undefined {
        return this.components.get(compType) as T | undefined;
      },
    };

    return obj;
  }

  private _resolveTransform(partial?: Partial<EngineObjectTransform>): EngineObjectTransform {
    return {
      position: partial?.position ?? { x: 0, y: 0, z: 0 },
      rotation: partial?.rotation ?? { x: 0, y: 0, z: 0 },
      scale:    partial?.scale    ?? { x: 1, y: 1, z: 1 },
    };
  }

  private _commitObject(obj: EngineObject): void {
    this.stateManager.set(`objects.${obj.id}`, {
      id: obj.id,
      name: obj.name,
      entityType: obj.entityType,
      entityId: obj.entityId,
      position: { ...obj.transform.position },
      rotation: { ...obj.transform.rotation },
      scale:    { ...obj.transform.scale },
      components: Object.fromEntries([...obj.components.entries()]),
    });
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _genId(): string {
  return `obj_${Engine.time.now()}_${_idCounter++}`;
}

function _disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) (m as THREE.Material)?.dispose();
  });
}
