import * as THREE from 'three';

export interface NumberRange {
  min: number;
  max: number;
}

export interface VectorRange {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface ParticleEmitterConfig {
  label: string;
  capacity: number;
  spawnRate: number;
  loop?: boolean;
  burstCount?: number;
  origin: { x: number; y: number; z: number };
  volume?: { x: number; y: number; z: number };
  lifetime: NumberRange;
  startSize: NumberRange;
  endSize: NumberRange;
  velocity: VectorRange;
  gravity?: number;
  colorStart: number;
  colorEnd: number;
  additive?: boolean;
  billboard?: boolean;
}

interface ParticleState {
  active: boolean;
  age: number;
  lifetime: number;
  sizeStart: number;
  sizeEnd: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
}

interface EmitterRuntime {
  id: string;
  config: ParticleEmitterConfig;
  mesh: THREE.InstancedMesh;
  particles: ParticleState[];
  accumulator: number;
}

function randomRange(range: NumberRange): number {
  return range.min + Math.random() * (range.max - range.min);
}

function randomVector(range: VectorRange): THREE.Vector3 {
  return new THREE.Vector3(
    randomRange({ min: range.min.x, max: range.max.x }),
    randomRange({ min: range.min.y, max: range.max.y }),
    randomRange({ min: range.min.z, max: range.max.z }),
  );
}

function colorLerp(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, Math.max(0, Math.min(1, t)));
}

