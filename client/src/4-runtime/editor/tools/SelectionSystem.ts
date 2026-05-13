/**
 * Selection System
 * Raycasts from camera through mouse cursor to select entities in the scene
 * 
 * Features:
 * - Mouse-based entity selection via raycasting
 * - Editor mode only activation
 * - Subscription API for selection events
 * - Performance-optimized (only raycast against selectable entities)
 * - Decoupled from rendering
 * 
 * Usage:
 * ```
 * const selectionSystem = new SelectionSystem(scene, entityManager, modeManager, camera);
 * selectionSystem.enable();
 * 
 * selectionSystem.onSelect((entityId: string) => {
 *   console.log('Selected entity:', entityId);
 * });
 * ```
 */

import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { Entity } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { SceneGraph } from '@engine/1-kernel/core/public-api';
import { matchesRaycastLayers } from '@engine/1-kernel/core/public-api';
import { ViewportRaycastManager } from './ViewportRaycastManager';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface SelectionEntityManagerAdapter {
  onEntityCreated(callback: (entity: Entity) => void): () => void;
  onEntityDestroyed(callback: (entity: Entity) => void): () => void;
  onEntityUpdated(callback: (entity: Entity) => void): () => void;
  getEntities(): Entity[];
}

export interface SelectionSystemConfig {
  enableLogging?: boolean;
  raycastDistance?: number;
}

interface Subscription {
  type: 'select' | 'deselect';
  callback: (entityId: string) => void;
}

export class SelectionSystem {
  private scene: THREE.Scene;
  private entityManager: SelectionEntityManagerAdapter;
  private modeManager: any;
  private camera: THREE.Camera | null;
  private config: Required<SelectionSystemConfig>;
  private systemContext: SystemContext | null = null;

  // Mouse tracking
  private mouse: THREE.Vector2;
  private readonly raycastManager: ViewportRaycastManager;

  // Selection state
  private selectedEntityIds: Set<string> = new Set();
  private selectableEntities: Map<string, Entity> = new Map();
  private readonly outlineGroup: THREE.Group = new THREE.Group();
  private readonly outlineHelpers: Map<string, THREE.BoxHelper> = new Map();

  // Subscriptions
  private subscribers: Subscription[] = [];

  // Lifecycle subscriptions
  private entityCreatedSubscriber: (() => void) | null = null;
  private entityDestroyedSubscriber: (() => void) | null = null;
  private entityUpdatedSubscriber: (() => void) | null = null;

  // Active state
  private enabled: boolean = false;

  // SceneGraph for subtree selection (injected from Engine)
  private sceneGraph: SceneGraph | null = null;
  private lifecycleDisposers: Array<() => void> = [];
  private toolCoordinator: { canSelect(): boolean } | null = null;

  constructor(
    scene: THREE.Scene,
    entityManager: SelectionEntityManagerAdapter,
    modeManager: any,
    camera: THREE.Camera,
    config: SelectionSystemConfig = {}
  ) {
    this.scene = scene;
    this.entityManager = entityManager;
    this.modeManager = modeManager;
    this.camera = camera;

    // Configuration
    this.config = {
      enableLogging: config.enableLogging ?? false,
      raycastDistance: config.raycastDistance ?? 10000,
    };

    // Mouse tracking
    this.mouse = new THREE.Vector2();
    this.raycastManager = new ViewportRaycastManager({ raycastDistance: this.config.raycastDistance });

    this.outlineGroup.name = 'selectionOutlineGroup';
    this.outlineGroup.userData.isGizmo = true;
    this.outlineGroup.traverse((child) => { child.userData.isGizmo = true; });
    this.scene.add(this.outlineGroup);

    this.lifecycleDisposers.push(
      gameBus.on('ENGINE_RESET', () => this.clearSelection()),
    );

    if (this.config.enableLogging) {
      console.log('[SelectionSystem] Initialized');
    }
  }

