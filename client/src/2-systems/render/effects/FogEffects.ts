import * as THREE from 'three';
import { getFog } from '../Fog';

/**
 * Fog Effects module
 * Dynamic fog with pulsing and color shifts
 */

interface FogEffectConfig {
  pulsSpeed?: number;
  pulsIntensity?: number;
  colorShiftSpeed?: number;
  minDensity?: number;
  maxDensity?: number;
  startColor?: THREE.Color;
  endColor?: THREE.Color;
}

export class FogEffects {
  private scene: THREE.Scene;
  private fog: THREE.FogExp2 | null;
  baseDensity: number;
  private enabled: boolean = true;
  private pulsSpeed: number;
  private pulsIntensity: number;
  private colorShiftSpeed: number;
  private minDensity: number;
  private maxDensity: number;
  private startColor: THREE.Color;
  private endColor: THREE.Color;
  private time: number = 0;

  constructor(scene: THREE.Scene, config: FogEffectConfig = {}) {
    this.scene = scene;
    this.fog = getFog();

    this.baseDensity = config.minDensity || 0.015;
    this.pulsSpeed = config.pulsSpeed || 0.8;
    this.pulsIntensity = config.pulsIntensity || 0.002;
    this.colorShiftSpeed = config.colorShiftSpeed || 0.15;
    this.minDensity = config.minDensity || 0.015;
    this.maxDensity = config.maxDensity || 0.025;

    // Fog color range: dark gray to darker gray
    this.startColor = config.startColor || new THREE.Color(0x1a1a1a);
    this.endColor = config.endColor || new THREE.Color(0x0d0d0d);
  }

  update(deltaTime: number): void {
    if (!this.fog || !this.enabled) return;

    this.time += deltaTime;

    // Subtle pulsing fog density
    const puls = Math.sin(this.time * this.pulsSpeed) * this.pulsIntensity;
    this.fog.density = this.baseDensity + puls;

    // Very slow color shift
    const colorShift = (Math.sin(this.time * this.colorShiftSpeed) + 1) / 2; // 0 to 1
    const shiftedColor = new THREE.Color();
    shiftedColor.lerpColors(this.startColor, this.endColor, colorShift);
    this.fog.color.copy(shiftedColor);
    this.scene.background = shiftedColor.clone();
  }

  setBaseDensity(density: number): void {
    this.baseDensity = density;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.fog) {
      this.fog.density = enabled ? this.baseDensity : 0;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setPulsSpeed(speed: number): void {
    this.pulsSpeed = speed;
  }

  setPulsIntensity(intensity: number): void {
    this.pulsIntensity = intensity;
  }

  setColorShiftSpeed(speed: number): void {
    this.colorShiftSpeed = speed;
  }

  destroy(): void {
    // Cleanup if needed
  }
}
