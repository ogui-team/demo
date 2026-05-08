import * as THREE from 'three';

/**
 * Renderer module
 * Handles WebGL renderer initialization and rendering
 */

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

export function initRenderer(
  canvasElement: HTMLCanvasElement,
  sceneRef: THREE.Scene,
  cameraRef: THREE.PerspectiveCamera
): THREE.WebGLRenderer {
  scene = sceneRef;
  camera = cameraRef;

  renderer = new THREE.WebGLRenderer({
    canvas: canvasElement,
    antialias: false, // PS1 aesthetic
    powerPreference: 'high-performance',
  });

  // PS1-style output gains nothing from high-DPI backbuffers, and the extra fill cost
  // dominates empty-scene frame time in production sampling.
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return renderer;
}

export function render(): void {
  if (!renderer || !scene || !camera) return;
  renderer.render(scene, camera);
}

export function setRendererSize(width: number, height: number): void {
  if (!renderer) return;
  renderer.setSize(width, height);
}

export function getRenderer(): THREE.WebGLRenderer | null {
  return renderer;
}
