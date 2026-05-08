/**
 * InteractionManager
 *
 * Priority coordinator for all interaction + highlight logic.
 *
 * Architecture
 * ────────────
 * InteractionManager owns three sub-systems:
 *   • HighlightSystem      — purely visual, receives the winner each frame
 *   • RaycastInteraction   — crosshair detection (used by physgun, future doors)
 *   • ProximityInteraction — radius detection (used for pickups)
 *
 * Each frame InteractionManager collects candidates from:
 *   1. External overrides registered by gameplay systems (physgun held/hover).
 *   2. The built-in RaycastInteraction (priority 40).
 *   3. The built-in ProximityInteraction (priority 10).
 *
 * The highest-priority candidate wins and drives HighlightSystem.
 *
 * Priority constants
 * ──────────────────
 *   PHYSGUN_HELD  = 100   physgun currently dragging an object
 *   PHYSGUN_HOVER =  50   physgun is active and crosshair is on an object
 *   RAYCAST       =  40   free raycast (future: doors, NPCs)
 *   PROXIMITY     =  10   walk-up proximity for pickups
 *
 * System ordering requirement
 * ────────────────────────────
 * PhysGunSystem.update() must run BEFORE InteractionManager.update() each frame
 * so that physgun overrides are registered before priority resolution happens.
 * Ensure PhysGunSystem is listed before InteractionManager in Engine.ts
 * auxiliarySystems.
 *
 * External API used by PhysGunSystem
 * ────────────────────────────────────
 *   interactionManager.setOverride('physgun', entityId, mesh, INTERACTION_PRIORITY.PHYSGUN_HELD)
 *   interactionManager.clearOverride('physgun')
 *   interactionManager.getRaycastTarget()   // to find grab target on click
 *
 * External API used by PickupSystem
 * ──────────────────────────────────
 *   interactionManager.getProximityTarget() // E-key grab target
 */

import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { HighlightSystem, type HighlightMode, RaycastInteraction, type RaycastTarget, ProximityInteraction, type ProximityTarget } from './InteractionRuntime';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { INTERACTION_PRIORITY } from './InteractionContracts';

// ─── Priority constants ───────────────────────────────────────────────────────

// ─── Types ────────────────────────────────────────────────────────────────────

interface InteractionEntity {
  id: string;
  type: string;
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
  getPosition(): { x: number; y: number; z: number };
}

interface InteractionEntityManagerAdapter {
  getEntities(): InteractionEntity[];
}

interface InteractionEntityRendererAdapter {
  getMeshForEntity(entityId: string): THREE.Object3D | null | undefined;
}

export interface InteractionTarget {
  entityId: string;
  mesh:     THREE.Object3D;
  source:   string;
  priority: number;
}

interface OverrideEntry {
  entityId: string;
  mesh:     THREE.Object3D;
  priority: number;
}

export interface InteractionManagerConfig {
  scene:             THREE.Scene;
  camera:            THREE.PerspectiveCamera;
  entityManager:     InteractionEntityManagerAdapter;
  entityRenderer:    InteractionEntityRendererAdapter;
  /** Max raycast distance in metres. Default: 22. */
  raycastMaxDist?:   number;
  /** Proximity detection radius in metres. Default: 2.4. */
  proximityRadius?:  number;
}

// ─── InteractionManager ───────────────────────────────────────────────────────

export class InteractionManager {
  private highlight: HighlightSystem;
  private raycast:   RaycastInteraction;
  private proximity: ProximityInteraction;
  private camera:    THREE.PerspectiveCamera;

  /** External priority overrides (e.g. physgun). Source key → entry. */
  private overrides = new Map<string, OverrideEntry>();

  private _active: InteractionTarget | null = null;
  private systemContext: SystemContext | null = null;
  private warnedBeforeInit = false;

