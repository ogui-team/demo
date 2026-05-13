/**
 * Gizmo System
 * Provides visual transform manipulation gizmos for selected entities
 * 
 * Features:
 * - X/Y/Z axis translation and rotation handles
 * - Drag-based interaction for smooth manipulation
 * - StateManager integration for all transforms
 * - SelectionSystem integration for entity tracking
 * - Editor-mode only operation
 * - Extensible for future scale/custom gizmos
 * 
 * Architecture:
 * - GizmoSystem: Main orchestration
 * - GizmoRenderer: Visual 3D representation
 * - GizmoInteraction: Mouse drag and input handling
 * 
 * Usage:
 * ```
 * const gizmoSystem = new GizmoSystem(scene, stateManager, modeManager);
 * gizmoSystem.enable();
 * 
 * const selectionSystem = Engine.getSelectionSystem();
 * selectionSystem.onSelect((entityId) => gizmoSystem.attachEntity(entityId));
 * selectionSystem.onDeselect(() => gizmoSystem.detachEntity());
 * ```
 */

import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { Entity } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { SceneGraph } from '@engine/1-kernel/core/public-api';
import * as TransformSystem from '@engine/1-kernel/core/public-api';
import { ViewportRaycastManager } from './ViewportRaycastManager';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type AxisType = 'x' | 'y' | 'z';

export interface GizmoSystemConfig {
  enableLogging?: boolean;
  gizmoSize?: number;
  axisLength?: number;
  lineMaterial?: THREE.LineBasicMaterial;
  highlightMaterial?: THREE.LineBasicMaterial;
}

interface GizmoAxis {
  direction: THREE.Vector3;
  color: number;
  mesh: THREE.Object3D | null;
  arrow: THREE.ArrowHelper | null;
}

interface GizmoTransformCommit {
  id: string;
  previousPosition: { x: number; y: number; z: number };
  previousRotation: { x: number; y: number; z: number };
  previousScale: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

interface GizmoTransformSnapshot {
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

interface GizmoTransformCommitBatch {
  primaryId: string;
  entities: GizmoTransformCommit[];
}

interface GizmoStateStoreAdapter {
  get(path: string): unknown;
  set(path: string, value: unknown): boolean;
}

interface GizmoEntityManagerAdapter {
  getEntity(entityId: string): Entity | null | undefined;
  onEntityDestroyed(callback: (entity: Entity) => void): () => void;
  onEntityUpdated(callback: (entity: Entity) => void): () => void;
}

interface ModeManagerAdapter {
  getMode?(): string;
  registerListener?(listener: {
    onEnterEditor?(): void;
    onExitEditor?(): void;
    onEnterPlay?(): void;
  }): () => void;
}

export class GizmoSystem {
  private scene: THREE.Scene;
  private stateManager: GizmoStateStoreAdapter;
  private modeManager: ModeManagerAdapter | null;
  private camera: THREE.Camera | null;
  private config: Required<GizmoSystemConfig>;
  private systemContext: SystemContext | null = null;
  private warnedBeforeInit = false;

  // State
  private enabled: boolean = false;
  private selectedEntity: Entity | null = null;
  private selectedEntityId: string | null = null;
  private selectedEntityIds: string[] = [];
  private selectedTransformBindingPath: string | null = null;
  private mode: GizmoMode = 'translate';
  private orientationMode: 'world' | 'local' = 'world';
  private snapSettings = {
    enabled: false,
    translate: 1,
    rotate: Math.PI / 18,
    scale: 0.1,
  };

  // Visual representation
  private gizmoGroup: THREE.Group = new THREE.Group();
  private axes: Map<AxisType, GizmoAxis> = new Map();

  // EntityManager for entity lookup
  private entityManager: GizmoEntityManagerAdapter | null = null;
  private entityDestroyedDisposer: (() => void) | null = null;
  private entityUpdatedDisposer: (() => void) | null = null;
  private lifecycleDisposers: Array<() => void> = [];

  // SceneGraph for world-transform lookups (parented entities)
  private sceneGraph: SceneGraph | null = null;
  private onEntityTransformCommitted: ((data: GizmoTransformCommitBatch) => void) | null = null;
  private toolCoordinator: {
    canUseGizmo(): boolean;
    beginGizmoDrag(reason?: string): boolean;
    endGizmoDrag(reason?: string): boolean;
  } | null = null;

  // Interaction
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private raycastManager: ViewportRaycastManager = new ViewportRaycastManager({ raycastDistance: 10000 });
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private draggedAxis: AxisType | null = null;
  private isDraggingBody: boolean = false;        // free-drag on entity mesh
  private dragPlane: THREE.Plane = new THREE.Plane();
  private dragStartEntityPos: THREE.Vector3 = new THREE.Vector3(); // entity pos at drag start
  private dragStartPlanePoint: THREE.Vector3 = new THREE.Vector3(); // ray-plane hit at drag start
  private dragSelectionIds: string[] = [];
  private dragStartSnapshots: Map<string, GizmoTransformSnapshot> = new Map();
  private dragStartScale = { x: 1, y: 1, z: 1 };
  private dragStartRotation = { x: 0, y: 0, z: 0 };

