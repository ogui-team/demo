/**
 * Entity Renderer
 * Manages Three.js objects for entities
 * Reads entity data and updates Three.js representations
 * Rendering does NOT control entity data - it only reads and displays
 */

import * as THREE from 'three';
import { Entity } from './Entity';
import { EntityManager } from './EntityManager';
import * as EntityAttributes from './EntityAttributes';
import { StateManager } from '../../0-foundation/foundation/state/StateManager';
import { setRaycastLayers } from './RaycastLayers';
import { createInstance as createAssetInstance } from '../../2-systems/gameplay/systems/AssetRegistry';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { EntityHandle } from './kernel/types';

export interface RenderComponentData {
  meshType: 'box' | 'sphere' | 'plane' | 'capsule' | 'custom' | 'dummyPrefab' | 'fireballOrb' | 'flyingMaskPrefab';
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  flatShading?: boolean;
  scale?: { x: number; y: number; z: number };
  geometry?: {
    width?: number;
    height?: number;
    depth?: number;
    radius?: number;
    segments?: number;
    radialSegments?: number;
    assetKey?: string;
  };
}

interface CullingSystemAdapter {
  registerForCulling(object: THREE.Object3D, id?: string): void;
  unregisterForCulling(id: string): void;
}

/**
 * EntityRenderer - Manages Three.js representation of entities
 */
export class EntityRenderer {
  private entityManager: EntityManager;
  private scene: THREE.Scene;
  private meshMap: Map<string | number, THREE.Object3D> = new Map(); // Support both string entity IDs and number handles
  private unsubscribers: Array<() => void> = [];
  private enableLogging: boolean = false;
  private stateManager: StateManager | null = null;
  private cullingSystem: CullingSystemAdapter | null = null;
  public kernel: any = null; // PUBLIC: SimulationKernel reference for DOD mesh syncing (can be injected)

  constructor(entityManager: EntityManager, scene: THREE.Scene, enableLogging: boolean = false, stateManager?: StateManager, kernel?: any) {
    this.entityManager = entityManager;
    this.scene = scene;
    this.enableLogging = enableLogging;
    this.stateManager = stateManager || null;
    this.kernel = kernel || null;

    if (this.enableLogging) {
      console.log('[EntityRenderer] Initialized');
    }

    this.setupListeners();
  }

  /**
   * Setup listeners for entity lifecycle
   */
  private setupListeners(): void {
    // Listen to entity creation
    const unsubscribeCreate = this.entityManager.onEntityCreated((entity) => {
      this.createMeshForEntity(entity);
    });

    // Listen to entity destruction
    const unsubscribeDestroy = this.entityManager.onEntityDestroyed((entity) => {
      this.removeMeshForEntity(entity);
    });

    // Listen to entity updates
    const unsubscribeUpdate = this.entityManager.onEntityUpdated((entity) => {
      this.updateMeshForEntity(entity);
    });

    this.unsubscribers.push(unsubscribeCreate, unsubscribeDestroy, unsubscribeUpdate);

    // VISUAL BRIDGE: Listen for DOD-spawned dummy armies
    // This hook ensures batch-spawned entities get visual representations
    const unsubscribeDummyArmy = (gameBus as any).on('DUMMY_ARMY_SPAWNED', (payload: any) => {
      this.onDummyArmySpawned(payload);
    });

    this.unsubscribers.push(() => {
      if (typeof unsubscribeDummyArmy === 'function') {
        unsubscribeDummyArmy();
      }
    });
  }

