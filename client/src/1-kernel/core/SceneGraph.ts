/**
 * Scene Graph System
 * Hierarchical transform management with parent/child relationships.
 *
 * Design principles:
 *  - Every entity registered here has a SceneNode (entityId, parentId?, children[]).
 *  - "Local" transform = stored in StateManager / entity. "World" transform = accumulated up the hierarchy.
 *  - All writes go through StateManager so Save/Load, network and undo systems stay consistent.
 *  - Rich event surface so Editor (hierarchy panel), SelectionSystem and GizmoSystem can react to
 *    hierarchy changes without polling.
 *
 * Integration points:
 *  - Editor hierarchy panel   â†’ subscribe via `onHierarchyChanged`
 *  - SelectionSystem          â†’ call `getSubtree` to select entire hierarchies
 *  - GizmoSystem              â†’ call `getWorldTransform` to position handles at world coords
 *  - EntityManager            â†’ calls `registerEntity` / `unregisterEntity` on lifecycle events
 *  - Play mode movement       â†’ call `setWorldPosition` so children follow automatically
 */

import { Entity, Vector3, Transform } from './Entity';
import { StateManager } from '../../0-foundation/foundation/state/StateManager';
import { getPosition, setPosition, getRotation, setRotation, getScale, setScale } from './Transform';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SceneNode {
  entityId: string;
  parentId?: string;
  children: string[];
}

/** Payload delivered to hierarchy-change subscribers. */
export interface HierarchyChangedEvent {
  type: 'parented' | 'unparented' | 'registered' | 'unregistered';
  entityId: string;
  parentId?: string;
}

/** Subscriber signature for hierarchy events. */
export type HierarchyChangeCallback = (event: HierarchyChangedEvent) => void;

// ---------------------------------------------------------------------------
// SceneGraph
// ---------------------------------------------------------------------------

export class SceneGraph {
  private nodes: Map<string, SceneNode> = new Map();
  private entities: Map<string, Entity> = new Map();
  private stateManager: StateManager;
  private enableLogging: boolean;

  /** Subscribers that want to know about hierarchy changes (e.g. Editor panel). */
  private hierarchyListeners: Set<HierarchyChangeCallback> = new Set();

  constructor(stateManager: StateManager, enableLogging = false) {
    this.stateManager = stateManager;
    this.enableLogging = enableLogging;
    if (this.enableLogging) console.log('[SceneGraph] Initialized');
  }

  // -------------------------------------------------------------------------
  // Subscription API (Editor / Gizmo integration)
  // -------------------------------------------------------------------------

  /**
   * Subscribe to hierarchy change events.
   * Returns an unsubscribe function.
   *
   * Usage (Editor hierarchy panel):
   *   const unsub = sceneGraph.onHierarchyChanged((e) => refreshPanel());
   *
   * Usage (GizmoSystem â€” re-position handle when parent changes):
   *   sceneGraph.onHierarchyChanged((e) => {
   *     if (e.entityId === selectedId) gizmo.refreshPosition();
   *   });
   */
  onHierarchyChanged(cb: HierarchyChangeCallback): () => void {
    this.hierarchyListeners.add(cb);
    return () => this.hierarchyListeners.delete(cb);
  }

  private emit(event: HierarchyChangedEvent): void {
    for (const cb of this.hierarchyListeners) {
      try { cb(event); } catch (err) { console.error('[SceneGraph] Listener error', err); }
    }
  }

  // -------------------------------------------------------------------------
  // Entity lifecycle
  // -------------------------------------------------------------------------

  /** Called by EntityManager when an entity is created. */
  registerEntity(entity: Entity): void {
    if (this.nodes.has(entity.id)) {
      console.warn(`[SceneGraph] Entity already registered: ${entity.id}`);
      return;
    }

    this.nodes.set(entity.id, { entityId: entity.id, children: [] });
    this.entities.set(entity.id, entity);

    this.stateManager.set(`entities.${entity.id}.parentId`, null);
    this.stateManager.set(`entities.${entity.id}.children`, []);

    if (this.enableLogging) console.log(`[SceneGraph] Registered: ${entity.id}`);
    this.emit({ type: 'registered', entityId: entity.id });
  }