  constructor(
    scene: THREE.Scene,
    stateManager: GizmoStateStoreAdapter,
    modeManager: ModeManagerAdapter | null,
    camera: THREE.Camera,
    config: GizmoSystemConfig = {}
  ) {
    this.scene = scene;
    this.stateManager = stateManager;
    this.modeManager = modeManager;
    this.camera = camera;

    this.config = {
      enableLogging: config.enableLogging ?? false,
      gizmoSize: config.gizmoSize ?? 1,
      axisLength: config.axisLength ?? 2,
      lineMaterial: config.lineMaterial || new THREE.LineBasicMaterial({ linewidth: 2 }),
      highlightMaterial: config.highlightMaterial || new THREE.LineBasicMaterial({ linewidth: 3 }),
    };

    // Initialize axes
    this.initializeAxes();

    // Setup mode listener
    if (this.modeManager?.registerListener) {
      this.modeManager.registerListener({
        onEnterEditor: () => this.enable(),
        onExitEditor: () => this.disable(),
        onEnterPlay: () => this.disable(),
      });
    }

    this.lifecycleDisposers.push(
      gameBus.on('ENGINE_RESET', () => {
        this.cancelInteraction('engine_reset');
        this.detachEntity();
      }),
      gameBus.on('ROUND_TRANSITION', () => {
        this.cancelInteraction('round_transition');
        this.detachEntity();
      }),
    );

    // Increase raycaster line threshold so arrow shafts are easier to click
    (this.raycaster as any).params.Line = { threshold: 0.05 };

    if (this.config.enableLogging) {
      console.log('[GizmoSystem] Initialized');
    }
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.stateManager = (ctx.systems.stateManager as GizmoStateStoreAdapter | undefined) ?? this.stateManager;
    this.modeManager = (ctx.systems.modeManager as ModeManagerAdapter | undefined) ?? this.modeManager;
    if (ctx.entityManager) {
      this.setEntityManager(ctx.entityManager as unknown as GizmoEntityManagerAdapter);
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        mode: this.mode,
        orientationMode: this.orientationMode,
        snapEnabled: this.snapSettings.enabled,
        selectedEntityId: this.selectedEntityId,
        selectedEntityIds: [...this.selectedEntityIds],
        selectedTransformBindingPath: this.selectedTransformBindingPath,
        isDragging: this.isDragging(),
        hasEntityManager: this.entityManager !== null,
        hasSceneGraph: this.sceneGraph !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  /**
   * Inject EntityManager (called from Engine after construction)
   */
  setEntityManager(entityManager: GizmoEntityManagerAdapter): void {
    this.entityDestroyedDisposer?.();
    this.entityUpdatedDisposer?.();
    this.entityManager = entityManager;
    this.entityDestroyedDisposer = entityManager.onEntityDestroyed((entity) => {
      if (!this.selectedEntityIds.includes(entity.id)) return;
      const remainingIds = this.selectedEntityIds.filter((selectedId) => selectedId !== entity.id);
      this.cancelInteraction('entity_destroyed');
      this.setSelectedEntityIds(remainingIds);
    });
    this.entityUpdatedDisposer = entityManager.onEntityUpdated((entity) => {
      if (!this.selectedEntityIds.includes(entity.id)) return;
      if (this.isDragging()) return;
      this.syncSelectedTransformBinding('entity_update');
    });
  }

  /**
   * Inject SceneGraph so gizmos use world-space positions for parented entities.
   * Called from Engine after EntityManager is wired.
   */
  setSceneGraph(sceneGraph: SceneGraph): void {
    this.sceneGraph = sceneGraph;
    // Subscribe to hierarchy changes — refresh gizmo if the selected entity moves in hierarchy
    this.sceneGraph.onHierarchyChanged((event) => {
      if (this.selectedEntityId && event.entityId === this.selectedEntityId) {
        this.updateGizmoVisuals();
      }
    });
  }

  setOnEntityTransformCommitted(callback: ((data: GizmoTransformCommitBatch) => void) | null): void {
    this.onEntityTransformCommitted = callback;
  }

  setToolCoordinator(coordinator: {
    canUseGizmo(): boolean;
    beginGizmoDrag(reason?: string): boolean;
    endGizmoDrag(reason?: string): boolean;
  } | null): void {
    this.toolCoordinator = coordinator;
  }

  setOrientationMode(mode: 'world' | 'local'): void {
    this.orientationMode = mode;
    this.updateGizmoVisuals();
  }

  toggleOrientationMode(): void {
    this.setOrientationMode(this.orientationMode === 'world' ? 'local' : 'world');
  }

  setSnapSettings(settings: Partial<{
    enabled: boolean;
    translate: number;
    rotate: number;
    scale: number;
  }>): void {
    this.snapSettings = {
      ...this.snapSettings,
      ...settings,
    };
  }

  private getAxisDirection(axisName: AxisType): THREE.Vector3 {
    const direction = new THREE.Vector3(
      axisName === 'x' ? 1 : 0,
      axisName === 'y' ? 1 : 0,
      axisName === 'z' ? 1 : 0,
    );

    if (this.orientationMode === 'local' && this.selectedEntityId) {
      const entityObject = this.scene.getObjectByName(`entity_${this.selectedEntityId}`) as THREE.Object3D | null;
      if (entityObject) {
        return direction.applyQuaternion(entityObject.getWorldQuaternion(new THREE.Quaternion())).normalize();
      }
    }

    return direction;
  }

  private snapValue(value: number, step: number): number {
    if (!this.snapSettings.enabled || step <= 0) {
      return value;
    }

    return Math.round(value / step) * step;
  }

  /**
   * Initialize axis configurations
   */
  private initializeAxes(): void {
    this.axes.set('x', {
      direction: new THREE.Vector3(1, 0, 0),
      color: 0xff0000, // Red
      mesh: null,
      arrow: null,
    });

    this.axes.set('y', {
      direction: new THREE.Vector3(0, 1, 0),
      color: 0x00ff00, // Green
      mesh: null,
      arrow: null,
    });

    this.axes.set('z', {
      direction: new THREE.Vector3(0, 0, 1),
      color: 0x0000ff, // Blue
      mesh: null,
      arrow: null,
    });
  }

  /**
   * Enable gizmo system
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    if (this.config.enableLogging) {
      console.log('[GizmoSystem] Enabled');
    }
  }

  /**
   * Disable gizmo system
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Hide gizmo
    this.cancelInteraction('disable');
    this.detachEntity();

    if (this.config.enableLogging) {
      console.log('[GizmoSystem] Disabled');
    }
  }

  /**
   * Attach to an entity for manipulation
   */
  attachEntity(entity: Entity | string): void {
    const entityId = typeof entity === 'string' ? entity : entity.id;
    this.setSelectedEntityIds([entityId]);
    if (typeof entity !== 'string') {
      this.selectedEntity = entity;
    }

    if (this.config.enableLogging) {
      console.log(`[GizmoSystem] Attached to entity: ${this.selectedEntityId}`);
    }
  }

  setSelectedEntityIds(entityIds: string[]): void {
    const nextIds = Array.from(new Set(entityIds.filter(Boolean)));
    if (nextIds.length === 0) {
      this.detachEntity();
      return;
    }

    this.cancelInteraction('selection_changed');
    this.selectedEntityIds = nextIds;
    this.selectedEntityId = nextIds[0] ?? null;
    this.selectedEntity = this.selectedEntityId && this.entityManager
      ? this.entityManager.getEntity(this.selectedEntityId) ?? null
      : null;
    this.selectedTransformBindingPath = this.selectedEntityId
      ? `entities.${this.selectedEntityId}.transform`
      : null;
    this.updateGizmoVisuals();
  }

  /**
   * Detach from current entity
   */
  detachEntity(): void {
    this.cancelInteraction('detach');
    this.selectedEntity = null;
    this.selectedEntityId = null;
    this.selectedEntityIds = [];
    this.selectedTransformBindingPath = null;
    this.dragSelectionIds = [];
    this.dragStartSnapshots.clear();
    this.hideGizmo();

    if (this.config.enableLogging) {
      console.log('[GizmoSystem] Detached from entity');
    }
  }

  cancelInteraction(reason = 'cancelled'): void {
    const wasDragging = this.draggedAxis !== null || this.isDraggingBody;
    this.draggedAxis = null;
    this.isDraggingBody = false;
    if (wasDragging) {
      this.toolCoordinator?.endGizmoDrag(reason);
    }
    if (wasDragging && this.config.enableLogging) {
      console.log(`[GizmoSystem] Interaction cancelled: ${reason}`);
    }
  }

  /**
   * Set gizmo mode (translate, rotate, scale)
   */
  setMode(mode: GizmoMode): void {
    this.mode = mode;
    this.updateGizmoVisuals();

    if (this.config.enableLogging) {
      console.log(`[GizmoSystem] Mode changed to: ${mode}`);
    }
  }

  /**
   * Get current gizmo mode
   */
  getMode(): GizmoMode {
    return this.mode;
  }

  getOrientationMode(): 'world' | 'local' {
    return this.orientationMode;
  }

  getSnapSettings(): Readonly<typeof this.snapSettings> {
    return { ...this.snapSettings };
  }

  update(_dt: number): void {
    if (!this.enabled) {
      this.hideGizmo();
      return;
    }

    if (this.modeManager?.getMode?.() !== 'editor') {
      this.cancelInteraction('non_editor_mode');
      this.hideGizmo();
      return;
    }

    if (!this.selectedEntityId) {
      this.hideGizmo();
      return;
    }

    if (this.entityManager && !this.entityManager.getEntity(this.selectedEntityId)) {
      this.detachEntity();
      return;
    }

    this.syncGizmoToSelectedEntity();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update gizmo visual representation.
   * Uses world-space position when SceneGraph is available so the gizmo appears
   * at the correct location for parented entities.
   */
  private updateGizmoVisuals(): void {
    if (!this.ensureRuntimeBindings('updateGizmoVisuals')) return;
    this.hideGizmo();

    if (!this.selectedEntityId) return;

    // Prefer world-transform from SceneGraph (correct for parented entities).
    // Fall back to raw StateManager position for unparented entities.
    let position: { x: number; y: number; z: number } | undefined;

    if (this.sceneGraph) {
      const worldT = this.sceneGraph.getWorldTransform(this.selectedEntityId);
      position = worldT.position;
    } else {
      position = this.stateManager.get(`entities.${this.selectedEntityId}.position`) as
        | { x: number; y: number; z: number }
        | undefined;
    }

    if (!position) return;

    this.setGizmoPosition(position);

    const gizmoSize = this.computeGizmoScale();
    this.gizmoGroup.scale.setScalar(gizmoSize);

    // Show axes based on mode
    switch (this.mode) {
      case 'translate':
        this.showTranslateGizmo();
        break;
      case 'rotate':
        this.showRotateGizmo();
        break;
      case 'scale':
        this.showScaleGizmo();
        break;
    }

    if (!this.scene.getObjectByName('gizmoGroup')) {
      this.gizmoGroup.name = 'gizmoGroup';
      this.scene.add(this.gizmoGroup);
    }
  }

  private syncGizmoToSelectedEntity(): void {
    const position = this.getSelectedEntityWorldPosition();
    if (!position) {
      this.hideGizmo();
      return;
    }

    if (this.gizmoGroup.children.length === 0) {
      this.updateGizmoVisuals();
      return;
    }

    this.setGizmoPosition(position);
  }

  private syncSelectedTransformBinding(reason: string): void {
    if (!this.selectedTransformBindingPath || !this.selectedEntityId) {
      return;
    }

    if (this.config.enableLogging) {
      console.log(`[GizmoSystem] Syncing transform binding via ${reason}: ${this.selectedTransformBindingPath}`);
    }

    this.updateGizmoVisuals();
  }

  private getSelectedEntityWorldPosition(): { x: number; y: number; z: number } | undefined {
    if (!this.selectedEntityId) return undefined;

    if (this.sceneGraph) {
      return this.sceneGraph.getWorldTransform(this.selectedEntityId).position;
    }

    return this.stateManager.get(`entities.${this.selectedEntityId}.position`) as
      | { x: number; y: number; z: number }
      | undefined;
  }

  private setGizmoPosition(position: { x: number; y: number; z: number }): void {
    this.gizmoGroup.position.set(position.x, position.y, position.z);
  }

  private computeGizmoScale(): number {
    if (!this.selectedEntityId || !this.camera) return 1;

    const mesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
    const baseScale = new THREE.Vector3(1, 1, 1);
    if (mesh) {
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const distance = mesh.position.distanceTo(this.camera.position);
      return Math.max(1, maxDim * 0.25, distance * 0.06);
    }

    return 1;
  }

  /**
   * Show translation gizmo (move arrows)
   */
  private showTranslateGizmo(): void {
    const origin = new THREE.Vector3(0, 0, 0);

    for (const [axisName, axis] of this.axes) {
      const arrowLength = this.config.axisLength;
      const axisDirection = this.getAxisDirection(axisName);
      const arrowHelper = new THREE.ArrowHelper(
        axisDirection,
        origin,
        arrowLength,
        axis.color,
        0.3 * arrowLength,
        0.2 * arrowLength
      );

      // Tag arrow and all children so SelectionSystem skips them
      arrowHelper.userData.isGizmo = true;
      arrowHelper.traverse((child) => { child.userData.isGizmo = true; });

      axis.arrow = arrowHelper;
      this.gizmoGroup.add(arrowHelper);
    }
  }

  /**
   * Show rotation gizmo (ring handles)
   *
   * Note: Using arrows for proxy rotation visualization
   * Full ring visualization can be added as enhancement
   */
  private showRotateGizmo(): void {
    const origin = new THREE.Vector3(0, 0, 0);
    const rotScale = this.config.axisLength * 0.7;

    for (const [axisName, axis] of this.axes) {
      const axisDirection = this.getAxisDirection(axisName);
      const arrowHelper = new THREE.ArrowHelper(
        axisDirection,
        origin,
        rotScale,
        axis.color,
        0.2 * rotScale,
        0.15 * rotScale
      );

      arrowHelper.userData.isGizmo = true;
      arrowHelper.traverse((child) => { child.userData.isGizmo = true; });

      axis.arrow = arrowHelper;
      this.gizmoGroup.add(arrowHelper);
    }
  }

  /**
   * Show scale gizmo (small boxes)
   */
  private showScaleGizmo(): void {
    const origin = new THREE.Vector3(0, 0, 0);
    const scaleSize = this.config.axisLength * 0.5;

    for (const [axisName, axis] of this.axes) {
      const axisDirection = this.getAxisDirection(axisName);
      const arrowHelper = new THREE.ArrowHelper(
        axisDirection,
        origin,
        scaleSize,
        axis.color,
        0.15 * scaleSize,
        0.1 * scaleSize
      );

      arrowHelper.userData.isGizmo = true;
      arrowHelper.traverse((child) => { child.userData.isGizmo = true; });

      axis.arrow = arrowHelper;
      this.gizmoGroup.add(arrowHelper);
    }
  }

  /**
   * Hide gizmo visuals
   */
  private hideGizmo(): void {
    this.gizmoGroup.clear();
    for (const axis of this.axes.values()) {
      axis.mesh = null;
      axis.arrow = null;
    }
  }

  /**
   * Normalise mouse coords from a MouseEvent
   */
  private updateMouse(event: MouseEvent): void {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Handle mouse down — detect axis hit OR body hit for free drag
   */
  handlePointerDown(event: MouseEvent): boolean {
    if (event.button !== 0 || !this.enabled || !this.selectedEntityId) return false;
    if (this.modeManager?.getMode?.() !== 'editor') return false;
    if ((event.target as HTMLElement).closest?.('#editor-menu')) return false;
    if (this.toolCoordinator && !this.toolCoordinator.canUseGizmo()) return false;

    this.updateMouse(event);

    // --- 1. Try to hit a gizmo axis arrow ---
    const arrowObjects: THREE.Object3D[] = [];
    for (const axis of this.axes.values()) {
      if (axis.arrow) arrowObjects.push(axis.arrow);
    }

    const axisHits = this.raycastManager.raycastObjects(this.mouse, this.camera!, arrowObjects, true);
    if (axisHits.length > 0) {
      const hitObject = axisHits[0].object;
      for (const [axisName, axis] of this.axes) {
        if (axis.arrow && axis.arrow.getObjectById(hitObject.id)) {
          if (this.toolCoordinator && !this.toolCoordinator.beginGizmoDrag(`axis:${axisName}`)) {
            return false;
          }
          this.draggedAxis = axisName as AxisType;
          this.isDraggingBody = false;
          this.setupDragPlane(axisHits[0].point);
          if (this.config.enableLogging) {
            console.log(`[GizmoSystem] Axis drag start: ${axisName}`);
          }
          break;
        }
      }
      return true;
    }

    // --- 2. Try to hit the entity mesh directly (free-body drag) ---
    const entityMesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
    if (entityMesh) {
      const bodyHits = this.raycastManager.raycastObjects(this.mouse, this.camera!, [entityMesh], true);
      if (bodyHits.length > 0) {
        if (this.toolCoordinator && !this.toolCoordinator.beginGizmoDrag('body_drag')) {
          return false;
        }
        this.isDraggingBody = true;
        this.draggedAxis = null;
        this.setupDragPlane(bodyHits[0].point);
        if (this.config.enableLogging) {
          console.log('[GizmoSystem] Free-body drag start');
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Setup a camera-facing drag plane through the given world point.
   * Stores the entity position, rotation, and ray-plane intersection at drag start.
   */
  private setupDragPlane(hitPoint: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('setupDragPlane')) return;
    if (!this.selectedEntityId || !this.camera) return;

    this.dragSelectionIds = this.getTransformSelectionIds();
    this.dragStartSnapshots.clear();
    for (const entityId of this.dragSelectionIds) {
      const snapshot = this.getTransformSnapshot(entityId);
      if (snapshot) {
        this.dragStartSnapshots.set(entityId, snapshot);
      }
    }

    const primarySnapshot = this.selectedEntityId ? this.dragStartSnapshots.get(this.selectedEntityId) : null;
    if (!primarySnapshot) return;

    // Use camera forward as the drag plane normal so the plane always faces the camera.
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    this.dragPlane.setFromNormalAndCoplanarPoint(camDir, hitPoint);

    // Cache entity position + rotation + scale at drag start
    this.dragStartEntityPos.set(primarySnapshot.position.x, primarySnapshot.position.y, primarySnapshot.position.z);
    this.rotationBase = { ...primarySnapshot.rotation };
    this.dragStartRotation = { ...this.rotationBase };
    this.scaleBase = { ...primarySnapshot.scale };
    this.dragStartScale = { ...this.scaleBase };

    // Cache ray-plane intersection at drag start
    const startHit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, startHit);
    this.dragStartPlanePoint.copy(startHit);
  }

  /**
   * Handle mouse move during drag
   */
  handlePointerMove(event: MouseEvent): boolean {
    const dragging = this.draggedAxis !== null || this.isDraggingBody;
    if (!dragging || !this.selectedEntityId || !this.camera) return false;

    if (!this.validateTransformTarget(this.selectedEntityId, 'handlePointerMove')) {
      return false;
    }

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Current ray-plane intersection
    const currentPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, currentPoint)) return false;

    // World-space delta from drag start
    const worldDelta = new THREE.Vector3().subVectors(currentPoint, this.dragStartPlanePoint);

    try {
      if (this.isDraggingBody) {
        // Free-body drag: move along camera plane (X + Z only, keep Y fixed unless desired)
        this.applyBodyDrag(worldDelta);
      } else if (this.mode === 'translate') {
        this.applyTranslation(worldDelta);
      } else if (this.mode === 'rotate') {
        this.applyRotation(worldDelta);
      } else if (this.mode === 'scale') {
        this.applyScale(worldDelta);
      }
    } catch (error) {
      console.error('[GizmoSystem] Transform update aborted', error);
      this.cancelInteraction('transform_update_error');
      return false;
    }

    return true;
  }

  /**
   * Apply translation along the dragged axis.
   * delta = (currentPlanePoint - dragStartPlanePoint)
   * We project delta onto the axis direction and add to the drag-start entity position.
   */
  private applyTranslation(worldDelta: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('applyTranslation')) return;
    if (!this.draggedAxis || !this.selectedEntityId) return;

    const axisDir = this.getAxisDirection(this.draggedAxis);
    const projected = this.snapValue(worldDelta.dot(axisDir), this.snapSettings.translate);
    const movement = new THREE.Vector3().copy(axisDir).multiplyScalar(projected);

    const newPos = {
      x: this.dragStartEntityPos.x + movement.x,
      y: this.dragStartEntityPos.y + movement.y,
      z: this.dragStartEntityPos.z + movement.z,
    };

    this.applyPositionUpdate(newPos);
  }

  /**
   * Free-body drag: move entity by the full XZ delta (Y preserved)
   */
  private applyBodyDrag(worldDelta: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('applyBodyDrag')) return;
    if (!this.selectedEntityId) return;

    // Move freely across the camera-facing plane
    const newPos = {
      x: this.dragStartEntityPos.x + worldDelta.x,
      y: this.dragStartEntityPos.y + worldDelta.y,
      z: this.dragStartEntityPos.z + worldDelta.z,
    };

    this.applyPositionUpdate(newPos);
  }

  /**
   * Write new **world** position to StateManager, entity, and mesh immediately.
   *
   * If a SceneGraph is present, it back-solves the correct local position so
   * parented entities stay correctly positioned relative to their parent.
   */
  private applyPositionUpdate(newPos: { x: number; y: number; z: number }): void {
    if (!this.ensureRuntimeBindings('applyPositionUpdate')) return;
    if (!this.selectedEntityId) return;

    const primarySnapshot = this.dragStartSnapshots.get(this.selectedEntityId);
    if (!primarySnapshot) return;

    const delta = {
      x: newPos.x - primarySnapshot.position.x,
      y: newPos.y - primarySnapshot.position.y,
      z: newPos.z - primarySnapshot.position.z,
    };

    for (const entityId of this.dragSelectionIds) {
      const snapshot = this.dragStartSnapshots.get(entityId);
      if (!snapshot) continue;

      this.applyWorldPositionToEntity(entityId, {
        x: snapshot.position.x + delta.x,
        y: snapshot.position.y + delta.y,
        z: snapshot.position.z + delta.z,
      });
    }

    this.gizmoGroup.position.set(newPos.x, newPos.y, newPos.z);
  }

  private applyWorldPositionToEntity(entityId: string, newPos: { x: number; y: number; z: number }): void {
    if (!this.validateTransformTarget(entityId, 'applyWorldPositionToEntity')) {
      return;
    }

    if (this.sceneGraph) {
      this.sceneGraph.setWorldPosition(entityId, newPos);
    } else {
      this.stateManager.set(`entities.${entityId}.position`, newPos);
    }

    if (this.entityManager) {
      const entity = this.entityManager.getEntity(entityId);
      if (entity) entity.setPosition(newPos);
    }

    const mesh = this.scene.getObjectByName(`entity_${entityId}`);
    if (mesh) mesh.position.set(newPos.x, newPos.y, newPos.z);
  }

  /**
   * Apply rotation around dragged axis.
   * Project worldDelta onto the screen-space tangent to get a signed angle.
   */
  private applyRotation(worldDelta: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('applyRotation')) return;
    if (!this.draggedAxis || !this.selectedEntityId) return;

    // Use the component of worldDelta perpendicular to the axis as angle magnitude
    const axisDir = this.getAxisDirection(this.draggedAxis);
    const tangent = new THREE.Vector3().copy(worldDelta);
    const projected = tangent.dot(axisDir);
    tangent.addScaledVector(axisDir, -projected); // remove component along axis
    const angle = this.snapValue(tangent.length() * 2, this.snapSettings.rotate); // radians — scale as desired

    // Determine sign from cross product in camera space (which way the drag is going)
    const cross = new THREE.Vector3().crossVectors(axisDir, worldDelta);
    const camDir = new THREE.Vector3();
    this.camera!.getWorldDirection(camDir);
    const sign = cross.dot(camDir) >= 0 ? 1 : -1;

    const newRot = {
      x: this.rotationBase.x + (this.draggedAxis === 'x' ? sign * angle : 0),
      y: this.rotationBase.y + (this.draggedAxis === 'y' ? sign * angle : 0),
      z: this.rotationBase.z + (this.draggedAxis === 'z' ? sign * angle : 0),
    };

    for (const entityId of this.dragSelectionIds) {
      const snapshot = this.dragStartSnapshots.get(entityId);
      if (!snapshot) continue;

      this.applyRotationToEntity(entityId, {
        x: snapshot.rotation.x + (this.draggedAxis === 'x' ? sign * angle : 0),
        y: snapshot.rotation.y + (this.draggedAxis === 'y' ? sign * angle : 0),
        z: snapshot.rotation.z + (this.draggedAxis === 'z' ? sign * angle : 0),
      });
    }

    const mesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
    if (mesh) mesh.rotation.set(newRot.x, newRot.y, newRot.z);
  }

  private applyRotationToEntity(entityId: string, newRot: { x: number; y: number; z: number }): void {
    if (!this.validateTransformTarget(entityId, 'applyRotationToEntity')) {
      return;
    }

    this.stateManager.set(`entities.${entityId}.rotation`, newRot);

    if (this.entityManager) {
      const entity = this.entityManager.getEntity(entityId);
      if (entity) entity.setRotation(newRot);
    }

    const mesh = this.scene.getObjectByName(`entity_${entityId}`);
    if (mesh) mesh.rotation.set(newRot.x, newRot.y, newRot.z);
  }

  /**
   * Apply scale along dragged axis.
   * Uses scaleBase (cached at drag start) so delta is stable across all frames.
   */
  private applyScale(worldDelta: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('applyScale')) return;
    if (!this.draggedAxis || !this.selectedEntityId) return;

    const axisDir = this.getAxisDirection(this.draggedAxis);
    const signedDelta = this.snapValue(worldDelta.dot(axisDir), this.snapSettings.scale); // positive = grow, negative = shrink
    // Map drag distance: 1 world unit of drag = 1x scale change
    const factor = Math.max(0.01, 1 + signedDelta);

    const newScale = {
      x: this.draggedAxis === 'x' ? Math.max(0.01, this.scaleBase.x * factor) : this.scaleBase.x,
      y: this.draggedAxis === 'y' ? Math.max(0.01, this.scaleBase.y * factor) : this.scaleBase.y,
      z: this.draggedAxis === 'z' ? Math.max(0.01, this.scaleBase.z * factor) : this.scaleBase.z,
    };

    for (const entityId of this.dragSelectionIds) {
      const snapshot = this.dragStartSnapshots.get(entityId);
      if (!snapshot) continue;

      this.applyScaleToEntity(entityId, {
        x: this.draggedAxis === 'x' ? Math.max(0.01, snapshot.scale.x * factor) : snapshot.scale.x,
        y: this.draggedAxis === 'y' ? Math.max(0.01, snapshot.scale.y * factor) : snapshot.scale.y,
        z: this.draggedAxis === 'z' ? Math.max(0.01, snapshot.scale.z * factor) : snapshot.scale.z,
      });
    }

    const mesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
    if (mesh) mesh.scale.set(newScale.x, newScale.y, newScale.z);
  }

