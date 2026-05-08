/**
 * PhysGunSystem
 *
 * Garry's Mod-style physics gun for play mode.
 * Press [G] to toggle physgun mode.
 * Left-click: grab the object the crosshair is aimed at.
 * Left-click again (or R): release.
 * Mouse wheel: adjust hold distance.
 * G / Escape: exit physgun mode and drop any held object.
 *
 * Works entirely in play mode without touching the editor systems.
 * Registers as an auxiliary system so EngineController.update() drives it.
 *
 * Highlight delegation
 * ────────────────────
 * Visual highlighting is fully delegated to InteractionManager via
 * setOverride / clearOverride. PhysGunSystem has NO THREE.LineSegments mesh;
 * it only tells InteractionManager what its current target is and at what
 * priority so that HighlightSystem can render the correct colour.
 *
 * Ordering requirement
 * ────────────────────
 * PhysGunSystem.update() must run BEFORE InteractionManager.update() each
 * frame (ensured by registration order in Engine.ts auxiliarySystems).
 */

import * as THREE from 'three';
import type { RoutedInputHandler } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { INTERACTION_PRIORITY } from './InteractionContracts';
import { OGUI } from '../../../4-runtime/ui/OGUITheme';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface PhysGunEntity {
  id: string;
  type: string;
  getPosition(): { x: number; y: number; z: number };
  setPosition(position: { x: number; y: number; z: number }): void;
}

interface PhysGunEntityManagerAdapter {
  getEntity(id: string): PhysGunEntity | null | undefined;
  getEntities(): PhysGunEntity[];
}

interface PhysGunEntityRendererAdapter {
  getMeshForEntity(entityId: string): THREE.Object3D | null | undefined;
}

interface PhysGunStateStoreAdapter {
  set(path: string, value: unknown): void;
}

interface InteractionManagerAdapter {
  setOverride(source: string, entityId: string, mesh: THREE.Object3D, priority: number): void;
  clearOverride(source: string): void;
}

interface WorldObjectAuthorityAdapter {
  syncAuthorityTransformForEntity(entityId: string): boolean;
}

// ─── PhysGunSystem ────────────────────────────────────────────────────────────

export class PhysGunSystem implements RoutedInputHandler {
  // ── Tuning constants ──────────────────────────────────────────────────────
  private readonly HOLD_DIST_MIN  = 1.5;
  private readonly HOLD_DIST_MAX  = 22;
  private readonly LERP_SPEED     = 16;   // units/sec
  private readonly SCROLL_FACTOR  = 0.008;

  // ── Dependencies ──────────────────────────────────────────────────────────
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private entityManager: PhysGunEntityManagerAdapter;
  private entityRenderer: PhysGunEntityRendererAdapter;
  private stateManager: PhysGunStateStoreAdapter;
  private interactionManager: InteractionManagerAdapter | null = null;
  private worldObjectAuthority: WorldObjectAuthorityAdapter | null = null;
  private systemContext: SystemContext | null = null;

  // ── Runtime state ─────────────────────────────────────────────────────────
  /** System is active (we are in play mode). */
  private _enabled = false;
  /** Physgun mode is toggled on by the player pressing G. */
  private _active  = false;
  /** Entity currently being held, or null.  */
  private _heldId: string | null = null;
  /** Distance in front of the camera at which the held object floats. */
  private _holdDist = 5;
  /** Smooth-movement target position. */
  private _targetPos = new THREE.Vector3();

  // ── Raycast (used only for grab action + hover detection) ─────────────────
  private _raycaster = new THREE.Raycaster();

  // ── HUD ───────────────────────────────────────────────────────────────────
  private _hudEl:    HTMLDivElement | null = null;
  private _beamEl:   HTMLDivElement | null = null;   // thin "tether" line visual
  private _lifecycleDisposers: Array<() => void> = [];

  // ─────────────────────────────────────────────────────────────────────────