  /** Called by EntityManager when an entity is destroyed. */
  unregisterEntity(entityId: string): void {
    const node = this.nodes.get(entityId);
    if (!node) return;

    // Detach from parent
    if (node.parentId) this.removeChild(node.parentId, entityId);

    // Unparent all children (they become root nodes)
    for (const childId of [...node.children]) this.removeChild(entityId, childId);

    this.nodes.delete(entityId);
    this.entities.delete(entityId);

    if (this.enableLogging) console.log(`[SceneGraph] Unregistered: ${entityId}`);
    this.emit({ type: 'unregistered', entityId });
  }

  // -------------------------------------------------------------------------
  // Hierarchy management
  // -------------------------------------------------------------------------

  /**
   * Make `childId` a child of `parentId`.
   * Maintains world position (converts child's current world position to local).
   */
  addChild(parentId: string, childId: string): void {
    const parentNode = this.nodes.get(parentId);
    const childNode  = this.nodes.get(childId);

    if (!parentNode) { console.error(`[SceneGraph] Parent not found: ${parentId}`); return; }
    if (!childNode)  { console.error(`[SceneGraph] Child not found: ${childId}`);  return; }
    if (this.wouldCreateCycle(parentId, childId)) {
      console.error(`[SceneGraph] Cycle detected: ${parentId} â†’ ${childId}`); return;
    }

    // Remove from previous parent if any
    if (childNode.parentId && childNode.parentId !== parentId) {
      this.removeChild(childNode.parentId, childId);
    }

    if (!parentNode.children.includes(childId)) {
      parentNode.children.push(childId);
      childNode.parentId = parentId;

      this.stateManager.set(`entities.${parentId}.children`, [...parentNode.children]);
      this.stateManager.set(`entities.${childId}.parentId`, parentId);

      if (this.enableLogging) console.log(`[SceneGraph] Parented ${childId} â†’ ${parentId}`);
      this.emit({ type: 'parented', entityId: childId, parentId });

      // Push transforms down from the new parent
      this.propagateTransform(parentId);
    }
  }

  /**
   * Remove `childId` from `parentId`'s children.
   * The child keeps its current world transform.
   */
  removeChild(parentId: string, childId: string): void {
    const parentNode = this.nodes.get(parentId);
    const childNode  = this.nodes.get(childId);
    if (!parentNode || !childNode) return;

    const idx = parentNode.children.indexOf(childId);
    if (idx < 0) return;

    parentNode.children.splice(idx, 1);
    childNode.parentId = undefined;

    this.stateManager.set(`entities.${parentId}.children`, [...parentNode.children]);
    this.stateManager.set(`entities.${childId}.parentId`, null);

    if (this.enableLogging) console.log(`[SceneGraph] Unparented ${childId} from ${parentId}`);
    this.emit({ type: 'unparented', entityId: childId, parentId });
  }

  getChildren(parentId: string): string[] {
    return [...(this.nodes.get(parentId)?.children ?? [])];
  }

  getParent(entityId: string): string | undefined {
    return this.nodes.get(entityId)?.parentId;
  }

  // -------------------------------------------------------------------------
  // World-transform API (used by GizmoSystem & Play-mode movement)
  // -------------------------------------------------------------------------

  /**
   * Compute world transform of an entity by accumulating parent chain.
   *
   * GizmoSystem usage:
   *   const world = sceneGraph.getWorldTransform(selectedEntityId);
   *   gizmoGroup.position.set(world.position.x, world.position.y, world.position.z);
   */
  getWorldTransform(entityId: string): Transform {
    const entity = this.entities.get(entityId);
    if (!entity) return _identityTransform();

    const local = _readTransform(entity, this.stateManager);
    const parentId = this.getParent(entityId);
    if (!parentId) return local;

    const parentWorld = this.getWorldTransform(parentId);
    return _combineTransforms(parentWorld, local);
  }

