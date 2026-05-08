import * as THREE from 'three';
import { getScene } from './Scene';
import { getRenderer } from './Renderer';
import { onEngineUpdate } from '../../0-foundation/foundation/Engine';
import { FogEffects } from './effects/FogEffects';
import { LightingEffects } from './effects/LightingEffects';
import { PostProcessing } from './postprocessing/PostProcessing';
import { CameraEffects } from './effects/CameraEffects';
import { RenderingEffects } from './RenderingEffects';
import { runtimeFrameCostProfiler } from '../../4-runtime/diagnostics/debug/FrameCostProfiler';

/**
 * Atmospheric Effects module
 * Orchestrates all visual atmosphere systems
 */

interface AtmosphericConfig {
  enableDynamicFog?: boolean;
  enableLightingEffects?: boolean;
  enablePostProcessing?: boolean;
  enableCameraEffects?: boolean;
  enableRenderingEffects?: boolean;
}

class AtmosphereManager {
  private fogEffects: FogEffects | null = null;
  private lightingEffects: LightingEffects | null = null;
  private postProcessing: PostProcessing | null = null;
  private cameraEffects: CameraEffects | null = null;
  private renderingEffects: RenderingEffects | null = null;
  private updateUnsubscribes: (() => void)[] = [];

  private postProcessingEnabled: boolean = true;
  private fogEnabled: boolean = true;
  private lightingEnabled: boolean = true;
  private cameraEnabled: boolean = true;

  init(config: AtmosphericConfig = {}): void {
    const {
      enableDynamicFog = false,
      enableLightingEffects = false,
      enablePostProcessing = false,
      enableCameraEffects = false,
      enableRenderingEffects = false,
    } = config;

    const scene = getScene();
    const renderer = getRenderer();

    if (!scene || !renderer) {
      console.error('Cannot initialize atmospheric effects: scene or renderer not ready');
      return;
    }

    // Initialize fog effects
    if (enableDynamicFog) {
      this.fogEffects = new FogEffects(scene);
    }

    // Initialize lighting effects
    if (enableLightingEffects) {
      this.lightingEffects = new LightingEffects(scene);
    }

    // Initialize post-processing
    if (enablePostProcessing) {
      this.postProcessing = new PostProcessing(renderer, scene);
    }

    // Initialize camera effects
    if (enableCameraEffects) {
      this.cameraEffects = new CameraEffects();
    }

    // Initialize rendering effects
    if (enableRenderingEffects) {
      this.renderingEffects = new RenderingEffects(renderer);
    }

    // Register update callback
    const unsubscribe = onEngineUpdate((deltaTime: number) => {
      this.update(deltaTime);
    });
    this.updateUnsubscribes.push(unsubscribe);

    console.log('Atmospheric effects initialized');
  }

  private update(deltaTime: number): void {
    if (this.fogEffects) runtimeFrameCostProfiler.measure('update:atmosphere.fog', () => this.fogEffects?.update(deltaTime));
    if (this.lightingEffects) runtimeFrameCostProfiler.measure('update:atmosphere.lighting', () => this.lightingEffects?.update(deltaTime));
    if (this.postProcessing) runtimeFrameCostProfiler.measure('update:atmosphere.postProcessing', () => this.postProcessing?.update(deltaTime));
    if (this.cameraEffects) runtimeFrameCostProfiler.measure('update:atmosphere.camera', () => this.cameraEffects?.update(deltaTime));
    if (this.renderingEffects) runtimeFrameCostProfiler.measure('update:atmosphere.rendering', () => this.renderingEffects?.update(deltaTime));
  }

  destroy(): void {
    this.updateUnsubscribes.forEach((unsub) => unsub());
    if (this.postProcessing) this.postProcessing.destroy();
    if (this.fogEffects) this.fogEffects.destroy();
    if (this.lightingEffects) this.lightingEffects.destroy();
    if (this.cameraEffects) this.cameraEffects.destroy();
    if (this.renderingEffects) this.renderingEffects.destroy();
  }

  // Getters for direct access if needed
  getFogEffects(): FogEffects | null {
    return this.fogEffects;
  }

  getLightingEffects(): LightingEffects | null {
    return this.lightingEffects;
  }

  getPostProcessing(): PostProcessing | null {
    return this.postProcessing;
  }

  getCameraEffects(): CameraEffects | null {
    return this.cameraEffects;
  }

  getRenderingEffects(): RenderingEffects | null {
    return this.renderingEffects;
  }

  setPostProcessingEnabled(enabled: boolean): void {
    this.postProcessingEnabled = enabled;
    this.postProcessing?.setEnabled(enabled);
  }

  isPostProcessingEnabled(): boolean {
    return this.postProcessingEnabled;
  }

  setFogEnabled(enabled: boolean): void {
    this.fogEnabled = enabled;
    this.fogEffects?.setEnabled(enabled);
  }

  isFogEnabled(): boolean {
    return this.fogEnabled;
  }

  setLightingEnabled(enabled: boolean): void {
    this.lightingEnabled = enabled;
    this.lightingEffects?.setEnabled(enabled);
  }

  isLightingEnabled(): boolean {
    return this.lightingEnabled;
  }

  setCameraEffectsEnabled(enabled: boolean): void {
    this.cameraEnabled = enabled;
    this.cameraEffects?.setEnabled(enabled);
  }

  isCameraEffectsEnabled(): boolean {
    return this.cameraEnabled;
  }

  setFilmGrainIntensity(intensity: number): void {
    this.postProcessing?.setFilmGrainIntensity(intensity);
  }

  setVignetteIntensity(intensity: number): void {
    this.postProcessing?.setVignetteIntensity(intensity);
  }
}

let atmosphereInstance: AtmosphereManager | null = null;

export function initAtmosphericEffects(
  config: AtmosphericConfig = {}
): AtmosphereManager {
  if (atmosphereInstance) {
    console.warn('Atmospheric effects already initialized');
    return atmosphereInstance;
  }

  atmosphereInstance = new AtmosphereManager();
  atmosphereInstance.init(config);

  return atmosphereInstance;
}

export function getAtmosphereManager(): AtmosphereManager | null {
  return atmosphereInstance;
}

export function destroyAtmosphericEffects(): void {
  if (atmosphereInstance) {
    atmosphereInstance.destroy();
    atmosphereInstance = null;
  }
}
