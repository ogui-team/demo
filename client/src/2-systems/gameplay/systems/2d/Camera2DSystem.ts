import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';

export class Camera2DSystem {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly worldCamera: THREE.OrthographicCamera;
  private readonly uiCamera: THREE.OrthographicCamera;
  private systemContext: SystemContext | null = null;
  private followEntityId: string | null = null;
  private zoom = 24;
  private bounds = { left: -16, right: 16, top: 9, bottom: -9 };
  private lastSize = { width: 1, height: 1 };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.worldCamera = new THREE.OrthographicCamera(-16, 16, 9, -9, -100, 100);
    this.worldCamera.position.set(0, 0, 10);
    this.uiCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -100, 100);
    this.uiCamera.position.set(0, 0, 10);
    this.syncViewport();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        zoom: this.zoom,
        followEntityId: this.followEntityId,
        bounds: this.bounds,
      },
    };
  }

  update(): void {
    this.syncViewport();
    if (!this.followEntityId || !this.systemContext?.entityManager) return;
    const entity = this.systemContext.entityManager.getEntity(this.followEntityId);
    if (!entity) return;
    const position = entity.getPosition();
    this.worldCamera.position.x = position.x;
    this.worldCamera.position.y = position.z;
    this.bounds = {
      left: this.worldCamera.left + this.worldCamera.position.x,
      right: this.worldCamera.right + this.worldCamera.position.x,
      top: this.worldCamera.top + this.worldCamera.position.y,
      bottom: this.worldCamera.bottom + this.worldCamera.position.y,
    };
  }

  setFollowEntity(entityId: string | null): void {
    if (this.followEntityId === entityId) return;
    this.followEntityId = entityId;
    gameBus.emit('stateMutation', {
      source: 'camera2DSystem',
      path: '2d.camera.followEntity',
      changedCount: entityId ? 1 : 0,
    });
  }

  getWorldCamera(): THREE.OrthographicCamera {
    return this.worldCamera;
  }

  getUICamera(): THREE.OrthographicCamera {
    return this.uiCamera;
  }

  getBounds(): { left: number; right: number; top: number; bottom: number } {
    return { ...this.bounds };
  }

  private syncViewport(): void {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);
    if (width === this.lastSize.width && height === this.lastSize.height) return;
    this.lastSize = { width, height };
    const aspect = width / height;
    const halfHeight = this.zoom / 2;
    const halfWidth = halfHeight * aspect;
    this.worldCamera.left = -halfWidth;
    this.worldCamera.right = halfWidth;
    this.worldCamera.top = halfHeight;
    this.worldCamera.bottom = -halfHeight;
    this.worldCamera.updateProjectionMatrix();

    this.uiCamera.left = 0;
    this.uiCamera.right = width;
    this.uiCamera.top = 0;
    this.uiCamera.bottom = height;
    this.uiCamera.updateProjectionMatrix();
    gameBus.emit('stateMutation', {
      source: 'camera2DSystem',
      path: '2d.camera.viewport',
      changedCount: 1,
    });
  }

  dispose(): void {
    // Camera2DSystem holds references to WebGL cameras - safe to leave for GC
    // as they are managed by the renderer
  }
}