  /**
   * Move entity to a world position, back-solving the local offset.
   *
   * Play-mode usage:
   *   sceneGraph.setWorldPosition(playerEntity.id, newWorldPos);
   *
   * GizmoSystem usage (after axis drag):
   *   sceneGraph.setWorldPosition(selectedId, dragResult);
   */
  setWorldPosition(entityId: string, worldPos: Vector3): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    const parentId = this.getParent(entityId);
    if (!parentId) {
      setPosition(entity, this.stateManager, worldPos);
    } else {
      const parentWorld = this.getWorldTransform(parentId);
      setPosition(entity, this.stateManager, _subtractV3(worldPos, parentWorld.position));
    }
    this.propagateTransform(entityId);
  }

  /** Set world rotation, back-solving local rotation. */
  setWorldRotation(entityId: string, worldRot: Vector3): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    const parentId = this.getParent(entityId);
    if (!parentId) {
      setRotation(entity, this.stateManager, worldRot);
    } else {
      const parentWorld = this.getWorldTransform(parentId);
      setRotation(entity, this.stateManager, _subtractV3(worldRot, parentWorld.rotation));
    }
    this.propagateTransform(entityId);
  }

  /** Set world scale, back-solving local scale (division by parent scale). */
  setWorldScale(entityId: string, worldScale: Vector3): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    const parentId = this.getParent(entityId);
    if (!parentId) {
      setScale(entity, this.stateManager, worldScale);
    } else {
      const ps = this.getWorldTransform(parentId).scale ?? { x: 1, y: 1, z: 1 };
      const eps = 1e-4;
      setScale(entity, this.stateManager, {
        x: Math.abs(ps.x) > eps ? worldScale.x / ps.x : worldScale.x,
        y: Math.abs(ps.y) > eps ? worldScale.y / ps.y : worldScale.y,
        z: Math.abs(ps.z) > eps ? worldScale.z / ps.z : worldScale.z,
      });
    }
    this.propagateTransform(entityId);
  }

  // -------------------------------------------------------------------------
  // Reparenting (dynamic)
  // -------------------------------------------------------------------------

  /**
   * Move an entity to a new parent (or root if newParentId is undefined)
   * while preserving world transform.
   *
   * Editor hierarchy-drag usage:
   *   sceneGraph.reparent(draggedEntityId, dropTargetEntityId);
   */
  reparent(entityId: string, newParentId?: string): void {
    const worldT = this.getWorldTransform(entityId);

    const oldParent = this.getParent(entityId);
    if (oldParent) this.removeChild(oldParent, entityId);

    if (newParentId) this.addChild(newParentId, entityId);

    // Restore world transform under new parent
    this.setWorldPosition(entityId, worldT.position);
    this.setWorldRotation(entityId, worldT.rotation);
    this.setWorldScale(entityId, worldT.scale ?? { x: 1, y: 1, z: 1 });
  }

  // -------------------------------------------------------------------------
  // Subtree helpers (SelectionSystem integration)
  // -------------------------------------------------------------------------

  /**
   * Return all entity IDs in the subtree rooted at `rootId` (depth-first, root first).
   *
   * SelectionSystem usage â€” select the whole hierarchy:
   *   const ids = sceneGraph.getSubtree(clickedEntityId);
   *   ids.forEach(id => selectionSystem.selectEntity(id));
   */
  getSubtree(rootId: string): string[] {
    const result: string[] = [rootId];
    const node = this.nodes.get(rootId);
    if (node) for (const childId of node.children) result.push(...this.getSubtree(childId));
    return result;
  }

  /**
   * Return the path from the root to `entityId`.
   *
   * Editor breadcrumb / hierarchy expand usage:
   *   const path = sceneGraph.getHierarchyPath(entityId);
   *   // path = ['scene_root', 'vehicle', 'wheel_fl', ...]
   */
  getHierarchyPath(entityId: string): string[] {
    const path: string[] = [entityId];
    let current = this.getParent(entityId);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) break;
      visited.add(current);
      path.unshift(current);
      current = this.getParent(current);
    }
    return path;
  }

  /** Return all SceneNodes with no parent (roots). */
  getRoots(): SceneNode[] {
    return Array.from(this.nodes.values()).filter(n => !n.parentId);
  }

  /** Return a copy of every SceneNode (for building a full hierarchy panel). */
  getAllNodes(): Map<string, Readonly<SceneNode>> {
    const out = new Map<string, Readonly<SceneNode>>();
    for (const [id, node] of this.nodes) out.set(id, { ...node, children: [...node.children] });
    return out;
  }

  // -------------------------------------------------------------------------
  // Transform propagation (internal)
  // -------------------------------------------------------------------------

  /**
   * Push world transforms down the subtree rooted at `entityId`.
   * Called automatically after any local transform change.
   *
   * NOTE: This does NOT modify StateManager values for children â€” it simply
   * notifies hierarchy listeners so meshes, gizmos, and the editor panel can
   * revalidate.  Child local transforms remain unchanged; their *world* transform
   * changes because the parent moved.
   */
  propagateTransform(entityId: string): void {
    const node = this.nodes.get(entityId);
    if (!node) return;
    for (const childId of node.children) {
      this.emit({ type: 'parented', entityId: childId, parentId: entityId });
      this.propagateTransform(childId);
    }
  }

  // -------------------------------------------------------------------------
  // Utility / debug
  // -------------------------------------------------------------------------

  /** Print the full hierarchy to the console (for debugging). */
  debugPrintHierarchy(): void {
    console.log('[SceneGraph] Hierarchy:');
    for (const root of this.getRoots()) this.debugPrintNode(root, 0);
  }

  private debugPrintNode(node: SceneNode, depth: number): void {
    console.log(`${'  '.repeat(depth)}- ${node.entityId}`);
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      if (child) this.debugPrintNode(child, depth + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private wouldCreateCycle(parentId: string, childId: string): boolean {
    let current: string | undefined = parentId;
    const seen = new Set<string>();
    while (current) {
      if (current === childId) return true;
      if (seen.has(current)) break;
      seen.add(current);
      current = this.getParent(current);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Integration hook exports used by Engine.ts / EditorController / GizmoSystem
// ---------------------------------------------------------------------------

/** Called by EntityManager.createEntity */
export function registerEntityInSceneGraph(entity: Entity, sceneGraph: SceneGraph): void {
  sceneGraph.registerEntity(entity);
}

/** Called by EntityManager.destroyEntity */
export function unregisterEntityFromSceneGraph(entityId: string, sceneGraph: SceneGraph): void {
  sceneGraph.unregisterEntity(entityId);
}

// ---------------------------------------------------------------------------
// Pure math helpers (no Three.js dependency)
// ---------------------------------------------------------------------------

function _identityTransform(): Transform {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

function _readTransform(entity: Entity, sm: StateManager): Transform {
  const pos  = sm.get(`entities.${entity.id}.position`) as Vector3 | undefined;
  const rot  = sm.get(`entities.${entity.id}.rotation`) as Vector3 | undefined;
  const scale = sm.get(`entities.${entity.id}.scale`)   as Vector3 | undefined;
  return {
    position: pos   ?? entity.getTransform().position,
    rotation: rot   ?? entity.getTransform().rotation,
    scale:    scale ?? entity.getTransform().scale ?? { x: 1, y: 1, z: 1 },
  };
}

function _combineTransforms(parent: Transform, local: Transform): Transform {
  const ps = parent.scale ?? { x: 1, y: 1, z: 1 };
  const ls = local.scale  ?? { x: 1, y: 1, z: 1 };
  return {
    position: {
      x: parent.position.x + local.position.x * ps.x,
      y: parent.position.y + local.position.y * ps.y,
      z: parent.position.z + local.position.z * ps.z,
    },
    rotation: {
      x: parent.rotation.x + local.rotation.x,
      y: parent.rotation.y + local.rotation.y,
      z: parent.rotation.z + local.rotation.z,
    },
    scale: {
      x: ps.x * ls.x,
      y: ps.y * ls.y,
      z: ps.z * ls.z,
    },
  };
}

function _subtractV3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

