import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { TwoDRenderPass, UI2DComponentData } from '../../../../4-runtime/ui/2d/TwoDTypes';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';

interface UI2DEntity {
  id: string;
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
}

interface UI2DEntityManager {
  getEntities(): Iterable<UI2DEntity>;
}

type HealthLookup = {
  getHp(playerId: string): number;
  getMaxHp(playerId: string): number;
};

export class UI2DSystem {
  private readonly entityManager: UI2DEntityManager;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;
  private readonly sizeScratch = new THREE.Vector2();
  private readonly renderPasses: TwoDRenderPass[];
  private systemContext: SystemContext | null = null;
  private visibleElements = 0;
  private lastSize = { width: 0, height: 0 };
  private lastReportedVisibleElements = -1;
  private redrawAccumulator = 0;
  private needsRedraw = true;
  private lastHealthPlayerId: string | null = null;
  private lastHp = Number.NaN;
  private lastMaxHp = Number.NaN;

  constructor(entityManager: UI2DEntityManager, renderer: THREE.WebGLRenderer) {
    this.entityManager = entityManager;
    this.renderer = renderer;
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(512, 256), material);
    this.mesh.position.set(256, 128, 0);
    this.scene.add(this.mesh);
    this.renderPasses = [{ layer: 'ui2D', scene: this.scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }];
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
        visibleElements: this.visibleElements,
      },
    };
  }

  update(dt = 0): void {
    this.syncSize();
    const context = this.context;
    if (!context) return;

    this.redrawAccumulator += dt;

    let localPlayerId: string | null = null;
    const uiConfigs: UI2DComponentData[] = [];
    for (const entity of this.entityManager.getEntities()) {
      if (!localPlayerId && entity.hasComponent('localPlayer')) {
        localPlayerId = entity.id;
      }
      const config = entity.getComponent('ui2d')?.data as UI2DComponentData | undefined;
      if (config) {
        uiConfigs.push(config);
      }
    }

    const healthSystem = this.systemContext?.systems.healthSystem as HealthLookup | undefined;
    let hp = Number.NaN;
    let maxHp = Number.NaN;
    if (localPlayerId && healthSystem) {
      hp = healthSystem.getHp(localPlayerId);
      maxHp = healthSystem.getMaxHp(localPlayerId);
    }

    const visibleCount = (localPlayerId && healthSystem ? 1 : 0) + uiConfigs.length;
    if (visibleCount !== this.visibleElements) {
      this.visibleElements = visibleCount;
      this.needsRedraw = true;
    }

    if (
      localPlayerId !== this.lastHealthPlayerId ||
      hp !== this.lastHp ||
      maxHp !== this.lastMaxHp
    ) {
      this.lastHealthPlayerId = localPlayerId;
      this.lastHp = hp;
      this.lastMaxHp = maxHp;
      this.needsRedraw = true;
    }

    const mode = getRuntimePerformanceMode();
    const redrawInterval = mode === RuntimePerformanceMode.DEV ? 0 : 0.125;
    if (!this.needsRedraw && redrawInterval > 0 && this.redrawAccumulator < redrawInterval) {
      this.emitVisibleElementsIfChanged();
      return;
    }

    this.redrawAccumulator = 0;
    this.needsRedraw = false;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (localPlayerId && healthSystem) {
      this.drawHealthBar(context, hp, maxHp);
    }

    for (const config of uiConfigs) {
      this.drawUiElement(context, config);
    }

    this.texture.needsUpdate = true;

    this.emitVisibleElementsIfChanged();
  }

  getRenderPasses(): TwoDRenderPass[] {
    const camera2D = this.systemContext?.systems.camera2DSystem as { getUICamera(): THREE.Camera } | undefined;
    if (!camera2D) return [];
    this.renderPasses[0].camera = camera2D.getUICamera();
    return this.renderPasses;
  }

  private emitVisibleElementsIfChanged(): void {
    if (this.visibleElements !== this.lastReportedVisibleElements) {
      this.lastReportedVisibleElements = this.visibleElements;
      gameBus.emit('stateMutation', {
        source: 'ui2DSystem',
        path: '2d.ui.visibleElements',
        changedCount: 1,
      });
    }
  }

  private drawHealthBar(context: CanvasRenderingContext2D, hp: number, maxHp: number): void {
    const ratio = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
    context.fillStyle = 'rgba(0,0,0,0.6)';
    context.fillRect(18, 18, 180, 24);
    context.fillStyle = '#1fd64b';
    context.fillRect(22, 22, 172 * ratio, 16);
    context.strokeStyle = '#ffffff';
    context.strokeRect(18, 18, 180, 24);
    context.fillStyle = '#ffffff';
    context.font = '12px monospace';
    context.fillText(`HP ${Math.round(hp)}/${Math.round(maxHp)}`, 24, 58);
  }

  private drawUiElement(context: CanvasRenderingContext2D, config: UI2DComponentData): void {
    const x = config.x ?? 24;
    const y = config.y ?? 24;
    const width = config.width ?? 180;
    const height = config.height ?? 26;
    if (config.kind === 'panel' || config.kind === 'health_bar') {
      context.fillStyle = config.background ?? 'rgba(0,0,0,0.45)';
      context.fillRect(x, y, width, height);
      context.strokeStyle = '#ffffff';
      context.strokeRect(x, y, width, height);
    }
    if (config.text) {
      context.fillStyle = config.color ?? '#ffffff';
      context.font = '12px monospace';
      context.fillText(config.text, x + 8, y + Math.max(16, height / 2));
    }
  }

  private syncSize(): void {
    this.renderer.getSize(this.sizeScratch);
    const width = Math.max(256, Math.floor(this.sizeScratch.x));
    const height = Math.max(128, Math.floor(this.sizeScratch.y));
    if (width === this.lastSize.width && height === this.lastSize.height) return;
    this.lastSize = { width, height };
    this.canvas.width = width;
    this.canvas.height = height;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height);
    this.mesh.position.set(width / 2, height / 2, 0);
    this.needsRedraw = true;
    gameBus.emit('stateMutation', {
      source: 'ui2DSystem',
      path: '2d.ui.viewport',
      changedCount: 1,
    });
  }

  dispose(): void {
    // Dispose canvas texture and mesh
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    // Clear scene
    this.scene.clear();
    // Reset state
    this.visibleElements = 0;
    this.lastHealthPlayerId = null;
    this.lastHp = Number.NaN;
    this.lastMaxHp = Number.NaN;
  }
}