  private applyScaleToEntity(entityId: string, newScale: { x: number; y: number; z: number }): void {
    if (!this.validateTransformTarget(entityId, 'applyScaleToEntity')) {
      return;
    }

    this.stateManager.set(`entities.${entityId}.scale`, newScale);

    if (this.entityManager) {
      const entity = this.entityManager.getEntity(entityId);
      if (entity) entity.setScale?.(newScale);
    }

    const mesh = this.scene.getObjectByName(`entity_${entityId}`);
    if (mesh) mesh.scale.set(newScale.x, newScale.y, newScale.z);
  }

  /**
   * Cache rotation at drag start so rotation delta is stable across all frames
   */
  private rotationBase: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  /**
   * Cache scale at drag start so scale delta is stable across all frames
   */
  private scaleBase: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };

  /**
   * Handle mouse up to stop dragging
   */
  handlePointerUp(_event: MouseEvent): boolean {
    const wasDragging = this.draggedAxis !== null || this.isDraggingBody;
    if (this.draggedAxis && this.config.enableLogging) {
      console.log(`[GizmoSystem] Drag ended on axis: ${this.draggedAxis}`);
    }
    this.draggedAxis = null;
    this.isDraggingBody = false;
    if (wasDragging) {
      this.toolCoordinator?.endGizmoDrag('pointer_up');
    }
    if (wasDragging) {
      this.emitTransformCommit();
    }
    return wasDragging;
  }

