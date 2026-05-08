/**
 * VisualStyle
 * PS1-horror visual style system.
 *
 * Applies fog, pixelation, limited draw distance, and flat-shading to achieve
 * a PS1-era horror demake aesthetic. All effects are applied through this system
 * rather than by modifying individual entity meshes.
 *
 * Pixelation uses canvas CSS scaling (image-rendering: pixelated) — the renderer
 * draws at a low internal resolution; the browser stretches the canvas up using
 * nearest-neighbour interpolation. No render-target compositing required.
 *
 * Usage:
 *   import { initVisualStyle, PRESETS } from './systems/VisualStyle';
 *
 *   const style = initVisualStyle(scene, camera, renderer, PRESETS.ps1Horror);
 *   onUpdate((dt) => style.update(dt));          // fog pulsing, etc.
 *   window.addEventListener('resize', () => style.onResize());
 */

import * as THREE from 'three';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type FogType = 'exponential' | 'linear';

export interface FogParams {
  /** Whether scene fog is active. */
  enabled: boolean;
  /** 'exponential' = THREE.FogExp2; 'linear' = THREE.Fog. */
  type: FogType;
  /** Fog color as hex integer, e.g. 0x1a0808. */
  color: number;
  /** Exponential fog density (only used when type = 'exponential'). */
  density?: number;
  /** Linear fog near plane (only used when type = 'linear'). */
  near?: number;
  /** Linear fog far  plane (only used when type = 'linear'). Default = drawDistance. */
  far?: number;
}

export interface PixelationParams {
  /** Enable low-resolution pixelated rendering. */
  enabled: boolean;
  /** Internal render width in pixels (e.g. 320). */
  width: number;
  /** Internal render height in pixels (e.g. 240). */
  height: number;
}

export interface FogPulseParams {
  /** Whether the fog density pulses over time. */
  enabled: boolean;
  /** Peak-to-peak amplitude of density oscillation. */
  amplitude: number;
  /** Oscillations per second. */
  frequency: number;
}

export interface VisualStyleConfig {
  fog: FogParams;
  /** Maximum view distance in world units; sets camera.far */
  drawDistance: number;
  pixelation: PixelationParams;
  /** Apply flat-shading to every mesh in the scene for low-poly look. */
  flatShading: boolean;
  fogPulse: FogPulseParams;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const PRESETS: Readonly<Record<string, VisualStyleConfig>> = {
  /** Classic PS1 horror — dark exponential fog, heavy pixelation, flat shading. */
  ps1Horror: {
    fog:          { enabled: true, type: 'exponential', color: 0x1a0808, density: 0.08 },
    drawDistance: 60,
    pixelation:   { enabled: true, width: 320, height: 240 },
    flatShading:  true,
    fogPulse:     { enabled: true, amplitude: 0.012, frequency: 0.25 },
  },
  /** Underground dungeon — cooler fog, tight draw distance. */
  dungeon: {
    fog:          { enabled: true, type: 'exponential', color: 0x0a0a1a, density: 0.06 },
    drawDistance: 40,
    pixelation:   { enabled: true, width: 320, height: 240 },
    flatShading:  true,
    fogPulse:     { enabled: false, amplitude: 0.008, frequency: 0.2 },
  },
  /** Outdoor scene — linear horizon fog, longer draw distance. */
  outdoor: {
    fog:          { enabled: true, type: 'linear', color: 0x7aaed6, near: 40, far: 120 },
    drawDistance: 150,
    pixelation:   { enabled: false, width: 320, height: 240 },
    flatShading:  false,
    fogPulse:     { enabled: false, amplitude: 0, frequency: 0 },
  },
  /** No effects — useful for debugging or clean 3D mode. */
  none: {
    fog:          { enabled: false, type: 'exponential', color: 0x000000, density: 0 },
    drawDistance: 1000,
    pixelation:   { enabled: false, width: 1280, height: 720 },
    flatShading:  false,
    fogPulse:     { enabled: false, amplitude: 0, frequency: 0 },
  },
};

// ─── Default resolution to restore on pixelation disable ─────────────────────

interface NativeResolution { width: number; height: number }

// ─── VisualStyle class ────────────────────────────────────────────────────────

export class VisualStyle {
  private readonly scene:    THREE.Scene;
  private readonly camera:   THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas:   HTMLCanvasElement;

  private config: VisualStyleConfig;

