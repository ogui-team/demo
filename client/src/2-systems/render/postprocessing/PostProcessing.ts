import * as THREE from 'three';

/**
 * Post-Processing module
 * Film grain, vignette, and desaturation effects
 * Uses efficient blend modes and minimal overhead
 */

interface PostProcessingConfig {
  enableFilmGrain?: boolean;
  filmGrainIntensity?: number;
  enableVignette?: boolean;
  vignetteIntensity?: number;
  enableDesaturation?: boolean;
  desaturationAmount?: number;
}

export class PostProcessing {
  private renderer: THREE.WebGLRenderer;
  private enabled: boolean = true;

  // Config
  private enableFilmGrain: boolean;
  private filmGrainIntensity: number;
  private enableVignette: boolean;
  private vignetteIntensity: number;
  private enableDesaturation: boolean;
  private desaturationAmount: number;
  private time: number = 0;

  // Canvas-based overlay for effects (rendered less frequently)
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayTexture: THREE.CanvasTexture | null = null;
  private material: THREE.Material | null = null;
  private targetMesh: THREE.Mesh | null = null;
  private scene: THREE.Scene | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    sceneRef: THREE.Scene,
    config: PostProcessingConfig = {}
  ) {
    this.renderer = renderer;
    this.scene = sceneRef;

    this.enableFilmGrain = config.enableFilmGrain !== false;
    this.filmGrainIntensity = config.filmGrainIntensity || 0.08;
    this.enableVignette = config.enableVignette !== false;
    this.vignetteIntensity = config.vignetteIntensity || 0.7;
    this.enableDesaturation = config.enableDesaturation !== false;
    this.desaturationAmount = config.desaturationAmount || 0.25;

    this.setupEffects();
  }

  private setupEffects(): void {
    // Create material with vignette
    const vignetteGeometry = new THREE.PlaneGeometry(2, 2);
    const vignetteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVignetteIntensity: { value: this.vignetteIntensity },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uVignetteIntensity;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          // Create vignette gradient
          vec2 uv = vUv - 0.5;
          float d = length(uv);
          float vignette = smoothstep(0.8, 0.2, d);
          
          // Subtle pulsing
          vignette *= mix(0.7, 1.0, sin(uTime * 0.5) * 0.5 + 0.5);
          
          gl_FragColor = vec4(0.0, 0.0, 0.0, vignette * uVignetteIntensity * 0.5);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.material = vignetteMaterial;
    this.targetMesh = new THREE.Mesh(vignetteGeometry, vignetteMaterial);
    this.targetMesh.frustumCulled = false;
    this.targetMesh.position.z = 0.5;

    // NOTE: Do NOT add to scene — PS1RenderingPipeline composite shader
    // already provides vignette. Adding this mesh to the scene causes
    // render contamination (black square behind crosshair).
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;

    this.time += deltaTime;

    // Update vignette material
    if (this.material instanceof THREE.ShaderMaterial) {
      this.material.uniforms.uTime.value = this.time;
    }
  }

  setFilmGrainIntensity(intensity: number): void {
    this.filmGrainIntensity = intensity;
  }

  setVignetteIntensity(intensity: number): void {
    this.vignetteIntensity = intensity;
    if (this.material instanceof THREE.ShaderMaterial) {
      this.material.uniforms.uVignetteIntensity.value = intensity;
    }
  }

  setDesaturation(amount: number): void {
    this.desaturationAmount = amount;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.targetMesh) {
      this.targetMesh.visible = enabled;
    }
  }

  destroy(): void {
    if (this.targetMesh && this.scene) {
      this.scene.remove(this.targetMesh);
    }
    if (this.material instanceof THREE.ShaderMaterial) {
      this.material.dispose();
    }
  }
}
