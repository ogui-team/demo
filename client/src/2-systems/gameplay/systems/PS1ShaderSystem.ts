/**
 * PS1ShaderSystem  —  Tier 3
 * Custom Three.js shader effects for authentic PS1/PSX aesthetic.
 *
 * Effects
 *   - Vertex jitter      : affine texture mapping wobble (PS1 geometry snap)
 *   - Dithering          : 2×2 / 4×4 Bayer matrix ordered dithering
 *   - Color banding      : posterization (reduce colour depth to 5-bit per channel)
 *   - Scanlines          : horizontal scanline overlay
 *
 * The system wraps Three.js postprocessing via a fullscreen quad rendered
 * after the main scene to keep it decoupled from scene geometry.
 *
 * Vertex jitter is applied per-material via helper `makeJitterMaterial()`.
 *
 * Usage:
 *   const ps1 = new PS1ShaderSystem(renderer, scene, camera);
 *   ps1.enable({ banding: true, dither: true, scanlines: true });
 *
 *   // Optional: apply vertex jitter to a mesh
 *   mesh.material = ps1.makeJitterMaterial({ color: 0xff4400 });
 *
 *   // Each frame (call AFTER renderer.render):
 *   ps1.render();
 *
 *   // Toggle individual effects at runtime
 *   ps1.setBanding(true, 5);   // 5-bit per channel
 *   ps1.setDither(true, 4);    // 4×4 Bayer
 *   ps1.setScanlines(true, 0.6);
 */

import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface PS1EffectsConfig {
  banding?:         boolean;
  bandingBits?:     number;   // bits per channel, default 5
  dither?:          boolean;
  ditherSize?:      2 | 4;    // Bayer matrix size
  scanlines?:       boolean;
  scanlineOpacity?: number;   // 0..1, default 0.4
  /** Vertex jitter amount for makeJitterMaterial. 0 = off, default 0.02 */
  jitterAmount?:    number;
}

// ─── GLSL sources ─────────────────────────────────────────────────────────────

const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Combines banding + dithering + scanlines in a single pass
const PS1_FRAG = /* glsl */`
  precision mediump float;
  varying vec2 vUv;

  uniform sampler2D tScene;
  uniform vec2      uResolution;
  uniform float     uBanding;       // 0 = off, 1 = on
  uniform float     uBits;          // colour bits per channel
  uniform float     uDither;        // 0 = off, 1 = 2x2, 2 = 4x4
  uniform float     uScanlines;     // 0 = off, 1 = on
  uniform float     uScanlineOp;    // opacity

  // 2×2 Bayer matrix (normalised to 0..1)
  float bayer2[4];

  // 4×4 Bayer matrix (normalised to 0..1)
  float bayer4[16];

  void buildBayers() {
    bayer2[0]=0.0/4.0; bayer2[1]=2.0/4.0;
    bayer2[2]=3.0/4.0; bayer2[3]=1.0/4.0;

    bayer4[ 0]= 0.0/16.0; bayer4[ 1]= 8.0/16.0; bayer4[ 2]= 2.0/16.0; bayer4[ 3]=10.0/16.0;
    bayer4[ 4]=12.0/16.0; bayer4[ 5]= 4.0/16.0; bayer4[ 6]=14.0/16.0; bayer4[ 7]= 6.0/16.0;
    bayer4[ 8]= 3.0/16.0; bayer4[ 9]=11.0/16.0; bayer4[10]= 1.0/16.0; bayer4[11]= 9.0/16.0;
    bayer4[12]=15.0/16.0; bayer4[13]= 7.0/16.0; bayer4[14]=13.0/16.0; bayer4[15]= 5.0/16.0;
  }

  float getDitherThreshold(vec2 fragCoord) {
    if (uDither < 0.5) return 0.0;
    if (uDither < 1.5) {
      // 2×2
      int xi = int(mod(fragCoord.x, 2.0));
      int yi = int(mod(fragCoord.y, 2.0));
      int idx = yi * 2 + xi;
      return bayer2[idx];
    } else {
      // 4×4
      int xi = int(mod(fragCoord.x, 4.0));
      int yi = int(mod(fragCoord.y, 4.0));
      int idx = yi * 4 + xi;
      return bayer4[idx];
    }
  }

  vec3 applyBanding(vec3 col, float bits) {
    float levels = pow(2.0, bits) - 1.0;
    return floor(col * levels + 0.5) / levels;
  }

  void main() {
    buildBayers();
    vec4 texel = texture2D(tScene, vUv);
    vec3 col   = texel.rgb;

    // Dithering — adds noise before quantisation
    if (uDither > 0.5) {
      vec2 fragCoord = vUv * uResolution;
      float dth = getDitherThreshold(fragCoord);
      float scale = 1.0 / (pow(2.0, uBits) - 1.0);
      col += (dth - 0.5) * scale;
    }

    // Colour banding (posterisation)
    if (uBanding > 0.5) {
      col = applyBanding(col, uBits);
    }

    // Scanlines
    if (uScanlines > 0.5) {
      float lineY = mod(vUv.y * uResolution.y, 2.0);
      float dark  = lineY < 1.0 ? (1.0 - uScanlineOp) : 1.0;
      col *= dark;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), texel.a);
  }
`;

