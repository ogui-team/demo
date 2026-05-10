import * as THREE from 'three';
import { listSystems } from '@engine/1-kernel/core/public-api';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';
import type { TwoDRenderLayer, TwoDRenderPass, TwoDRenderPassProvider } from '../../4-runtime/ui/2d/TwoDTypes';

/**
 * PS1 Rendering Pipeline
 * Comprehensive post-processing and rendering effects for PS1-style aesthetics
 * Includes:
 * - Resolution scaling (internal render to lower res, upscale to screen)
 * - Color quantization (reduce color depth)
 * - Dithering (simulates old rendering)
 * - Vertex jitter (unstable geometry)
 * - Depth-based fog integration
 * - Lighting simplification
 */

interface PS1PipelineConfig {
  // Resolution scaling
  enableResolutionScaling?: boolean;
  internalResolutionScale?: number; // 0.5 = half resolution

  // Color quantization
  enableColorQuantization?: boolean;
  colorBits?: number; // Bits per channel (e.g., 5 for 15-bit color)

  // Dithering
  enableDithering?: boolean;
  ditheringIntensity?: number;

  // Vertex jitter
  enableVertexJitter?: boolean;
  jitterAmount?: number;

  // Fog
  enableDepthFog?: boolean;
  fogIntensity?: number;

  // Film grain
  enableFilmGrain?: boolean;
  filmGrainIntensity?: number;

  // Vignette
  enableVignette?: boolean;
  vignetteIntensity?: number;
}