  /**
   * Create Three.js mesh for entity
   */
  private createMeshForEntity(entity: Entity): void {
    // Check if entity has render component
    const renderComponent = entity.getComponent('render');
    if (!renderComponent) {
      return; // Entity doesn't have a visual representation
    }

    const data = renderComponent.data as RenderComponentData;
    const transform = entity.getTransform();

    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;
    let sceneObject: THREE.Object3D | null = null;

    // Create geometry based on mesh type
    switch (data.meshType) {
      case 'dummyPrefab': {
        sceneObject = this.createDummyPrefabObject(data.color ?? 0xb63a20);
        break;
      }
      case 'flyingMaskPrefab': {
        sceneObject = this.createFlyingMaskPrefabObject(data.color ?? 0x7e2bb5);
        break;
      }
      case 'fireballOrb': {
        sceneObject = this.createFireballOrbObject(data.color ?? 0xff5a1f, data.emissive ?? 0xffa347);
        break;
      }
      case 'custom': {
        const assetKey = data.geometry?.assetKey;
        if (assetKey) {
          sceneObject = createAssetInstance(assetKey);
        }
        if (!sceneObject) {
          sceneObject = new THREE.Group();
          sceneObject.visible = false;
          sceneObject.userData.assetKey = assetKey ?? null;
          sceneObject.userData.missingAsset = true;
          console.warn('[EntityRenderer] Missing custom asset instance; keeping entity invisible', {
            entityId: entity.id,
            entityType: entity.type,
            assetKey: assetKey ?? null,
          });
        }
        break;
      }
      case 'sphere': {
        const radius = data.geometry?.radius || 1;
        const segments = data.geometry?.segments || 32;
        geometry = new THREE.SphereGeometry(radius, segments, segments);
        break;
      }

      case 'plane': {
        const planeWidth = data.geometry?.width || 10;
        const planeHeight = data.geometry?.height || 10;
        geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
        break;
      }

      case 'capsule': {
        const capsuleRadius = data.geometry?.radius || 0.4;
        const capsuleHeight = data.geometry?.height || 1.0;
        const capsuleSegs = data.geometry?.radialSegments || 8;
        geometry = new THREE.CapsuleGeometry(capsuleRadius, capsuleHeight, 4, capsuleSegs);
        break;
      }

      case 'box':
      default: {
        const width = data.geometry?.width || 2;
        const height = data.geometry?.height || 2;
        const depth = data.geometry?.depth || 2;
        geometry = new THREE.BoxGeometry(width, height, depth);
        break;
      }
    }

    if (!sceneObject) {
      const color = data.color || 0xffffff;
      material = new THREE.MeshPhongMaterial({
        color,
        emissive: new THREE.Color(data.emissive ?? 0x000000),
        emissiveIntensity: data.emissiveIntensity ?? 0,
        transparent: data.transparent ?? false,
        opacity: data.opacity ?? 1,
        flatShading: data.flatShading ?? true,
      });
      sceneObject = new THREE.Mesh(geometry!, material);
    }

    const mesh = sceneObject;

    // Set mesh name and entity reference for raycasting/selection
    mesh.name = `entity_${entity.id}`;
    mesh.userData.entityId = entity.id;
    mesh.userData.entityType = entity.type;
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
      child.userData.entityId = entity.id;
      child.userData.entityType = entity.type;
      if (entity.type !== 'LocalPlayer' && entity.type !== 'RemotePlayer') {
        setRaycastLayers(child, ['world', 'editor']);
      }
    });

    const baseScale = data.scale ?? { x: 1, y: 1, z: 1 };
    const entityScale = transform.scale ?? { x: 1, y: 1, z: 1 };

    // Apply transform
    mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
    mesh.rotation.order = 'XYZ';
    mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    mesh.scale.set(
      baseScale.x * entityScale.x,
      baseScale.y * entityScale.y,
      baseScale.z * entityScale.z,
    );
    mesh.userData.baseScale = {
      x: mesh.scale.x,
      y: mesh.scale.y,
      z: mesh.scale.z,
    };

    // Add to scene
    this.scene.add(mesh);
    this.meshMap.set(entity.id, mesh);
    mesh.userData.forceHidden = false;

    // Check visibility attribute and set mesh visibility
    if (this.stateManager) {
      const isInvisible = EntityAttributes.isInvisible(entity, this.stateManager);
      mesh.userData.forceHidden = isInvisible;
      mesh.visible = !isInvisible;

      // Subscribe to attribute changes to update visibility dynamically
      const unsubscribe = EntityAttributes.subscribeToAttributes(entity, this.stateManager, (newAttrs, oldAttrs) => {
        // During initialization, oldAttrs might be undefined
        if (!oldAttrs || newAttrs.isInvisible !== oldAttrs.isInvisible) {
          mesh.userData.forceHidden = newAttrs.isInvisible;
          mesh.visible = !newAttrs.isInvisible;
        }
      });

      this.unsubscribers.push(unsubscribe);
    }

    this.cullingSystem?.registerForCulling(mesh, entity.id);
  }

  private createDummyPrefabObject(color: number): THREE.Group {
    const root = new THREE.Group();

    const bodyMaterial = new THREE.MeshPhongMaterial({
      color,
      emissive: 0x2c0b06,
      emissiveIntensity: 0.45,
      flatShading: true,
    });
    const headMaterial = new THREE.MeshPhongMaterial({
      color: 0xf3c7a6,
      emissive: 0x2b1608,
      emissiveIntensity: 0.25,
      flatShading: true,
    });
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2b3 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.28), bodyMaterial);
    body.position.set(0, 0.34, 0);
    root.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), headMaterial);
    head.position.set(0, 0.8, 0);
    root.add(head);

    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMaterial);
    leftEye.position.set(-0.07, 0.83, 0.15);
    root.add(leftEye);

    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMaterial);
    rightEye.position.set(0.07, 0.83, 0.15);
    root.add(rightEye);

    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), bodyMaterial.clone());
    leftLeg.position.set(-0.1, 0.02, 0);
    root.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), bodyMaterial.clone());
    rightLeg.position.set(0.1, 0.02, 0);
    root.add(rightLeg);

    // Arms: shoulder pivot groups so rotation animates around shoulder joint
    const leftShoulderPivot = new THREE.Group();
    leftShoulderPivot.name = 'leftArmPivot';
    leftShoulderPivot.position.set(-0.28, 0.52, 0);
    leftShoulderPivot.rotation.x = -Math.PI * 0.75; // reaching-forward zombie pose
    const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), bodyMaterial.clone());
    leftArmMesh.position.set(0, -0.18, 0);
    leftShoulderPivot.add(leftArmMesh);
    root.add(leftShoulderPivot);
    root.userData.leftArmPivot = leftShoulderPivot;

    const rightShoulderPivot = new THREE.Group();
    rightShoulderPivot.name = 'rightArmPivot';
    rightShoulderPivot.position.set(0.28, 0.52, 0);
    rightShoulderPivot.rotation.x = -Math.PI * 0.75;
    const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), bodyMaterial.clone());
    rightArmMesh.position.set(0, -0.18, 0);
    rightShoulderPivot.add(rightArmMesh);
    root.add(rightShoulderPivot);
    root.userData.rightArmPivot = rightShoulderPivot;

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      child.userData.baseEmissive = material instanceof THREE.MeshPhongMaterial
        ? material.emissive.getHex()
        : 0x000000;
      child.userData.baseEmissiveIntensity = material instanceof THREE.MeshPhongMaterial
        ? material.emissiveIntensity
        : 0;
    });

    return root;
  }

  private createFlyingMaskPrefabObject(color: number): THREE.Group {
    const root = new THREE.Group();

    const maskMaterial = new THREE.MeshPhongMaterial({
      color,
      emissive: 0x3c1b6e,
      emissiveIntensity: 0.8,
      flatShading: true,
    });

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xe28eff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    const face = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), maskMaterial);
    face.scale.set(1.05, 0.9, 0.4);
    root.add(face);

    const leftHorn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 10), maskMaterial);
    leftHorn.position.set(-0.12, 0.05, -0.08);
    leftHorn.rotation.set(-Math.PI * 0.45, 0, -Math.PI * 0.2);
    root.add(leftHorn);

    const rightHorn = leftHorn.clone();
    rightHorn.position.set(0.12, 0.05, -0.08);
    rightHorn.rotation.set(-Math.PI * 0.45, 0, Math.PI * 0.2);
    root.add(rightHorn);

    const eyeGlowA = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 20), glowMaterial);
    eyeGlowA.rotation.set(Math.PI * 0.5, 0, 0);
    eyeGlowA.position.set(-0.06, 0, 0.14);
    root.add(eyeGlowA);

    const eyeGlowB = eyeGlowA.clone();
    eyeGlowB.position.set(0.06, 0, 0.14);
    root.add(eyeGlowB);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 8, 24), glowMaterial);
    halo.rotation.set(Math.PI * 0.5, 0, 0);
    halo.position.set(0, 0.08, 0);
    root.add(halo);

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      child.userData.baseEmissive = material instanceof THREE.MeshPhongMaterial
        ? material.emissive.getHex()
        : 0x000000;
      child.userData.baseEmissiveIntensity = material instanceof THREE.MeshPhongMaterial
        ? material.emissiveIntensity
        : 0;
    });

    return root;
  }

  private createFireballOrbObject(color: number, emissiveColor: number): THREE.Group {
    const root = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshPhongMaterial({
        color,
        emissive: emissiveColor,
        emissiveIntensity: 1.8,
        flatShading: true,
        transparent: true,
        opacity: 0.98,
      }),
    );
    root.add(core);

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 14, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffd17a,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    root.add(shell);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.03, 8, 18),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI * 0.5;
    root.add(ring);

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });

    return root;
  }

  /**
   * Update Three.js mesh position/rotation from entity
   */
  private updateMeshForEntity(entity: Entity): void {
    const mesh = this.meshMap.get(entity.id);
    if (!mesh) return;

    const transform = entity.getTransform();

    // Update position
    mesh.position.set(transform.position.x, transform.position.y, transform.position.z);

    // Update rotation
    mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);

    const renderComponent = entity.getComponent('render');
    const data = renderComponent?.data as RenderComponentData | undefined;
    const baseScale = data?.scale ?? { x: 1, y: 1, z: 1 };
    const entityScale = transform.scale ?? { x: 1, y: 1, z: 1 };
    mesh.scale.set(
      baseScale.x * entityScale.x,
      baseScale.y * entityScale.y,
      baseScale.z * entityScale.z,
    );
  }

  /**
   * Remove Three.js mesh for entity
   */
  private removeMeshForEntity(entity: Entity): void {
    const mesh = this.meshMap.get(entity.id);
    if (mesh) {
      this.cullingSystem?.unregisterForCulling(entity.id);
      this.scene.remove(mesh);

      if (mesh.userData.sharedAssetInstance) {
        this.meshMap.delete(entity.id);
        return;
      }

      // Dispose of geometry and material
      if (mesh instanceof THREE.Mesh) {
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      }

      this.meshMap.delete(entity.id);
    }
  }

  /**
   * VISUAL BRIDGE: Handle batch-spawned DOD entities
   * Called when DummyEnemySystem spawns an army of 500 entities
   * Creates fallback meshes (red cubes) for entities that lack custom assets
   * This ensures visual manifestation while asset loading is resolved
   */
  private onDummyArmySpawned(payload: any): void {
    if (!payload?.handles || !Array.isArray(payload.handles)) {
      console.warn('[EntityRenderer] onDummyArmySpawned received invalid payload', { payload });
      return;
    }

    const handles = payload.handles as number[];  // ✅ EntityHandle is number, not string!
    const origin = payload.origin || { x: 16, y: 1, z: 16 };
    const spacing = payload.spacing || 2.0;

    // ALWAYS log this critical event
    console.log('[EntityRenderer] VISUAL BRIDGE: Processing dummy army spawn', {
      count: handles.length,
      origin,
      spacing,
      timestamp: payload.timestamp,
    });

    // Calculate grid dimensions
    const cols = Math.ceil(Math.sqrt(handles.length));
    const rows = Math.ceil(handles.length / cols);

    // Create fallback meshes for all spawned entities
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i];
      const dummySystem = (globalThis as any).__dummyEnemySystem;
      if (dummySystem?.getVisualEntityId?.(handle)) {
        continue;
      }
      
      // Skip if mesh already exists for this handle
      if (this.meshMap.has(handle)) {
        console.warn(`[EntityRenderer] Mesh already exists for handle ${handle}, skipping`);
        continue;
      }

      try {
        // Calculate grid position
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = origin.x + (col - cols / 2) * spacing;
        const z = origin.z + (row - rows / 2) * spacing;
        const y = origin.y;

        const mesh = this.createDummyPrefabObject(0x9f2f18);

        // Store handle reference for later lookup
        mesh.name = `dummy_${handle}`;
        mesh.userData.entityHandle = handle;
        mesh.userData.isFallbackMesh = true;
        mesh.userData.baseScale = { x: 0.95, y: 0.95, z: 0.95 };

        // Position at calculated grid location
        mesh.position.set(x, y, z);
        mesh.scale.setScalar(0.95);
        mesh.traverse((child) => {
          child.userData.entityHandle = handle;
          if (child instanceof THREE.Mesh) {
            setRaycastLayers(child, ['world', 'editor']);
          }
        });

        this.scene.add(mesh);
        this.meshMap.set(handle, mesh);
        this.cullingSystem?.registerForCulling(mesh, `${handle}`); // Convert to string for culling API

        if (i < 5 || i % 50 === 0) {
          console.log(`[EntityRenderer] Created cube ${i+1}/500 for handle ${handle} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
        }
      } catch (error) {
        console.error(`[EntityRenderer] Failed to create fallback mesh for ${handle}:`, error);
      }
    }

    console.log('[EntityRenderer] VISUAL BRIDGE: Fallback meshes created', {
      count: handles.length,
      timestamp: Date.now(),
    });
  }

  /**
   * Manually sync entity mesh (call this after adding components)
   */
  syncEntity(entity: Entity): void {
    // If entity already has a mesh, remove it
    if (this.meshMap.has(entity.id)) {
      this.removeMeshForEntity(entity);
    }

    // Create new mesh if entity has render component
    if (entity.hasComponent('render')) {
      this.createMeshForEntity(entity);

      if (this.enableLogging) {
        console.log(`[EntityRenderer] Synced entity: ${entity.id}`);
      }
    }
  }

  setCullingSystem(cullingSystem: CullingSystemAdapter | null): void {
    this.cullingSystem = cullingSystem;
    if (!cullingSystem) return;
    for (const [entityId, mesh] of this.meshMap.entries()) {
      cullingSystem.registerForCulling(mesh, `${entityId}`); // Convert handle to string for culling API
    }
  }

  /**
   * Inject kernel reference for DOD mesh synchronization
   * Called after engine initialization when kernel becomes available
   */
  setKernel(kernel: any): void {
    this.kernel = kernel;
    if (this.enableLogging && kernel) {
      console.log('[EntityRenderer] Kernel injected for DOD sync');
    }
  }

  /**
   * Get Three.js mesh for entity
   */
  getMeshForEntity(entityId: string): THREE.Object3D | undefined {
    return this.meshMap.get(entityId);
  }

  /**
   * Get all meshes
   */
  getAllMeshes(): Map<string | number, THREE.Object3D> {
    return new Map(this.meshMap);
  }

  /**
   * Sync all entities with their meshes
   */
  syncAll(): void {
    for (const entity of this.entityManager.getEntities()) {
      this.updateMeshForEntity(entity);
    }
  }

  /**
   * Per-frame update: Sync DOD mesh positions from kernel buffers
   * Called from the game loop every frame to keep fallback meshes in sync with kernel state
   */
  update(): void {
    // Lazy-load kernel if not set (will be injected after engine init)
    if (!this.kernel) {
      // Try to get DummyEnemySystem and extract kernel from it
      try {
        const dummyEnemySystem = (globalThis as any).__dummyEnemySystem;
        if (dummyEnemySystem && dummyEnemySystem.kernel) {
          this.kernel = dummyEnemySystem.kernel;
          if (this.enableLogging) {
            console.log('[EntityRenderer] Auto-discovered kernel from DummyEnemySystem');
          }
        }
      } catch (error) {
        // Silently fail - kernel will be set up next frame or via setKernel()
      }
    }

    // Skip if no kernel (fallback meshes require kernel buffer access)
    if (!this.kernel || !this.kernel.positions) {
      return;
    }

    // TICK INTERPOLATION: Get interpolated positions instead of raw kernel positions
    // This eliminates microsnapping caused by 60Hz kernel ticks vs 144fps rendering
    let visualPositions = this.kernel.positions.getReadBuffer(); // Default to read buffer
    const activeCount = this.kernel.entities.activeCount;

    if (this.kernel.interpolationSystem) {
      // If interpolation system is available, use interpolated positions
      visualPositions = this.kernel.interpolationSystem.update(activeCount);
    }

    const entityRegistry = this.kernel.entities;

    // DEBUG: Count fallback meshes
    let fallbackMeshCount = 0;
    let failedDenseIndexCount = 0;
    const samplePositions: Array<[EntityHandle, [number, number, number]]> = [];

    // Iterate through all tracked meshes and update positions from kernel
    for (const [handle, mesh] of this.meshMap.entries()) {
      // Skip if this isn't a fallback mesh (regular meshes are updated via entity lifecycle)
      if (!mesh.userData?.isFallbackMesh) {
        continue;
      }

      fallbackMeshCount++;

      try {
        // Get dense index for this handle
        const denseIndex = entityRegistry.getDenseIndex(handle);
        if (denseIndex < 0) {
          failedDenseIndexCount++;
          if (failedDenseIndexCount === 1) {
            console.warn(`[EntityRenderer] WARNING: getDenseIndex(${handle}) returned ${denseIndex} - entity not found in registry`);
          }
          continue; // Entity no longer exists
        }

        // Read INTERPOLATED position from visual buffer (or raw if interpolation disabled)
        const basePos = denseIndex * 3;
        const x = visualPositions[basePos];
        const y = visualPositions[basePos + 1];
        const z = visualPositions[basePos + 2];

        // Update mesh position
        mesh.position.set(x, y, z);

        // Sample first 5 for debugging
        if (samplePositions.length < 5) {
          samplePositions.push([handle as EntityHandle, [x, y, z]]);
        }
      } catch (error) {
        // Silently skip errors to avoid watchdog freeze
        if (this.enableLogging) {
          console.warn(`[EntityRenderer] Failed to sync mesh ${handle}:`, error);
        }
      }
    }

    // DEBUG: Log sync status every 60 frames with sample positions
    if (fallbackMeshCount > 0 && Math.random() < 0.016) {
      const interpolationStatus = this.kernel.interpolationSystem ? '[INTERPOLATED]' : '[RAW]';
      console.log(`[EntityRenderer] Syncing ${fallbackMeshCount} meshes ${interpolationStatus} | Samples: ${samplePositions.map(([h, [x, y, z]]) => `h${h}@(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`).join(', ')}`);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Remove all meshes
    for (const [entityId, mesh] of this.meshMap.entries()) {
      this.cullingSystem?.unregisterForCulling(`${entityId}`); // Convert to string for culling API
      this.scene.remove(mesh);
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }

    // Unsubscribe from listeners
    this.unsubscribers.forEach((unsub) => unsub());

    this.meshMap.clear();
  }
}