export const VFX_PRESETS: Record<string, Omit<ParticleEmitterConfig, 'origin'>> = {
  pistolMuzzleFlash: {
    label: 'Pistol Muzzle Flash',
    capacity: 18,
    spawnRate: 0,
    loop: false,
    burstCount: 12,
    lifetime: { min: 0.04, max: 0.09 },
    startSize: { min: 0.1, max: 0.22 },
    endSize: { min: 0.01, max: 0.05 },
    velocity: {
      min: { x: -0.3, y: -0.12, z: -1.2 },
      max: { x: 0.3, y: 0.12, z: -0.35 },
    },
    gravity: -0.1,
    colorStart: 0xfff2a6,
    colorEnd: 0xff7a2b,
    additive: true,
    billboard: true,
    volume: { x: 0.06, y: 0.06, z: 0.06 },
  },
  spiritCastPulse: {
    label: 'Spirit Cast Pulse',
    capacity: 24,
    spawnRate: 0,
    loop: false,
    burstCount: 16,
    lifetime: { min: 0.08, max: 0.18 },
    startSize: { min: 0.08, max: 0.16 },
    endSize: { min: 0.02, max: 0.05 },
    velocity: {
      min: { x: -0.45, y: -0.1, z: -0.45 },
      max: { x: 0.45, y: 0.35, z: 0.45 },
    },
    gravity: -0.08,
    colorStart: 0xdff7d9,
    colorEnd: 0x78c7a6,
    additive: true,
    billboard: true,
    volume: { x: 0.12, y: 0.12, z: 0.12 },
  },
  bulletImpactSpark: {
    label: 'Bullet Impact Spark',
    capacity: 20,
    spawnRate: 0,
    loop: false,
    burstCount: 14,
    lifetime: { min: 0.08, max: 0.18 },
    startSize: { min: 0.03, max: 0.08 },
    endSize: { min: 0.01, max: 0.03 },
    velocity: {
      min: { x: -0.8, y: 0.05, z: -0.8 },
      max: { x: 0.8, y: 1.2, z: 0.8 },
    },
    gravity: -2.8,
    colorStart: 0xffd37a,
    colorEnd: 0x8a4c18,
    additive: true,
    billboard: true,
    volume: { x: 0.08, y: 0.08, z: 0.08 },
  },
  spiritImpactBloom: {
    label: 'Spirit Impact Bloom',
    capacity: 28,
    spawnRate: 0,
    loop: false,
    burstCount: 20,
    lifetime: { min: 0.12, max: 0.24 },
    startSize: { min: 0.04, max: 0.1 },
    endSize: { min: 0.01, max: 0.04 },
    velocity: {
      min: { x: -0.9, y: 0.05, z: -0.9 },
      max: { x: 0.9, y: 1.0, z: 0.9 },
    },
    gravity: -1.2,
    colorStart: 0xbef0cb,
    colorEnd: 0x2f5b47,
    additive: true,
    billboard: true,
    volume: { x: 0.1, y: 0.1, z: 0.1 },
  },
  fireballImpactBurst: {
    label: 'Fireball Impact Burst',
    capacity: 36,
    spawnRate: 0,
    loop: false,
    burstCount: 24,
    lifetime: { min: 0.14, max: 0.3 },
    startSize: { min: 0.05, max: 0.14 },
    endSize: { min: 0.01, max: 0.05 },
    velocity: {
      min: { x: -1.1, y: 0.08, z: -1.1 },
      max: { x: 1.1, y: 1.35, z: 1.1 },
    },
    gravity: -1.6,
    colorStart: 0xffd27a,
    colorEnd: 0x8f1c08,
    additive: true,
    billboard: true,
    volume: { x: 0.12, y: 0.12, z: 0.12 },
  },
  ambientDust: {
    label: 'Ambient Dust',
    capacity: 96,
    spawnRate: 22,
    loop: true,
    burstCount: 6,
    lifetime: { min: 1.6, max: 2.8 },
    startSize: { min: 0.15, max: 0.45 },
    endSize: { min: 0.05, max: 0.2 },
    velocity: {
      min: { x: -0.1, y: 0.15, z: -0.1 },
      max: { x: 0.1, y: 0.4, z: 0.1 },
    },
    gravity: -0.02,
    colorStart: 0xf3d8a0,
    colorEnd: 0x6b5d49,
    additive: false,
    billboard: true,
    volume: { x: 1.8, y: 0.8, z: 1.8 },
  },
  emberTorch: {
    label: 'Ember Torch',
    capacity: 72,
    spawnRate: 30,
    loop: true,
    burstCount: 4,
    lifetime: { min: 0.8, max: 1.6 },
    startSize: { min: 0.08, max: 0.22 },
    endSize: { min: 0.01, max: 0.1 },
    velocity: {
      min: { x: -0.18, y: 0.35, z: -0.18 },
      max: { x: 0.18, y: 0.85, z: 0.18 },
    },
    gravity: -0.06,
    colorStart: 0xffc36b,
    colorEnd: 0x8a1f0a,
    additive: true,
    billboard: true,
    volume: { x: 0.25, y: 0.1, z: 0.25 },
  },
  spawnBurst: {
    label: 'Spawn Burst',
    capacity: 48,
    spawnRate: 0,
    loop: false,
    burstCount: 36,
    lifetime: { min: 0.4, max: 0.8 },
    startSize: { min: 0.14, max: 0.3 },
    endSize: { min: 0.01, max: 0.08 },
    velocity: {
      min: { x: -1.6, y: 0.4, z: -1.6 },
      max: { x: 1.6, y: 1.6, z: 1.6 },
    },
    gravity: -1.2,
    colorStart: 0xb3ff8a,
    colorEnd: 0x2d4210,
    additive: true,
    billboard: true,
    volume: { x: 0.2, y: 0.2, z: 0.2 },
  },
};