// Vertex jitter material — snaps vertices to a low-res grid (PS1 pre-division)
const JITTER_VERT = /* glsl */`
  uniform float uJitter;      // snap grid size
  varying vec2  vUv;
  varying vec3  vNormal;

  void main() {
    vUv    = uv;
    vNormal = normalMatrix * normal;

    vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    // Snap X/Y in clip space to simulate PS1 integer vertex coords
    if (uJitter > 0.0) {
      float grid = uJitter;
      clipPos.xy = floor(clipPos.xy / grid) * grid;
    }

    gl_Position = clipPos;
  }
`;

const JITTER_FRAG = /* glsl */`
  uniform vec3      uColor;
  uniform sampler2D uMap;
  uniform float     uHasMap;
  varying vec2      vUv;
  varying vec3      vNormal;

  void main() {
    vec3 col = uColor;
    if (uHasMap > 0.5) col *= texture2D(uMap, vUv).rgb;

    // Simple flat-ish PS1 lighting
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
    float diff = max(dot(normalize(vNormal), lightDir), 0.0) * 0.6 + 0.4;
    gl_FragColor = vec4(col * diff, 1.0);
  }
`;

// ─── PS1ShaderSystem ──────────────────────────────────────────────────────────

export class PS1ShaderSystem {
  private renderer:  THREE.WebGLRenderer;
  private mainScene: THREE.Scene;
  private camera:    THREE.Camera;

  // Post-process pass
  private ppScene:   THREE.Scene    = new THREE.Scene();
  private ppCamera:  THREE.OrthographicCamera;
  private ppQuad:    THREE.Mesh     | null = null;
  private renderTarget: THREE.WebGLRenderTarget;
  private ppMaterial: THREE.ShaderMaterial | null = null;