  /**
   * Double-click cycles through gizmo modes: translate → rotate → scale → translate
   */
  handleDoubleClick(event: MouseEvent): boolean {
    if (!this.enabled || !this.selectedEntityId) return false;
    if (this.modeManager?.getMode?.() !== 'editor') return false;
    if ((event.target as HTMLElement).closest?.('#editor-menu')) return false;

    const order: GizmoMode[] = ['translate', 'rotate', 'scale'];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    this.setMode(next);

    if (this.config.enableLogging) {
      console.log(`[GizmoSystem] Mode via double-click: ${next}`);
    }

    return true;
  }

  isDragging(): boolean {
    return this.draggedAxis !== null || this.isDraggingBody;
  }

  private emitTransformCommit(): void {
    if (!this.ensureRuntimeBindings('emitTransformCommit')) return;
    if (!this.onEntityTransformCommitted || !this.selectedEntityId) return;

    if (!this.validateTransformTarget(this.selectedEntityId, 'emitTransformCommit')) {
      return;
    }

    const entities = this.dragSelectionIds
      .map((entityId) => {
        if (!this.validateTransformTarget(entityId, 'emitTransformCommit:entry')) {
          return null;
        }

        const previous = this.dragStartSnapshots.get(entityId);
        const current = this.getTransformSnapshot(entityId);
        if (!previous || !current) return null;

        return {
          id: entityId,
          previousPosition: { ...previous.position },
          previousRotation: { ...previous.rotation },
          previousScale: { ...previous.scale },
          position: { ...current.position },
          rotation: { ...current.rotation },
          scale: { ...current.scale },
        } satisfies GizmoTransformCommit;
      })
      .filter((entry): entry is GizmoTransformCommit => entry !== null);

    if (entities.length === 0) return;

    this.onEntityTransformCommitted({
      primaryId: this.selectedEntityId,
      entities,
    });
  }

