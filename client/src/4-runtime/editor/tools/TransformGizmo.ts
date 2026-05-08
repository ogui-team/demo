/**
 * Transform Gizmo
 * Unreal Engine-style transform handles for moving, rotating, and scaling objects
 * 
 * Usage:
 * 1. Click object in editor to select
 * 2. Click again to enter MOVE mode (colored arrows appear)
 * 3. Drag arrows to move along axis
 * 4. Click again to enter ROTATE mode
 * 5. Click again to enter SCALE mode
 * 
 * Colors: Red=X, Green=Y, Blue=Z
 */

import * as THREE from 'three';
import { Entity } from '@engine/1-kernel/core/public-api';
import * as TransformSystem from '@engine/1-kernel/core/public-api';
import { StateManager } from '../../../0-foundation/foundation/state/StateManager';

export type GizmoMode = 'move' | 'rotate' | 'scale';

export interface GizmoConfig {
  arrowSize?: number;
  arrowColor?: { x: number; y: number; z: number };
}

export class TransformGizmo {
  private scene: THREE.Scene;
  private stateManager: StateManager;
  private entity: Entity | null = null;
  private mode: GizmoMode = 'move';
  private enabled: boolean = false;

  // Visual elements
  private gizmoGroup: THREE.Group = new THREE.Group();
  private arrowHelperX: THREE.ArrowHelper | null = null;
  private arrowHelperY: THREE.ArrowHelper | null = null;
  private arrowHelperZ: THREE.ArrowHelper | null = null;
  private modeText: HTMLElement | null = null;

  // Interaction
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private camera: THREE.Camera | null = null;
  private draggedAxis: 'x' | 'y' | 'z' | null = null;
  private dragPlane: THREE.Plane = new THREE.Plane();
  private dragPoint: THREE.Vector3 = new THREE.Vector3();
  private dragStartPos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private dragStartValue: number = 0;

  // Event handlers
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private mouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  // Config
  private arrowSize: number;
  private arrowColors: { x: number; y: number; z: number };

  constructor(scene: THREE.Scene, stateManager: StateManager, camera: THREE.Camera, config: GizmoConfig = {}) {
    this.scene = scene;
    this.stateManager = stateManager;
    this.camera = camera;
    this.arrowSize = config.arrowSize || 2;
    this.arrowColors = config.arrowColor || { x: 0xff0000, y: 0x00ff00, z: 0x0000ff };

    this.createModeIndicator();
  }

