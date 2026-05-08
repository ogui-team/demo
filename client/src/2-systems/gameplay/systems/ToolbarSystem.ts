/**
 * ToolbarSystem — 5-slot quick-access hotbar (keys 1-5).
 *
 *  Slot 0 is always reserved for the Gravity Gun (physgun_tool).
 *  Slots 1-4 are auto-populated with weapons / tools from the grid
 *  inventory and can be switched with number keys.
 *
 *  Implements RoutedInputHandler so InputRouter can slot it in the
 *  game-context chain BEFORE PlayController.
 */

import type { RoutedInputHandler } from '@engine/1-kernel/core/public-api';
import type {
  InventoryGridManager,
  GridInventory,
  ItemInfo,
} from './InventoryGridManager';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { OGUI } from '../../../4-runtime/ui/OGUITheme';
import { getGeneratedItemIconUrl } from '../../../4-runtime/ui/GeneratedItemTextures';

// ── Constants ─────────────────────────────────────────────────────────────────

const SLOT_COUNT   = 5;
const CELL_SIZE    = 52;           // px, width & height
const CELL_GAP     = 4;            // px between cells
const PHYSGUN_ITEM = 'physgun_tool';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolbarSlot {
  index:      number;
  instanceId: string | null;
  itemId:     string | null;
}

type ActiveSlotCallback = (slot: ToolbarSlot) => void;

// ── Class ─────────────────────────────────────────────────────────────────────

export class ToolbarSystem implements RoutedInputHandler {
  private manager: InventoryGridManager;

  private slots: ToolbarSlot[] = Array.from({ length: SLOT_COUNT }, (_, i) => ({
    index: i, instanceId: null, itemId: null,
  }));
  private activeIndex = 0;

  private physGunActivate:   (() => void) | null = null;
  private physGunDeactivate: (() => void) | null = null;

  private activeSlotCallbacks: ActiveSlotCallback[] = [];
  private cooldownProvider: ((slot: ToolbarSlot) => number) | null = null;
  private physGunEnabled = true;

  // DOM
  private container: HTMLDivElement | null = null;
  private cells:     HTMLDivElement[]      = [];

  // onChange subscription cancel fn
  private unsubInventory: (() => void) | null = null;

  private enabled = false;

  constructor(manager: InventoryGridManager) {
    this.manager = manager;
    // Slot 0 always = physgun
    this.slots[0].itemId = PHYSGUN_ITEM;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    console.log('[ToolbarSystem] Enabling toolbar...');
    this._buildDOM();
    // Start from physgun, then let inventory sync move to the equipped weapon.
    this._activateSlot(0);
    // Subscribe to inventory changes
    console.log('[ToolbarSystem] Subscribing to inventory changes');
    this.unsubInventory = this.manager.onChange((inv) => {
      console.log(`[ToolbarSystem] Inventory changed - syncing ${inv.items.length} items to toolbar`);
      this._syncFromInventory(inv);
    });
    // Seed from current inventory if already loaded
    const inv = this.manager.getInventory();
    if (inv) {
      console.log(`[ToolbarSystem] Current inventory has ${inv.items.length} items, seeding toolbar`);
      this._syncFromInventory(inv);
    } else {
      console.warn('[ToolbarSystem] No inventory loaded yet when enabling toolbar');
    }
    gameBus.emit('stateMutation', {
      source: 'ToolbarSystem',
      path: 'toolbar.enabled',
      changedCount: 1,
    });
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    // Unsubscribe
    if (this.unsubInventory) { this.unsubInventory(); this.unsubInventory = null; }
    // Deactivate current tool
    if (this.activeIndex === 0) this.physGunDeactivate?.();
    // Destroy DOM
    this._destroyDOM();
    // Clear dynamic slots
    for (let i = 1; i < SLOT_COUNT; i++) {
      this.slots[i].instanceId = null;
      this.slots[i].itemId     = null;
    }
    this.activeIndex = 0;
    gameBus.emit('stateMutation', {
      source: 'ToolbarSystem',
      path: 'toolbar.enabled',
      changedCount: 1,
    });
  }