  constructor(deps: {
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    entityManager: PhysGunEntityManagerAdapter;
    entityRenderer: PhysGunEntityRendererAdapter;
    stateManager: PhysGunStateStoreAdapter;
    interactionManager?: InteractionManagerAdapter;
  }) {
    this.camera             = deps.camera;
    this.scene              = deps.scene;
    this.entityManager      = deps.entityManager;
    this.entityRenderer     = deps.entityRenderer;
    this.stateManager       = deps.stateManager;
    this.interactionManager = deps.interactionManager ?? null;
    this._lifecycleDisposers.push(
      gameBus.on('ENGINE_RESET', () => this.deactivate()),
      gameBus.on('ROUND_TRANSITION', () => this.deactivate()),
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Called when entering play mode. */
  enable(): void {
    this._enabled = true;
    this._buildHUD();
  }

  /** Activate physgun mode while staying inside play-mode lifecycle. */
  activate(): void {
    if (!this._enabled) this.enable();
    this._setActive(true);
  }

  /** Deactivate physgun mode without disabling the whole system. */
  deactivate(): void {
    this._setActive(false);
  }

  /** Called when leaving play mode. */
  disable(): void {
    this._enabled = false;
    this._setActive(false);
  }

  destroy(): void {
    this.disable();
    while (this._lifecycleDisposers.length > 0) {
      this._lifecycleDisposers.pop()?.();
    }
    this._hudEl?.remove();
    this._beamEl?.remove();
    this._hudEl   = null;
    this._beamEl  = null;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.interactionManager) {
      this.interactionManager = ctx.systems.interactionManager as InteractionManagerAdapter | null;
    }
    if (!this.worldObjectAuthority) {
      this.worldObjectAuthority = ctx.systems.worldObjectAuthorityService as WorldObjectAuthorityAdapter | null;
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this._enabled ? 'active' : 'idle',
      active: this._active,
      metrics: {
        enabled: this._enabled,
        holding: this._heldId !== null,
        heldId: this._heldId,
        holdDistance: this._holdDist,
        hasInteractionManager: this.interactionManager !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  /**
   * Inject or replace the InteractionManager dependency after construction.
   * Engine.ts calls this after both systems are created.
   */
  setInteractionManager(im: InteractionManagerAdapter): void {
    this.interactionManager = im;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this._enabled) return;

    if (this._active && this._heldId) {
      this._updateHeld(dt);
      this._updateBeam();
      // Tell InteractionManager: physgun is holding this object (highest priority).
      const mesh = this.entityRenderer.getMeshForEntity(this._heldId);
      if (mesh && this.interactionManager) {
        this.interactionManager.setOverride(
          'physgun', this._heldId, mesh, INTERACTION_PRIORITY.PHYSGUN_HELD,
        );
      }
    } else if (this._active) {
      this._beamEl && (this._beamEl.style.display = 'none');
      // Raycast for hover and register with InteractionManager (mid priority).
      this._detectHoverAndRegister();
    } else {
      this._beamEl && (this._beamEl.style.display = 'none');
      this.interactionManager?.clearOverride('physgun');
    }
  }

  isActive(): boolean {
    return this._active;
  }

  isHolding(): boolean {
    return this._heldId !== null;
  }

  // ── Input routing ─────────────────────────────────────────────────────────

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this._enabled) return false;

    // Press Shift+G to toggle physgun active/inactive
    if ((e.key === 'g' || e.key === 'G') && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this._setActive(!this._active);
      return true;
    }

    // Press R to drop grabbed object (only when physgun is active)
    if (this._active && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      this._drop();
      return true;
    }

    return false;
  }

  handleKeyUp(_e: KeyboardEvent): boolean {
    return false;
  }

  handlePointerDown(e: MouseEvent): boolean {
    if (!this._enabled || !this._active) return false;

    if (e.button === 0) {
      if (this._heldId) {
        this._drop();
      } else {
        this._tryGrab();
      }
      return true;
    }

    if (e.button === 2) {
      this._drop();
      return true;
    }

    return false;
  }

  handlePointerMove(_e: MouseEvent): boolean {
    return false;   // camera handles mouse movement; we read it each frame
  }

  handlePointerUp(_e: MouseEvent): boolean {
    return false;
  }

  handleWheel(e: WheelEvent): boolean {
    if (!this._enabled || !this._active) return false;

    const delta = e.deltaY * this.SCROLL_FACTOR;
    this._holdDist = Math.max(this.HOLD_DIST_MIN, Math.min(this.HOLD_DIST_MAX, this._holdDist + delta));
    this._refreshHUD();
    return true;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _setActive(on: boolean): void {
    this._active = on;
    if (!on) {
      this._drop();
      this.interactionManager?.clearOverride('physgun');
    }
    this._refreshHUD();
  }

  private _tryGrab(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this._raycaster.set(this.camera.position, dir);
    this._raycaster.far = this.HOLD_DIST_MAX;

    const meshes = this._collectEntityMeshes();
    const hits   = this._raycaster.intersectObjects(meshes, true);
    const hit    = hits.find(h => h.object.userData.entityId);
    if (!hit) return;

    const entityId = hit.object.userData.entityId as string;
    this._heldId   = entityId;
    this._holdDist = Math.max(this.HOLD_DIST_MIN, hit.distance);
    this._refreshHUD();
  }

  private _drop(): void {
    if (!this._heldId) return;
    this._heldId = null;
    this.interactionManager?.clearOverride('physgun');
    this._refreshHUD();
  }

  private _updateHeld(dt: number): void {
    if (!this._heldId) return;

    const entity = this.entityManager.getEntity(this._heldId);
    if (!entity) { this._heldId = null; this._refreshHUD(); return; }

    // Target = camera origin + look * holdDist (keep Y free for 3D movement)
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this._targetPos.copy(this.camera.position).addScaledVector(dir, this._holdDist);

    // Smooth lerp
    const cur = entity.getPosition();
    const f   = Math.min(1, this.LERP_SPEED * dt);
    const np  = {
      x: cur.x + (this._targetPos.x - cur.x) * f,
      y: cur.y + (this._targetPos.y - cur.y) * f,
      z: cur.z + (this._targetPos.z - cur.z) * f,
    };

    // Update entity data
    entity.setPosition(np);

    // Directly move mesh (no need to wait for EntityManager tick)
    const mesh = this.entityRenderer.getMeshForEntity(this._heldId);
    if (mesh) mesh.position.set(np.x, np.y, np.z);

    // Keep StateManager in sync
    this.stateManager.set(`entities.${this._heldId}.position`, np);
    this.worldObjectAuthority?.syncAuthorityTransformForEntity(this._heldId);
  }

  /**
   * Raycast each frame while physgun is active (not holding) and report the
   * hover target to InteractionManager at PHYSGUN_HOVER priority.
   * This ensures physgun hover always overrides the proximity highlight.
   */
  private _detectHoverAndRegister(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this._raycaster.set(this.camera.position, dir);
    this._raycaster.far = this.HOLD_DIST_MAX;

    const hits  = this._raycaster.intersectObjects(this._collectEntityMeshes(), true);
    const hit   = hits.find(h => h.object.userData.entityId);

    if (!hit || !this.interactionManager) {
      this.interactionManager?.clearOverride('physgun');
      return;
    }

    const entityId = hit.object.userData.entityId as string;
    const mesh     = this.entityRenderer.getMeshForEntity(entityId) ?? hit.object;
    this.interactionManager.setOverride(
      'physgun', entityId, mesh, INTERACTION_PRIORITY.PHYSGUN_HOVER,
    );
  }

  private _collectEntityMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const entity of this.entityManager.getEntities()) {
      if (entity.type === 'LocalPlayer' || entity.type === 'RemotePlayer') continue;
      const mesh = this.entityRenderer.getMeshForEntity(entity.id);
      if (mesh) out.push(mesh);
    }
    return out;
  }