export class VFXMaker {
  private readonly scene: THREE.Scene;
  private camera: THREE.Camera | null;
  private emitters = new Map<string, EmitterRuntime>();
  private scratchMatrix = new THREE.Matrix4();
  private scratchQuaternion = new THREE.Quaternion();
  private scratchScale = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: THREE.Camera | null = null) {
    this.scene = scene;
    this.camera = camera;
  }

  setCamera(camera: THREE.Camera | null): void {
    this.camera = camera;
  }

  createEmitter(id: string, config: ParticleEmitterConfig): string {
    this.removeEmitter(id);

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      vertexColors: true,
      blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, config.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData.isVfxEmitter = true;
    mesh.name = `vfx_${id}`;

    const particles: ParticleState[] = Array.from({ length: config.capacity }, () => ({
      active: false,
      age: 0,
      lifetime: 0,
      sizeStart: 0,
      sizeEnd: 0,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      colorStart: new THREE.Color(config.colorStart),
      colorEnd: new THREE.Color(config.colorEnd),
    }));

    this.scene.add(mesh);
    this.emitters.set(id, { id, config, mesh, particles, accumulator: 0 });

    if (!config.loop) {
      this._emitBurst(this.emitters.get(id)!, config.burstCount ?? config.capacity);
    }

    return id;
  }

  triggerPreset(id: string, preset: keyof typeof VFX_PRESETS, origin: { x: number; y: number; z: number }): string {
    return this.createEmitter(id, { ...VFX_PRESETS[preset], origin });
  }

  removeEmitter(id: string): void {
    const emitter = this.emitters.get(id);
    if (!emitter) return;
    this.scene.remove(emitter.mesh);
    emitter.mesh.geometry.dispose();
    (emitter.mesh.material as THREE.Material).dispose();
    this.emitters.delete(id);
  }

  clear(): void {
    for (const id of [...this.emitters.keys()]) {
      this.removeEmitter(id);
    }
  }

  hasEmitter(id: string): boolean {
    return this.emitters.has(id);
  }

  getEmitterCount(): number {
    return this.emitters.size;
  }

  getEmitterMesh(id: string): THREE.InstancedMesh | null {
    return this.emitters.get(id)?.mesh ?? null;
  }

  update(dt: number): void {
    for (const emitter of this.emitters.values()) {
      if (emitter.config.loop && emitter.config.spawnRate > 0) {
        emitter.accumulator += dt * emitter.config.spawnRate;
        while (emitter.accumulator >= 1) {
          emitter.accumulator -= 1;
          this._spawnParticle(emitter);
        }
      }

      let activeCount = 0;
      for (const particle of emitter.particles) {
        if (!particle.active) continue;

        particle.age += dt;
        if (particle.age >= particle.lifetime) {
          particle.active = false;
          continue;
        }

        particle.velocity.y += (emitter.config.gravity ?? 0) * dt;
        particle.position.addScaledVector(particle.velocity, dt);

        const t = particle.age / particle.lifetime;
        const scale = THREE.MathUtils.lerp(particle.sizeStart, particle.sizeEnd, t);
        const color = colorLerp(particle.colorStart, particle.colorEnd, t);

        this._writeParticle(emitter, activeCount, particle.position, scale, color, emitter.config.billboard ?? true);
        activeCount += 1;
      }

      emitter.mesh.count = activeCount;
      emitter.mesh.instanceMatrix.needsUpdate = true;
      if (emitter.mesh.instanceColor) {
        emitter.mesh.instanceColor.needsUpdate = true;
      }

      if (!emitter.config.loop && activeCount === 0) {
        this.removeEmitter(emitter.id);
      }
    }
  }

  private _emitBurst(emitter: EmitterRuntime, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this._spawnParticle(emitter);
    }
  }

  private _spawnParticle(emitter: EmitterRuntime): void {
    const slot = emitter.particles.find((particle) => !particle.active);
    if (!slot) return;

    const volume = emitter.config.volume ?? { x: 0, y: 0, z: 0 };
    slot.active = true;
    slot.age = 0;
    slot.lifetime = randomRange(emitter.config.lifetime);
    slot.sizeStart = randomRange(emitter.config.startSize);
    slot.sizeEnd = randomRange(emitter.config.endSize);
    slot.position.set(
      emitter.config.origin.x + (Math.random() - 0.5) * volume.x,
      emitter.config.origin.y + (Math.random() - 0.5) * volume.y,
      emitter.config.origin.z + (Math.random() - 0.5) * volume.z,
    );
    slot.velocity.copy(randomVector(emitter.config.velocity));
    slot.colorStart.setHex(emitter.config.colorStart);
    slot.colorEnd.setHex(emitter.config.colorEnd);
  }

  private _writeParticle(
    emitter: EmitterRuntime,
    index: number,
    position: THREE.Vector3,
    scale: number,
    color: THREE.Color,
    billboard: boolean,
  ): void {
    if (billboard && this.camera) {
      this.camera.getWorldQuaternion(this.scratchQuaternion);
    } else {
      this.scratchQuaternion.identity();
    }

    this.scratchScale.set(scale, scale, scale);
    this.scratchMatrix.compose(position, this.scratchQuaternion, this.scratchScale);
    emitter.mesh.setMatrixAt(index, this.scratchMatrix);
    emitter.mesh.setColorAt(index, color);
  }
}