import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { ObjectPool } from '@engine/1-kernel/core/public-api';
import type { Vector3 } from '@engine/1-kernel/core/public-api';
import { VFXMaker, VFX_PRESETS } from '../systems/VFXMaker';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface FireEvent {
  shooterId: string;
  weaponId: string;
  origin: Vector3;
  direction: Vector3;
}

interface HitEvent {
  shooterId: string;
  weaponId: string;
  targetId: string;
  point: Vector3;
  damage: number;
}

interface WeaponPresentationWeaponAdapter {
  getEquipped(playerId: string): string | undefined;
}

interface PlayerModelGroupLookup {
  getGroup(playerId: string): THREE.Group | null | undefined;
}

interface WeaponPresentationConfig {
  scene: THREE.Scene;
  getCamera: () => THREE.Camera | null;
  getLocalPlayerId: () => string | null;
  weaponSystem: WeaponPresentationWeaponAdapter;
  playerModels: PlayerModelGroupLookup;
  vfxMaker: VFXMaker;
}

interface ActiveTracer {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  age: number;
  lifetime: number;
}

interface WeaponVisualProfile {
  tracerLength: number;
  tracerColor: number;
  tracerLifetime: number;
  flashPreset: keyof typeof VFX_PRESETS;
  impactPreset: keyof typeof VFX_PRESETS;
  tracerStyle: 'beam' | 'none';
  recoilKick: number;
  bodyColor: number;
  gripColor: number;
  accentColor: number;
  scale: [number, number, number];
  offset: [number, number, number];
  rotation: [number, number, number];
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_WEAPON_VISUAL: WeaponVisualProfile = {
  tracerLength: 14,
  tracerColor: 0xffd37a,
  tracerLifetime: 0.1,
  flashPreset: 'bulletImpactSpark',
  impactPreset: 'bulletImpactSpark',
  tracerStyle: 'beam',
  recoilKick: 0.65,
  bodyColor: 0x67645c,
  gripColor: 0x2a2422,
  accentColor: 0xb67e36,
  scale: [1, 1, 1],
  offset: [0.34, -0.26, -0.5],
  rotation: [-0.08, -0.06, -0.02],
};

export class WeaponPresentationSystem {
  private readonly scene: THREE.Scene;
  private readonly getCamera: () => THREE.Camera | null;
  private readonly getLocalPlayerId: () => string | null;
  private weaponSystem: WeaponPresentationWeaponAdapter;
  private playerModels: PlayerModelGroupLookup;
  private readonly vfxMaker: VFXMaker;
  private readonly tracerPool: ObjectPool<THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>>;
  private readonly tracerGeometry = new THREE.CylinderGeometry(0.018, 0.035, 1, 6);
  private readonly tracerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd37a,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  private readonly viewModelBodyMaterial = new THREE.MeshLambertMaterial({ color: DEFAULT_WEAPON_VISUAL.bodyColor, flatShading: true });
  private readonly viewModelGripMaterial = new THREE.MeshLambertMaterial({ color: DEFAULT_WEAPON_VISUAL.gripColor, flatShading: true });
  private readonly viewModelAccentMaterial = new THREE.MeshLambertMaterial({ color: DEFAULT_WEAPON_VISUAL.accentColor, flatShading: true });
  private readonly viewModelRoot = new THREE.Group();
  private readonly pistolModel = new THREE.Group();
  private readonly muzzleAnchor = new THREE.Object3D();
  private readonly tempVector = new THREE.Vector3();
  private readonly tempVectorB = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly activeTracers: ActiveTracer[] = [];
  private readonly weaponVisuals: Record<string, WeaponVisualProfile> = {
    pistol: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 15,
      tracerColor: 0xffd37a,
      tracerLifetime: 0.08,
      flashPreset: 'pistolMuzzleFlash',
      recoilKick: 0.9,
    },
    shotgun: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 10,
      tracerColor: 0xffb35a,
      tracerLifetime: 0.12,
      recoilKick: 0.95,
      bodyColor: 0x6e6253,
      gripColor: 0x34281f,
      accentColor: 0xd1a261,
      scale: [1.08, 1.02, 1.28],
      offset: [0.36, -0.28, -0.55],
    },
    rifle: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 22,
      tracerColor: 0xffc56e,
      tracerLifetime: 0.1,
      recoilKick: 0.62,
      bodyColor: 0x596064,
      gripColor: 0x20292d,
      accentColor: 0xb7c3c8,
      scale: [0.92, 0.94, 1.45],
      offset: [0.34, -0.27, -0.58],
    },
    burstRifle: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 18,
      tracerColor: 0xffbf7a,
      tracerLifetime: 0.1,
      recoilKick: 0.68,
      bodyColor: 0x54514d,
      gripColor: 0x1f1b19,
      accentColor: 0xc38847,
      scale: [0.96, 0.96, 1.3],
    },
    grenadeLauncher: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 8,
      tracerColor: 0xff8640,
      tracerLifetime: 0.14,
      recoilKick: 0.98,
      bodyColor: 0x5b4a40,
      gripColor: 0x251d18,
      accentColor: 0xdb8448,
      scale: [1.12, 1.06, 1.18],
      offset: [0.38, -0.3, -0.52],
    },
    flareGun: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 12,
      tracerColor: 0xff6f41,
      tracerLifetime: 0.12,
      flashPreset: 'pistolMuzzleFlash',
      recoilKick: 0.74,
      bodyColor: 0x5a3f35,
      gripColor: 0x271b18,
      accentColor: 0xff8c4e,
      scale: [0.86, 0.9, 0.96],
      offset: [0.31, -0.24, -0.48],
    },
    macuahuitl: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 3.2,
      tracerColor: 0xff8d54,
      tracerLifetime: 0.06,
      recoilKick: 0.82,
      bodyColor: 0x3a2319,
      gripColor: 0x1f110c,
      accentColor: 0xffa14f,
      scale: [0.7, 0.6, 1.8],
      offset: [0.3, -0.22, -0.42],
      rotation: [0.12, -0.18, 0.22],
    },
    spiritSwarmStaff: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 13,
      tracerColor: 0x8fe3c5,
      tracerLifetime: 0.14,
      flashPreset: 'spiritCastPulse',
      impactPreset: 'spiritImpactBloom',
      tracerStyle: 'none',
      recoilKick: 0.54,
      bodyColor: 0x526144,
      gripColor: 0x21301c,
      accentColor: 0xd9bd6d,
      scale: [0.58, 1.08, 2.1],
      offset: [0.29, -0.18, -0.44],
      rotation: [0.04, -0.14, 0.14],
    },
    poisonBlowgun: {
      ...DEFAULT_WEAPON_VISUAL,
      tracerLength: 18,
      tracerColor: 0x86df8e,
      tracerLifetime: 0.09,
      recoilKick: 0.36,
      bodyColor: 0x385c3f,
      gripColor: 0x19271c,
      accentColor: 0x9fe7a5,
      scale: [0.54, 0.48, 1.76],
      offset: [0.28, -0.2, -0.45],
      rotation: [-0.04, -0.12, 0.08],
    },
  };

  private time = 0;
  private recoil = 0;
  private flashCounter = 0;
  private systemContext: SystemContext | null = null;

  constructor(config: WeaponPresentationConfig) {
    this.scene = config.scene;
    this.getCamera = config.getCamera;
    this.getLocalPlayerId = config.getLocalPlayerId;
    this.weaponSystem = config.weaponSystem;
    this.playerModels = config.playerModels;
    this.vfxMaker = config.vfxMaker;
    this.tracerPool = new ObjectPool(
      () => {
        const mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial.clone());
        mesh.visible = false;
        mesh.renderOrder = 8;
        return mesh;
      },
      {
        initialSize: 12,
        onAcquire: (mesh) => {
          mesh.visible = true;
          this.scene.add(mesh);
        },
        onRelease: (mesh) => {
          mesh.visible = false;
          this.scene.remove(mesh);
        },
      },
    );

    this.buildPistolViewModel();
    this.viewModelRoot.visible = false;
    this.viewModelRoot.renderOrder = 10;
  }

  handleFire(event: FireEvent): void {
    const localPlayerId = this.getLocalPlayerId();
    const isLocal = localPlayerId !== null && event.shooterId === localPlayerId;
    const profile = this.getWeaponVisualProfile(event.weaponId);
    const flashOrigin = isLocal
      ? this.getLocalMuzzleOrigin() ?? this.toThreeVector(event.origin)
      : this.getRemoteMuzzleOrigin(event.shooterId, event.origin);

    this.spawnFlash(flashOrigin, profile.flashPreset);
    if (profile.tracerStyle === 'beam') {
      this.spawnTracer(flashOrigin, event.direction, profile.tracerLength, profile.tracerColor, profile.tracerLifetime);
    }
    gameBus.emit('stateMutation', {
      source: 'weaponPresentationSystem',
      path: 'weaponPresentation.fire',
      changedCount: 1,
    });

    if (isLocal) {
      this.recoil = Math.min(1, this.recoil + profile.recoilKick);
    }
  }

  handleImpact(event: HitEvent): void {
    const profile = this.getWeaponVisualProfile(event.weaponId);
    this.vfxMaker.triggerPreset(
      `impact_${this.flashCounter += 1}`,
      profile.impactPreset,
      event.point,
    );
    gameBus.emit('stateMutation', {
      source: 'weaponPresentationSystem',
      path: 'weaponPresentation.impact',
      changedCount: 1,
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.mountToCamera();
    this.updateViewModel(dt);
    this.updateTracers(dt);
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      tracers: this.activeTracers.length,
      pool: this.tracerPool.getStats(),
      viewModelVisible: this.viewModelRoot.visible,
    };
  }

  dispose(): void {
    this.tracerPool.releaseAll();
    this.tracerGeometry.dispose();
    this.tracerMaterial.dispose();
    this.viewModelRoot.parent?.remove(this.viewModelRoot);
    this.pistolModel.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
    });
    this.viewModelBodyMaterial.dispose();
    this.viewModelGripMaterial.dispose();
    this.viewModelAccentMaterial.dispose();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    const weaponSystem = ctx.systems.weaponSystem as WeaponPresentationWeaponAdapter | null | undefined;
    if (weaponSystem) {
      this.weaponSystem = weaponSystem;
    }
    const playerModels = ctx.systems.playerModelSystem as PlayerModelGroupLookup | null | undefined;
    if (playerModels) {
      this.playerModels = playerModels;
    }
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
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  private buildPistolViewModel(): void {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.68), this.viewModelBodyMaterial);
    slide.position.set(0, 0.02, -0.08);
    this.pistolModel.add(slide);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.44), this.viewModelBodyMaterial);
    frame.position.set(0, -0.02, 0.04);
    this.pistolModel.add(frame);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), this.viewModelGripMaterial);
    grip.position.set(0, -0.2, 0.14);
    grip.rotation.x = -0.25;
    this.pistolModel.add(grip);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.08), this.viewModelAccentMaterial);
    sight.position.set(0, 0.095, -0.26);
    this.pistolModel.add(sight);

    this.muzzleAnchor.position.set(0, 0.01, -0.43);
    this.pistolModel.add(this.muzzleAnchor);

    this.viewModelRoot.add(this.pistolModel);
  }

  private mountToCamera(): void {
    const camera = this.getCamera();
    if (!camera) return;
    if (this.viewModelRoot.parent === camera) return;
    camera.add(this.viewModelRoot);
  }

  private updateViewModel(dt: number): void {
    const localPlayerId = this.getLocalPlayerId();
    const camera = this.getCamera();
    const equippedWeaponId = localPlayerId ? this.weaponSystem.getEquipped(localPlayerId) : undefined;
    const hasProfile = !!equippedWeaponId && !!this.weaponVisuals[equippedWeaponId];
    const visible = !!localPlayerId && !!camera && hasProfile;
    this.viewModelRoot.visible = visible;

    this.recoil += (0 - this.recoil) * Math.min(1, dt * 14);
    if (!visible) return;

    const profile = this.getWeaponVisualProfile(equippedWeaponId);
    this.viewModelBodyMaterial.color.setHex(profile.bodyColor);
    this.viewModelGripMaterial.color.setHex(profile.gripColor);
    this.viewModelAccentMaterial.color.setHex(profile.accentColor);
    this.pistolModel.scale.set(profile.scale[0], profile.scale[1], profile.scale[2]);

    const breathX = Math.sin(this.time * 1.8) * 0.01;
    const breathY = Math.cos(this.time * 2.2) * 0.008;
    this.viewModelRoot.position.set(
      profile.offset[0] + breathX,
      profile.offset[1] + breathY + this.recoil * 0.04,
      profile.offset[2] + this.recoil * 0.08,
    );
    this.viewModelRoot.rotation.set(
      profile.rotation[0] + this.recoil * 0.14,
      profile.rotation[1],
      profile.rotation[2] - this.recoil * 0.08,
    );
    this.pistolModel.rotation.z = Math.sin(this.time * 1.8) * 0.02;
  }

  private updateTracers(dt: number): void {
    for (let index = this.activeTracers.length - 1; index >= 0; index -= 1) {
      const tracer = this.activeTracers[index];
      tracer.age += dt;
      const lifeT = 1 - tracer.age / tracer.lifetime;
      const material = tracer.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, lifeT * 0.9);
      if (tracer.age < tracer.lifetime) continue;
      this.tracerPool.release(tracer.mesh);
      this.activeTracers.splice(index, 1);
    }
  }

  private spawnFlash(position: THREE.Vector3, preset: string): void {
    this.vfxMaker.triggerPreset(
      `flash_${this.flashCounter += 1}`,
      preset,
      { x: position.x, y: position.y, z: position.z },
    );
  }

  private spawnTracer(origin: THREE.Vector3, direction: Vector3, length: number, color: number, lifetime: number): void {
    const mesh = this.tracerPool.acquire();
    const material = mesh.material as THREE.MeshBasicMaterial;
    const normalizedDirection = this.tempVector.set(direction.x, direction.y, direction.z).normalize();
    const midpoint = this.tempVectorB.copy(origin).addScaledVector(normalizedDirection, length * 0.5);

    this.tempQuaternion.setFromUnitVectors(UP_AXIS, normalizedDirection);
    mesh.position.copy(midpoint);
    mesh.quaternion.copy(this.tempQuaternion);
    mesh.scale.set(1, length, 1);
    material.color.setHex(color);
    material.opacity = 0.9;
    this.activeTracers.push({ mesh, age: 0, lifetime });
  }

  private getLocalMuzzleOrigin(): THREE.Vector3 | null {
    if (!this.viewModelRoot.visible) return null;
    return this.muzzleAnchor.getWorldPosition(new THREE.Vector3());
  }

  private getRemoteMuzzleOrigin(playerId: string, fallback: Vector3): THREE.Vector3 {
    const group = this.playerModels.getGroup(playerId);
    if (!group) return this.toThreeVector(fallback);
    return group.localToWorld(new THREE.Vector3(0.28, 1.15, 0.38));
  }

  private toThreeVector(vector: Vector3): THREE.Vector3 {
    return new THREE.Vector3(vector.x, vector.y, vector.z);
  }

  private getWeaponVisualProfile(weaponId?: string): WeaponVisualProfile {
    if (!weaponId) {
      return DEFAULT_WEAPON_VISUAL;
    }

    return this.weaponVisuals[weaponId] ?? DEFAULT_WEAPON_VISUAL;
  }
}