  // ── Beam visual (thin vertical line in HUD to suggest tether) ────────────

  private _updateBeam(): void {
    if (!this._beamEl) return;
    this._beamEl.style.display = 'block';
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private _buildHUD(): void {
    if (this._hudEl) return;

    // Status badge
    this._hudEl = document.createElement('div');
    Object.assign(this._hudEl.style, {
      position:    'fixed',
      bottom:      '84px',
      left:        '50%',
      transform:   'translateX(-50%)',
      fontFamily:  OGUI.font,
      fontSize:    '10px',
      letterSpacing: '2px',
      pointerEvents: 'none',
      zIndex:      String(OGUI.zHUD + 10),
      display:     'none',
      background:  OGUI.bgPanel,
      border:      `1px solid ${OGUI.border}`,
      padding:     '4px 14px',
      userSelect:  'none',
    });
    document.body.appendChild(this._hudEl);

    // Crosshair beam  (thin horizontal rule centred on screen)
    this._beamEl = document.createElement('div');
    Object.assign(this._beamEl.style, {
      position:    'fixed',
      top:         '50%',
      left:        '50%',
      transform:   'translate(-50%, -50%)',
      width:       '16px',
      height:      '2px',
      background:  'rgba(128, 210, 255, 0.6)',
      pointerEvents: 'none',
      zIndex:      String(OGUI.zHUD + 9),
      display:     'none',
      borderRadius: '1px',
    });
    document.body.appendChild(this._beamEl);
  }

  private _refreshHUD(): void {
    if (!this._hudEl) return;

    if (!this._enabled || !this._active) {
      this._hudEl.style.display  = 'none';
      if (this._beamEl) this._beamEl.style.display = 'none';
      return;
    }

    this._hudEl.style.display = 'block';

    if (this._heldId) {
      this._hudEl.textContent        = `PHYSGUN · HOLDING  [LMB release · R drop · SCROLL distance]`;
      this._hudEl.style.color        = OGUI.ok;
      this._hudEl.style.borderColor  = OGUI.borderSel;
    } else {
      const dist = this._holdDist.toFixed(1);
      this._hudEl.textContent        = `PHYSGUN  [LMB grab · SCROLL dist:${dist} · G exit]`;
      this._hudEl.style.color        = OGUI.textSec;
      this._hudEl.style.borderColor  = OGUI.border;
    }
  }
}
