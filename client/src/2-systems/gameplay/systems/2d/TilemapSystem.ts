import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { SpriteBatch2D, type BatchedSprite2D } from '../../../../4-runtime/ui/2d/SpriteBatch2D';
import type { SpriteAtlas2D, TilemapComponentData, TilemapLayer2D, TwoDRenderPass } from '../../../../4-runtime/ui/2d/TwoDTypes';
import { gameBus } from '@engine/1-kernel/core/public-api';

interface TilemapEntity {
  id: string;
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
  getPosition(): { x: number; y: number; z: number };
}

interface TilemapEntityManager {
  getEntities(): Iterable<TilemapEntity>;
  getEntity(id: string): TilemapEntity | undefined;
}

type AtlasLookup = {
  getAtlas(id: string): SpriteAtlas2D | null;
  getFrame(atlasId: string, frameId: string): { x: number; y: number; width: number; height: number } | null;
  noteUsage(atlasId: string, count: number): void;
};

export class TilemapSystem {
  private readonly entityManager: TilemapEntityManager;
  private readonly scenes = {
    background: new THREE.Scene(),
    world2D: new THREE.Scene(),
  };
  private readonly batches = new Map<string, SpriteBatch2D>();
  private systemContext: SystemContext | null = null;
  private tileCount = 0;
  private mapCount = 0;
  private selectedMapId: string | null = null;
  private lastReportedMetrics = {
    tileCount: -1,
    mapCount: -1,
    selectedMapId: null as string | null,
  };

  constructor(entityManager: TilemapEntityManager) {
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
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        mapCount: this.mapCount,
        tileCount: this.tileCount,
        selectedMapId: this.selectedMapId,
      },
    };
  }

  update(): void {
    const atlasSystem = this.systemContext?.systems.spriteAtlasSystem as AtlasLookup | undefined;
    if (!atlasSystem) return;
    this.tileCount = 0;
    this.mapCount = 0;
    const layersByPass = new Map<string, BatchedSprite2D[]>();
    const tilemaps = Array.from(this.entityManager.getEntities()).filter((entity) => entity.hasComponent('tilemap'));
    if (!this.selectedMapId && tilemaps[0]) this.selectedMapId = tilemaps[0].id;

    for (const entity of tilemaps) {
      const component = entity.getComponent('tilemap')?.data as TilemapComponentData | undefined;
      if (!component) continue;
      if (component.visible === false) continue;
      this.mapCount += 1;
      const transform = entity.getPosition();
      for (const layer of component.layers) {
        const atlas = atlasSystem.getAtlas(layer.atlasId);
        if (!atlas) continue;
        const bucketKey = `${layer.renderLayer ?? 'background'}:${layer.atlasId}`;
        const bucket = layersByPass.get(bucketKey) ?? [];
        this.compileLayer(layer, atlas, transform.x, transform.z, bucket);
        atlasSystem.noteUsage(layer.atlasId, bucket.length);
        layersByPass.set(bucketKey, bucket);
      }
    }

    for (const [key, sprites] of layersByPass) {
      const [renderLayer, atlasId] = key.split(':');
      const batchKey = `${renderLayer}:${atlasId}`;
      const atlas = atlasSystem.getAtlas(atlasId);
      if (!atlas) continue;
      let batch = this.batches.get(batchKey);
      if (!batch) {
        batch = new SpriteBatch2D(atlas.texture, Math.max(1024, sprites.length + 16));
        this.batches.set(batchKey, batch);
        const scene = renderLayer === 'background' ? this.scenes.background : this.scenes.world2D;
        scene.add(batch.getMesh());
      }
      batch.setTexture(atlas.texture);
      batch.updateSprites(sprites);
    }

    this.emitMetricsIfChanged();
  }

  getRenderPasses(): TwoDRenderPass[] {
    const camera2D = this.systemContext?.systems.camera2DSystem as { getWorldCamera(): THREE.Camera } | undefined;
    if (!camera2D) return [];
    return [
      { layer: 'background', scene: this.scenes.background, camera: camera2D.getWorldCamera() },
      { layer: 'world2D', scene: this.scenes.world2D, camera: camera2D.getWorldCamera() },
    ];
  }

  isSolidAtWorld(x: number, y: number): boolean {
    for (const entity of this.entityManager.getEntities()) {
      const component = entity.getComponent('tilemap')?.data as TilemapComponentData | undefined;
      if (!component) continue;
      const transform = entity.getPosition();
      for (const layer of component.layers) {
        const localX = x - transform.x;
        const localY = y - transform.z;
        const tileX = Math.floor(localX / layer.tileSize);
        const tileY = Math.floor(localY / layer.tileSize);
        if (tileX < 0 || tileY < 0 || tileX >= layer.width || tileY >= layer.height) continue;
        const frame = layer.tiles[tileY * layer.width + tileX];
        if (frame && layer.solidFrames?.includes(frame)) {
          return true;
        }
      }
    }
    return false;
  }

  getDebugPanel(): HTMLElement | null {
    const root = document.createElement('div');
    root.style.cssText = 'margin-top:18px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);';
    root.innerHTML = '<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:10px;letter-spacing:1.5px;color:#9ea7ad;">Tilemap Inspector</div>';
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;font-size:11px;color:#9ea7ad;line-height:1.6;';
    root.appendChild(body);
    const entity = this.selectedMapId ? this.entityManager.getEntity(this.selectedMapId) : null;
    const component = entity?.getComponent('tilemap')?.data as TilemapComponentData | undefined;
    body.textContent = component
      ? `Map: ${entity?.id} | Layers: ${component.layers.length} | Tiles: ${component.layers.reduce((count, layer) => count + layer.tiles.length, 0)}`
      : 'No tilemap selected';
    return root;
  }

  private compileLayer(layer: TilemapLayer2D, atlas: SpriteAtlas2D, originX: number, originY: number, out: BatchedSprite2D[]): void {
    for (let row = 0; row < layer.height; row += 1) {
      for (let column = 0; column < layer.width; column += 1) {
        const frameId = layer.tiles[row * layer.width + column];
        if (!frameId) continue;
        const frame = atlas.frames[frameId];
        if (!frame) continue;
        const uvRect = {
          x: frame.x / atlas.width,
          y: frame.y / atlas.height,
          width: frame.width / atlas.width,
          height: frame.height / atlas.height,
        };
        out.push({
          x: originX + column * layer.tileSize + layer.tileSize / 2,
          y: originY + row * layer.tileSize + layer.tileSize / 2,
          z: (layer.renderLayer === 'background' ? -5 : -1),
          width: layer.tileSize,
          height: layer.tileSize,
          uvRect,
          opacity: 1,
          tint: 0xffffff,
        });
        this.tileCount += 1;
      }
    }
  }

  private emitMetricsIfChanged(): void {
    if (
      this.tileCount === this.lastReportedMetrics.tileCount
      && this.mapCount === this.lastReportedMetrics.mapCount
      && this.selectedMapId === this.lastReportedMetrics.selectedMapId
    ) {
      return;
    }

    this.lastReportedMetrics = {
      tileCount: this.tileCount,
      mapCount: this.mapCount,
      selectedMapId: this.selectedMapId,
    };
    gameBus.emit('stateMutation', {
      source: 'tilemapSystem',
      path: '2d.tilemap.metrics',
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
    this.scenes.background.clear();
    this.scenes.world2D.clear();
    // Reset state
    this.tileCount = 0;
    this.mapCount = 0;
    this.selectedMapId = null;
  }
}
