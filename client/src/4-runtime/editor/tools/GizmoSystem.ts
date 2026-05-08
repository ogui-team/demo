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

interface GizmoStateStoreAdapter {
  get(path: string): unknown;
  set(path: string, value: unknown): boolean;
}

interface GizmoEntityManagerAdapter {
  getEntity(entityId: string): Entity | null | undefined;
  onEntityDestroyed(callback: (entity: Entity) => void): () => void;
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
  private mode: GizmoMode = 'translate';

  // Visual representation
  private gizmoGroup: THREE.Group = new THREE.Group();
  private axes: Map<AxisType, GizmoAxis> = new Map();

  // EntityManager for entity lookup
  private entityManager: GizmoEntityManagerAdapter | null = null;
  private entityDestroyedDisposer: (() => void) | null = null;
  private lifecycleDisposers: Array<() => void> = [];

  // SceneGraph for world-transform lookups (parented entities)
  private sceneGraph: SceneGraph | null = null;
  private onEntityTransformCommitted: ((data: GizmoTransformCommit) => void) | null = null;
  private toolCoordinator: {
    canUseGizmo(): boolean;
    beginGizmoDrag(reason?: string): boolean;
    endGizmoDrag(reason?: string): boolean;
  } | null = null;

  // Interaction
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private draggedAxis: AxisType | null = null;
  private isDraggingBody: boolean = false;        // free-drag on entity mesh
  private dragPlane: THREE.Plane = new THREE.Plane();
  private dragStartEntityPos: THREE.Vector3 = new THREE.Vector3(); // entity pos at drag start
  private dragStartPlanePoint: THREE.Vector3 = new THREE.Vector3(); // ray-plane hit at drag start
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
        selectedEntityId: this.selectedEntityId,
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
    this.entityManager = entityManager;
    this.entityDestroyedDisposer = entityManager.onEntityDestroyed((entity) => {
      if (entity.id !== this.selectedEntityId) return;
      this.cancelInteraction('entity_destroyed');
      this.detachEntity();
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

  setOnEntityTransformCommitted(callback: ((data: GizmoTransformCommit) => void) | null): void {
    this.onEntityTransformCommitted = callback;
  }

  setToolCoordinator(coordinator: {
    canUseGizmo(): boolean;
    beginGizmoDrag(reason?: string): boolean;
    endGizmoDrag(reason?: string): boolean;
  } | null): void {
    this.toolCoordinator = coordinator;
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
    // Handle string entity ID
    if (typeof entity === 'string') {
      this.selectedEntityId = entity;
      this.selectedEntity = null; // Will be resolved later if needed
    } else {
      this.selectedEntity = entity;
      this.selectedEntityId = entity.id;
    }

    // Update gizmo visuals
    this.updateGizmoVisuals();

    if (this.config.enableLogging) {
      console.log(`[GizmoSystem] Attached to entity: ${this.selectedEntityId}`);
    }
  }

  /**
   * Detach from current entity
   */
  detachEntity(): void {
    this.cancelInteraction('detach');
    this.selectedEntity = null;
    this.selectedEntityId = null;
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
      const arrowHelper = new THREE.ArrowHelper(
        axis.direction,
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
      const arrowHelper = new THREE.ArrowHelper(
        axis.direction,
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
      const arrowHelper = new THREE.ArrowHelper(
        axis.direction,
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
    this.raycaster.setFromCamera(this.mouse, this.camera!);

    // --- 1. Try to hit a gizmo axis arrow ---
    const arrowObjects: THREE.Object3D[] = [];
    for (const axis of this.axes.values()) {
      if (axis.arrow) arrowObjects.push(axis.arrow);
    }

    const axisHits = this.raycaster.intersectObjects(arrowObjects, true);
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
      const bodyHits = this.raycaster.intersectObject(entityMesh, true);
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

    // Use world-position (SceneGraph) as the drag start baseline so that
    // axis-delta math is always in world space, even for parented entities.
    let pos: { x: number; y: number; z: number } | undefined;
    const rot = this.stateManager.get(`entities.${this.selectedEntityId}.rotation`) as
      | { x: number; y: number; z: number }
      | undefined;

    if (this.sceneGraph) {
      const worldT = this.sceneGraph.getWorldTransform(this.selectedEntityId);
      pos = worldT.position;
    } else {
      pos = this.stateManager.get(`entities.${this.selectedEntityId}.position`) as
        | { x: number; y: number; z: number }
        | undefined;
    }
    if (!pos) return;

    // Use camera forward as the drag plane normal so the plane always faces the camera.
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    this.dragPlane.setFromNormalAndCoplanarPoint(camDir, hitPoint);

    // Cache entity position + rotation + scale at drag start
    this.dragStartEntityPos.set(pos.x, pos.y, pos.z);
    this.rotationBase = rot ? { ...rot } : { x: 0, y: 0, z: 0 };
    this.dragStartRotation = { ...this.rotationBase };
    const scaleVal = this.stateManager.get(`entities.${this.selectedEntityId}.scale`) as
      | { x: number; y: number; z: number }
      | undefined;
    this.scaleBase = scaleVal ? { ...scaleVal } : { x: 1, y: 1, z: 1 };
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

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Current ray-plane intersection
    const currentPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, currentPoint)) return false;

    // World-space delta from drag start
    const worldDelta = new THREE.Vector3().subVectors(currentPoint, this.dragStartPlanePoint);

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

    const axisDir = this.axes.get(this.draggedAxis)!.direction;
    const projected = worldDelta.dot(axisDir); // signed distance along axis

    const newPos = {
      x: this.dragStartEntityPos.x + (this.draggedAxis === 'x' ? projected : 0),
      y: this.dragStartEntityPos.y + (this.draggedAxis === 'y' ? projected : 0),
      z: this.dragStartEntityPos.z + (this.draggedAxis === 'z' ? projected : 0),
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

    if (this.sceneGraph) {
      // SceneGraph.setWorldPosition writes local pos to StateManager and propagates
      this.sceneGraph.setWorldPosition(this.selectedEntityId, newPos);
    } else {
      this.stateManager.set(`entities.${this.selectedEntityId}.position`, newPos);
    }

    // Update entity's local transform so EntityRenderer gets the change
    if (this.entityManager) {
      const entity = this.entityManager.getEntity(this.selectedEntityId);
      if (entity) entity.setPosition(newPos);
    }

    // Immediately update the mesh for smooth, lag-free dragging
    const mesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
    if (mesh) mesh.position.set(newPos.x, newPos.y, newPos.z);

    // Keep gizmo in sync
    this.gizmoGroup.position.set(newPos.x, newPos.y, newPos.z);
  }

  /**
   * Apply rotation around dragged axis.
   * Project worldDelta onto the screen-space tangent to get a signed angle.
   */
  private applyRotation(worldDelta: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('applyRotation')) return;
    if (!this.draggedAxis || !this.selectedEntityId) return;

    const rotKey = `entities.${this.selectedEntityId}.rotation`;
    const baseRot = this.stateManager.get(rotKey) as { x: number; y: number; z: number } | undefined;
    if (!baseRot) return;

    // Use the component of worldDelta perpendicular to the axis as angle magnitude
    const axisDir = this.axes.get(this.draggedAxis)!.direction;
    const tangent = new THREE.Vector3().copy(worldDelta);
    const projected = tangent.dot(axisDir);
    tangent.addScaledVector(axisDir, -projected); // remove component along axis
    const angle = tangent.length() * 2; // radians — scale as desired

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

    this.stateManager.set(rotKey, newRot);

    if (this.entityManager) {
      const entity = this.entityManager.getEntity(this.selectedEntityId);
      if (entity) entity.setRotation(newRot);
    }

    const mesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
    if (mesh) mesh.rotation.set(newRot.x, newRot.y, newRot.z);
  }

  /**
   * Apply scale along dragged axis.
   * Uses scaleBase (cached at drag start) so delta is stable across all frames.
   */
  private applyScale(worldDelta: THREE.Vector3): void {
    if (!this.ensureRuntimeBindings('applyScale')) return;
    if (!this.draggedAxis || !this.selectedEntityId) return;

    const axisDir = this.axes.get(this.draggedAxis)!.direction;
    const signedDelta = worldDelta.dot(axisDir); // positive = grow, negative = shrink
    // Map drag distance: 1 world unit of drag = 1x scale change
    const factor = Math.max(0.01, 1 + signedDelta);

    const newScale = {
      x: this.draggedAxis === 'x' ? Math.max(0.01, this.scaleBase.x * factor) : this.scaleBase.x,
      y: this.draggedAxis === 'y' ? Math.max(0.01, this.scaleBase.y * factor) : this.scaleBase.y,
      z: this.draggedAxis === 'z' ? Math.max(0.01, this.scaleBase.z * factor) : this.scaleBase.z,
    };

    this.stateManager.set(`entities.${this.selectedEntityId}.scale`, newScale);

    if (this.entityManager) {
      const entity = this.entityManager.getEntity(this.selectedEntityId);
      if (entity) entity.setScale?.(newScale);
    }

    const mesh = this.scene.getObjectByName(`entity_${this.selectedEntityId}`);
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

    const position = this.stateManager.get(`entities.${this.selectedEntityId}.position`) as
      | { x: number; y: number; z: number }
      | undefined;
    const rotation = this.stateManager.get(`entities.${this.selectedEntityId}.rotation`) as
      | { x: number; y: number; z: number }
      | undefined;
    const scale = this.stateManager.get(`entities.${this.selectedEntityId}.scale`) as
      | { x: number; y: number; z: number }
      | undefined;

    if (!position || !rotation || !scale) return;

    this.onEntityTransformCommitted({
      id: this.selectedEntityId,
      previousPosition: { x: this.dragStartEntityPos.x, y: this.dragStartEntityPos.y, z: this.dragStartEntityPos.z },
      previousRotation: { ...this.dragStartRotation },
      previousScale: { ...this.dragStartScale },
      position: { ...position },
      rotation: { ...rotation },
      scale: { ...scale },
    });
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.disable();
    this.entityDestroyedDisposer?.();
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