  /**
   * Enable selection system and attach event listeners
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Update selectable entities on entity creation/destruction
    this.entityCreatedSubscriber = this.entityManager.onEntityCreated((entity: Entity) => {
      this.selectableEntities.set(entity.id, entity);
      if (this.config.enableLogging) {
        console.log(`[SelectionSystem] Added selectable entity: ${entity.id}`);
      }
    });

    this.entityDestroyedSubscriber = this.entityManager.onEntityDestroyed((entity: Entity) => {
      this.selectableEntities.delete(entity.id);
      if (this.selectedEntityIds.has(entity.id)) {
        this.deselect();
      }
      if (this.config.enableLogging) {
        console.log(`[SelectionSystem] Removed selectable entity: ${entity.id}`);
      }
    });

    this.entityUpdatedSubscriber = this.entityManager.onEntityUpdated((entity: Entity) => {
      if (!this.selectedEntityIds.has(entity.id)) return;
      this.updateOutlineForEntity(entity.id);
    });

    // Initialize with existing entities
    this.entityManager.getEntities().forEach((entity: Entity) => {
      this.selectableEntities.set(entity.id, entity);
    });

    if (this.config.enableLogging) {
      console.log('[SelectionSystem] Enabled');
    }
  }

  /**
   * Disable selection system and remove event listeners
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.entityCreatedSubscriber) this.entityCreatedSubscriber();
    if (this.entityDestroyedSubscriber) this.entityDestroyedSubscriber();
    if (this.entityUpdatedSubscriber) this.entityUpdatedSubscriber();

    this.clearSelection();
    this.selectableEntities.clear();

    if (this.config.enableLogging) {
      console.log('[SelectionSystem] Disabled');
    }
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (ctx.entityManager) {
      this.entityManager = ctx.entityManager as SelectionEntityManagerAdapter;
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  setToolCoordinator(coordinator: { canSelect(): boolean } | null): void {
    this.toolCoordinator = coordinator;
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        selectedEntityIds: Array.from(this.selectedEntityIds),
        selectableCount: this.selectableEntities.size,
        hasSceneGraph: this.sceneGraph !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  /**
   * Update normalised mouse position from a raw MouseEvent
   */
  private updateMouseCoords(event: MouseEvent): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const rect = (canvas as HTMLCanvasElement).getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Handle mouse move to keep mouse coords current
   */
  handlePointerMove(event: MouseEvent): boolean {
    if (!this.enabled || !this.camera) return false;
    this.updateMouseCoords(event);
    return false;
  }

  /**
   * Handle mouse down to detect selection
   */
  handlePointerDown(event: MouseEvent): boolean {
    // Only select on left click
    if (event.button !== 0) return false;

    if (this.toolCoordinator && !this.toolCoordinator.canSelect()) {
      return false;
    }

    // Only select in editor mode
    const runtimeMode = Engine.getEngineController()?.getRuntimeMode?.() ?? Engine.getStateManagerInstance()?.getRaw('mode');
    if (runtimeMode && runtimeMode !== 'editor') {
      return false;
    }

    // Ignore clicks on UI elements
    if (this.isClickOnUI(event.target as HTMLElement)) {
      return false;
    }

    // Always update coords from this exact click position
    this.updateMouseCoords(event);

    // If the click lands on a gizmo handle, do not change selection
    if (this.isClickOnGizmo()) {
      return false;
    }

    const selectionHit = this.performSelection(event.shiftKey || event.ctrlKey || event.metaKey);

    if (this.config.enableLogging) {
      console.log(
        `[SelectionSystem] Click detected at (${this.mouse.x.toFixed(2)}, ${this.mouse.y.toFixed(2)})`
      );
    }

    return selectionHit;
  }

  /**
   * Check if click target is a UI element (should be ignored)
   */
  private isClickOnUI(target: HTMLElement): boolean {
    // Ignore clicks on menu, input fields, buttons, etc.
    if (
      target.closest?.('#editor-menu') ||
      target.closest?.('#gizmo-mode-indicator') ||
      target.closest?.('#debug-overlay') ||
      target.closest?.('#netgraph-overlay') ||
      target.closest?.('#cs-main-menu') ||
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'LABEL' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'TEXTAREA'
    ) {
      return true;
    }
    return false;
  }

  /**
   * Check if the current mouse position is over a gizmo handle.
   * Objects belonging to the gizmo have userData.isGizmo = true.
   */
  private isClickOnGizmo(): boolean {
    if (!this.camera) return false;
    const gizmoObjects: THREE.Object3D[] = [];
    this.scene.traverseVisible((obj) => {
      if (obj.userData?.isGizmo) gizmoObjects.push(obj);
    });
    const hits = this.raycastManager.raycastObjects(this.mouse, this.camera, gizmoObjects, false);
    return hits.length > 0;
  }

