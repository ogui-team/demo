/**
 * CullingSystem  —  Tier 1
 * Frustum culling, distance-based LOD, and static mesh batching.
 *
 * Three strategies:
 *   1. Frustum culling   — toggle mesh.visible based on camera frustum
 *   2. Distance LOD      — swap geometry based on camera distance
 *   3. Static batching   — merge static BufferGeometries into a single draw call
 *
 * Usage:
 *   const culling = new CullingSystem(camera, scene);
 *
 *   // Register any Three.js Object3D for frustum culling
 *   culling.registerForCulling(mesh);
 *
 *   // Register LOD levels (near → far)
 *   culling.registerLOD(entity.id, [
 *     { geometry: highDetailGeo,  maxDist: 15 },
 *     { geometry: midDetailGeo,   maxDist: 40 },
 *     { geometry: lowDetailGeo,   maxDist: 999 },
 *   ]);
 *
 *   // Batch static meshes
 *   culling.batchStatic([mesh1, mesh2, mesh3], sharedMaterial);
 *
 *   // Each frame:
 *   culling.update(deltaTime);
 */

import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LODLevel {
  geometry:  THREE.BufferGeometry;
  /** Distance at which this level is used (exclusive upper bound). */
  maxDist:   number;
}

interface LODEntry {
  mesh:   THREE.Mesh;
  levels: LODLevel[];
  current: number;  // index of current active LOD
}

interface CullEntry {
  object:      THREE.Object3D;
  boundingSphere: THREE.Sphere;
}

// ─── CullingSystem ────────────────────────────────────────────────────────────

export class CullingSystem {
  private camera:       THREE.Camera;
  private scene:        THREE.Scene;
  private frustum:      THREE.Frustum     = new THREE.Frustum();
  private projMatrix:   THREE.Matrix4     = new THREE.Matrix4();

  private cullEntries:  Map<string, CullEntry> = new Map();
  private lodEntries:   Map<string, LODEntry>  = new Map();

  /** Batched merged meshes owned by this system (tracked for disposal). */
  private batchedMeshes: THREE.Mesh[] = [];

  /** How often (seconds) to recheck frustum culling. 0 = every frame. */
  private cullInterval = 0;
  private cullTimer    = 0;
  private systemContext: SystemContext | null = null;
  private enabled = true;
  private visibleCount = 0;
  private culledCount = 0;
  private lastCullDurationMs = 0;
  private averageCullDurationMs = 0;
  private peakCullDurationMs = 0;
  private lastCullChecks = 0;
  private lastUpdatedAt = 0;
  private samples = 0;

