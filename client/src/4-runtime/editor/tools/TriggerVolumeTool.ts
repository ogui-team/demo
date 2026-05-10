import * as THREE from 'three';
import { Entity, gameBus, type RoutedInputHandler, type SystemCapabilities, type SystemContext } from '@engine/1-kernel/core/public-api';
import { createRenderComponent } from '../../../2-systems/gameplay/game/components/RenderComponent';
import { createBoxCollider } from '../../../2-systems/gameplay/game/components/ColliderComponent';
import { createTriggerVolumeComponent } from '../../../2-systems/gameplay/game/components/TriggerVolumeComponent';
import type { PrefabPlacementSystem } from './PrefabPlacementSystem';

interface ToolCoordinatorAdapter {
  getActiveTool(): 'SELECT' | 'PAINT' | 'WHITEBOX';
  beginWhiteboxDrag(reason?: string): boolean;
  endWhiteboxDrag(reason?: string): boolean;
}

interface EntityManagerAdapter {
  createEntity(type: string, transform?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } }): Entity;
}

interface EntityRendererAdapter {
  syncEntity(entity: Entity): void;
}

export interface TriggerVolumeToolConfig {
  scene: THREE.Scene;
  toolCoordinator: ToolCoordinatorAdapter;
  placementSystem: PrefabPlacementSystem;
  entityManager: EntityManagerAdapter;
  entityRenderer: EntityRendererAdapter;
  enableLogging?: boolean;
  defaultHeight?: number;
  minDimension?: number;
}

interface TriggerPreviewState {
  anchor: { x: number; y: number; z: number };
  current: { x: number; y: number; z: number };
}

export class TriggerVolumeTool implements RoutedInputHandler {
  private readonly scene: THREE.Scene;
  private readonly toolCoordinator: ToolCoordinatorAdapter;
  private readonly placementSystem: PrefabPlacementSystem;
  private readonly entityManager: EntityManagerAdapter;
  private readonly entityRenderer: EntityRendererAdapter;
  private readonly enableLogging: boolean;
  private readonly defaultHeight: number;
  private readonly minDimension: number;
  private readonly previewMesh: THREE.Mesh;
  private previewState: TriggerPreviewState | null = null;
  private systemContext: SystemContext | null = null;
  private readonly lifecycleDisposers: Array<() => void> = [];