  // Pixelation tracking
  private _pixelEnabled: boolean = false;
  private _nativeRes: NativeResolution = { width: window.innerWidth, height: window.innerHeight };

  // Fog pulsing runtime
  private _fogPulseTime: number = 0;
  private _fogBaseDensity: number = 0.08;

  constructor(
    scene:    THREE.Scene,
    camera:   THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    config:   Partial<VisualStyleConfig> = {},
  ) {
    this.scene    = scene;
    this.camera   = camera;
    this.renderer = renderer;
    this.canvas   = renderer.domElement;

    // Deep-merge supplied config over the ps1Horror preset
    this.config = this._mergeConfig(PRESETS.ps1Horror, config);
    this._apply(this.config);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Apply a named preset. */
  applyPreset(name: keyof typeof PRESETS): void {
    const preset = PRESETS[name as string];
    if (!preset) {
      console.warn(`[VisualStyle] Unknown preset '${name}'.`);
      return;
    }
    this.applyConfig(preset);
  }

  /** Apply a full config object (partial overrides are allowed). */
  applyConfig(cfg: Partial<VisualStyleConfig>): void {
    this.config = this._mergeConfig(this.config, cfg);
    this._apply(this.config);
  }

  // --- Fog ---

  setFog(params: Partial<FogParams>): void {
    this.config = this._mergeConfig(this.config, { fog: { ...this.config.fog, ...params } });
    this._applyFog(this.config.fog);
  }

  /** Enable slowly-pulsing exponential fog for a breathing, alive atmosphere. */
  setFogPulse(params: Partial<FogPulseParams>): void {
    this.config.fogPulse = { ...this.config.fogPulse, ...params };
    if (this.config.fog.type === 'exponential' && this.scene.fog instanceof THREE.FogExp2) {
      this._fogBaseDensity = this.scene.fog.density;
    }
  }

  // --- Draw distance --------------------------------------------------------

  /** Set camera far clip plane in world units. */
  setDrawDistance(far: number): void {
    this.config.drawDistance = far;
    this._applyDrawDistance(far);
  }

  // --- Pixelation -----------------------------------------------------------

  /**
   * Enable or reconfigure pixelated rendering.
   * The scene is rendered at `width × height` and scaled up via CSS
   * using nearest-neighbour interpolation — classic PS1 look.
   */
  setPixelation(width: number, height: number, enabled: boolean = true): void {
    this.config.pixelation = { enabled, width, height };
    this._applyPixelation(this.config.pixelation);
  }

  // --- Flat shading ---------------------------------------------------------

  /**
   * Traverse the whole scene and apply (or remove) flat shading on every mesh.
   * Safe to call multiple times — idempotent.
   */
  setFlatShading(enabled: boolean): void {
    this.config.flatShading = enabled;
    this._traverseApplyFlatShading(this.scene, enabled);
  }

  /**
   * Apply flat shading to a single mesh.
   * Call this from entity creation code to ensure newly spawned meshes match
   * the style without re-traversing the entire scene.
   */
  applyFlatShadingToMesh(mesh: THREE.Mesh): void {
    this._setFlatOnMesh(mesh, this.config.flatShading);
  }

  // --- Update ---------------------------------------------------------------

  /**
   * Call once per frame from the engine update loop.
   * Drives fog pulsing and any future per-frame visual effects.
   *
   * @param deltaTime  Seconds since last frame.
   */
  update(deltaTime: number): void {
    const pulse = this.config.fogPulse;
    if (
      pulse.enabled &&
      this.config.fog.type === 'exponential' &&
      this.scene.fog instanceof THREE.FogExp2
    ) {
      this._fogPulseTime += deltaTime;
      this.scene.fog.density =
        this._fogBaseDensity +
        Math.sin(this._fogPulseTime * pulse.frequency * Math.PI * 2) * pulse.amplitude;
    }
  }

  // --- Resize ---------------------------------------------------------------

  /**
   * Call on window resize.
   * When pixelation is active the internal resolution stays fixed; only the
   * CSS scale changes, which is handled automatically by the 100vw/100vh style.
   * When pixelation is disabled the renderer is resized to the full window.
   */
  onResize(width?: number, height?: number): void {
    const w = width  ?? window.innerWidth;
    const h = height ?? window.innerHeight;

    this._nativeRes = { width: w, height: h };

    if (!this._pixelEnabled) {
      this.renderer.setSize(w, h, true);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // Pixelated: canvas CSS auto-fills viewport; internal resolution unchanged.
  }

  // --- Config access --------------------------------------------------------

  getConfig(): Readonly<VisualStyleConfig> {
    return this.config;
  }

  isPixelated(): boolean {
    return this._pixelEnabled;
  }

  // --- Cleanup --------------------------------------------------------------

  dispose(): void {
    if (this._pixelEnabled) this._disablePixelation();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private _apply(cfg: VisualStyleConfig): void {
    this._applyFog(cfg.fog);
    this._applyDrawDistance(cfg.drawDistance);
    this._applyPixelation(cfg.pixelation);
    if (cfg.flatShading) this._traverseApplyFlatShading(this.scene, true);
    // Seed fog pulse baseline
    if (cfg.fog.type === 'exponential') {
      this._fogBaseDensity = cfg.fog.density ?? 0.08;
      this._fogPulseTime   = 0;
    }
  }

  // --- Fog -----------------------------------------------------------------

  private _applyFog(params: FogParams): void {
    if (!params.enabled) {
      this.scene.fog = null;
      return;
    }

    if (params.type === 'linear') {
      this.scene.fog = new THREE.Fog(
        params.color,
        params.near ?? 10,
        params.far  ?? this.config.drawDistance,
      );
    } else {
      const density = params.density ?? 0.08;
      this.scene.fog = new THREE.FogExp2(params.color, density);
      this._fogBaseDensity = density;
    }

    // Match scene background to fog color for seamless horizon
    this.scene.background = new THREE.Color(params.color);
  }

  // --- Draw distance -------------------------------------------------------

  private _applyDrawDistance(far: number): void {
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  // --- Pixelation ----------------------------------------------------------

  private _applyPixelation(params: PixelationParams): void {
    if (params.enabled) {
      this._enablePixelation(params.width, params.height);
    } else {
      this._disablePixelation();
    }
  }

  private _enablePixelation(w: number, h: number): void {
    // Store current native resolution before we change things
    this._nativeRes = {
      width:  window.innerWidth,
      height: window.innerHeight,
    };

    // Draw at the target (low) resolution — do NOT update CSS size.
    this.renderer.setSize(w, h, /* updateStyle = */ false);

    // Stretch the canvas to fill the viewport using pixelated interpolation.
    this.canvas.style.width           = '100vw';
    this.canvas.style.height          = '100vh';
    this.canvas.style.imageRendering  = 'pixelated';

    // Fix camera aspect for the low-res dimensions
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this._pixelEnabled = true;
  }

  private _disablePixelation(): void {
    if (!this._pixelEnabled) return;

    const { width, height } = this._nativeRes;
    this.renderer.setSize(width, height, /* updateStyle = */ true);

    this.canvas.style.width          = '';
    this.canvas.style.height         = '';
    this.canvas.style.imageRendering = '';

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this._pixelEnabled = false;
  }

  // --- Flat shading helpers ------------------------------------------------

  private _traverseApplyFlatShading(root: THREE.Object3D, enabled: boolean): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) this._setFlatOnMesh(obj, enabled);
    });
  }

