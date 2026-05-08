/**
 * PickupSystem
 *
 * Purely gameplay logic. Listens for the E key in play mode and picks up the
 * entity that ProximityInteraction currently reports as the nearest interactable.
 *
 * Conditions for a successful pickup
 * ────────────────────────────────────
 *   • PickupSystem is enabled (play mode).
 *   • A proximity target exists (player is within interaction radius).
 *   • The target entity has the 'interactable' component.
 *   • The component has pickupable: true.
 *
 * On pickup
 * ─────────
 *   1. Entity is removed from EntityManager (triggers EntityRenderer cleanup).
 *   2. The onPickup callback fires so Engine.ts can add the item to InventorySystem.
 *
 * Decoupling
 * ──────────
 * PickupSystem has NO dependency on InventorySystem. The Engine wires the
 * onPickup callback to whatever inventory implementation is active. This keeps
 * the system open for extension (future netcode, animation, sound) without
 * touching PickupSystem.
 *
 * HUD prompt
 * ──────────
 * A small "[E] INTERACT" label appears whenever a proximity target is active.
 * It reads the target's `prompt` or `itemId` for the label text.
 */

import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { RoutedInputHandler } from '@engine/1-kernel/core/public-api';
import type { InteractableComponent } from './components/InteractableComponent';
import { isConsoleOpen } from '../../../4-runtime/editor/Console';
import { OGUI } from '../../../4-runtime/ui/OGUITheme';
import { gameBus } from '@engine/1-kernel/core/public-api';

interface PickupEntityAdapter {
  getComponent(componentName: string): { data: unknown } | undefined;
}

interface EntityManagerAdapter {
  getEntity(entityId: string): PickupEntityAdapter | undefined;
  destroyEntity(entityId: string): void;
}

interface InteractionManagerAdapter {
  getProximityTarget(): { entityId: string; interactable: InteractableComponent } | null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PickupResult {
  entityId:    string;
  interactable: InteractableComponent;
}

// ─── PickupSystem ─────────────────────────────────────────────────────────────

export class PickupSystem implements RoutedInputHandler {
  private em: EntityManagerAdapter;
  private im: InteractionManagerAdapter;
  private systemContext: SystemContext | null = null;

  private _enabled = false;

  // HUD prompt element
  private _promptEl: HTMLDivElement | null = null;
  private _lastPromptId: string | null = null;

  /**
   * Wire this to an inventory/gameplay callback in Engine.ts.
   * Called synchronously on successful pickup AFTER the entity is removed.
   */
  onPickup: ((result: PickupResult) => void) | null = null;

  constructor(deps: {
    entityManager:     EntityManagerAdapter;
    interactionManager: InteractionManagerAdapter;
  }) {
    this.em = deps.entityManager;
    this.im = deps.interactionManager;
    this._buildPromptEl();
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.em = (ctx.entityManager as EntityManagerAdapter | null) ?? this.em;
    this.im = (ctx.systems.interactionManager as InteractionManagerAdapter | undefined) ?? this.im;
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
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: this._enabled,
      metrics: {
        hasSystemContext: this.systemContext !== null,
        promptVisible: this._promptEl?.style.display === 'block',
        lastPromptId: this._lastPromptId,
        proximityTargetId: this.im.getProximityTarget()?.entityId ?? null,
      },
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  enable(): void  { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    this._hidePrompt();
  }

  /** EngineController drives this each frame to update the HUD prompt. */
  update(_dt: number): void {
    if (!this._enabled) return;
    this._updatePrompt();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this._enabled) return false;
    if (isConsoleOpen?.()) return false;
    if (e.key !== 'e' && e.key !== 'E') return false;

    const target = this.im.getProximityTarget();
    if (!target) return false;

    const entity = this.em.getEntity(target.entityId);
    if (!entity) return false;

    const comp = entity.getComponent('interactable');
    if (!comp) return false;

    const ic = comp.data as InteractableComponent;
    if (!ic.pickupable) return false;

    // ── Perform pickup ──────────────────────────────────────────────────────
    const result: PickupResult = { entityId: target.entityId, interactable: ic };

    // Remove entity from world first (so proximity scan no longer finds it).
    this.em.destroyEntity(target.entityId);

    // Notify game layer (Engine wires this to InventorySystem.addItem etc.)
    this.onPickup?.(result);

    // Broadcast typed event so any system can react without tight coupling.
    if (ic.itemId) {
      gameBus.emit('itemPicked', {
        entityId: target.entityId,
        itemId:   ic.itemId,
        quantity: ic.quantity ?? 1,
      });
    }

    // Immediately hide prompt since target is gone.
    this._hidePrompt();

    return true;
  }

  // ── HUD prompt ─────────────────────────────────────────────────────────────

  private _updatePrompt(): void {
    const target = this.im.getProximityTarget();

    if (!target) {
      if (this._lastPromptId !== null) this._hidePrompt();
      return;
    }

    if (target.entityId === this._lastPromptId) return; // no change

    // Build label: prefer explicit prompt, then itemId, then generic fallback.
    const label = target.interactable.prompt
      ?? target.interactable.itemId
      ?? 'ITEM';

    this._showPrompt(label);
    this._lastPromptId = target.entityId;
  }

  private _showPrompt(label: string): void {
    if (!this._promptEl) return;
    this._promptEl.textContent = `[ E ]  ${label.toUpperCase()}`;
    this._promptEl.style.display = 'block';
  }

  private _hidePrompt(): void {
    if (this._promptEl) this._promptEl.style.display = 'none';
    this._lastPromptId = null;
  }

  private _buildPromptEl(): void {
    if (this._promptEl) return;
    this._promptEl = document.createElement('div');
    Object.assign(this._promptEl.style, {
      position:      'fixed',
      bottom:        '120px',
      left:          '50%',
      transform:     'translateX(-50%)',
      fontFamily:    OGUI.font,
      fontSize:      '10px',
      letterSpacing: '2px',
      color:         OGUI.textPri,
      background:    OGUI.bgPanel,
      border:        `1px solid ${OGUI.border}`,
      padding:       '4px 14px',
      pointerEvents: 'none',
      userSelect:    'none',
      display:       'none',
      zIndex:        String(OGUI.zHUD + 5),
    });
    document.body.appendChild(this._promptEl);
  }

  destroy(): void {
    this._promptEl?.remove();
    this._promptEl = null;
  }
}