  /**
   * Perform raycast and select entity if hit
   */
  private performSelection(additive: boolean): boolean {
    if (!this.camera || !this.scene) return false;

    // Get all selectable entities' meshes
    const selectableObjects = this.getSelectableObjects();

    if (selectableObjects.length === 0) {
      if (this.selectedEntityIds.size > 0) this.clearSelection();
      return false;
    }

    // Raycast against selectable objects
    const intersects = this.raycastManager.raycastObjects(this.mouse, this.camera, selectableObjects, true);

    if (intersects.length > 0) {
      // Get the closest intersected object
      const hitObject = intersects[0].object;
      const entityId = this.getEntityIdFromMesh(hitObject);

      if (entityId) {
        if (additive) {
          this.toggleEntity(entityId);
        } else {
          this.selectEntity(entityId);
        }
        return true;
      }

      if (this.selectedEntityIds.size > 0) this.clearSelection();
      return false;
    }

    if (!additive && this.selectedEntityIds.size > 0) {
      this.clearSelection();
    }

    return false;
  }

  /**
   * Get all Three.js meshes from selectable entities
   */
  private getSelectableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    const seen = new Set<string>();

    this.scene.traverseVisible((object) => {
      const entityId = this.getEntityIdFromMesh(object);
      if (!entityId || seen.has(entityId)) return;
      const entity = this.selectableEntities.get(entityId);
      if (!entity) return;
      if (entity.type === 'LocalPlayer' || entity.type === 'RemotePlayer') return;
      if (!matchesRaycastLayers(object, ['editor'])) return;
      seen.add(entityId);
      objects.push(object);
    });

