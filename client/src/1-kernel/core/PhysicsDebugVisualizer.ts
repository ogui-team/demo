/**
 * Physics Debug Visualization System
 * Renders all physics colliders from SimulationKernel as semi-transparent debug geometry
 * 
 * Usage:
 *   const debugViz = new PhysicsDebugVisualizer(kernel, scene);
 *   debugViz.renderPhysicsDebugColliders();
 */

import * as THREE from 'three';
import type { SimulationKernel } from './kernel/SimulationKernel';

export class PhysicsDebugVisualizer {
  private readonly kernel: SimulationKernel;
  private readonly scene: THREE.Scene;
  private debugMeshes: THREE.Mesh[] = [];
  private enabled = true;

  constructor(kernel: SimulationKernel, scene: THREE.Scene) {
    this.kernel = kernel;
    this.scene = scene;
  }

  /**
   * Render all physics colliders as semi-transparent red boxes
   * Called once per frame to keep debug visualization up-to-date
   */
  renderPhysicsDebugColliders(): void {
    if (!this.enabled) return;

    // Clear previous debug meshes
    this.clearDebugMeshes();

    // Get position data from kernel
    const positionBuffer = this.kernel.positions.getReadBuffer();
    const entityRegistry = this.kernel.entities;
    
    if (!positionBuffer || !entityRegistry) {
      console.warn('[PhysicsDebugViz] Missing kernel position buffer or entity registry');
      return;
    }

    // Iterate all active entities
    entityRegistry.forEachDense((denseIndex: number, handle: number) => {
      const base = denseIndex * 3;
      const x = positionBuffer[base];
      const y = positionBuffer[base + 1];
      const z = positionBuffer[base + 2];

      // Create debug box at entity position
      // Default size: 0.8 x 1.6 x 0.8 (player collision radius)
      const boxGeometry = new THREE.BoxGeometry(1.6, 3.2, 1.6);
      const boxMaterial = new THREE.MeshPhongMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.15,
        wireframe: false,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const debugMesh = new THREE.Mesh(boxGeometry, boxMaterial);
      debugMesh.position.set(x, y, z);
      debugMesh.name = `debug_collider_${denseIndex}`;
      debugMesh.renderOrder = -1; // Render behind everything
      
      this.scene.add(debugMesh);
      this.debugMeshes.push(debugMesh);
    });

    console.log(`[PhysicsDebugViz] Rendered ${this.debugMeshes.length} debug collider boxes`);
  }

  /**
   * Render static collision boxes (if provided from server)
   */
  renderStaticColliders(staticBoxes: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    halfExtents: { x: number; y: number; z: number };
  }>): void {
    staticBoxes.forEach((box, idx) => {
      const geometry = new THREE.BoxGeometry(
        box.halfExtents.x * 2,
        box.halfExtents.y * 2,
        box.halfExtents.z * 2
      );

      const material = new THREE.MeshPhongMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.25,
        wireframe: false,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(box.position.x, box.position.y, box.position.z);
      mesh.name = `static_collider_${idx}_${box.id}`;
      mesh.renderOrder = -2;

      this.scene.add(mesh);
      this.debugMeshes.push(mesh);
    });

    console.log(`[PhysicsDebugViz] Rendered ${staticBoxes.length} static collision boxes`);
  }

  /**
   * Clear all debug meshes from scene
   */
  private clearDebugMeshes(): void {
    for (const mesh of this.debugMeshes) {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material && 'dispose' in mesh.material) {
        (mesh.material as any).dispose();
      }
    }
    this.debugMeshes = [];
  }

  /**
   * Toggle debug visualization on/off
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearDebugMeshes();
    }
  }

  /**
   * Get diagnostics about rendered colliders
   */
  getDebugStats(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      debugMeshesCount: this.debugMeshes.length,
      kernelEntityCount: this.kernel.entities?.activeCount ?? 0,
    };
  }
}
