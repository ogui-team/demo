import * as THREE from 'three';
import { getCameraStateAdapter } from '../../camera/CameraStateAdapter';

/**
 * Camera Effects module
 * Subtle sway, jitter, and optional FOV changes
 */

interface CameraEffectConfig {
  swaySpeed?: number;
  swayIntensity?: number;
  jitterIntensity?: number;
  enableFOVPulse?: boolean;
  fovPulseSpeed?: number;
  fovPulseAmount?: number;
}

export class CameraEffects {
  private swaySpeed: number;
  private swayIntensity: number;
  private jitterIntensity: number;
  private enableFOVPulse: boolean;
  private fovPulseSpeed: number;
  private fovPulseAmount: number;
  private time: number = 0;
  private enabled: boolean = true;

  // Track the previously applied positional offset so we can remove it next frame.
  private _prevOffset: THREE.Vector3 = new THREE.Vector3();
  private readonly channelId = 'atmosphere-camera-effects';

  constructor(config: CameraEffectConfig = {}) {
    this.swaySpeed = config.swaySpeed || 0.7;
    this.swayIntensity = config.swayIntensity || 0.08;
    this.jitterIntensity = config.jitterIntensity || 0.02;
    this.enableFOVPulse = config.enableFOVPulse || false;
    this.fovPulseSpeed = config.fovPulseSpeed || 0.5;
    this.fovPulseAmount = config.fovPulseAmount || 2;
  }

  update(deltaTime: number): void {
    const cameraAdapter = getCameraStateAdapter();
    if (!cameraAdapter) return;

    this.time += deltaTime;

    if (!this.enabled) {
      this._prevOffset.set(0, 0, 0);
      cameraAdapter.clearPositionOffset(this.channelId);
      cameraAdapter.clearFovOffset(this.channelId);
      return;
    }

    // Subtle sway on X and Z axes
    const swayX = Math.sin(this.time * this.swaySpeed) * this.swayIntensity;
    const swayZ = Math.cos(this.time * this.swaySpeed * 0.7) * this.swayIntensity;

    // Random jitter
    const jitterX = (Engine.random.next() - 0.5) * this.jitterIntensity;
    const jitterY = (Engine.random.next() - 0.5) * this.jitterIntensity;
    const jitterZ = (Engine.random.next() - 0.5) * this.jitterIntensity;

    // Store and apply new offset
    this._prevOffset.set(swayX + jitterX, jitterY, swayZ + jitterZ);
    cameraAdapter.setPositionOffset(this.channelId, this._prevOffset);

    // Optional FOV pulse
    if (this.enableFOVPulse) {
      const fovPulse = Math.sin(this.time * this.fovPulseSpeed) * this.fovPulseAmount;
      cameraAdapter.setFovOffset(this.channelId, fovPulse);
    } else {
      cameraAdapter.clearFovOffset(this.channelId);
    }
  }

  /** No-op kept for API compatibility. Base position is now implicit (controller-driven). */
  setBasePosition(_pos: THREE.Vector3): void { /* intentionally empty */ }

  setSwaySpeed(speed: number): void {
    this.swaySpeed = speed;
  }

  setSwayIntensity(intensity: number): void {
    this.swayIntensity = intensity;
  }

  setJitterIntensity(intensity: number): void {
    this.jitterIntensity = intensity;
  }

  setFOVPulseSpeed(speed: number): void {
    this.fovPulseSpeed = speed;
  }

  setFOVPulseAmount(amount: number): void {
    this.fovPulseAmount = amount;
  }

  enableFOVPulsing(enabled: boolean): void {
    this.enableFOVPulse = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      const cameraAdapter = getCameraStateAdapter();
      this._prevOffset.set(0, 0, 0);
      cameraAdapter?.clearPositionOffset(this.channelId);
      cameraAdapter?.clearFovOffset(this.channelId);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    const cameraAdapter = getCameraStateAdapter();
    this._prevOffset.set(0, 0, 0);
    cameraAdapter?.clearPositionOffset(this.channelId);
    cameraAdapter?.clearFovOffset(this.channelId);
  }
}