  update(_dt: number): void {
    if (!this.enabled) return;
    this._renderCells();
  }

  destroy(): void {
    this.disable();
    this.activeSlotCallbacks = [];
  }

  /**
   * Provide callbacks so the toolbar can activate / deactivate the PhysGun
   * when slot 0 is selected / deselected.
   */
  setPhysGunCallbacks(activate: () => void, deactivate: () => void): void {
    this.physGunActivate   = activate;
    this.physGunDeactivate = deactivate;
  }

  /**
   * Subscribe to active-slot changes.  Fired on every slot switch.
   * Returns an unsubscribe function.
   */
  onActiveSlotChange(cb: ActiveSlotCallback): () => void {
    this.activeSlotCallbacks.push(cb);
    return () => {
      this.activeSlotCallbacks = this.activeSlotCallbacks.filter((c) => c !== cb);
    };
  }

  getActiveSlot(): ToolbarSlot { return this.slots[this.activeIndex]; }

  setCooldownProvider(provider: (slot: ToolbarSlot) => number): void {
    this.cooldownProvider = provider;
  }

  selectSlotWithItem(itemId: string): boolean {
    const index = this.slots.findIndex((slot) => slot.itemId === itemId);
    if (index < 0) {
      return false;
    }
    this._activateSlot(index);
    return true;
  }

  selectFirstAvailableSlot(preferredItemIds: readonly string[] = []): boolean {
    for (const itemId of preferredItemIds) {
      if (this.selectSlotWithItem(itemId)) {
        return true;
      }
    }

    const fallback = this.slots.find((slot) => slot.index !== 0 && !!slot.itemId)
      ?? (this.physGunEnabled ? this.slots[0] : null);
    if (!fallback?.itemId) {
      return false;
    }

    this._activateSlot(fallback.index);
    return true;
  }