    return objects;
  }

  /**
   * Get entity ID from a Three.js mesh object
   * Searches up the object hierarchy to find the entity reference
   */
  private getEntityIdFromMesh(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;

    // Walk up the hierarchy looking for entity reference
    while (current) {
      // Check if object has entity reference
      if ((current.userData as any)?.entityId) {
        return (current.userData as any).entityId;
      }

      // Check object name pattern
      if (current.name?.startsWith('entity_')) {
        return current.name.substring(7); // Remove 'entity_' prefix
      }

      current = current.parent;
    }

    return null;
  }

  /**
   * Select a specific entity
   */
  selectEntity(entityId: string): void {
    if (!this.selectableEntities.has(entityId)) {
      if (this.config.enableLogging) {
        console.warn(`[SelectionSystem] Cannot select unknown entity: ${entityId}`);
      }
      return;
    }

    const previousSelectedIds = new Set(this.selectedEntityIds);
    this.selectedEntityIds.clear();
    this.selectedEntityIds.add(entityId);

    for (const id of previousSelectedIds) {
      if (id !== entityId) {
        this.notifyDeselection(id);
      }
    }

    this.notifySelection(entityId);
    this.updateSelectionOutlines();

    if (this.config.enableLogging) {
      console.log(`[SelectionSystem] Selected entity: ${entityId}`);
    }
  }

  toggleEntity(entityId: string): void {
    if (!this.selectableEntities.has(entityId)) {
      if (this.config.enableLogging) {
        console.warn(`[SelectionSystem] Cannot toggle unknown entity: ${entityId}`);
      }
      return;
    }

    if (this.selectedEntityIds.has(entityId)) {
      this.selectedEntityIds.delete(entityId);
      this.notifyDeselection(entityId);
      this.updateSelectionOutlines();
      if (this.config.enableLogging) {
        console.log(`[SelectionSystem] Deselected entity: ${entityId}`);
      }
      return;
    }

    this.selectedEntityIds.add(entityId);
    this.notifySelection(entityId);
    this.updateSelectionOutlines();

    if (this.config.enableLogging) {
      console.log(`[SelectionSystem] Multi-selected entity: ${entityId}`);
    }
  }

  /**
   * Deselect current entity or entities
   */
  deselect(): void {
    if (this.selectedEntityIds.size === 0) return;

    for (const id of Array.from(this.selectedEntityIds)) {
      this.selectedEntityIds.delete(id);
      this.notifyDeselection(id);
      if (this.config.enableLogging) {
        console.log(`[SelectionSystem] Deselected entity: ${id}`);
      }
    }

    this.updateSelectionOutlines();
  }

  clearSelection(): void {
    this.deselect();
  }

  /**
   * Get currently selected entity ID (first selected if multiple)
   */
  getSelected(): string | null {
    return this.selectedEntityIds.values().next().value ?? null;
  }

  /**
   * Get currently selected entity
   */
  getSelectedEntity(): Entity | null {
    const firstSelected = this.getSelected();
    if (!firstSelected) return null;
    return this.selectableEntities.get(firstSelected) || null;
  }

  getSelectedIds(): string[] {
    return Array.from(this.selectedEntityIds);
  }

  setSelectedIds(entityIds: string[]): void {
    const desiredIds = new Set(
      entityIds.filter((entityId) => this.selectableEntities.has(entityId)),
    );

    const previousIds = new Set(this.selectedEntityIds);
    this.selectedEntityIds = desiredIds;

    for (const id of previousIds) {
      if (!this.selectedEntityIds.has(id)) {
        this.notifyDeselection(id);
      }
    }

    for (const id of this.selectedEntityIds) {
      if (!previousIds.has(id)) {
        this.notifySelection(id);
      }
    }

    this.updateSelectionOutlines();
  }

  private updateSelectionOutlines(): void {
    for (const [entityId, helper] of this.outlineHelpers.entries()) {
      if (this.selectedEntityIds.has(entityId)) continue;
      helper.removeFromParent();
      this.outlineHelpers.delete(entityId);
    }

    for (const entityId of this.selectedEntityIds) {
      this.updateOutlineForEntity(entityId);
    }
  }

  private updateOutlineForEntity(entityId: string): void {
    const entityMesh = this.scene.getObjectByName(`entity_${entityId}`);
    const existing = this.outlineHelpers.get(entityId) ?? null;

    if (!entityMesh) {
      existing?.removeFromParent();
      this.outlineHelpers.delete(entityId);
      return;
    }

    entityMesh.updateWorldMatrix(true, false);

    const helper = existing ?? new THREE.BoxHelper(entityMesh, 0xffd44d);
    helper.userData.isGizmo = true;
    helper.raycast = () => {};
    helper.setFromObject(entityMesh);
    helper.updateWorldMatrix(true, false);

    if (!existing) {
      this.outlineHelpers.set(entityId, helper);
      this.outlineGroup.add(helper);
    }
  }

  validateSelection(): boolean {
    const hadSelection = this.selectedEntityIds.size > 0;
    for (const id of Array.from(this.selectedEntityIds)) {
      if (!this.selectableEntities.has(id)) {
        this.selectedEntityIds.delete(id);
        this.notifyDeselection(id);
      }
    }
    return this.selectedEntityIds.size > 0 || !hadSelection;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Inject SceneGraph so this system can select entire subtrees.
   * Called by Engine after both systems are constructed.
   *
   * Editor hierarchy panel usage:
   *   selectionSystem.setSceneGraph(sceneGraph);
   *   selectionSystem.selectWithSubtree(clickedEntityId);
   */
  setSceneGraph(sceneGraph: SceneGraph): void {
    this.sceneGraph = sceneGraph;
  }

  /**
   * Select an entity and every entity in its subtree.
   * Fires individual onSelect callbacks for each id so GizmoSystem
   * (and other subscribers) are notified.
   *
   * Editor hierarchy-panel usage:
   *   selectionSystem.selectWithSubtree(parentEntityId);
   */
  selectWithSubtree(rootEntityId: string): void {
    const ids = this.sceneGraph
      ? this.sceneGraph.getSubtree(rootEntityId)
      : [rootEntityId];

    const desiredIds = new Set<string>();
    for (const id of ids) {
      if (this.selectableEntities.has(id)) desiredIds.add(id);
    }

    if (desiredIds.size === 0) {
      return;
    }

    const previousIds = new Set(this.selectedEntityIds);
    this.selectedEntityIds = desiredIds;

    for (const id of previousIds) {
      if (!this.selectedEntityIds.has(id)) {
        this.notifyDeselection(id);
      }
    }

    for (const id of this.selectedEntityIds) {
      if (!previousIds.has(id)) {
        this.notifySelection(id);
      }
    }

    this.updateSelectionOutlines();
  }

  /**
   * Subscribe to selection events
   */
  onSelect(callback: (entityId: string) => void): () => void {
    this.subscribers.push({ type: 'select', callback });
    return () => {
      this.subscribers = this.subscribers.filter((s) => s.callback !== callback);
    };
  }

  /**
   * Subscribe to deselection events
   */
  onDeselect(callback: (entityId: string) => void): () => void {
    this.subscribers.push({ type: 'deselect', callback });
    return () => {
      this.subscribers = this.subscribers.filter((s) => s.callback !== callback);
    };
  }

  /**
   * Notify all subscribers of selection
   */
  private notifySelection(entityId: string): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.type === 'select') {
        try {
          subscriber.callback(entityId);
        } catch (error) {
          console.error('[SelectionSystem] Error in selection callback:', error);
        }
      }
    }
  }

  /**
   * Notify all subscribers of deselection
   */
  private notifyDeselection(entityId: string): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.type === 'deselect') {
        try {
          subscriber.callback(entityId);
        } catch (error) {
          console.error('[SelectionSystem] Error in deselection callback:', error);
        }
      }
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.disable();
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
    this.subscribers = [];
    this.selectableEntities.clear();
  }
}
