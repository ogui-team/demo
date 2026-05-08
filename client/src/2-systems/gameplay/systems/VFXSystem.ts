import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { VFXMaker, VFX_PRESETS, type ParticleEmitterConfig } from './VFXMaker';

export class VFXSystem {
  private readonly scene: THREE.Scene;
  private readonly vfxMaker: VFXMaker;
  private systemContext: SystemContext | null = null;
  private emitterCounter = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera | null = null) {
    this.scene = scene;
    this.vfxMaker = new VFXMaker(scene, camera);
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
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
      status: 'active',
      active: true,
      metrics: {
        emitterCount: this.vfxMaker.getEmitterCount(),
        sceneChildren: this.scene.children.length,
      },
    };
  }

  setCamera(camera: THREE.Camera | null): void {
    this.vfxMaker.setCamera(camera);
  }

  createEmitter(config: ParticleEmitterConfig, id?: string): string {
    return this.vfxMaker.createEmitter(id ?? this.nextEmitterId(), config);
  }

  playPreset(preset: keyof typeof VFX_PRESETS, origin: { x: number; y: number; z: number }, id?: string): string {
    return this.vfxMaker.triggerPreset(id ?? this.nextEmitterId(), preset, origin);
  }

  hasEmitter(id: string): boolean {
    return this.vfxMaker.hasEmitter(id);
  }

  getEmitterMesh(id: string): THREE.InstancedMesh | null {
    return this.vfxMaker.getEmitterMesh(id);
  }

  update(dt: number): void {
    this.vfxMaker.update(dt);
  }

  clear(): void {
    this.vfxMaker.clear();
  }

  dispose(): void {
    this.clear();
  }

  private nextEmitterId(): string {
    this.emitterCounter += 1;
    return `vfx_emitter_${this.emitterCounter}`;
  }
}