export class PS1RenderingPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Configuration
  private config: Required<PS1PipelineConfig>;

  // Render targets for resolution scaling
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private scaledRenderTarget: THREE.WebGLRenderTarget | null = null;

  // Post-processing materials
  private compositeShaderMaterial: THREE.ShaderMaterial | null = null;
  private compositeMesh: THREE.Mesh | null = null;
  private compositeScene: THREE.Scene | null = null;
  private compositeCamera: THREE.OrthographicCamera | null = null;

  // Tracking
  private time: number = 0;
  private enabled: boolean = true;

  private static readonly EXTERNAL_LAYER_ORDER: Record<TwoDRenderLayer, number> = {
    background: 0,
    world2D: 1,
    entities2D: 2,
    ui2D: 3,
  };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    config: PS1PipelineConfig = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const mode = getRuntimePerformanceMode();
    const stableOrRelease = mode !== RuntimePerformanceMode.DEV;

    // Set defaults
    this.config = {
      enableResolutionScaling: config.enableResolutionScaling !== false,
      internalResolutionScale: config.internalResolutionScale ?? (stableOrRelease ? 0.35 : 0.5),
      enableColorQuantization: config.enableColorQuantization !== false,
      colorBits: config.colorBits ?? 5,
      enableDithering: config.enableDithering !== false,
      ditheringIntensity: config.ditheringIntensity ?? (stableOrRelease ? 0.12 : 0.3),
      enableVertexJitter: config.enableVertexJitter !== false,
      jitterAmount: config.jitterAmount ?? 0.002,
      enableDepthFog: config.enableDepthFog !== false,
      fogIntensity: config.fogIntensity ?? 0.8,
      enableFilmGrain: config.enableFilmGrain ?? !stableOrRelease,
      filmGrainIntensity: config.filmGrainIntensity ?? 0.08,
      enableVignette: config.enableVignette !== false,
      vignetteIntensity: config.vignetteIntensity ?? (stableOrRelease ? 0.25 : 0.6),
    };

    this.initialize();
  }

  private initialize(): void {
    // Setup render targets for resolution scaling
    if (this.config.enableResolutionScaling) {
      const width = window.innerWidth * this.config.internalResolutionScale;
      const height = window.innerHeight * this.config.internalResolutionScale;

      this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
      });

      this.scaledRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        magFilter: THREE.NearestFilter, // Keep pixelated when upscaling
        minFilter: THREE.NearestFilter,
      });
    }

    // Setup composite shader material
    this.setupCompositeShader();
  }

  private setupCompositeShader(): void {
    const vertexShader = `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform sampler2D uTexture;
      uniform float uTime;
      uniform float uColorBits;
      uniform float uDitheringIntensity;
      uniform float uFilmGrainIntensity;
      uniform float uVignetteIntensity;
      uniform float uFogIntensity;

      varying vec2 vUv;

      // Pseudo-random function
      float random(vec2 st) {
        return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
      }

      // Bayer matrix dithering
      float bayer2x2(vec2 p) {
        return mod(floor(p.x) + 2.0 * floor(p.y), 3.0) / 3.0;
      }

      // Color quantization
      vec3 quantizeColor(vec3 color) {
        // Reduce to specified bits per channel
        float levels = pow(2.0, uColorBits);
        return floor(color * levels) / levels;
      }

      void main() {
        vec2 uv = vUv;
        vec4 color = texture2D(uTexture, uv);

        // Apply color quantization (posterization)
        if (uColorBits < 8.0) {
          color.rgb = quantizeColor(color.rgb);
        }

        // Apply dithering
        if (uDitheringIntensity > 0.0) {
          vec2 screenPos = uv * 300.0; // Adjust dithering frequency
          float dither = bayer2x2(screenPos);
          dither = (dither - 0.5) * 2.0; // Remap to [-1, 1]
          color.rgb += dither * uDitheringIntensity / 255.0;
        }

        // Apply film grain
        if (uFilmGrainIntensity > 0.0) {
          float grain = random(uv + vec2(uTime)) - 0.5;
          color.rgb += grain * uFilmGrainIntensity;
        }

        // Apply vignette
        if (uVignetteIntensity > 0.0) {
          vec2 coord = uv - 0.5;
          float d = length(coord);
          float vignette = smoothstep(0.8, 0.2, d);
          vignette = mix(1.0, vignette, uVignetteIntensity);
          color.rgb *= vignette;
        }

        // Apply depth fog effect (darken edges/distance)
        if (uFogIntensity > 0.0) {
          vec2 coord = uv - 0.5;
          float d = length(coord);
          float fogFactor = d * d * uFogIntensity;
          color.rgb = mix(color.rgb, vec3(0.1), fogFactor);
        }

        // Clamp to avoid overflow
        color = clamp(color, 0.0, 1.0);

        gl_FragColor = color;
      }
    `;

    this.compositeShaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uTime: { value: 0 },
        uColorBits: { value: this.config.colorBits },
        uDitheringIntensity: { value: this.config.ditheringIntensity },
        uFilmGrainIntensity: { value: this.config.filmGrainIntensity },
        uVignetteIntensity: { value: this.config.vignetteIntensity },
        uFogIntensity: { value: this.config.fogIntensity },
      },
      vertexShader,
      fragmentShader,
      transparent: false,
      depthWrite: false,
      depthTest: false,
    });

    // Create composite scene
    this.compositeScene = new THREE.Scene();
    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.compositeMesh = new THREE.Mesh(geometry, this.compositeShaderMaterial);
    this.compositeScene.add(this.compositeMesh);
  }

  /**
   * Apply vertex jitter to geometry for unstable look
   */
  applyVertexJitter(geometry: THREE.BufferGeometry): void {
    if (!this.config.enableVertexJitter) return;

    const positions = geometry.attributes.position;
    if (!positions) return;

    const posArray = positions.array as Float32Array;

    for (let i = 0; i < posArray.length; i += 3) {
      posArray[i] += (Engine.random.next() - 0.5) * this.config.jitterAmount;
      posArray[i + 1] += (Engine.random.next() - 0.5) * this.config.jitterAmount;
      posArray[i + 2] += (Engine.random.next() - 0.5) * this.config.jitterAmount;
    }

    positions.needsUpdate = true;
  }

  /**
   * Simplify lighting on materials
   */
  simplifyLighting(material: THREE.Material): void {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.flatShading = true;
      material.roughness = 1.0; // Full roughness, no specular highlights
      material.metalness = 0.0;
    } else if (material instanceof THREE.MeshPhongMaterial) {
      material.flatShading = true;
      material.shininess = 0;
    }
  }

  /**
   * Render the scene with full PS1 pipeline
   */
  render(): void {
    const externalPasses = this.collectExternalPasses();
    if (!this.enabled) {
      // Bypass pipeline — render scene directly
      this.renderer.setRenderTarget(null);
      this.renderer.clear(true, true, true);
      this.renderExternalPasses(null, ['background'], externalPasses);
      this.renderer.render(this.scene, this.camera);
      this.renderExternalPasses(null, ['world2D', 'entities2D', 'ui2D'], externalPasses);
      return;
    }
    // Store original render target
    const originalRenderTarget = this.renderer.getRenderTarget();

    let sourceRenderTarget: THREE.WebGLRenderTarget | null = null;

    // Step 1: Render to lower resolution if enabled
    if (this.config.enableResolutionScaling && this.renderTarget) {
      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.clear(true, true, true);
      this.renderExternalPasses(this.renderTarget, ['background'], externalPasses);
      this.renderer.render(this.scene, this.camera);
      this.renderExternalPasses(this.renderTarget, ['world2D', 'entities2D', 'ui2D'], externalPasses);
      sourceRenderTarget = this.renderTarget;
    } else {
      // Render at full resolution but to a render target for post-processing
      if (this.scaledRenderTarget) {
        this.renderer.setRenderTarget(this.scaledRenderTarget);
        this.renderer.clear(true, true, true);
        this.renderExternalPasses(this.scaledRenderTarget, ['background'], externalPasses);
        this.renderer.render(this.scene, this.camera);
        this.renderExternalPasses(this.scaledRenderTarget, ['world2D', 'entities2D', 'ui2D'], externalPasses);
        sourceRenderTarget = this.scaledRenderTarget;
      } else {
        // Fallback: Just render directly
        this.renderer.setRenderTarget(null);
        this.renderer.clear(true, true, true);
        this.renderExternalPasses(null, ['background'], externalPasses);
        this.renderer.render(this.scene, this.camera);
        this.renderExternalPasses(null, ['world2D', 'entities2D', 'ui2D'], externalPasses);
        return;
      }
    }

    // Step 2: Apply post-processing effects
    if (this.compositeShaderMaterial && this.compositeMesh && this.compositeScene && this.compositeCamera) {
      // Set the source texture
      this.compositeShaderMaterial.uniforms.uTexture.value = sourceRenderTarget?.texture || null;
      this.compositeShaderMaterial.uniforms.uTime.value = this.time;

      // Resolution-scaled path can composite directly to the backbuffer.
      this.renderer.setRenderTarget(null);

      this.renderer.render(this.compositeScene, this.compositeCamera);
    }

    // Restore original render target
    this.renderer.setRenderTarget(originalRenderTarget);
  }

  /**
   * Update pipeline
   */
  update(deltaTime: number): void {
    this.time += deltaTime;
  }

  /**
   * Handle window resize
   */
  onWindowResize(): void {
    if (!this.config.enableResolutionScaling) return;

    const width = window.innerWidth * this.config.internalResolutionScale;
    const height = window.innerHeight * this.config.internalResolutionScale;

    if (this.renderTarget) {
      this.renderTarget.setSize(width, height);
    }

    if (this.scaledRenderTarget) {
      this.scaledRenderTarget.setSize(window.innerWidth, window.innerHeight);
    }
  }

  /**
   * Update shader uniforms
   */
  setColorBits(bits: number): void {
    this.config.colorBits = bits;
    if (this.compositeShaderMaterial) {
      this.compositeShaderMaterial.uniforms.uColorBits.value = bits;
    }
  }

  setDitheringIntensity(intensity: number): void {
    this.config.ditheringIntensity = intensity;
    if (this.compositeShaderMaterial) {
      this.compositeShaderMaterial.uniforms.uDitheringIntensity.value = intensity;
    }
  }

  setFilmGrainIntensity(intensity: number): void {
    this.config.filmGrainIntensity = intensity;
    if (this.compositeShaderMaterial) {
      this.compositeShaderMaterial.uniforms.uFilmGrainIntensity.value = intensity;
    }
  }

  setVignetteIntensity(intensity: number): void {
    this.config.vignetteIntensity = intensity;
    if (this.compositeShaderMaterial) {
      this.compositeShaderMaterial.uniforms.uVignetteIntensity.value = intensity;
    }
  }

  setFogIntensity(intensity: number): void {
    this.config.fogIntensity = intensity;
    if (this.compositeShaderMaterial) {
      this.compositeShaderMaterial.uniforms.uFogIntensity.value = intensity;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private collectExternalPasses(): TwoDRenderPass[] {
    return listSystems()
      .flatMap((entry) => {
        const provider = entry.system as TwoDRenderPassProvider | undefined;
        return typeof provider?.getRenderPasses === 'function' ? provider.getRenderPasses() : [];
      })
      .filter((pass) => !!pass?.scene && !!pass?.camera)
      .sort((left, right) => PS1RenderingPipeline.EXTERNAL_LAYER_ORDER[left.layer] - PS1RenderingPipeline.EXTERNAL_LAYER_ORDER[right.layer]);
  }

  private renderExternalPasses(
    target: THREE.WebGLRenderTarget | null,
    layers: TwoDRenderLayer[],
    externalPasses: TwoDRenderPass[] = this.collectExternalPasses(),
  ): void {
    const passes = externalPasses.filter((pass) => layers.includes(pass.layer));
    if (passes.length === 0) return;
    const originalAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(target);
    for (const pass of passes) {
      this.renderer.clearDepth();
      this.renderer.render(pass.scene, pass.camera);
    }
    this.renderer.autoClear = originalAutoClear;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.renderTarget?.dispose();
    this.scaledRenderTarget?.dispose();
    this.compositeShaderMaterial?.dispose();
  }
}
