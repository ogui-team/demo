import * as THREE from 'three';
import { SpriteBatch2D } from '../../../../4-runtime/ui/2d/SpriteBatch2D';
import type { ParallaxLayer2D, SpriteAtlas2D, TwoDRenderPass } from '../../../../4-runtime/ui/2d/TwoDTypes';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

type AtlasLookup = {
	getAtlas(id: string): SpriteAtlas2D | null;
	noteUsage(atlasId: string, count: number): void;
};

export class ParallaxSystem {
	private readonly scene = new THREE.Scene();
	private readonly layers: ParallaxLayer2D[] = [
		{ id: 'hills_far', atlasId: 'corridor_2d_demo', frame: 'parallax_hills', factorX: 0.15, factorY: 0.05, y: 3, width: 28, height: 10, tint: 0xa8c6ff },
		{ id: 'hills_mid', atlasId: 'corridor_2d_demo', frame: 'parallax_hills', factorX: 0.28, factorY: 0.1, y: -1, width: 34, height: 12, tint: 0x7ea0d6 },
	];
	private readonly batches = new Map<string, SpriteBatch2D>();
	private systemContext: SystemContext | null = null;
	private lastRenderedLayerCount = -1;

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
				layerCount: this.layers.length,
			},
		};
	}

	update(): void {
		const atlasSystem = this.systemContext?.systems.spriteAtlasSystem as AtlasLookup | undefined;
		const camera2D = this.systemContext?.systems.camera2DSystem as { getBounds(): { left: number; right: number; top: number; bottom: number } } | undefined;
		if (!atlasSystem || !camera2D) return;
		const bounds = camera2D.getBounds();
		let renderedLayerCount = 0;

		for (const layer of this.layers) {
			const atlas = atlasSystem.getAtlas(layer.atlasId);
			const frame = atlas?.frames[layer.frame];
			if (!atlas || !frame) continue;
			let batch = this.batches.get(layer.id);
			if (!batch) {
				batch = new SpriteBatch2D(atlas.texture, 3);
				this.batches.set(layer.id, batch);
				this.scene.add(batch.getMesh());
			}
			batch.setTexture(atlas.texture);
			const uvRect = {
				x: frame.x / atlas.width,
				y: frame.y / atlas.height,
				width: frame.width / atlas.width,
				height: frame.height / atlas.height,
			};
			const centerX = (bounds.left + bounds.right) / 2;
			const sprites = [-1, 0, 1].map((offset) => ({
				x: centerX * layer.factorX + offset * layer.width,
				y: layer.y + bounds.bottom * layer.factorY,
				z: -20 + offset * 0.001,
				width: layer.width,
				height: layer.height,
				uvRect,
				tint: layer.tint ?? 0xffffff,
				opacity: 0.95,
			}));
			atlasSystem.noteUsage(layer.atlasId, sprites.length);
			batch.updateSprites(sprites);
			renderedLayerCount += 1;
		}

		if (renderedLayerCount !== this.lastRenderedLayerCount) {
			this.lastRenderedLayerCount = renderedLayerCount;
			gameBus.emit('stateMutation', {
				source: 'parallaxSystem',
				path: '2d.parallax.layers',
				changedCount: 1,
			});
		}
	}

	getRenderPasses(): TwoDRenderPass[] {
		const camera2D = this.systemContext?.systems.camera2DSystem as { getWorldCamera(): THREE.Camera } | undefined;
		if (!camera2D) return [];
		return [{ layer: 'background', scene: this.scene, camera: camera2D.getWorldCamera() }];
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
		// Dispose scene
		this.scene.clear();
	}
}

