import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { getGeneratedItemTexture } from '../../../4-runtime/ui/GeneratedItemTextures';

interface ViewModelSystemConfig {
  getCamera: () => THREE.Camera | null;
  getScene: () => THREE.Scene | null;
  getLocalPlayerId: () => string | null;
}

export class ViewModelSystem {
  private readonly getCamera: () => THREE.Camera | null;
  private readonly getScene: () => THREE.Scene | null;
  private readonly getLocalPlayerId: () => string | null;
  private readonly viewModelRoot = new THREE.Group();
  private readonly itemPreviewRoot = new THREE.Group();
  private readonly orbGroup = new THREE.Group();
  private readonly ringGroup = new THREE.Group();
  private currentPreviewItemId: string | null = null;
  private time = 0;
  private castKick = 0;
  private readonly itemPreviewBasePosition = new THREE.Vector3(0.26, -0.2, -0.42);
  private readonly itemPreviewScale = 0.72;
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempLocalQuaternion = new THREE.Quaternion();

  constructor(config: ViewModelSystemConfig) {
    this.getCamera = config.getCamera;
    this.getScene = config.getScene;
    this.getLocalPlayerId = config.getLocalPlayerId;

    this.buildFireballViewModel();
    this.viewModelRoot.visible = false;
    this.viewModelRoot.renderOrder = 14;
    this.itemPreviewRoot.visible = false;
    this.itemPreviewRoot.renderOrder = 999;
    this.itemPreviewRoot.scale.setScalar(this.itemPreviewScale);

    (gameBus as any).on('abilityCast', (payload: any) => {
      if (payload?.abilityId !== 'ability_fireball') {
        return;
      }
      if (payload.entityId !== this.getLocalPlayerId()) {
        return;
      }
      this.castKick = 1;
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.mountToScene();

    const camera = this.getCamera();
    if (!camera) {
      return;
    }
    camera.updateMatrixWorld(true);

    const toolbarSlot = Engine.getToolbarSystem()?.getActiveSlot();
    const itemId = toolbarSlot?.itemId ?? null;
    const showFireball = Boolean(this.getLocalPlayerId()) && itemId === 'debug_fireball';
    const showItemPreview = Boolean(this.getLocalPlayerId()) && !!itemId && itemId !== 'debug_fireball';
    const swayX = Math.sin(this.time * 1.9) * 0.012;
    const swayY = Math.cos(this.time * 2.4) * 0.01;

    this.viewModelRoot.visible = showFireball;
    this.itemPreviewRoot.visible = showItemPreview;
    if (showItemPreview && itemId) {
      this.updateItemPreview(itemId);
      this.syncRootToCamera(
        this.itemPreviewRoot,
        this.itemPreviewBasePosition.x + swayX * 0.6,
        this.itemPreviewBasePosition.y + swayY * 0.6,
        this.itemPreviewBasePosition.z,
        -0.18 + swayY * 0.18,
        0.36 - swayX * 0.4,
        0.02 + swayX * 0.25,
        this.itemPreviewScale,
      );
    } else {
      this.currentPreviewItemId = null;
    }

    this.castKick += (0 - this.castKick) * Math.min(1, dt * 12);
    if (!showFireball && !showItemPreview) {
      return;
    }

    const pulse = 1 + Math.sin(this.time * 6.8) * 0.08 + this.castKick * 0.18;

    if (showFireball) {
      this.syncRootToCamera(
        this.viewModelRoot,
        0.31 + swayX,
        -0.24 + swayY + this.castKick * 0.06,
        -0.42 + this.castKick * 0.1,
        -0.16 + this.castKick * 0.22,
        -0.42 - this.castKick * 0.12,
        0.18 - this.castKick * 0.18,
        1,
      );
      this.orbGroup.scale.setScalar(pulse);
      this.ringGroup.rotation.x += dt * 1.4;
      this.ringGroup.rotation.y -= dt * 2.8;
      this.ringGroup.rotation.z += dt * 1.9;
    }
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      visible: this.viewModelRoot.visible,
      castKick: this.castKick,
    };
  }

  private buildFireballViewModel(): void {
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshPhongMaterial({
        color: 0xff6a24,
        emissive: 0xffb347,
        emissiveIntensity: 2.6,
        flatShading: true,
      }),
    );
    this.orbGroup.add(core);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffcf7a,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.orbGroup.add(glow);

    const ringA = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.018, 8, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    ringA.rotation.x = Math.PI * 0.5;
    this.ringGroup.add(ringA);

    const ringB = ringA.clone();
    ringB.rotation.y = Math.PI * 0.5;
    this.ringGroup.add(ringB);

    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.24, 0.12),
      new THREE.MeshPhongMaterial({
        color: 0x3f271f,
        emissive: 0x110804,
        emissiveIntensity: 0.2,
        flatShading: true,
      }),
    );
    palm.position.set(0.06, -0.18, 0.04);
    palm.rotation.z = -0.35;

    this.viewModelRoot.add(this.orbGroup);
    this.viewModelRoot.add(this.ringGroup);
    this.viewModelRoot.add(palm);
  }

  private updateItemPreview(itemId: string): void {
    if (this.currentPreviewItemId === itemId) {
      return;
    }
    this.currentPreviewItemId = itemId;
    this.itemPreviewRoot.clear();
    this.itemPreviewRoot.add(this.createItemPreviewModel(itemId));
  }

  private createItemPreviewModel(itemId: string): THREE.Group {
    const group = new THREE.Group();
    const previewItemId = itemId.startsWith('weapon_') ? itemId.slice('weapon_'.length) : itemId;
    const texture = getGeneratedItemTexture(itemId);
    const backdrop = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.018),
      this.createPreviewMaterial({
        color: 0x0f3a31,
        opacity: 0.28,
        transparent: true,
      }),
    );
    backdrop.position.set(0, 0, -0.14);
    group.add(backdrop);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      this.createPreviewMaterial({
        color: 0xcdeee5,
        map: texture,
      }),
    );
    group.add(base);

    let detail: THREE.Mesh;
    switch (previewItemId) {
      case 'debug_fireball':
        detail = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.08, 0),
          this.createPreviewMaterial({ color: 0xff9548 }),
        );
        detail.position.set(0, 0.14, 0);
        break;
      case 'macuahuitl':
        detail = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.16, 0.42),
          this.createPreviewMaterial({ color: 0x7b5a2f }),
        );
        detail.position.set(0, 0.05, 0.02);
        const obsidianEdge = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.14, 0.34),
          this.createPreviewMaterial({ color: 0x6de2d2 }),
        );
        obsidianEdge.position.set(0.035, 0.08, 0.02);
        group.add(obsidianEdge);
        break;
      case 'flareGun':
        detail = new THREE.Mesh(
          new THREE.BoxGeometry(0.13, 0.07, 0.24),
          this.createPreviewMaterial({ color: 0xff8e45 }),
        );
        detail.position.set(0, 0.05, 0.01);
        break;
      case 'health_potion_sm':
        detail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.05, 0.16, 10),
          this.createPreviewMaterial({ color: 0xff6c8d }),
        );
        detail.position.set(0, 0.03, 0.02);
        break;
      case 'poisonBlowgun':
        detail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.018, 0.44, 12),
          this.createPreviewMaterial({ color: 0x6ab46e }),
        );
        detail.rotation.set(0, 0, Math.PI * 0.5);
        detail.position.set(0, 0.06, 0.02);
        break;
      case 'spiritSwarmStaff':
        detail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.024, 0.03, 0.42, 12),
          this.createPreviewMaterial({ color: 0xe6d07b }),
        );
        detail.rotation.set(0.2, 0, -0.22);
        detail.position.set(0, 0.05, 0.02);
        const spiritHead = new THREE.Mesh(
          new THREE.SphereGeometry(0.065, 10, 10),
          this.createPreviewMaterial({ color: 0x9de7df }),
        );
        spiritHead.position.set(0.02, 0.17, 0.04);
        group.add(spiritHead);
        break;
      case 'health_pack':
      case 'health_small':
      case 'stim_pack':
        detail = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.12, 0.03),
          this.createPreviewMaterial({ color: 0xffffff }),
        );
        detail.position.set(0, 0, 0.105);
        break;
      case 'ammo_9mm':
        detail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10),
          this.createPreviewMaterial({ color: 0xe1b46a }),
        );
        detail.rotation.set(Math.PI * 0.5, 0, 0);
        detail.position.set(0, 0.06, 0);
        break;
      case 'weapon_pistol':
        detail = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.06, 0.24),
          this.createPreviewMaterial({ color: 0xb8c6dc }),
        );
        detail.position.set(0, 0.06, 0.0);
        const barrel = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.04, 0.18),
          this.createPreviewMaterial({ color: 0x6c6f78 }),
        );
        barrel.position.set(0, 0.04, 0.16);
        group.add(barrel);
        break;
      case 'weapon_knife':
        detail = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.06, 0.2),
          this.createPreviewMaterial({ color: 0xc5c6c7 }),
        );
        detail.position.set(0, 0.08, 0.0);
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 0.08),
          this.createPreviewMaterial({ color: 0x5a4532 }),
        );
        handle.position.set(0, 0.01, -0.08);
        group.add(handle);
        break;
      case 'physgun_tool':
        detail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 0.18, 10),
          this.createPreviewMaterial({ color: 0x7aa8ff }),
        );
        detail.rotation.set(Math.PI * 0.15, 0, 0);
        detail.position.set(0, 0.04, 0);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.09, 0.01, 8, 18),
          this.createPreviewMaterial({ color: 0x4a73d9, transparent: true, opacity: 0.85 }),
        );
        ring.rotation.set(Math.PI * 0.5, 0, 0);
        ring.position.set(0, 0.08, 0);
        group.add(ring);
        break;
      default:
        detail = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 10, 10),
          this.createPreviewMaterial({ color: 0x7fe1d7 }),
        );
        detail.position.set(0, 0.1, 0);
        break;
    }
    group.add(detail);
    group.rotation.set(-0.2, 0.5, 0);
    group.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) {
        return;
      }

      const mesh = node as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m.depthTest = false;
        m.depthWrite = false;
        m.toneMapped = false;
      }
      mesh.renderOrder = 999;
    });
    return group;
  }

  private createPreviewMaterial(options: {
    color: number;
    map?: THREE.Texture | null;
    transparent?: boolean;
    opacity?: number;
  }): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: options.color,
      map: options.map ?? null,
      transparent: options.transparent ?? (typeof options.opacity === 'number' && options.opacity < 1),
      opacity: options.opacity ?? 1,
    });
  }

  private mountToScene(): void {
    const scene = this.getScene();
    if (!scene) {
      return;
    }

    if (this.viewModelRoot.parent !== scene) {
      scene.add(this.viewModelRoot);
    }
    if (this.itemPreviewRoot.parent !== scene) {
      scene.add(this.itemPreviewRoot);
    }
  }

  private syncRootToCamera(
    root: THREE.Group,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    scale: number,
  ): void {
    const camera = this.getCamera();
    if (!camera) {
      return;
    }

    this.tempPosition.set(offsetX, offsetY, offsetZ);
    camera.localToWorld(this.tempPosition);
    root.position.copy(this.tempPosition);

    this.tempLocalQuaternion.setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
    this.tempQuaternion.copy(camera.quaternion).multiply(this.tempLocalQuaternion);
    root.quaternion.copy(this.tempQuaternion);
    root.scale.setScalar(scale);
  }
}