  constructor(config: TriggerVolumeToolConfig) {
    this.scene = config.scene;
    this.toolCoordinator = config.toolCoordinator;
    this.placementSystem = config.placementSystem;
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer;
    this.enableLogging = config.enableLogging ?? false;
    this.defaultHeight = Math.max(0.25, config.defaultHeight ?? 3);
    this.minDimension = Math.max(0.1, config.minDimension ?? 0.5);

    this.previewMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x39ff14,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      }),
    );
    this.previewMesh.name = 'editor_trigger_preview';
    this.previewMesh.visible = false;

    this.lifecycleDisposers.push(
      gameBus.on('EDITOR_TOOL_CHANGED', ({ tool }) => {
        if (tool !== 'WHITEBOX') {
          this.cancelPreview('tool_changed');
        }
      }),
      gameBus.on('ENGINE_RESET', () => this.cancelPreview('engine_reset')),
      gameBus.on('ROUND_TRANSITION', () => this.cancelPreview('round_transition')),
    );
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  handleDoubleClick(_event: MouseEvent): boolean {
    return false;
  }

  handleWheel(_event: WheelEvent): boolean {
    return false;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  update(_dt: number): void {
    // Preview updates are pointer driven.
  }

  disable(): void {
    this.cancelPreview('disable');
  }

  destroy(): void {
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
    this.hidePreview();
    this.scene.remove(this.previewMesh);
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
      status: this.previewState ? 'dragging' : 'idle',
      active: true,
      metrics: {
        defaultHeight: this.defaultHeight,
        minDimension: this.minDimension,
        hasPreview: this.previewState !== null,
      },
    };
  }

  handlePointerDown(event: MouseEvent): boolean {
    if (event.button !== 0) return false;
    if (this.toolCoordinator.getActiveTool() !== 'WHITEBOX') return false;

    event.preventDefault();
    const hit = this.placementSystem.pickGroundPointFromPointer(event);
    if (!hit) {
      return true;
    }
    if (!this.toolCoordinator.beginWhiteboxDrag('pointer_down')) {
      return true;
    }

    this.previewState = {
      anchor: { ...hit.point },
      current: { ...hit.point },
    };
    this.ensurePreviewAttached();
    this.updatePreview();
    return true;
  }

  handlePointerMove(event: MouseEvent): boolean {
    if (!this.previewState) return false;
    const hit = this.placementSystem.pickGroundPointFromPointer(event);
    if (!hit) return true;
    this.previewState.current = { ...hit.point };
    this.updatePreview();
    return true;
  }

  handlePointerUp(event: MouseEvent): boolean {
    if (event.button !== 0) return false;
    if (!this.previewState) return false;

    const bounds = this.computeBounds(this.previewState.anchor, this.previewState.current);
    this.hidePreview();
    this.toolCoordinator.endWhiteboxDrag('pointer_up');

    if (bounds.size.x < this.minDimension || bounds.size.z < this.minDimension) {
      return true;
    }

    const entity = this.entityManager.createEntity('EditorObject_TriggerVolume', {
      position: bounds.center,
      rotation: { x: 0, y: 0, z: 0 },
    });
    entity.addComponent({
      name: 'render',
      data: createRenderComponent('box', 0x39ff14, {
        width: bounds.size.x,
        height: bounds.size.y,
        depth: bounds.size.z,
      }, {
        transparent: true,
        opacity: 0.25,
        emissive: 0x39ff14,
        receiveShadow: false,
      }),
    });
    entity.addComponent({
      name: 'collider',
      data: createBoxCollider(bounds.size.x, bounds.size.y, bounds.size.z, {
        isTrigger: true,
      }),
    });
    entity.addComponent({
      name: 'triggerVolume',
      data: createTriggerVolumeComponent(bounds.size, {
        editorColor: 0x39ff14,
      }),
    });
    this.entityRenderer.syncEntity(entity);
    this.placementSystem.finalizePlacedEntity(entity, {
      entityType: entity.type,
    });

    gameBus.emit('EDITOR_TRIGGER_VOLUME_CREATED', {
      entityId: entity.id,
      center: bounds.center,
      size: bounds.size,
      timestamp: Engine.time.now(),
    });

    return true;
  }

  private ensurePreviewAttached(): void {
    if (!this.previewMesh.parent) {
      this.scene.add(this.previewMesh);
    }
    this.previewMesh.visible = true;
  }

  private updatePreview(): void {
    if (!this.previewState) return;
    const bounds = this.computeBounds(this.previewState.anchor, this.previewState.current);
    this.previewMesh.position.set(bounds.center.x, bounds.center.y, bounds.center.z);
    this.previewMesh.scale.set(bounds.size.x, bounds.size.y, bounds.size.z);
  }

  private hidePreview(): void {
    this.previewState = null;
    this.previewMesh.visible = false;
  }

  private cancelPreview(reason: string): void {
    if (!this.previewState) return;
    this.hidePreview();
    this.toolCoordinator.endWhiteboxDrag(reason);
  }

  private computeBounds(anchor: { x: number; y: number; z: number }, current: { x: number; y: number; z: number }) {
    const size = {
      x: Math.max(this.minDimension, Math.abs(current.x - anchor.x)),
      y: this.defaultHeight,
      z: Math.max(this.minDimension, Math.abs(current.z - anchor.z)),
    };
    const baseY = Math.min(anchor.y, current.y);
    const center = {
      x: (anchor.x + current.x) * 0.5,
      y: baseY + size.y * 0.5,
      z: (anchor.z + current.z) * 0.5,
    };
    return { center, size };
  }
}