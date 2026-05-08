/**
 * RaycastInteraction
 *
 * Detection-only system. Fires a single ray from the camera along its look
 * direction every frame and reports the first entity hit.
 *
 * Used by:
 *   - InteractionManager  — runs it automatically; exposes getRaycastTarget()
 *   - PhysGunSystem       — reads the result to know what object to grab
 *
 * Does NOT apply any visual highlight.
 * Does NOT process input.
 * Does NOT depend on any other interaction system.
 */

import * as THREE from 'three';
import type { EntityManager } from '@engine/1-kernel/core/public-api';
import type { EntityRenderer } from '@engine/1-kernel/core/public-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RaycastTarget {
  /** ID of the hit entity. */
  entityId: string;
  /** Root Object3D of the entity (from EntityRenderer). */
  mesh: THREE.Object3D;
  /** World-space distance from camera to hit point. */
  distance: number;
}

export interface RaycastInteractionConfig {
  camera:            THREE.PerspectiveCamera;
  entityManager:     EntityManager;
  entityRenderer:    EntityRenderer;
  /** Maximum ray distance (metres). Default: 22. */
  maxDistance?:      number;
  /**
   * When true only considers entities that have the 'interactable' component.
   * When false (default) all non-player entities are candidates — suitable
   * for physgun which can grab anything physical.
   */
  requireInteractable?: boolean;
}

// ─── RaycastInteraction ───────────────────────────────────────────────────────

export class RaycastInteraction {
  private cam:                  THREE.PerspectiveCamera;
  private em:                   EntityManager;
  private er:                   EntityRenderer;
  private maxDist:              number;
  private requireInteractable:  boolean;

  private _raycaster = new THREE.Raycaster();
  private _dir       = new THREE.Vector3();
  private _current:  RaycastTarget | null = null;

  constructor(cfg: RaycastInteractionConfig) {
    this.cam                 = cfg.camera;
    this.em                  = cfg.entityManager;
    this.er                  = cfg.entityRenderer;
    this.maxDist             = cfg.maxDistance           ?? 22;
    this.requireInteractable = cfg.requireInteractable   ?? false;
  }

  // ── Detection ──────────────────────────────────────────────────────────────

  /**
   * Run the raycast. Must be called once per frame before getTarget().
   */
  update(): void {
    this.cam.getWorldDirection(this._dir);
    this._raycaster.set(this.cam.position, this._dir);
    this._raycaster.far = this.maxDist;

    const meshes = this._collectCandidateMeshes();
    const hits   = this._raycaster.intersectObjects(meshes, true);

    // Find first hit whose ancestor carries an entityId tag
    const hit = hits.find(h => {
      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData.entityId) return true;
        obj = obj.parent;
      }
      return false;
    });

    if (!hit) {
      this._current = null;
      return;
    }

    // Walk up to find the entityId tag (may be on a parent group)
    let tagged: THREE.Object3D | null = hit.object;
    while (tagged && !tagged.userData.entityId) tagged = tagged.parent;
    if (!tagged) { this._current = null; return; }

    const entityId = tagged.userData.entityId as string;
    const rootMesh = this.er.getMeshForEntity(entityId) ?? tagged;

    this._current = { entityId, mesh: rootMesh, distance: hit.distance };
  }

  /** Returns the last computed target, or null if nothing was hit. */
  getTarget(): RaycastTarget | null {
    return this._current;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _collectCandidateMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const entity of this.em.getEntities()) {
      if (entity.type === 'LocalPlayer' || entity.type === 'RemotePlayer') continue;
      if (this.requireInteractable && !entity.hasComponent('interactable')) continue;
      const mesh = this.er.getMeshForEntity(entity.id);
      if (mesh) out.push(mesh);
    }
    return out;
  }
}
