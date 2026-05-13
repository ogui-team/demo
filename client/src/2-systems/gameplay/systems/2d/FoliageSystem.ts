import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { BatchedSprite2D } from '../../../../4-runtime/ui/2d/SpriteBatch2D';
import type { TwoDRenderPass } from '../../../../4-runtime/ui/2d/TwoDTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FoliageInstanceData {
  x: number;
  y: number;
  atlasId: string;
  frame: string;
  width?: number;
  height?: number;
  tint?: number;
}

// ---------------------------------------------------------------------------
// FoliageBatch — owns geometry buffers only; material is owned by MaterialManager
// ---------------------------------------------------------------------------

class FoliageBatch {
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly positionAttr: THREE.InstancedBufferAttribute;
  private readonly scaleAttr: THREE.InstancedBufferAttribute;
  private readonly uvAttr: THREE.InstancedBufferAttribute;
  private readonly tintAttr: THREE.InstancedBufferAttribute;
  private readonly opacityAttr: THREE.InstancedBufferAttribute;
  private readonly rotationAttr: THREE.InstancedBufferAttribute;
  private readonly capacity: number;

  constructor(material: THREE.ShaderMaterial, capacity = 2048) {
    this.material = material;
    this.capacity = capacity;

    const base = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.attributes.position = base.attributes.position;
    this.geometry.attributes.uv = base.attributes.uv;

    this.positionAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.scaleAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.uvAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.rotationAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);

    this.geometry.setAttribute('iTranslate', this.positionAttr);
    this.geometry.setAttribute('iScale', this.scaleAttr);
    this.geometry.setAttribute('iUvRect', this.uvAttr);
    this.geometry.setAttribute('iTint', this.tintAttr);
    this.geometry.setAttribute('iOpacity', this.opacityAttr);
    this.geometry.setAttribute('iRotation', this.rotationAttr);
    this.geometry.instanceCount = 0;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18; // below entity sprites (order 20)
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  setTexture(texture: THREE.Texture): void {
    this.material.uniforms.uAtlas.value = texture;
  }

  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  updateSprites(sprites: BatchedSprite2D[]): void {
    const count = Math.min(sprites.length, this.capacity);
    for (let i = 0; i < count; i++) {
      const sprite = sprites[i];
      const tint = new THREE.Color(sprite.tint ?? 0xffffff);
      this.positionAttr.setXYZ(i, sprite.x, sprite.y, sprite.z ?? 0);
      this.scaleAttr.setXY(i, sprite.width, sprite.height);
      this.uvAttr.setXYZW(i, sprite.uvRect.x, sprite.uvRect.y, sprite.uvRect.width, sprite.uvRect.height);
      this.tintAttr.setXYZ(i, tint.r, tint.g, tint.b);
      this.opacityAttr.setX(i, sprite.opacity ?? 1);
      this.rotationAttr.setX(i, sprite.rotation ?? 0);
    }
    this.positionAttr.needsUpdate = true;
    this.scaleAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
    this.rotationAttr.needsUpdate = true;
    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
  }