  /**
   * Create on-screen mode indicator
   */
  private createModeIndicator(): void {
    const indicator = document.createElement('div');
    indicator.id = 'gizmo-mode-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(23, 18, 13, 0.88);
      color: #d4a850;
      padding: 6px 14px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      letter-spacing: 1px;
      border: 1px solid rgba(212, 168, 80, 0.35);
      border-left: 2px solid #d4a850;
      display: none;
      z-index: 1000;
      text-transform: uppercase;
      pointer-events: none;
    `;
    document.body.appendChild(indicator);
    this.modeText = indicator;
  }

  /**
   * Set entity to transform and enable gizmo
   */
  setEntity(entity: Entity | null): void {
    if (!entity) {
      this.disable();
      this.entity = null;
      this.scene.remove(this.gizmoGroup);
      return;
    }

    this.entity = entity;
    this.updateGizmoPosition();
    this.enable();
  }

  /**
   * Get current entity
   */
  getEntity(): Entity | null {
    return this.entity;
  }

  /**
   * Get current mode
   */
  getMode(): GizmoMode {
    return this.mode;
  }

  /**
   * Cycle to next mode (move -> rotate -> scale -> move...)
   */
  cycleMode(): void {
    const modes: GizmoMode[] = ['move', 'rotate', 'scale'];
    const currentIndex = modes.indexOf(this.mode);
    this.mode = modes[(currentIndex + 1) % modes.length];
    this.updateGizmoVisuals();
    this.updateModeIndicator();
  }

  /**
   * Enable gizmo input handling
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e);
    this.mouseUpHandler = (e: MouseEvent) => this.onMouseUp(e);
    this.mouseDownHandler = (e: MouseEvent) => this.onMouseDown(e);
    this.wheelHandler = (e: WheelEvent) => this.onMouseWheel(e);

    window.addEventListener('mousemove', this.mouseMoveHandler);
    window.addEventListener('mouseup', this.mouseUpHandler);
    window.addEventListener('mousedown', this.mouseDownHandler);
    window.addEventListener('wheel', this.wheelHandler);

    if (!this.scene.getObjectByName('gizmoGroup')) {
      this.scene.add(this.gizmoGroup);
    }

    this.updateGizmoVisuals();
    this.updateModeIndicator();
  }

  /**
   * Disable gizmo
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.mouseMoveHandler) window.removeEventListener('mousemove', this.mouseMoveHandler);
    if (this.mouseUpHandler) window.removeEventListener('mouseup', this.mouseUpHandler);
    if (this.mouseDownHandler) window.removeEventListener('mousedown', this.mouseDownHandler);
    if (this.wheelHandler) window.removeEventListener('wheel', this.wheelHandler);

    if (this.modeText) {
      this.modeText.style.display = 'none';
    }
  }

  /**
   * Update gizmo position to match entity
   */
  updateGizmoPosition(): void {
    if (!this.entity) return;

    const pos = this.entity.getPosition();
    this.gizmoGroup.position.set(pos.x, pos.y, pos.z);
  }

  /**
   * Update gizmo visuals based on current mode
   */
  private updateGizmoVisuals(): void {
    // Clear existing arrows
    this.gizmoGroup.clear();
    this.arrowHelperX = null;
    this.arrowHelperY = null;
    this.arrowHelperZ = null;

    if (!this.entity) return;

    const origin = new THREE.Vector3(0, 0, 0);

    switch (this.mode) {
      case 'move':
        // Create three-axis arrows for movement
        this.arrowHelperX = new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          origin,
          this.arrowSize,
          this.arrowColors.x
        );
        this.arrowHelperY = new THREE.ArrowHelper(
          new THREE.Vector3(0, 1, 0),
          origin,
          this.arrowSize,
          this.arrowColors.y
        );
        this.arrowHelperZ = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          origin,
          this.arrowSize,
          this.arrowColors.z
        );

        this.gizmoGroup.add(this.arrowHelperX);
        this.gizmoGroup.add(this.arrowHelperY);
        this.gizmoGroup.add(this.arrowHelperZ);
        break;

      case 'rotate':
        // Create rotation indicator circles (simplified - just arrows with different scale)
        const rotScale = this.arrowSize * 0.7;
        this.arrowHelperX = new THREE.ArrowHelper(
          new THREE.Vector3(0, 1, 0),
          origin,
          rotScale,
          this.arrowColors.x
        );
        this.arrowHelperY = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          origin,
          rotScale,
          this.arrowColors.y
        );
        this.arrowHelperZ = new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          origin,
          rotScale,
          this.arrowColors.z
        );

        this.gizmoGroup.add(this.arrowHelperX);
        this.gizmoGroup.add(this.arrowHelperY);
        this.gizmoGroup.add(this.arrowHelperZ);
        break;

      case 'scale':
        // Create scale indicator (smaller arrows)
        const scaleSize = this.arrowSize * 0.5;
        this.arrowHelperX = new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          origin,
          scaleSize,
          this.arrowColors.x
        );
        this.arrowHelperY = new THREE.ArrowHelper(
          new THREE.Vector3(0, 1, 0),
          origin,
          scaleSize,
          this.arrowColors.y
        );
        this.arrowHelperZ = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          origin,
          scaleSize,
          this.arrowColors.z
        );

        this.gizmoGroup.add(this.arrowHelperX);
        this.gizmoGroup.add(this.arrowHelperY);
        this.gizmoGroup.add(this.arrowHelperZ);
        break;
    }
  }

  /**
   * Update mode indicator text
   */
  private updateModeIndicator(): void {
    if (!this.modeText) return;
    this.modeText.style.display = 'block';
    const modeIcon: Record<string, string> = { move: '⟷', rotate: '↻', scale: '⤢' };
    const icon = modeIcon[this.mode] || '·';
    this.modeText.textContent = `${icon}  ${this.mode.toUpperCase()}  ·  drag axis · click to cycle`;
  }

  /**
   * Handle mouse down to detect which axis is being dragged
   */
  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || !this.entity || !this.camera) return; // Left click only
    if ((e.target as HTMLElement).closest('#editor-menu')) return; // Ignore menu clicks

    // Update mouse position
    const rect = (this.camera as any).domElement?.getBoundingClientRect();
    if (!rect) return;

    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast against gizmo arrows
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const arrowLines: THREE.Object3D[] = [];
    if (this.arrowHelperX) arrowLines.push(this.arrowHelperX);
    if (this.arrowHelperY) arrowLines.push(this.arrowHelperY);
    if (this.arrowHelperZ) arrowLines.push(this.arrowHelperZ);

    const intersects = this.raycaster.intersectObjects(arrowLines, true);

    if (intersects.length > 0) {
      // Determine which axis was clicked
      const hitObject = intersects[0].object;
      if (hitObject.parent?.parent === this.arrowHelperX) {
        this.draggedAxis = 'x';
      } else if (hitObject.parent?.parent === this.arrowHelperY) {
        this.draggedAxis = 'y';
      } else if (hitObject.parent?.parent === this.arrowHelperZ) {
        this.draggedAxis = 'z';
      }

      if (this.draggedAxis) {
        this.dragStartPos = this.entity.getPosition();
        this.setupDragPlane();
      }
    } else {
      // Click without hitting gizmo = cycle mode
      this.cycleMode();
    }
  }

  /**
   * Setup the plane for drag operations
   */
  private setupDragPlane(): void {
    if (!this.draggedAxis || !this.entity || !this.camera) return;

    const pos = this.entity.getPosition();
    const normal = new THREE.Vector3();

    // Setup plane perpendicular to the dragged axis
    switch (this.draggedAxis) {
      case 'x':
        normal.set(1, 0, 0);
        break;
      case 'y':
        normal.set(0, 1, 0);
        break;
      case 'z':
        normal.set(0, 0, 1);
        break;
    }

    this.dragPlane.setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(pos.x, pos.y, pos.z)
    );

    // Store the starting value for scale operations
    const scale = this.entity.getScale();
    if (this.draggedAxis === 'x') this.dragStartValue = scale.x;
    if (this.draggedAxis === 'y') this.dragStartValue = scale.y;
    if (this.draggedAxis === 'z') this.dragStartValue = scale.z;
  }

  /**
   * Handle mouse move for dragging
   */
  private onMouseMove(e: MouseEvent): void {
    if (!this.draggedAxis || !this.entity || !this.camera) return;

    const rect = (this.camera as any).domElement?.getBoundingClientRect();
    if (!rect) return;

    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Find intersection with drag plane
    this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint);

    const delta = new THREE.Vector3();
    delta.copy(this.dragPoint).sub(new THREE.Vector3(this.dragStartPos.x, this.dragStartPos.y, this.dragStartPos.z));

    // Calculate drag amount for rotation and scale operations
    const dragAmount = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));

    // Apply transformation based on mode and axis
    const currentPos = this.entity.getPosition();
    const currentRot = this.entity.getRotation();
    const currentScale = this.entity.getScale();

    switch (this.mode) {
      case 'move':
        const newPos = { ...currentPos };
        if (this.draggedAxis === 'x') newPos.x = this.dragStartPos.x + delta.x;
        if (this.draggedAxis === 'y') newPos.y = this.dragStartPos.y + delta.y;
        if (this.draggedAxis === 'z') newPos.z = this.dragStartPos.z + delta.z;
        TransformSystem.setPosition(this.entity, this.stateManager, newPos);
        break;

      case 'rotate':
        const angleChange = dragAmount * 2; // Rotation multiplier
        const newRot = { ...currentRot };

        if (this.draggedAxis === 'x') newRot.x += angleChange;
        if (this.draggedAxis === 'y') newRot.y += angleChange;
        if (this.draggedAxis === 'z') newRot.z += angleChange;

        TransformSystem.setRotation(this.entity, this.stateManager, newRot);
        break;

      case 'scale':
        const scaleAmount = 1 + dragAmount;
        const newScale = { ...currentScale };

        if (this.draggedAxis === 'x') newScale.x = Math.max(0.1, currentScale.x * scaleAmount);
        if (this.draggedAxis === 'y') newScale.y = Math.max(0.1, currentScale.y * scaleAmount);
        if (this.draggedAxis === 'z') newScale.z = Math.max(0.1, currentScale.z * scaleAmount);

        TransformSystem.setScale(this.entity, this.stateManager, newScale);
        break;
    }

    // Update gizmo position
    this.updateGizmoPosition();
  }

  /**
   * Handle mouse up to stop dragging
   */
  private onMouseUp(e: MouseEvent): void {
    this.draggedAxis = null;
  }

  /**
   * Handle mouse wheel for fine adjustment
   */
  private onMouseWheel(e: WheelEvent): void {
    if (!this.entity || !this.draggedAxis) return;

    e.preventDefault();

    const adjustment = e.deltaY > 0 ? -0.1 : 0.1;
    const currentPos = this.entity.getPosition();

    const newPos = { ...currentPos };
    if (this.draggedAxis === 'x') newPos.x += adjustment;
    if (this.draggedAxis === 'y') newPos.y += adjustment;
    if (this.draggedAxis === 'z') newPos.z += adjustment;

    TransformSystem.setPosition(this.entity, this.stateManager, newPos);
    this.updateGizmoPosition();
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.disable();
    this.scene.remove(this.gizmoGroup);
    if (this.modeText?.parentElement) {
      this.modeText.parentElement.removeChild(this.modeText);
    }
  }
}
