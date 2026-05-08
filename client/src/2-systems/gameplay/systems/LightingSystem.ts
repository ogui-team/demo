import * as THREE from 'three';
import type { Entity } from '../../../1-kernel/core/Entity';
import { EntityManager } from '../../../1-kernel/core/EntityManager';
import type { LightComponentData } from './components/LightComponent';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

export interface LightingSystemConfig {
  shadowCastDistance?: number;
  visibilityDistance?: number;
}

interface LightMapEntry {
  light: THREE.Light;
  target?: THREE.Object3D;
  type: LightComponentData['type'];
  originalCastShadow: boolean;
}

export class LightingSystem {
  private readonly entityManager: EntityManager;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly config: Required<LightingSystemConfig>;
  private readonly lightsByEntityId = new Map<string, LightMapEntry>();
  private readonly disposers: Array<() => void> = [];
  private systemContext: SystemContext | null = null;

  constructor(
    entityManager: EntityManager,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: LightingSystemConfig = {},
  ) {
    this.entityManager = entityManager;
    this.scene = scene;
    this.camera = camera;
    this.config = {
      shadowCastDistance: config.shadowCastDistance ?? 50,
      visibilityDistance: config.visibilityDistance ?? 100,
    };
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
      usesReplication: false,
      exposesDebug: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  start(): void {
    this.entityManager.getEntitiesWithComponent('light').forEach((entity) => {
      this.ensureLight(entity);
    });

    this.disposers.push(
      this.entityManager.onEntityUpdated((entity) => this.onEntityUpdated(entity)),
      this.entityManager.onEntityDestroyed((entity) => this.disposeLight(entity.id)),
    );
  }

  update(_dt: number): void {
    for (const [entityId, entry] of this.lightsByEntityId.entries()) {
      const entity = this.entityManager.activeEntities.get(entityId);
      if (!entity || !entity.hasComponent('light')) {
        this.disposeLight(entityId);
        continue;
      }

      this.syncLightWithEntity(entity, entry);
    }
  }

  destroy(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
    for (const key of Array.from(this.lightsByEntityId.keys())) {
      this.disposeLight(key);
    }
  }

  private onEntityUpdated(entity: Entity): void {
    if (entity.hasComponent('light')) {
      this.ensureLight(entity);
      return;
    }

    this.disposeLight(entity.id);
  }

  private ensureLight(entity: Entity): void {
    const component = entity.getComponent('light');
    if (!component) {
      return;
    }

    const data = component.data as LightComponentData;
    const existing = this.lightsByEntityId.get(entity.id);
    if (existing) {
      this.applyLightSettings(existing.light, data);
      existing.originalCastShadow = data.castShadow ?? existing.originalCastShadow;
      this.syncLightWithEntity(entity, existing);
      return;
    }

    const entry = this.createLightEntry(data);
    this.lightsByEntityId.set(entity.id, entry);
    this.scene.add(entry.light);
    if (entry.target) {
      this.scene.add(entry.target);
      (entry.light as THREE.SpotLight).target = entry.target;
    }

    this.syncLightWithEntity(entity, entry);
  }

  private createLightEntry(data: LightComponentData): LightMapEntry {
    let light: THREE.Light;
    let target: THREE.Object3D | undefined;

    if (data.type === 'spot') {
      const spot = new THREE.SpotLight(
        data.color,
        data.intensity,
        data.distance,
        data.angle ?? Math.PI * 0.34,
        data.penumbra ?? 0.2,
        data.decay ?? 2,
      );
      spot.castShadow = data.castShadow ?? true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.radius = data.shadowRadius ?? 3;
      spot.shadow.bias = data.shadowBias ?? -0.001;
      target = new THREE.Object3D();
      light = spot;
    } else {
      const point = new THREE.PointLight(
        data.color,
        data.intensity,
        data.distance,
        data.decay ?? 2,
      );
      point.castShadow = data.castShadow ?? true;
      point.shadow.mapSize.set(1024, 1024);
      point.shadow.radius = data.shadowRadius ?? 2;
      point.shadow.bias = data.shadowBias ?? -0.001;
      light = point;
    }

    light.userData.isEntityLight = true;
    light.userData.lightType = data.type;

    return {
      light,
      target,
      type: data.type,
      originalCastShadow: data.castShadow ?? true,
    };
  }

  private applyLightSettings(light: THREE.Light, data: LightComponentData): void {
    light.color.setHex(data.color);
    light.intensity = data.intensity;

    if (light instanceof THREE.PointLight) {
      light.distance = data.distance ?? light.distance;
      light.decay = data.decay ?? light.decay;
      light.castShadow = data.castShadow ?? light.castShadow;
      light.shadow.radius = data.shadowRadius ?? light.shadow.radius;
      light.shadow.bias = data.shadowBias ?? light.shadow.bias;
    }

    if (light instanceof THREE.SpotLight) {
      light.distance = data.distance ?? light.distance;
      light.decay = data.decay ?? light.decay;
      light.angle = data.angle ?? light.angle;
      light.penumbra = data.penumbra ?? light.penumbra;
      light.castShadow = data.castShadow ?? light.castShadow;
      light.shadow.radius = data.shadowRadius ?? light.shadow.radius;
      light.shadow.bias = data.shadowBias ?? light.shadow.bias;
    }
  }

  private syncLightWithEntity(entity: Entity, entry: LightMapEntry): void {
    const position = entity.getPosition();
    entry.light.position.set(position.x, position.y, position.z);

    if (entry.target && entry.light instanceof THREE.SpotLight) {
      const offset = (entity.getComponent('light')!.data as LightComponentData).targetOffset ?? { x: 0, y: -1, z: 0 };
      entry.target.position.set(position.x + offset.x, position.y + offset.y, position.z + offset.z);
      entry.target.updateMatrixWorld();
    }

    this.applyDistanceCulling(entry);
  }

  private applyDistanceCulling(entry: LightMapEntry): void {
    const lightPosition = entry.light.position;
    const distanceSq = this.camera.position.distanceToSquared(lightPosition);
    const castShadowDistanceSq = this.config.shadowCastDistance * this.config.shadowCastDistance;
    const visibleDistanceSq = this.config.visibilityDistance * this.config.visibilityDistance;

    const withinVisibility = distanceSq <= visibleDistanceSq;
    const withinShadowRange = distanceSq <= castShadowDistanceSq;

    entry.light.visible = withinVisibility;
    entry.light.castShadow = withinVisibility && withinShadowRange && entry.originalCastShadow;
  }

  private disposeLight(entityId: string): void {
    const entry = this.lightsByEntityId.get(entityId);
    if (!entry) {
      return;
    }

    if (entry.light.parent) {
      entry.light.parent.remove(entry.light);
    }

    if (entry.target && entry.target.parent) {
      entry.target.parent.remove(entry.target);
    }

    if (typeof (entry.light as any).dispose === 'function') {
      (entry.light as any).dispose();
    }

    this.lightsByEntityId.delete(entityId);
  }
}
