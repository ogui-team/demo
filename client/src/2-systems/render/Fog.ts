import * as THREE from 'three';
import { getScene } from './Scene';

/**
 * Fog module
 * Handles exponential fog effects
 */

let fog: THREE.FogExp2 | null = null;

interface FogConfig {
  color?: number;
  density?: number;
}

interface FogConfigResult {
  color: number;
  density: number;
}

const defaultConfig: Required<FogConfig> = {
  color: 0x334444, // Slightly lighter fog for visibility (teal-dark-gray)
  density: 0.02, // Increased for more prominent effect
};

export function initFog(config: FogConfig = {}): THREE.FogExp2 {
  const settings = { ...defaultConfig, ...config };

  fog = new THREE.FogExp2(settings.color, settings.density);

  const scene = getScene();
  if (scene) {
    scene.fog = fog;
  }

  return fog;
}

export function getFog(): THREE.FogExp2 | null {
  return fog;
}

export function setFogDensity(density: number): void {
  if (fog) {
    fog.density = density;
  }
}

export function setFogColor(color: number): void {
  if (fog) {
    fog.color = new THREE.Color(color);
  }
}

export function getFogConfig(): FogConfigResult | null {
  if (!fog) return null;
  return {
    color: fog.color.getHex(),
    density: fog.density,
  };
}