  /**
   * Remove the physgun from slot 0 and switch to the first available weapon.
   * Call when entering a mode where physgun should not be accessible (e.g. horde).
   */
  clearPhysGunSlot(): void {
    this.physGunEnabled = false;
    this.slots[0].itemId = null;
    this.slots[0].instanceId = null;
    if (this.physGunDeactivate) this.physGunDeactivate();
    this._compactEquippableSlots();
    const firstWeapon = this.slots.find((s) => !!s.itemId);
    if (firstWeapon) this._activateSlot(firstWeapon.index);
    this._renderCells();
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        activeIndex: this.activeIndex,
        loadedSlots: this.slots.filter((slot) => !!slot.itemId).length,
        activeItemId: this.slots[this.activeIndex]?.itemId ?? null,
        equippedItemIds: this.slots.map((slot) => slot.itemId),
      },
    };
  }

  // ── RoutedInputHandler ───────────────────────────────────────────────────

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    const n = parseInt(event.key, 10);
    if (n >= 1 && n <= SLOT_COUNT && !isNaN(n)) {
      this._activateSlot(n - 1);
      return true;
    }
    return false;
  }

  // ── Private — State ──────────────────────────────────────────────────────

  private _activateSlot(index: number): void {
    if (index < 0 || index >= SLOT_COUNT) return;
    const targetSlot = this.slots[index];

    const slotRequiresItem = index !== 0 || !this.physGunEnabled;
    if (slotRequiresItem && (!targetSlot || !targetSlot.itemId)) {
      console.warn(`[ToolbarSystem] Cannot select empty slot ${index}`);
      return;
    }

    const prev = this.activeIndex;
    this.activeIndex = index;

    // Deactivate previous
    if (prev === 0 && (index !== 0 || !this.physGunEnabled)) this.physGunDeactivate?.();

    // Activate new
    if (this.physGunEnabled && index === 0 && this.slots[0].itemId !== null) {
      this.physGunActivate?.();
    }

    this._renderCells();

    const slot = this.slots[index];
    for (const cb of this.activeSlotCallbacks) {
      try { cb(slot); } catch { /* never crash main loop */ }
    }
    gameBus.emit('stateMutation', {
      source: 'ToolbarSystem',
      path: 'toolbar.activeSlot',
      changedCount: 1,
    });
  }

  /**
   * Called on every inventory change.  Fills slots 1-4 with weapons/tools
   * from the inventory, removing items that are no longer present.
   */
  private _syncFromInventory(inv: GridInventory): void {
    const catalog = this.manager.getCatalog();
    const previousActiveInstanceId = this.slots[this.activeIndex]?.instanceId ?? null;
    const slotStartIndex = this.physGunEnabled ? 1 : 0;
    // Build set of present instanceIds
    const presentIds = new Set(inv.items.map((i) => i.instanceId));
    // Remove stale slots
    for (let i = slotStartIndex; i < SLOT_COUNT; i++) {
      const slot = this.slots[i];
      if (slot.instanceId && !presentIds.has(slot.instanceId)) {
        slot.instanceId = null;
        slot.itemId     = null;
      }
    }
    // Add new equippable items to empty slots
    for (const item of inv.items) {
      const def = catalog.get(item.itemId) as (ItemInfo & { type?: string }) | undefined;
      // Only slot weapons and misc tools (not consumables / ammo)
      const type = def?.type ?? '';
      if (type !== 'weapon' && type !== 'misc') continue;
      if (item.itemId === PHYSGUN_ITEM) {
        if (this.physGunEnabled) {
          this.slots[0].itemId = PHYSGUN_ITEM;
          this.slots[0].instanceId = item.instanceId;
        }
        continue;
      }
      // Already in a slot?
      if (this.slots.some((s) => s.instanceId === item.instanceId)) continue;
      const emptySlot = this.slots.find((s) => s.index >= slotStartIndex && s.instanceId === null);
      if (!emptySlot) break;
      emptySlot.instanceId = item.instanceId;
      emptySlot.itemId     = item.itemId;
    }
    this._compactEquippableSlots();
    this._renderCells();

    const equippedSlotIndex = this.slots.findIndex((slot) => slot.instanceId === inv.equippedWeapon);
    const activeSlot = this.slots[this.activeIndex];
    const activeMissing = !!activeSlot?.instanceId && !presentIds.has(activeSlot.instanceId);
    const shouldSyncToEquipped = equippedSlotIndex >= slotStartIndex && (
      this.activeIndex < slotStartIndex
      || activeMissing
      || (!!previousActiveInstanceId && previousActiveInstanceId !== inv.equippedWeapon && activeSlot?.itemId === null)
    );

    if (shouldSyncToEquipped) {
      this._activateSlot(equippedSlotIndex);
    }
  }

  private _compactEquippableSlots(): void {
    const slotStartIndex = this.physGunEnabled ? 1 : 0;
    const equippable = this.slots
      .filter((slot) => slot.index >= slotStartIndex && !!slot.itemId)
      .map((slot) => ({ instanceId: slot.instanceId, itemId: slot.itemId }));

    for (let i = slotStartIndex; i < SLOT_COUNT; i++) {
      const next = equippable[i - slotStartIndex];
      this.slots[i].instanceId = next?.instanceId ?? null;
      this.slots[i].itemId = next?.itemId ?? null;
    }
  }

  // ── Private — DOM ────────────────────────────────────────────────────────

  private _buildDOM(): void {
    if (this.container) return;

    const wrap = document.createElement('div');
    wrap.id = 'ogui-toolbar';
    Object.assign(wrap.style, {
      position:  'fixed',
      bottom:    '16px',
      left:      '50%',
      transform: 'translateX(-50%)',
      display:   'flex',
      flexDirection: 'row',
      gap:       `${CELL_GAP}px`,
      zIndex:    '9000',
      userSelect: 'none',
      pointerEvents: 'none',
    });

    this.cells = [];

    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = document.createElement('div');
      Object.assign(cell.style, {
        width:       `${CELL_SIZE}px`,
        height:      `${CELL_SIZE}px`,
        background:  OGUI.bgBase,
        border:      `1px solid ${OGUI.border}`,
        boxSizing:   'border-box',
        position:    'relative',
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'center',
        fontFamily:  OGUI.font,
      });

      // Slot number label (top-left)
      const numLabel = document.createElement('span');
      numLabel.textContent = String(i + 1);
      Object.assign(numLabel.style, {
        position:  'absolute',
        top:       '2px',
        left:      '3px',
        fontSize:  '9px',
        color:     OGUI.textDim ?? '#666',
        lineHeight: '1',
      });
      cell.appendChild(numLabel);

      // Icon area (center)
      const icon = document.createElement('div');
      icon.className = 'toolbar-icon';
      Object.assign(icon.style, {
        width:      '30px',
        height:     '30px',
        background: 'transparent',
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize:   '11px',
        fontWeight: 'bold',
        color:      OGUI.textPri,
        letterSpacing: '0.5px',
      });
      cell.appendChild(icon);

      const cooldownBar = document.createElement('div');
      cooldownBar.className = 'toolbar-cooldown-bar';
      Object.assign(cooldownBar.style, {
        position:  'absolute',
        left:      '4px',
        right:     '4px',
        bottom:    '4px',
        height:    '4px',
        background: 'rgba(255, 255, 255, 0.12)',
        borderRadius: '2px',
        overflow:  'hidden',
        pointerEvents: 'none',
      });
      const cooldownFill = document.createElement('div');
      cooldownFill.className = 'toolbar-cooldown-fill';
      Object.assign(cooldownFill.style, {
        height:   '100%',
        width:    '0%',
        background: 'rgba(255, 112, 36, 0.85)',
        transformOrigin: 'left',
        transition: 'width 0.1s linear',
      });
      cooldownBar.appendChild(cooldownFill);
      cell.appendChild(cooldownBar);

      this.cells.push(cell);
      wrap.appendChild(cell);
    }

    document.body.appendChild(wrap);
    this.container = wrap;
    this._renderCells();
  }

  private _destroyDOM(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.cells = [];
    }
  }

  private _renderCells(): void {
    if (!this.container) return;
    const catalog = this.manager.getCatalog();

    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = this.cells[i];
      if (!cell) continue;
      const slot    = this.slots[i];
      const active  = i === this.activeIndex;
      const def     = slot.itemId ? (catalog.get(slot.itemId) as (ItemInfo & { color?: string; symbol?: string }) | undefined) : undefined;

      // Border / bg highlight for active
      cell.style.border     = active
        ? `1px solid ${OGUI.borderSel ?? 'rgba(200,200,200,0.8)'}`
        : `1px solid ${OGUI.border}`;
      cell.style.background = active
        ? 'rgba(30, 30, 30, 0.97)'
        : OGUI.bgBase;
      cell.style.boxShadow  = active ? `0 0 6px rgba(160,160,160,0.35)` : 'none';

      // Icon
      const icon = cell.querySelector<HTMLDivElement>('.toolbar-icon');
      if (icon) {
        if (def) {
          icon.style.backgroundColor = def.color ?? 'rgba(30,30,60,0.8)';
          icon.style.backgroundImage = `url(${getGeneratedItemIconUrl(def.id)})`;
          icon.style.backgroundSize = '26px 26px';
          icon.style.backgroundPosition = 'center 4px';
          icon.style.backgroundRepeat = 'no-repeat';
          icon.style.borderRadius = '2px';
          icon.textContent = def.symbol ?? def.id.slice(0, 3).toUpperCase();
          icon.style.color = active ? '#fff' : OGUI.textPri;
          icon.style.alignItems = 'flex-end';
          icon.style.justifyContent = 'center';
          icon.style.paddingBottom = '2px';
          icon.style.textShadow = '0 1px 2px rgba(0,0,0,0.8)';
        } else {
          icon.style.backgroundColor = 'transparent';
          icon.style.backgroundImage = 'none';
          icon.textContent = '';
        }
      }

      const cooldownFill = cell.querySelector<HTMLDivElement>('.toolbar-cooldown-fill');
      if (cooldownFill) {
        const cooldownFraction = this.cooldownProvider ? this.cooldownProvider(slot) : 0;
        const clamped = Math.max(0, Math.min(1, cooldownFraction));
        cooldownFill.style.width = `${clamped * 100}%`;
      }
    }
  }
}
