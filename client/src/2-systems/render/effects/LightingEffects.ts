import * as THREE from 'three';
import { getAmbientLight, getDirectionalLight } from '../Lights';
import { addToScene } from '../Scene';

/**
 * Lighting Effects module
 * Flickering ambient light and moving point lights
 */

interface LightingEffectConfig {
  ambientFlickerSpeed?: number;
  ambientFlickerIntensity?: number;
  enableMovingLight?: boolean;
  movingLightSpeed?: number;
  movingLightColor?: THREE.Color;
  movingLightIntensity?: number;
  movingLightRadius?: number;
}

export class LightingEffects {
  private scene: THREE.Scene;
  ambientLight: THREE.AmbientLight | null;
  private movingLight: THREE.PointLight | null = null;
  private baseAmbientIntensity: number = 0.4;
  private enabled: boolean = true;
  private ambientFlickerSpeed: number;
  private ambientFlickerIntensity: number;
  private movingLightSpeed: number;
  private movingLightRadius: number;
  private time: number = 0;

  constructor(scene: THREE.Scene, config: LightingEffectConfig = {}) {
    this.scene = scene;
    this.ambientLight = getAmbientLight();

    this.ambientFlickerSpeed = config.ambientFlickerSpeed || 4.5;
    this.ambientFlickerIntensity = config.ambientFlickerIntensity || 0.08;
    this.movingLightSpeed = config.movingLightSpeed || 0.5;
    this.movingLightRadius = config.movingLightRadius || 15;

    if (config.enableMovingLight !== false) {
      this.createMovingLight(
        config.movingLightColor || new THREE.Color(0x6688ff),
        config.movingLightIntensity || 0.4
      );
    }
  }

  private createMovingLight(color: THREE.Color, intensity: number): void {
    this.movingLight = new THREE.PointLight(color, intensity, 50);
    this.movingLight.position.set(0, 8, 0);
    this.scene.add(this.movingLight);
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;
    this.time += deltaTime;

    // Ambient light flickering
    if (this.ambientLight) {
      // Subtle high-frequency flicker
      const flicker =
        Math.sin(this.time * this.ambientFlickerSpeed * 2.5) * 0.5 +
        Math.sin(this.time * this.ambientFlickerSpeed * 1.8) * 0.3;

      const noise = Math.random() * this.ambientFlickerIntensity * 0.3;
      this.ambientLight.intensity =
        this.baseAmbientIntensity + flicker * this.ambientFlickerIntensity + noise;
    }

    // Moving point light with slow orbit
    if (this.movingLight) {
      const angle = this.time * this.movingLightSpeed;
      this.movingLight.position.x = Math.cos(angle) * this.movingLightRadius;
      this.movingLight.position.z = Math.sin(angle) * this.movingLightRadius;
      this.movingLight.position.y = 8 + Math.sin(this.time * 0.3) * 2;
    }
  }

  setAmbientFlickerSpeed(speed: number): void {
    this.ambientFlickerSpeed = speed;
  }

  setAmbientFlickerIntensity(intensity: number): void {
    this.ambientFlickerIntensity = intensity;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.movingLight) {
      this.movingLight.visible = enabled;
    }
    if (this.ambientLight && !enabled) {
      this.ambientLight.intensity = this.baseAmbientIntensity;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setMovingLightSpeed(speed: number): void {
    this.movingLightSpeed = speed;
  }

  destroy(): void {
    if (this.movingLight) {
      this.scene.remove(this.movingLight);
    }
  }
}
