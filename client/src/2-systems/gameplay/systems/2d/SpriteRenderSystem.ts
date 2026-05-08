import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { SpriteBatch2D, type BatchedSprite2D } from '../../../../4-runtime/ui/2d/SpriteBatch2D';
import type { AnimationComponentData, SpriteAtlas2D, SpriteComponentData, TwoDRenderPass } from '../../../../4-runtime/ui/2d/TwoDTypes';
import { gameBus } from '@engine/1-kernel/core/public-api';

interface SpriteRenderEntity {
  id: string;
  type: string;
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
  addComponent(component: { name: string; data: unknown }): void;
  getPosition(): { x: number; y: number; z: number };
}

interface SpriteRenderEntityManager {
  getEntities(): Iterable<SpriteRenderEntity>;
  getEntity(id: string): SpriteRenderEntity | undefined;
}

type AtlasLookup = {
  getAtlas(id: string): SpriteAtlas2D | null;
  noteUsage(atlasId: string, count: number): void;
};

export class SpriteRenderSystem {
  private readonly entityManager: SpriteRenderEntityManager;
  private readonly scenes = {
    world2D: new THREE.Scene(),
    entities2D: new THREE.Scene(),
  };
  private readonly batches = new Map<string, SpriteBatch2D>();
  private systemContext: SystemContext | null = null;
  private spriteCount = 0;
  private batchCount = 0;
  private drawCalls = 0;
  private selectedEntityId: string | null = null;
  private lastReportedMetrics = {
    spriteCount: -1,
    batchCount: -1,
    drawCalls: -1,
    selectedEntityId: null as string | null,
  };