  constructor(cfg: InteractionManagerConfig) {
    this.camera = cfg.camera;

    const raycastEntityManager = cfg.entityManager as unknown as ConstructorParameters<typeof RaycastInteraction>[0]['entityManager'];
    const raycastEntityRenderer = cfg.entityRenderer as unknown as ConstructorParameters<typeof RaycastInteraction>[0]['entityRenderer'];
    const proximityEntityManager = cfg.entityManager as unknown as ConstructorParameters<typeof ProximityInteraction>[0]['entityManager'];
    const proximityEntityRenderer = cfg.entityRenderer as unknown as ConstructorParameters<typeof ProximityInteraction>[0]['entityRenderer'];

    this.highlight = new HighlightSystem(cfg.scene);

    this.raycast = new RaycastInteraction({
      camera:         cfg.camera,
      entityManager:  raycastEntityManager,
      entityRenderer: raycastEntityRenderer,
      maxDistance:    cfg.raycastMaxDist ?? 22,
      // Only highlight interactable entities; physgun hover uses its own override at higher priority.
      requireInteractable: true,
    });

    this.proximity = new ProximityInteraction({
      entityManager:  proximityEntityManager,
      entityRenderer: proximityEntityRenderer,
      radius:         cfg.proximityRadius ?? 2.4,
    });
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
      status: 'ok',
      active: true,
      metrics: {
        hasSystemContext: this.systemContext !== null,
        overrideCount: this.overrides.size,
        activeTargetId: this._active?.entityId ?? null,
        proximityRadius: this.getProximityRadius(),
      },
    };
  }

  // ── Override API (used by PhysGunSystem) ───────────────────────────────────

  /**
   * Register a high-priority target that overrides the built-in detection
   * systems. If the same source calls this again it replaces the previous entry.
   *
   * @param source   Stable string key identifying the caller, e.g. 'physgun'.
   * @param entityId The entity being targeted.
   * @param mesh     Root Object3D of the entity.
   * @param priority Numeric priority. Use INTERACTION_PRIORITY constants.
   */
  setOverride(
    source:   string,
    entityId: string,
    mesh:     THREE.Object3D,
    priority: number,
  ): void {
    this.overrides.set(source, { entityId, mesh, priority });
    gameBus.emit('stateMutation', {
      source: 'interactionManager',
      path: `interaction.overrides.${source}`,
      changedCount: 1,
    });
  }

  /**
   * Remove a previously registered override.
   * Call this when the source system deactivates (e.g. physgun exits mode).
   */
  clearOverride(source: string): void {
    if (!this.overrides.delete(source)) return;
    gameBus.emit('stateMutation', {
      source: 'interactionManager',
      path: `interaction.overrides.${source}`,
      changedCount: 1,
    });
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  /**
   * Run all detection systems, resolve priority, and drive HighlightSystem.
   * Must be called once per frame (after PhysGunSystem.update()).
   */
  update(dt: number): void {
    if (!this.systemContext && !this.warnedBeforeInit) {
      this.warnedBeforeInit = true;
      console.warn('[InteractionManager] update() called before SystemContext init');
    }

    const previousActive = this._active;

    // 1. Run built-in detection.
    this.raycast.update();
    this.proximity.update(this.camera.position, dt);

    // 2. Collect ALL candidates with their priorities.
    const candidates: InteractionTarget[] = [];

    for (const [source, o] of this.overrides) {
      candidates.push({ source, ...o });
    }

    const rt = this.raycast.getTarget();
    if (rt) {
      candidates.push({
        entityId: rt.entityId,
        mesh:     rt.mesh,
        source:   'raycast',
        priority: INTERACTION_PRIORITY.RAYCAST,
      });
    }

    const pt = this.proximity.getTarget();
    if (pt) {
      candidates.push({
        entityId: pt.entityId,
        mesh:     pt.mesh,
        source:   'proximity',
        priority: INTERACTION_PRIORITY.PROXIMITY,
      });
    }

    // 3. Resolve winner.
    if (candidates.length === 0) {
      this.highlight.setTarget(null, 'hover');
      this.highlight.update(dt);
      this._active = null;
      if (previousActive) {
        gameBus.emit('stateMutation', {
          source: 'interactionManager',
          path: 'interaction.activeTarget',
          changedCount: 1,
        });
      }
      return;
    }

    candidates.sort((a, b) => b.priority - a.priority);
    const best = candidates[0];
    this._active = best;
    if (
      previousActive?.entityId !== best.entityId
      || previousActive?.source !== best.source
      || previousActive?.priority !== best.priority
    ) {
      gameBus.emit('stateMutation', {
        source: 'interactionManager',
        path: 'interaction.activeTarget',
        changedCount: 1,
      });
    }

    // 4. Determine visual mode.
    const mode: HighlightMode =
      best.priority >= INTERACTION_PRIORITY.PHYSGUN_HELD ? 'held'      :
      best.source   === 'proximity'                      ? 'proximity' : 'hover';

    // 5. Optional color override from interactable component (proximity case).
    let colorOverride: number | undefined;
    if (mode === 'proximity' && pt) {
      colorOverride = pt.interactable.highlightColor;
    }

    this.highlight.setTarget(best.mesh, mode, colorOverride);
    this.highlight.update(dt);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** The winning target after priority resolution. Null when nothing targeted. */
  getActiveTarget(): InteractionTarget | null {
    return this._active;
  }

  /**
   * The current proximity target (nearest highlightable entity within radius).
   * Used by PickupSystem for E-key pickup.
   */
  getProximityTarget(): ProximityTarget | null {
    return this.proximity.getTarget();
  }

  /**
   * The current raycast target (what the crosshair is over).
   * Read by PhysGunSystem to decide what object to grab on click.
   */
  getRaycastTarget(): RaycastTarget | null {
    return this.raycast.getTarget();
  }

  /** Access the proximity radius for tuning or HUD display. */
  getProximityRadius(): number {
    return this.proximity.getRadius();
  }

  /** Adjust proximity radius at runtime (e.g. crouch reduces reach). */
  setProximityRadius(r: number): void {
    this.proximity.setRadius(r);
    gameBus.emit('stateMutation', {
      source: 'interactionManager',
      path: 'interaction.proximityRadius',
      changedCount: 1,
    });
  }

  destroy(): void {
    this.highlight.destroy();
  }
}
