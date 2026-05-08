/**
 * ProximityInteraction
 *
 * Detection-only system. Each frame it scans all entities within a configurable
 * radius for ones that carry the 'interactable' component with highlightable:true,
 * and reports the nearest one as the active proximity target.
 *
 * Anti-flicker
 * ────────────
 * A stability window (default 150 ms) prevents the target from switching
 * between objects that are equidistant or oscillating at the border of range.
 * A new candidate must be closest for the full window duration before it
 * becomes the reported target.
 *
 * Used by:
 *   - InteractionManager  — runs it automatically; exposes getProximityTarget()
 *   - PickupSystem        — reads current proximity target on E-key press
 *
 * Does NOT apply any visual highlight.
 * Does NOT process input.
 * Does NOT know about the physgun or raycast source.
 */

import * as THREE from 'three';
import type { EntityManager } from '@engine/1-kernel/core/public-api';
import type { EntityRenderer } from '@engine/1-kernel/core/public-api';
import type { InteractableComponent } from './components/InteractableComponent';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProximityTarget {
  entityId:      string;
  mesh:          THREE.Object3D;
  distance:      number;
  /** The entity's InteractableComponent data (for highlight color, itemId, etc.) */
  interactable:  InteractableComponent;
}

export interface ProximityInteractionConfig {
  entityManager:   EntityManager;
  entityRenderer:  EntityRenderer;
  /** Interaction radius in world units. Default: 2.4. */
  radius?:         number;
  /**
   * Min time in seconds a new candidate must hold its lead before being
   * promoted to the current target. Prevents flicker. Default: 0.15.
   */
  stabilityWindow?: number;
}

// ─── ProximityInteraction ─────────────────────────────────────────────────────

export class ProximityInteraction {
  private em:              EntityManager;
  private er:              EntityRenderer;
  private radius:          number;
  private stability:       number;

  private _current:       ProximityTarget | null = null;
  private _candidateId:   string | null = null;
  private _candidateTimer = 0;

  private _scratchV = new THREE.Vector3();

  constructor(cfg: ProximityInteractionConfig) {
    this.em        = cfg.entityManager;
    this.er        = cfg.entityRenderer;
    this.radius    = cfg.radius          ?? 2.4;
    this.stability = cfg.stabilityWindow ?? 0.15;
  }

  // ── Detection ──────────────────────────────────────────────────────────────

  /**
   * Scan entities around playerPosition and update the current target.
   * Must be called once per frame with the player/camera world position.
   *
   * @param playerPosition  World-space position to measure distances from.
   * @param dt              Frame delta in seconds (for stability window).
   */
  update(playerPosition: THREE.Vector3, dt: number): void {
    let best:     ProximityTarget | null = null;
    let bestDist  = Infinity;

    for (const entity of this.em.getEntities()) {
      const comp = entity.getComponent('interactable');
      if (!comp) continue;

      const ic = comp.data as InteractableComponent;
      if (!ic.highlightable) continue;

      const mesh = this.er.getMeshForEntity(entity.id);
      if (!mesh) continue;

      const pos = entity.getPosition();
      this._scratchV.set(pos.x, pos.y, pos.z);
      const dist = playerPosition.distanceTo(this._scratchV);

      if (dist <= this.radius && dist < bestDist) {
        bestDist = dist;
        best = { entityId: entity.id, mesh, distance: dist, interactable: ic };
      }
    }

    // ── Stability anti-flicker logic ─────────────────────────────────────────
    const bestId = best?.entityId ?? null;

    if (bestId !== this._candidateId) {
      // New candidate — reset timer.
      this._candidateId    = bestId;
      this._candidateTimer = 0;
      // If the candidate is null (walked out of range) clear immediately.
      if (!bestId) this._current = null;
    } else if (best) {
      // Same candidate — accumulate time.
      this._candidateTimer += dt;
      if (this._candidateTimer >= this.stability) {
        this._current = best;
      }
    }
    // If best is null but candidateId already null, _current stays cleared (handled above).
  }

  /** Returns the stabilised proximity target, or null when outside all entities. */
  getTarget(): ProximityTarget | null {
    return this._current;
  }

  /** Change the detection radius at runtime (e.g. for crouching, items, etc.) */
  setRadius(r: number): void {
    this.radius = r;
  }

  getRadius(): number {
    return this.radius;
  }
}