  constructor(entityManager: SpriteRenderEntityManager) {
    this.entityManager = entityManager;
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
        spriteCount: this.spriteCount,
        batchCount: this.batchCount,
        drawCalls: this.drawCalls,
        selectedEntityId: this.selectedEntityId,
      },
    };
  }

  update(): void {
    const atlasSystem = this.systemContext?.systems.spriteAtlasSystem as AtlasLookup | undefined;
    if (!atlasSystem) return;

    this.ensureDefaultPlayerSprites();

    const grouped = new Map<string, BatchedSprite2D[]>();
    this.spriteCount = 0;
    this.batchCount = 0;
    this.drawCalls = 0;

    const spriteEntities = Array.from(this.entityManager.getEntities()).filter((entity) => entity.hasComponent('sprite'));
    if (!this.selectedEntityId && spriteEntities[0]) this.selectedEntityId = spriteEntities[0].id;
    for (const entity of spriteEntities) {
      const sprite = entity.getComponent('sprite')?.data as SpriteComponentData | undefined;
      if (!sprite || sprite.visible === false) continue;
      const atlas = atlasSystem.getAtlas(sprite.atlasId);
      const frame = atlas?.frames[sprite.frame];
      if (!atlas || !frame) continue;

      const layer = sprite.layer ?? 'entities2D';
      const key = `${layer}:${sprite.atlasId}`;
      const list = grouped.get(key) ?? [];
      const position = entity.getPosition();
      list.push({
        x: position.x,
        y: position.z + ((sprite.height ?? 1.6) * (sprite.pivotY ?? 0.5)),
        z: layer === 'entities2D' ? -2 - position.z * 0.0001 : -3,
        width: sprite.width ?? 1.6,
        height: sprite.height ?? 1.6,
        rotation: sprite.rotation2D ?? 0,
        uvRect: {
          x: frame.x / atlas.width,
          y: frame.y / atlas.height,
          width: frame.width / atlas.width,
          height: frame.height / atlas.height,
        },
        tint: sprite.tint ?? 0xffffff,
        opacity: sprite.opacity ?? 1,
      });
      grouped.set(key, list);
      atlasSystem.noteUsage(sprite.atlasId, list.length);
      this.spriteCount += 1;
    }

    for (const [key, sprites] of grouped) {
      const [layer, atlasId] = key.split(':');
      const atlas = atlasSystem.getAtlas(atlasId);
      if (!atlas) continue;
      let batch = this.batches.get(key);
      if (!batch) {
        batch = new SpriteBatch2D(atlas.texture, Math.max(512, sprites.length + 16));
        this.batches.set(key, batch);
        (layer === 'world2D' ? this.scenes.world2D : this.scenes.entities2D).add(batch.getMesh());
      }
      batch.setTexture(atlas.texture);
      batch.updateSprites(sprites);
      const metrics = batch.getMetrics();
      this.batchCount += metrics.batchCount;
      this.drawCalls += metrics.drawCalls;
    }

    for (const [key, batch] of this.batches) {
      if (!grouped.has(key)) {
        batch.updateSprites([]);
      }
    }

    this.emitMetricsIfChanged();
  }

  getRenderPasses(): TwoDRenderPass[] {
    const camera2D = this.systemContext?.systems.camera2DSystem as { getWorldCamera(): THREE.Camera } | undefined;
    if (!camera2D) return [];
    return [
      { layer: 'world2D', scene: this.scenes.world2D, camera: camera2D.getWorldCamera() },
      { layer: 'entities2D', scene: this.scenes.entities2D, camera: camera2D.getWorldCamera() },
    ];
  }

  getDebugPanel(requestRefresh: () => void): HTMLElement | null {
    const root = document.createElement('div');
    root.style.cssText = 'margin-top:18px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);';
    root.innerHTML = '<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:10px;letter-spacing:1.5px;color:#9ea7ad;">Sprite Preview Panel</div>';
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;';
    root.appendChild(body);

    const spriteEntities = Array.from(this.entityManager.getEntities()).filter((entity) => entity.hasComponent('sprite'));
    const select = document.createElement('select');
    select.style.cssText = 'padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);color:#e6edf3;font:inherit;';
    for (const entity of spriteEntities) {
      const option = document.createElement('option');
      option.value = entity.id;
      option.textContent = entity.id;
      option.selected = entity.id === this.selectedEntityId;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.selectedEntityId = select.value || null;
      requestRefresh();
    });
    body.appendChild(select);

    const preview = document.createElement('canvas');
    preview.width = 96;
    preview.height = 96;
    preview.style.cssText = 'width:96px;height:96px;border:1px solid rgba(255,255,255,0.08);background:#0b0b0b;image-rendering:pixelated;';
    body.appendChild(preview);

    const entity = this.selectedEntityId ? this.entityManager.getEntity(this.selectedEntityId) : spriteEntities[0];
    if (entity && !this.selectedEntityId) this.selectedEntityId = entity.id;
    const sprite = entity?.getComponent('sprite')?.data as SpriteComponentData | undefined;
    const atlasSystem = this.systemContext?.systems.spriteAtlasSystem as AtlasLookup | undefined;
    const atlas = sprite ? atlasSystem?.getAtlas(sprite.atlasId) : null;
    const frame = sprite && atlas ? atlas.frames[sprite.frame] : null;
    const ctx = preview.getContext('2d');
    if (ctx && atlas?.image && frame) {
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, preview.width, preview.height);
    }

    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:#9ea7ad;line-height:1.5;';
    info.textContent = sprite
      ? `Atlas: ${sprite.atlasId} | Frame: ${sprite.frame} | Sprites: ${this.spriteCount} | Batches: ${this.batchCount}`
      : 'No sprite selected';
    body.appendChild(info);

    return root;
  }

  private ensureDefaultPlayerSprites(): void {
    for (const entity of this.entityManager.getEntities()) {
      if (entity.type !== 'LocalPlayer' && entity.type !== 'RemotePlayer') continue;
      if (!entity.hasComponent('sprite')) {
        entity.addComponent({
          name: 'sprite',
          data: {
            atlasId: 'corridor_2d_demo',
            frame: entity.type === 'RemotePlayer' ? 'player_remote_0' : 'player_idle_0',
            layer: 'entities2D',
            width: 1.6,
            height: 1.8,
            tint: 0xffffff,
            visible: true,
            pivotY: 0.5,
          } satisfies SpriteComponentData,
        });
      }

      if (!entity.hasComponent('animation2d')) {
        entity.addComponent({
          name: 'animation2d',
          data: {
            state: 'idle',
            playing: true,
            speed: 1,
            clips: {
              idle: { id: 'idle', fps: 3, loop: true, frames: entity.type === 'RemotePlayer' ? ['player_remote_0', 'player_remote_0'] : ['player_idle_0', 'player_idle_1'] },
              run: { id: 'run', fps: 8, loop: true, frames: entity.type === 'RemotePlayer' ? ['player_remote_0', 'player_remote_0'] : ['player_run_0', 'player_run_1'] },
            },
          } satisfies AnimationComponentData,
        });
      }

      if (entity.hasComponent('localPlayer') && !entity.hasComponent('physics2d')) {
        entity.addComponent({
          name: 'physics2d',
          data: { width: 0.9, height: 0.9, dynamic: true, solid: true, maxSpeed: 6, velocityX: 0, velocityY: 0 } satisfies Record<string, unknown>,
        });
      }

      if (entity.hasComponent('localPlayer') && !entity.hasComponent('input2d')) {
        entity.addComponent({
          name: 'input2d',
          data: { enabled: true, localControlled: true, moveSpeed: 6 },
        });
      }
    }
  }

  private emitMetricsIfChanged(): void {
    if (
      this.spriteCount === this.lastReportedMetrics.spriteCount
      && this.batchCount === this.lastReportedMetrics.batchCount
      && this.drawCalls === this.lastReportedMetrics.drawCalls
      && this.selectedEntityId === this.lastReportedMetrics.selectedEntityId
    ) {
      return;
    }

    this.lastReportedMetrics = {
      spriteCount: this.spriteCount,
      batchCount: this.batchCount,
      drawCalls: this.drawCalls,
      selectedEntityId: this.selectedEntityId,
    };
    gameBus.emit('stateMutation', {
      source: 'spriteRenderSystem',
      path: '2d.spriteRender.metrics',
      changedCount: 1,
    });
  }

  dispose(): void {
    // Clear all sprite batches
    for (const batch of this.batches.values()) {
      const mesh = batch.getMesh();
      if (mesh) {
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material)?.dispose();
      }
    }
    this.batches.clear();
    // Clear scenes
    this.scenes.world2D.clear();
    this.scenes.entities2D.clear();
    // Reset state
    this.spriteCount = 0;
    this.batchCount = 0;
    this.drawCalls = 0;
    this.selectedEntityId = null;
  }
}