  constructor(camera: THREE.Camera, scene: THREE.Scene, cullInterval = 0) {
    this.camera       = camera;
    this.scene        = scene;
    this.cullInterval = cullInterval;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      cullEntries: this.cullEntries.size,
      lodEntries: this.lodEntries.size,
      batchedMeshes: this.batchedMeshes.length,
      visibleCount: this.visibleCount,
      culledCount: this.culledCount,
      lastCullChecks: this.lastCullChecks,
      lastCullDurationMs: this.lastCullDurationMs,
      averageCullDurationMs: this.averageCullDurationMs,
      peakCullDurationMs: this.peakCullDurationMs,
      cullInterval: this.cullInterval,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const entry of this.cullEntries.values()) {
        entry.object.visible = entry.object.userData.forceHidden !== true;
      }
      this.visibleCount = this.cullEntries.size;
      this.culledCount = 0;
      this.lastCullChecks = this.cullEntries.size;
      this.lastUpdatedAt = Date.now();
    }
  }

  // ─── Frustum culling ───────────────────────────────────────────────────────

  registerForCulling(object: THREE.Object3D, id?: string): void {
    const key = id ?? object.uuid;
    // Compute bounding sphere from geometry if available
    object.updateWorldMatrix(true, false);
    let sphere = new THREE.Sphere(object.position.clone(), 1);

    if ((object as THREE.Mesh).geometry) {
      const geo = (object as THREE.Mesh).geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (geo.boundingSphere) {
        sphere = geo.boundingSphere.clone().applyMatrix4(object.matrixWorld);
      }
    }

    this.cullEntries.set(key, { object, boundingSphere: sphere });
    gameBus.emit('stateMutation', {
      source: 'cullingSystem',
      path: `culling.entries.${key}`,
      changedCount: 1,
    });

    // Disable Three.js built-in frustum culling — we handle it
    object.frustumCulled = false;
  }

  unregisterForCulling(id: string): void {
    this.cullEntries.delete(id);
    gameBus.emit('stateMutation', {
      source: 'cullingSystem',
      path: `culling.entries.${id}`,
      changedCount: 1,
    });
  }

  // ─── LOD ──────────────────────────────────────────────────────────────────

  registerLOD(id: string, mesh: THREE.Mesh, levels: LODLevel[]): void {
    // Sort levels by maxDist ascending
    const sorted = [...levels].sort((a, b) => a.maxDist - b.maxDist);
    this.lodEntries.set(id, { mesh, levels: sorted, current: 0 });
  }

  unregisterLOD(id: string): void {
    this.lodEntries.delete(id);
  }

  // ─── Static batching ──────────────────────────────────────────────────────

  /**
   * Merge multiple meshes into a single draw call.
   * The source meshes are removed from the scene and replaced by one batched mesh.
   * Returns the merged mesh or null if merging failed.
   */
  batchStatic(meshes: THREE.Mesh[], material: THREE.Material): THREE.Mesh | null {
    if (meshes.length === 0) return null;

    const mergedGeo = new THREE.BufferGeometry();
    const geometries: THREE.BufferGeometry[] = [];

    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      geometries.push(geo);
    }

    // Merge all attribute arrays
    const posArrays: Float32Array[] = [];
    const normArrays: Float32Array[] = [];
    const uvArrays: Float32Array[] = [];
    let hasNormals = true;
    let hasUVs     = true;

    for (const geo of geometries) {
      posArrays.push(geo.attributes.position.array as Float32Array);
      if (geo.attributes.normal)   normArrays.push(geo.attributes.normal.array as Float32Array);
      else hasNormals = false;
      if (geo.attributes.uv)       uvArrays.push(geo.attributes.uv.array as Float32Array);
      else hasUVs = false;
    }

    const merge = (arrays: Float32Array[]) =>
      arrays.reduce((acc, a) => { const out = new Float32Array(acc.length + a.length); out.set(acc); out.set(a, acc.length); return out; }, new Float32Array(0));

    mergedGeo.setAttribute('position', new THREE.BufferAttribute(merge(posArrays), 3));
    if (hasNormals) mergedGeo.setAttribute('normal',   new THREE.BufferAttribute(merge(normArrays), 3));
    if (hasUVs)     mergedGeo.setAttribute('uv',       new THREE.BufferAttribute(merge(uvArrays),   2));
    mergedGeo.computeBoundingSphere();

    const batchedMesh = new THREE.Mesh(mergedGeo, material);
    batchedMesh.name  = `batched_${Date.now()}`;

    // Remove originals from scene, add merged
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }

    this.scene.add(batchedMesh);
    this.batchedMeshes.push(batchedMesh);
    gameBus.emit('stateMutation', {
      source: 'cullingSystem',
      path: 'culling.batches',
      changedCount: 1,
    });
    return batchedMesh;
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────

  update(deltaTime: number): void {
    if (!this.enabled) return;
    this._updateLOD();

    this.cullTimer += deltaTime;
    if (this.cullTimer >= this.cullInterval) {
      this.cullTimer = 0;
      this._updateFrustumCulling();
    }
  }

  private _updateFrustumCulling(): void {
    const startedAt = performance.now();
    this.projMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projMatrix);

    let visibleCount = 0;
    let culledCount = 0;
    let checks = 0;

    for (const entry of this.cullEntries.values()) {
      // Update bounding sphere world position
      entry.object.updateWorldMatrix(false, false);
      entry.boundingSphere.center.setFromMatrixPosition(entry.object.matrixWorld);

      const visible = this.frustum.intersectsSphere(entry.boundingSphere) && entry.object.userData.forceHidden !== true;
      entry.object.visible = visible;
      checks += 1;
      if (visible) visibleCount += 1;
      else culledCount += 1;
    }

    const duration = performance.now() - startedAt;
    const nextSamples = this.samples + 1;
    this.samples = nextSamples;
    this.visibleCount = visibleCount;
    this.culledCount = culledCount;
    this.lastCullChecks = checks;
    this.lastCullDurationMs = duration;
    this.averageCullDurationMs = nextSamples > 1
      ? ((this.averageCullDurationMs * (nextSamples - 1)) + duration) / nextSamples
      : duration;
    this.peakCullDurationMs = Math.max(this.peakCullDurationMs, duration);
    this.lastUpdatedAt = Date.now();
  }

  private _updateLOD(): void {
    const camPos = (this.camera as THREE.PerspectiveCamera).position ?? new THREE.Vector3();

    for (const entry of this.lodEntries.values()) {
      const dist = camPos.distanceTo(entry.mesh.position);
      let newLevel = entry.levels.length - 1;

      for (let i = 0; i < entry.levels.length; i++) {
        if (dist < entry.levels[i].maxDist) { newLevel = i; break; }
      }

      if (newLevel !== entry.current) {
        entry.mesh.geometry = entry.levels[newLevel].geometry;
        entry.current       = newLevel;
      }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    for (const mesh of this.batchedMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.batchedMeshes = [];
    this.cullEntries.clear();
    this.lodEntries.clear();
  }
}