  private validateTransformTarget(entityId: string, accessor: string): boolean {
    try {
      const entity = this.entityManager?.getEntity(entityId) ?? null;
      if (!entity) {
        this.cancelInteraction(`${accessor}:missing_entity`);
        return false;
      }

      if (this.sceneGraph) {
        const worldTransform = this.sceneGraph.getWorldTransform(entityId);
        const { x, y, z } = worldTransform.position;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          this.cancelInteraction(`${accessor}:invalid_world_transform`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`[GizmoSystem] Invalid transform target during ${accessor}`, {
        entityId,
        error,
      });
      this.cancelInteraction(`${accessor}:exception`);
      return false;
    }
  }

  private getTransformSelectionIds(): string[] {
    const selectedIds = this.selectedEntityIds.length > 0
      ? [...this.selectedEntityIds]
      : (this.selectedEntityId ? [this.selectedEntityId] : []);

    if (!this.sceneGraph || selectedIds.length <= 1) {
      return selectedIds;
    }

    const selectedSet = new Set(selectedIds);
    return selectedIds.filter((entityId) => {
      let parentId = this.sceneGraph?.getParent(entityId);
      while (parentId) {
        if (selectedSet.has(parentId)) {
          return false;
        }
        parentId = this.sceneGraph?.getParent(parentId);
      }
      return true;
    });
  }

  private getTransformSnapshot(entityId: string): GizmoTransformSnapshot | null {
    let position: { x: number; y: number; z: number } | undefined;
    if (this.sceneGraph) {
      position = this.sceneGraph.getWorldTransform(entityId).position;
    } else {
      position = this.stateManager.get(`entities.${entityId}.position`) as
        | { x: number; y: number; z: number }
        | undefined;
    }

    const rotation = this.stateManager.get(`entities.${entityId}.rotation`) as
      | { x: number; y: number; z: number }
      | undefined;
    const scale = this.stateManager.get(`entities.${entityId}.scale`) as
      | { x: number; y: number; z: number }
      | undefined;

    if (!position || !rotation || !scale) {
      return null;
    }

    return {
      id: entityId,
      position: { ...position },
      rotation: { ...rotation },
      scale: { ...scale },
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.disable();
    this.entityDestroyedDisposer?.();
    this.entityUpdatedDisposer?.();
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
    this.scene.remove(this.gizmoGroup);
    this.axes.clear();
  }

  private ensureRuntimeBindings(accessor: string): boolean {
    if (this.stateManager) return true;
    if (!this.warnedBeforeInit) {
      this.warnedBeforeInit = true;
      console.warn(`[GizmoSystem] ${accessor} called before state manager/context was available`);
    }
    return false;
  }
}
