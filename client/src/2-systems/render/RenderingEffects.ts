import * as THREE from 'three';

/**
 * Rendering Effects module
 * Reduces rendering precision and simulates low-poly look
 */

interface RenderingEffectConfig {
  enableVertexSnap?: boolean;
  snapGridSize?: number;
  dithering?: boolean;
}

export class RenderingEffects {
  private renderer: THREE.WebGLRenderer;
  private enableVertexSnap: boolean;
  private snapGridSize: number;
  private dithering: boolean;

  // Store original materials to modify
  private modifiedMaterials: Map<THREE.Material, THREE.Material> = new Map();

  constructor(renderer: THREE.WebGLRenderer, config: RenderingEffectConfig = {}) {
    this.renderer = renderer;
    this.enableVertexSnap = config.enableVertexSnap !== false;
    this.snapGridSize = config.snapGridSize || 0.125; // 1/8 unit precision
    this.dithering = config.dithering !== false;

    // Apply renderer settings for PS1-like aesthetic
    renderer.sortObjects = true;
    renderer.shadowMap.enabled = false; // Reduce complexity
  }

  /**
   * Apply vertex snapping to geometry
   * Snaps vertices to a grid to create low-poly effect
   */
  snapGeometryVertices(geometry: THREE.BufferGeometry, gridSize: number = 0.125): void {
    if (!this.enableVertexSnap) return;

    const positions = geometry.attributes.position;
    if (!positions) return;

    const posArray = positions.array as Float32Array;

    for (let i = 0; i < posArray.length; i += 3) {
      posArray[i] = Math.round(posArray[i] / gridSize) * gridSize;
      posArray[i + 1] = Math.round(posArray[i + 1] / gridSize) * gridSize;
      posArray[i + 2] = Math.round(posArray[i + 2] / gridSize) * gridSize;
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /**
   * Apply film grain/dithering shader to materials
   */
  applyDitheringToMaterial(material: THREE.Material): void {
    if (!this.dithering || !(material instanceof THREE.MeshPhongMaterial)) {
      return;
    }

    // Reduce precision by disabling high-quality features
    material.flatShading = true;
  }

  /**
   * Update renderer settings
   */
  update(_deltaTime: number): void {
    // Renderer settings are applied in constructor
    // Could add dynamic precision changes here if needed
  }

  destroy(): void {
    this.modifiedMaterials.clear();
  }
}
