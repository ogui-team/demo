import * as THREE from 'three';

interface GlobalWorldLightManagerConfig {
  getScene: () => THREE.Scene | null;
}

export class GlobalWorldLightManager {
  private readonly getScene: () => THREE.Scene | null;
  private fallbackAmbient: THREE.AmbientLight | null = null;
  private fallbackDirectional: THREE.DirectionalLight | null = null;
  private fallbackTarget: THREE.Object3D | null = null;

  constructor(config: GlobalWorldLightManagerConfig) {
    this.getScene = config.getScene;
  }

  ensurePlayLighting(reason = 'unspecified'): { injected: boolean; hasAuthoredLights: boolean } {
    const scene = this.getScene();
    if (!scene) {
      return { injected: false, hasAuthoredLights: false };
    }

    if (this.hasAuthoredLights(scene)) {
      this.clearFallbackLights();
      return { injected: false, hasAuthoredLights: true };
    }

    if (!this.fallbackAmbient) {
      const ambient = new THREE.AmbientLight(0xcfd8e6, 0.62);
      ambient.name = 'global_world_light_fallback_ambient';
      ambient.userData.globalWorldLightFallback = true;
      scene.add(ambient);
      this.fallbackAmbient = ambient;
    }

    if (!this.fallbackDirectional) {
      const directional = new THREE.DirectionalLight(0xfff1d6, 1.85);
      directional.name = 'global_world_light_fallback_directional';
      directional.userData.globalWorldLightFallback = true;
      directional.castShadow = true;
      directional.shadow.mapSize.set(1024, 1024);
      directional.shadow.camera.near = 0.5;
      directional.shadow.camera.far = 80;
      directional.shadow.bias = -0.0006;
      directional.position.set(14, 22, 10);

      const target = new THREE.Object3D();
      target.name = 'global_world_light_fallback_target';
      target.userData.globalWorldLightFallback = true;
      target.position.set(0, 0, 0);

      directional.target = target;
      scene.add(target);
      scene.add(directional);

      this.fallbackTarget = target;
      this.fallbackDirectional = directional;
    }

    console.log('[GlobalWorldLightManager] Injected fallback play lighting', { reason });
    return { injected: true, hasAuthoredLights: false };
  }

  hasAuthoredSceneLights(): boolean {
    const scene = this.getScene();
    if (!scene) {
      return false;
    }
    return this.hasAuthoredLights(scene);
  }

  clearFallbackLights(): void {
    const scene = this.getScene();
    if (!scene) {
      this.fallbackAmbient = null;
      this.fallbackDirectional = null;
      this.fallbackTarget = null;
      return;
    }

    if (this.fallbackDirectional) {
      scene.remove(this.fallbackDirectional);
      this.fallbackDirectional = null;
    }
    if (this.fallbackTarget) {
      scene.remove(this.fallbackTarget);
      this.fallbackTarget = null;
    }
    if (this.fallbackAmbient) {
      scene.remove(this.fallbackAmbient);
      this.fallbackAmbient = null;
    }
  }

  private hasAuthoredLights(scene: THREE.Scene): boolean {
    let found = false;
    scene.traverse((object) => {
      if (found) {
        return;
      }
      const candidate = object as THREE.Object3D & { isLight?: boolean };
      if (candidate.isLight !== true) {
        return;
      }
      if (object.userData?.globalWorldLightFallback === true) {
        return;
      }
      found = true;
    });
    return found;
  }
}