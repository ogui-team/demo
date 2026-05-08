import * as THREE from 'three';
import { addToScene } from './Scene';

/**
 * Lights module
 * Handles ambient and directional lighting
 */

interface Lights {
  ambient: THREE.AmbientLight | null;
  directional: THREE.DirectionalLight | null;
}

const lights: Lights = {
  ambient: null,
  directional: null,
};

const SHADOW_CAMERA_RANGE = 48;
const SUN_DISTANCE = 28;
const SUN_DIRECTION = new THREE.Vector3(0.64, -1.0, 0.28).normalize();

export function initLights(): Lights {
  lights.ambient = new THREE.AmbientLight(0xd8e8ff, 0.35);
  addToScene(lights.ambient);

  lights.directional = new THREE.DirectionalLight(0xf6f4eb, 1.0);
  lights.directional.position.set(5, 10, 7);
  lights.directional.castShadow = true;

  const shadow = lights.directional.shadow;
  shadow.mapSize.set(2048, 2048);
  shadow.radius = 4;
  shadow.bias = -0.0006;
  shadow.camera.near = 1;
  shadow.camera.far = 120;

  const cam = shadow.camera as THREE.OrthographicCamera;
  cam.left = -SHADOW_CAMERA_RANGE;
  cam.right = SHADOW_CAMERA_RANGE;
  cam.top = SHADOW_CAMERA_RANGE;
  cam.bottom = -SHADOW_CAMERA_RANGE;
  cam.updateProjectionMatrix();

  addToScene(lights.directional);
  addToScene(lights.directional.target);
  lights.directional.target.position.set(0, 0, 0);

  return lights;
}

export function getAmbientLight(): THREE.AmbientLight | null {
  return lights.ambient;
}

export function getDirectionalLight(): THREE.DirectionalLight | null {
  return lights.directional;
}

export function setAmbientIntensity(intensity: number): void {
  if (lights.ambient) {
    lights.ambient.intensity = intensity;
  }
}

export function setDirectionalIntensity(intensity: number): void {
  if (lights.directional) {
    lights.directional.intensity = intensity;
  }
}

export function setDirectionalPosition(x: number, y: number, z: number): void {
  if (lights.directional) {
    lights.directional.position.set(x, y, z);
  }
}

export function updateGlobalSunlight(playerPosition: THREE.Vector3): void {
  if (!lights.directional) {
    return;
  }

  const targetPosition = new THREE.Vector3().copy(playerPosition);
  const sunPosition = new THREE.Vector3()
    .copy(playerPosition)
    .addScaledVector(SUN_DIRECTION, SUN_DISTANCE);

  lights.directional.position.copy(sunPosition);
  lights.directional.target.position.copy(targetPosition);
  lights.directional.target.updateMatrixWorld();

  const shadowCamera = lights.directional.shadow.camera as THREE.OrthographicCamera;
  shadowCamera.left = -SHADOW_CAMERA_RANGE;
  shadowCamera.right = SHADOW_CAMERA_RANGE;
  shadowCamera.top = SHADOW_CAMERA_RANGE;
  shadowCamera.bottom = -SHADOW_CAMERA_RANGE;
  shadowCamera.updateProjectionMatrix();
}
