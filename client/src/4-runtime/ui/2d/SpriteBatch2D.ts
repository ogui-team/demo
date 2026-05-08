import * as THREE from 'three';

export interface BatchedSprite2D {
  x: number;
  y: number;
  z?: number;
  width: number;
  height: number;
  rotation?: number;
  uvRect: { x: number; y: number; width: number; height: number };
  tint?: number;
  opacity?: number;
}

export class SpriteBatch2D {
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
  private count = 0;

  constructor(texture: THREE.Texture, capacity: number = 4096) {
    this.capacity = capacity;

    const baseGeometry = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = baseGeometry.index;
    this.geometry.attributes.position = baseGeometry.attributes.position;
    this.geometry.attributes.uv = baseGeometry.attributes.uv;

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

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: texture },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec3 iTranslate;
        attribute vec2 iScale;
        attribute vec4 iUvRect;
        attribute vec3 iTint;
        attribute float iOpacity;
        attribute float iRotation;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vOpacity;

        void main() {
          vec2 scaled = position.xy * iScale;
          float c = cos(iRotation);
          float s = sin(iRotation);
          vec2 rotated = vec2(
            scaled.x * c - scaled.y * s,
            scaled.x * s + scaled.y * c
          );
          vec3 world = vec3(rotated + iTranslate.xy, iTranslate.z);
          vUv = iUvRect.xy + uv * iUvRect.zw;
          vTint = iTint;
          vOpacity = iOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vOpacity;

        void main() {
          vec4 sampled = texture2D(uAtlas, vUv);
          if (sampled.a <= 0.01 || vOpacity <= 0.01) discard;
          gl_FragColor = vec4(sampled.rgb * vTint, sampled.a * vOpacity);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  setTexture(texture: THREE.Texture): void {
    this.material.uniforms.uAtlas.value = texture;
  }

  updateSprites(sprites: BatchedSprite2D[]): void {
    const count = Math.min(sprites.length, this.capacity);
    this.count = count;
    for (let index = 0; index < count; index += 1) {
      const sprite = sprites[index];
      const tint = new THREE.Color(sprite.tint ?? 0xffffff);
      this.positionAttr.setXYZ(index, sprite.x, sprite.y, sprite.z ?? 0);
      this.scaleAttr.setXY(index, sprite.width, sprite.height);
      this.uvAttr.setXYZW(index, sprite.uvRect.x, sprite.uvRect.y, sprite.uvRect.width, sprite.uvRect.height);
      this.tintAttr.setXYZ(index, tint.r, tint.g, tint.b);
      this.opacityAttr.setX(index, sprite.opacity ?? 1);
      this.rotationAttr.setX(index, sprite.rotation ?? 0);
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

  getMetrics(): { drawCalls: number; batchCount: number; spriteCount: number } {
    return {
      drawCalls: this.count > 0 ? 1 : 0,
      batchCount: this.count > 0 ? 1 : 0,
      spriteCount: this.count,
    };
  }

  dispose(): void {
    this.material.dispose();
    this.geometry.dispose();
  }
}