  private _setFlatOnMesh(mesh: THREE.Mesh, flatShading: boolean): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if ('flatShading' in mat) {
        (mat as THREE.MeshLambertMaterial).flatShading = flatShading;
        mat.needsUpdate = true;
      }
    }
  }

  // --- Config merge --------------------------------------------------------

  private _mergeConfig(
    base: VisualStyleConfig,
    overrides: Partial<VisualStyleConfig>,
  ): VisualStyleConfig {
    return {
      fog:          { ...base.fog,          ...overrides.fog },
      drawDistance: overrides.drawDistance  ?? base.drawDistance,
      pixelation:   { ...base.pixelation,   ...overrides.pixelation },
      flatShading:  overrides.flatShading   ?? base.flatShading,
      fogPulse:     { ...base.fogPulse,     ...overrides.fogPulse },
    };
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _instance: VisualStyle | null = null;

/**
 * Create and store a singleton VisualStyle instance.
 * Subsequent calls to `getVisualStyle()` return the same instance.
 */
export function initVisualStyle(
  scene:    THREE.Scene,
  camera:   THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  config?:  Partial<VisualStyleConfig>,
): VisualStyle {
  _instance = new VisualStyle(scene, camera, renderer, config);
  return _instance;
}

/** Retrieve the singleton VisualStyle created by `initVisualStyle`. */
export function getVisualStyle(): VisualStyle | null {
  return _instance;
}
