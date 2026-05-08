/**
 * HighlightSystem
 *
 * Purely visual system. Renders a wireframe box-outline around a target
 * THREE.Object3D every frame. Has no knowledge of input, physics, or game logic.
 *
 * Modes
 * ─────
 *   hover     — dim blue-grey  (crosshair aim, physgun scanning)
 *   held      — bright cyan    (physgun holding an object)
 *   proximity — amber          (nearby interactable waiting for E-key)
 *
 * Color can be overridden per-call via the optional colorOverride parameter
 * (used when an InteractableComponent specifies a custom highlightColor).
 *
 * Usage
 * ─────
 *   const hs = new HighlightSystem(scene);
 *   hs.setTarget(mesh, 'hover');        // show outline
 *   hs.setTarget(mesh, 'proximity', 0xff0000); // custom colour
 *   hs.setTarget(null, 'hover');        // clear outline
 *   hs.update(dt);                      // call every frame (tracks moving objects)
 */

import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HighlightMode = 'hover' | 'held' | 'proximity';

/** Default hex colors per mode. */
const MODE_COLORS: Record<HighlightMode, number> = {
  hover:     0x506880,   // dim blue-grey — non-obtrusive scanning colour
  held:      0x80d4ff,   // bright cyan   — confirms "I am grabbing this"
  proximity: 0xd4a850,   // amber         — "you can interact here"
};

/** How much extra padding the outline box gets on each axis. */
const OUTLINE_PADDING = 0.12;

// ─── HighlightSystem ──────────────────────────────────────────────────────────

export class HighlightSystem {
  private scene: THREE.Scene;

  private _lines:     THREE.LineSegments | null  = null;
  private _targetRef: THREE.Object3D    | null  = null;
  private _mode:      HighlightMode     | null  = null;
  private _colorHex:  number | null = null;
  private systemContext: SystemContext | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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
      status: this._targetRef ? 'active' : 'idle',
      active: this._targetRef !== null,
      metrics: {
        hasTarget: this._targetRef !== null,
        currentMode: this._mode,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Set or replace the current highlight target.
   * Pass null as object to clear the highlight.
   *
   * @param object       The THREE.Object3D whose bounds will be outlined.
   * @param mode         Visual mode (determines default color if no override).
   * @param colorOverride Optional hex color that overrides the mode default.
   */
  setTarget(
    object:        THREE.Object3D | null,
    mode:          HighlightMode,
    colorOverride?: number,
  ): void {
    if (!object) {
      this._clear();
      return;
    }

  const color = colorOverride ?? MODE_COLORS[mode];
  const changed = this._targetRef !== object || this._mode !== mode || this._colorHex !== color;

    if (!this._lines) {
      this._lines = this._buildLineSegments(color);
      this.scene.add(this._lines);
    } else {
      // Reuse existing mesh — just update the colour if mode changed.
      (this._lines.material as THREE.LineBasicMaterial).color.setHex(color);
    }

    this._targetRef = object;
    this._mode      = mode;
    this._colorHex  = color;

    // Sync immediately so the outline appears on the correct frame.
    this._syncBounds();
    if (changed) {
      gameBus.emit('stateMutation', {
        source: 'highlightSystem',
        path: 'interaction.highlight',
        changedCount: 1,
      });
    }
  }

  /**
   * Call once per frame. Keeps the outline aligned with the target if it moves.
   */
  update(_dt: number): void {
    if (this._lines && this._targetRef) {
      this._syncBounds();
    }
  }

  hasTarget(): boolean {
    return this._targetRef !== null;
  }

  getCurrentMode(): HighlightMode | null {
    return this._mode;
  }

  destroy(): void {
    this._clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Recompute bounding box and reposition/rescale the outline mesh. */
  private _syncBounds(): void {
    if (!this._lines || !this._targetRef) return;

    const box  = new THREE.Box3().setFromObject(this._targetRef);
    const size = new THREE.Vector3();
    const ctr  = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(ctr);

    this._lines.position.copy(ctr);
    this._lines.scale.set(
      size.x + OUTLINE_PADDING,
      size.y + OUTLINE_PADDING,
      size.z + OUTLINE_PADDING,
    );
  }

  /** Build a unit-scale EdgeGeometry LineSegments mesh. */
  private _buildLineSegments(color: number): THREE.LineSegments {
    const mat  = new THREE.LineBasicMaterial({ color });
    const geo  = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mesh = new THREE.LineSegments(geo, mat);

    // Mark as non-game geometry so editor/raycaster systems ignore it.
    mesh.userData.isGizmo    = true;
    mesh.userData.isHighlight = true;
    mesh.raycast = () => {};  // prevent accidental raycast hits

    return mesh;
  }

  private _clear(): void {
    const hadTarget = this._targetRef !== null;
    if (!this._lines) return;
    this.scene.remove(this._lines);
    this._lines.geometry.dispose();
    (this._lines.material as THREE.Material).dispose();
    this._lines     = null;
    this._targetRef = null;
    this._mode      = null;
    this._colorHex  = null;
    if (hadTarget) {
      gameBus.emit('stateMutation', {
        source: 'highlightSystem',
        path: 'interaction.highlight',
        changedCount: 1,
      });
    }
  }
}