  private cfg: Required<PS1EffectsConfig> = {
    banding:         true,
    bandingBits:     5,
    dither:          true,
    ditherSize:      4,
    scanlines:       true,
    scanlineOpacity: 0.35,
    jitterAmount:    0.015,
  };
  private systemContext: SystemContext | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    mainScene: THREE.Scene,
    camera: THREE.Camera,
    cfg: PS1EffectsConfig = {}
  ) {
    this.renderer  = renderer;
    this.mainScene = mainScene;
    this.camera    = camera;
    Object.assign(this.cfg, cfg);

    const size = renderer.getSize(new THREE.Vector2());
    this.renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format:    THREE.RGBAFormat,
    });

    this.ppCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._buildPostPass(size);
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
      status: 'active',
      active: true,
      metrics: {
        banding: this.cfg.banding,
        dither: this.cfg.dither,
        scanlines: this.cfg.scanlines,
        jitterAmount: this.cfg.jitterAmount,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  // ─── Controls ─────────────────────────────────────────────────────────────

  enable(cfg: PS1EffectsConfig = {}): void {
    Object.assign(this.cfg, cfg);
    this._updateUniforms();
    gameBus.emit('stateMutation', {
      source: 'ps1ShaderSystem',
      path: 'rendering.ps1Shader',
      changedCount: 1,
    });
  }

  setBanding(on: boolean, bits = 5): void {
    this.cfg.banding     = on;
    this.cfg.bandingBits = bits;
    this._updateUniforms();
    gameBus.emit('stateMutation', {
      source: 'ps1ShaderSystem',
      path: 'rendering.ps1Shader.banding',
      changedCount: 1,
    });
  }

  setDither(on: boolean, size: 2 | 4 = 4): void {
    this.cfg.dither     = on;
    this.cfg.ditherSize = size;
    this._updateUniforms();
    gameBus.emit('stateMutation', {
      source: 'ps1ShaderSystem',
      path: 'rendering.ps1Shader.dither',
      changedCount: 1,
    });
  }

  setScanlines(on: boolean, opacity = 0.35): void {
    this.cfg.scanlines       = on;
    this.cfg.scanlineOpacity = opacity;
    this._updateUniforms();
    gameBus.emit('stateMutation', {
      source: 'ps1ShaderSystem',
      path: 'rendering.ps1Shader.scanlines',
      changedCount: 1,
    });
  }

  setJitterAmount(amount: number): void {
    this.cfg.jitterAmount = amount;
  }

  // ─── Render call ──────────────────────────────────────────────────────────

  /**
   * Replace the normal renderer.render() call with this.
   * Renders main scene to RT, then applies post-processing pass.
   */
  render(): void {
    // Pass 1: render main scene to render target
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.mainScene, this.camera);

    // Pass 2: post-process fullscreen pass
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.ppScene, this.ppCamera);
  }

  onResize(width: number, height: number): void {
    this.renderTarget.setSize(width, height);
    if (this.ppMaterial) {
      this.ppMaterial.uniforms['uResolution'].value.set(width, height);
    }
  }

  // ─── Vertex jitter material ───────────────────────────────────────────────

  /**
   * Returns a ShaderMaterial with PS1-style vertex snapping.
   * Use as mesh.material = ps1.makeJitterMaterial({ color:0xff0000 }).
   */
  makeJitterMaterial(opts: {
    color?:   number | THREE.Color;
    texture?: THREE.Texture;
  } = {}): THREE.ShaderMaterial {
    const color = opts.color instanceof THREE.Color
      ? opts.color
      : new THREE.Color(opts.color ?? 0xffffff);

    return new THREE.ShaderMaterial({
      vertexShader:   JITTER_VERT,
      fragmentShader: JITTER_FRAG,
      uniforms: {
        uJitter: { value: this.cfg.jitterAmount },
        uColor:  { value: color },
        uMap:    { value: opts.texture ?? null },
        uHasMap: { value: opts.texture ? 1.0 : 0.0 },
      },
      side: THREE.FrontSide,
    });
  }

  /** Update jitter uniforms on all tracked meshes (call after setJitterAmount). */
  applyJitterToScene(scene: THREE.Scene): void {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.ShaderMaterial;
        if (mat?.uniforms?.['uJitter'] !== undefined) {
          mat.uniforms['uJitter'].value = this.cfg.jitterAmount;
        }
      }
    });
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.ppMaterial?.dispose();
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private _buildPostPass(size: THREE.Vector2): void {
    this.ppMaterial = new THREE.ShaderMaterial({
      vertexShader:   FULLSCREEN_VERT,
      fragmentShader: PS1_FRAG,
      uniforms: {
        tScene:       { value: this.renderTarget.texture },
        uResolution:  { value: new THREE.Vector2(size.x, size.y) },
        uBanding:     { value: this.cfg.banding    ? 1.0 : 0.0 },
        uBits:        { value: this.cfg.bandingBits },
        uDither:      { value: this.cfg.dither      ? (this.cfg.ditherSize === 4 ? 2.0 : 1.0) : 0.0 },
        uScanlines:   { value: this.cfg.scanlines   ? 1.0 : 0.0 },
        uScanlineOp:  { value: this.cfg.scanlineOpacity },
      },
      depthTest:  false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.ppMaterial
    );
    quad.frustumCulled = false;
    this.ppScene.add(quad);
    this.ppQuad = quad;
  }

  private _updateUniforms(): void {
    if (!this.ppMaterial) return;
    const u = this.ppMaterial.uniforms;
    u['uBanding'].value   = this.cfg.banding    ? 1.0 : 0.0;
    u['uBits'].value      = this.cfg.bandingBits;
    u['uDither'].value    = this.cfg.dither      ? (this.cfg.ditherSize === 4 ? 2.0 : 1.0) : 0.0;
    u['uScanlines'].value = this.cfg.scanlines   ? 1.0 : 0.0;
    u['uScanlineOp'].value = this.cfg.scanlineOpacity;
  }
}