  /** Disposes geometry buffers only. Material lifetime is managed by MaterialManager. */
  dispose(): void {
    this.geometry.dispose();
    this.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Atlas + camera accessor duck-types (resolved via systemContext at runtime)
// ---------------------------------------------------------------------------

type AtlasLookup = {
  getAtlas(id: string): { texture: THREE.Texture; width: number; height: number; frames: Record<string, { x: number; y: number; width: number; height: number }> } | null;
};

type Camera2DSystemAccessor = {
  getWorldCamera(): THREE.OrthographicCamera;
  getBounds(): { left: number; right: number; top: number; bottom: number };
};

type MaterialManagerAccessor = {
  createFoliageWindMaterial(texture: THREE.Texture): THREE.ShaderMaterial;
};

// ---------------------------------------------------------------------------
// FoliageSystem
// ---------------------------------------------------------------------------

export class FoliageSystem {
  private readonly scene = new THREE.Scene();
  private readonly batches = new Map<string, FoliageBatch>();
  private instances: FoliageInstanceData[] = [];
  private systemContext: SystemContext | null = null;
  private visibleCount = 0;
  private lastVisibleCount = -1;

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  // ---------------------------------------------------------------------------
  // Instance management — no entities, pure internal buffer
  // ---------------------------------------------------------------------------

  addFoliage(instance: FoliageInstanceData): void {
    this.instances.push(instance);
  }

  clearFoliage(): void {
    this.instances = [];
    for (const batch of this.batches.values()) {
      batch.updateSprites([]);
    }
    this.visibleCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Update — viewport cull → build sprite buffer → push to batches
  // ---------------------------------------------------------------------------

  update(): void {
    const atlasSystem = this.systemContext?.systems.spriteAtlasSystem as AtlasLookup | undefined;
    const camera2D = this.systemContext?.systems.camera2DSystem as Camera2DSystemAccessor | undefined;
    const materialManager = this.systemContext?.systems.materialManager as MaterialManagerAccessor | undefined;

    if (!atlasSystem || !camera2D || !materialManager) return;

    const bounds = camera2D.getBounds();
    const worldCamera = camera2D.getWorldCamera();
    const engineTime = typeof Engine !== 'undefined' ? Engine.time.seconds() : performance.now() / 1000;

    // Bucket visible instances per atlasId
    const grouped = new Map<string, BatchedSprite2D[]>();

    for (const instance of this.instances) {
      const w = instance.width ?? 1;
      const h = instance.height ?? 1.5;
      const pad = Math.max(w, h);

      // Viewport cull — skip if outside camera bounds + padding
      if (
        instance.x + pad < bounds.left
        || instance.x - pad > bounds.right
        || instance.y + pad < bounds.bottom
        || instance.y - pad > bounds.top
      ) {
        continue;
      }

      const atlas = atlasSystem.getAtlas(instance.atlasId);
      const frameData = atlas?.frames[instance.frame];
      if (!atlas || !frameData) continue;

      const uvRect = {
        x: frameData.x / atlas.width,
        y: frameData.y / atlas.height,
        width: frameData.width / atlas.width,
        height: frameData.height / atlas.height,
      };

      const spriteZ = -3 - instance.y * 0.0001;

      const existing = grouped.get(instance.atlasId) ?? [];

      // Sprite A — rotation 0°
      existing.push({
        x: instance.x,
        y: instance.y,
        z: spriteZ,
        width: w,
        height: h,
        rotation: 0,
        uvRect,
        tint: instance.tint ?? 0xffffff,
        opacity: 1,
      });

      // Sprite B — rotation 90° (X-shape cross)
      existing.push({
        x: instance.x,
        y: instance.y,
        z: spriteZ,
        width: w,
        height: h,
        rotation: Math.PI * 0.5,
        uvRect,
        tint: instance.tint ?? 0xffffff,
        opacity: 1,
      });

      grouped.set(instance.atlasId, existing);
    }

    // Flush visible sprites to batches
    this.visibleCount = 0;

    for (const [atlasId, sprites] of grouped) {
      const atlas = atlasSystem.getAtlas(atlasId);
      if (!atlas) continue;

      let batch = this.batches.get(atlasId);
      if (!batch) {
        const material = materialManager.createFoliageWindMaterial(atlas.texture);
        batch = new FoliageBatch(material, Math.max(512, sprites.length * 2 + 64));
        this.scene.add(batch.getMesh());
        this.batches.set(atlasId, batch);
      }

      batch.setTexture(atlas.texture);
      batch.setTime(engineTime);
      batch.updateSprites(sprites);
      this.visibleCount += sprites.length;
    }

    // Zero out batches whose atlasId is no longer in view
    for (const [atlasId, batch] of this.batches) {
      if (!grouped.has(atlasId)) {
        batch.updateSprites([]);
      }
    }

    this.emitMetricsIfChanged(worldCamera);
  }

  // ---------------------------------------------------------------------------
  // Render integration — PS1RenderingPipeline picks this up via listSystems()
  // ---------------------------------------------------------------------------

  getRenderPasses(): TwoDRenderPass[] {
    const camera2D = this.systemContext?.systems.camera2DSystem as Camera2DSystemAccessor | undefined;
    if (!camera2D) return [];
    return [{ layer: 'world2D', scene: this.scene, camera: camera2D.getWorldCamera() }];
  }

  // ---------------------------------------------------------------------------
  // Standard system interface
  // ---------------------------------------------------------------------------

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        totalInstances: this.instances.length,
        visibleInstances: Math.round(this.visibleCount / 2), // 2 sprites per instance
        batchCount: this.batches.size,
        drawCalls: [...this.batches.values()].filter((b) => b.getMesh().visible).length,
      },
    };
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      batch.dispose();
    }
    this.batches.clear();
    this.scene.clear();
    this.instances = [];
    this.systemContext = null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private emitMetricsIfChanged(_worldCamera: THREE.OrthographicCamera): void {
    if (this.visibleCount === this.lastVisibleCount) return;
    this.lastVisibleCount = this.visibleCount;
    gameBus.emit('stateMutation', {
      source: 'foliageSystem',
      path: '2d.foliage.metrics',
      changedCount: 1,
    });
  }
}
