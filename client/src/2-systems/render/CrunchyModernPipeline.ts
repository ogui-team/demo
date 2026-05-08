/**
 * CrunchyModernPipeline - ULTRA MINIMAL
 * 
 * Dead simple implementation. Creates fresh meshes every frame.
 * No caching, no complexity. Just pure rendering.
 */

import * as THREE from 'three';

let gDebugLevel = 2;

// Global marker that pipeline loaded
(window as any).__crunchyModernLoaded = true;
console.log('[CrunchyModern] Module loaded');

export class CrunchyModernPipeline {
  private renderer: THREE.WebGLRenderer;
  private baseSceneRenderTarget: THREE.WebGLRenderTarget | null = null;
  private frameCount = 0;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    console.log('[CrunchyModern] Constructor called');

    // Expose debug interface
    (window as any).__debugGraphicsConfig = {
      setDebugLevel: (level: number) => {
        gDebugLevel = level;
        console.log(`[CrunchyModern] Debug level: ${level}`);
      },
      getInfo: () => {
        return {
          frameCount: this.frameCount,
          debugLevel: gDebugLevel,
          hasTarget: !!this.baseSceneRenderTarget,
        };
      },
    };
  }

  setBaseSceneRenderTarget(target: THREE.WebGLRenderTarget): void {
    this.baseSceneRenderTarget = target;
    console.log('[CrunchyModern] Target set');
  }

  update(): void {
    this.frameCount++;

    if (!this.baseSceneRenderTarget) {
      console.warn('[CrunchyModern] No target');
      return;
    }

    if (this.frameCount % 30 === 0) {
      console.log(`[CrunchyModern] Frame ${this.frameCount}, Level ${gDebugLevel}, Target:`, {
        width: this.baseSceneRenderTarget.width,
        height: this.baseSceneRenderTarget.height,
        texture: !!this.baseSceneRenderTarget.texture,
      });
    }

    try {
      switch (gDebugLevel) {
        case 0:
          break;
        case 1:
          this.level1_RawFBO();
          break;
        case 2:
          this.level2_Passthrough();
          break;
        case 3:
          this.level3_Pixelation();
          break;
        case 4:
          this.level4_CrunchyModern();
          break;
      }
    } catch (error) {
      console.error('[CrunchyModern] ERROR in render switch:', error);
    }
  }

  private level1_RawFBO(): void {
    try {
      const tex = this.baseSceneRenderTarget!.texture;
      const planeGeo = new THREE.PlaneGeometry(2, 2);
      const planeMat = new THREE.MeshBasicMaterial({ map: tex });
      
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.position.z = -1;
      
      const scene = new THREE.Scene();
      scene.add(plane);
      
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      cam.position.z = 0;
      
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      
      planeGeo.dispose();
      planeMat.dispose();
    } catch (error) {
      console.error('[CrunchyModern] ERROR in level1:', error);
    }
  }

  private level2_Passthrough(): void {
    try {
      const tex = this.baseSceneRenderTarget!.texture;
      const planeGeo = new THREE.PlaneGeometry(2, 2);
      const planeMat = new THREE.ShaderMaterial({
        uniforms: { uTexture: { value: tex } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D uTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(uTexture, vUv); }`,
      });
      
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.position.z = -1;
      
      const scene = new THREE.Scene();
      scene.add(plane);
      
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      cam.position.z = 0;
      
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      
      planeGeo.dispose();
      planeMat.dispose();
    } catch (error) {
      console.error('[CrunchyModern] ERROR in level2:', error);
    }
  }

  private level3_Pixelation(): void {
    try {
      const tex = this.baseSceneRenderTarget!.texture;
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      
      const planeGeo = new THREE.PlaneGeometry(2, 2);
      const planeMat = new THREE.ShaderMaterial({
        uniforms: { 
          uTexture: { value: tex },
          uPixelSize: { value: 4.0 },
          uResolution: { value: size },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform sampler2D uTexture;
          uniform float uPixelSize;
          uniform vec2 uResolution;
          varying vec2 vUv;
          void main() {
            vec2 pixelCoord = floor(vUv * uResolution / uPixelSize) * uPixelSize / uResolution;
            gl_FragColor = texture2D(uTexture, pixelCoord);
          }
        `,
      });
      
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.position.z = -1;
      
      const scene = new THREE.Scene();
      scene.add(plane);
      
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      cam.position.z = 0;
      
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      
      planeGeo.dispose();
      planeMat.dispose();
    } catch (error) {
      console.error('[CrunchyModern] ERROR in level3:', error);
    }
  }

  private level4_CrunchyModern(): void {
    try {
      const tex = this.baseSceneRenderTarget!.texture;
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      
      // Get settings from debug menu
      const debugConfig = (window as any).__debugGraphicsConfig;
      const graphicsSettings = (window as any).__graphicsSettings || {
        pixelSize: 3.0,
        colorBits: 5.0,
        ditherEnabled: true,
      };
      
      const planeGeo = new THREE.PlaneGeometry(2, 2);
      const planeMat = new THREE.ShaderMaterial({
        uniforms: { 
          uTexture: { value: tex },
          uPixelSize: { value: graphicsSettings.pixelSize || 3.0 },
          uResolution: { value: size },
          uColorBits: { value: graphicsSettings.colorBits || 5.0 },
          uDitherStrength: { value: graphicsSettings.ditherEnabled ? 0.1 : 0.0 },
          uTime: { value: performance.now() / 1000.0 },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform sampler2D uTexture;
          uniform float uPixelSize;
          uniform vec2 uResolution;
          uniform float uColorBits;
          uniform float uDitherStrength;
          uniform float uTime;
          varying vec2 vUv;
          
          float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
          
          void main() {
            vec2 pixelCoord = floor(vUv * uResolution / uPixelSize) * uPixelSize / uResolution;
            vec4 color = texture2D(uTexture, pixelCoord);
            
            float levels = pow(2.0, uColorBits);
            color.rgb = floor(color.rgb * levels) / levels;
            
            float dither = rand(pixelCoord + vec2(uTime)) * uDitherStrength;
            color.rgb += dither;
            
            gl_FragColor = color;
          }
        `,
      });
      
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.position.z = -1;
      
      const scene = new THREE.Scene();
      scene.add(plane);
      
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      cam.position.z = 0;
      
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      
      planeGeo.dispose();
      planeMat.dispose();
    } catch (error) {
      console.error('[CrunchyModern] ERROR in level4:', error);
    }
  }

  dispose(): void {
    console.log('[CrunchyModern] Disposed');
  }
}

