/**
 * InventoryGridUI
 *
 * Diablo 2–style grid inventory panel.
 *
 * Layout (numbers approximate):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  INVENTORY                              [I] / [ESC] close│
 *   ├─────────────┬────────────────────────────────────────────┤
 *   │ EQUIPPED    │                 BACKPACK                   │
 *   │ ┌─────────┐ │  ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐                  │
 *   │ │ WEAPON  │ │  │ │ │ │ │ │ │ │ │ │ │                  │
 *   │ └─────────┘ │  ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤                  │
 *   │ ┌─────────┐ │  │ │ │ │ │ │ │ │ │ │ │                  │
 *   │ │  ARMOR  │ │  ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤                  │
 *   │ └─────────┘ │  …  6 rows total                          │
 *   │             │  └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘                  │
 *   ├─────────────┴────────────────────────────────────────────┤
 *   │  [item name]  [stat block]  [description]                │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Features:
 *   - 44 px² grid cells; items span their catalogued gridW × gridH
 *   - Drag & drop with snap-to-grid and green/red placement highlight
 *   - Right-click context menu: Equip / Drop
 *   - Equipment slots (weapon + armor) with drag-to-equip
 *   - Hover tooltip in the info bar
 *   - Fully OGUI-themed (grey/monochrome)
 *   - Toggle with [I]; releases pointer lock when open
 *   - Enable/disable tied to play mode via enable() / disable()
 */

import { OGUI } from './OGUITheme';
import type { InventoryGridManager, GridInventory, GridItem, ItemInfo } from '../../2-systems/gameplay/systems/InventoryGridManager';
import { isConsoleOpen } from '../editor/Console';
import { getGeneratedItemIconUrl } from './GeneratedItemTextures';
import { EventListenerRegistry } from '../../1-kernel/core/EventListenerRegistry';
import { gameBus } from '@engine/1-kernel/core/public-api';

// ─── Constants ────────────────────────────────────────────────────────────────

const CELL  = 44;     // pixel size per grid cell
const PAD   = 6;      // inner padding inside item icon

// Equip-slot visual dimensions
const EQUIP_W_CELLS = 2;
const EQUIP_H_MAP   = { weapon: 3, armor: 3 } as const;

// ─── InventoryGridUI ──────────────────────────────────────────────────────────

export class InventoryGridUI {
  private _manager: InventoryGridManager;
  private _enabled  = false;
  private _open     = false;
  private _listenerRegistry = new EventListenerRegistry();

  // DOM nodes
  private _panel:      HTMLDivElement | null = null;
  private _grid:       HTMLDivElement | null = null;
  private _equip:      HTMLDivElement | null = null;
  private _infoBar:    HTMLDivElement | null = null;
  private _ghost:      HTMLDivElement | null = null;
  private _highlight:  HTMLDivElement | null = null;
  private _ctxMenu:    HTMLDivElement | null = null;

  // Drag state
  private _drag: {
    instanceId: string;
    itemId:     string;
    def:        ItemInfo;
    /** Pixel offset of cursor within the item's top-left corner */
    offPxX:     number;
    offPxY:     number;
    /** Current snap cell (grid coords) */
    snapX:      number;
    snapY:      number;
    valid:      boolean;
  } | null = null;

  // Key handler ref for cleanup
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private _boundMouseUp:   ((e: MouseEvent) => void) | null = null;

  constructor(manager: InventoryGridManager) {
    this._manager = manager;
    this._injectCSS();
    this._buildPanel();
    this._attachKeys();

    // Re-render whenever inventory changes
    manager.onChange(() => {
      console.log(`[InventoryGridUI] Inventory changed, panel open: ${this._open}`);
      if (this._open) {
        console.log('[InventoryGridUI] Re-rendering inventory panel');
        this._render();
      }
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  enable(): void  { this._enabled = true; }
  disable(): void { this._enabled = false; this.close(); }

  open(): void {
    if (!this._panel || !this._enabled) {
      console.warn(`[InventoryGridUI.open] Cannot open - panel exists: ${!!this._panel}, enabled: ${this._enabled}`);
      return;
    }
    console.log('[InventoryGridUI] Opening inventory panel');
    this._open = true;
    this._panel.style.display = 'flex';
    // Release pointer lock so the player can interact
    if (document.pointerLockElement) document.exitPointerLock();
    this._render();
  }

  close(): void {
    if (!this._panel) return;
    this._open = false;
    this._panel.style.display = 'none';
    this._stopDrag();
    this._hideCtxMenu();
  }

  toggle(): void {
    if (this._open) this.close(); else this.open();
  }

  isOpen(): boolean { return this._open; }

  /** EngineController calls this every frame. */
  update(_dt: number): void { /* no per-frame work needed */ }

  // ── CSS injection ─────────────────────────────────────────────────────────

  private _injectCSS(): void {
    if (document.getElementById('inv-styles')) return;
    const s = document.createElement('style');
    s.id = 'inv-styles';
    s.textContent = `
      #inv-panel {
        display: none;
        position: fixed;
        inset: 0;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.72);
        z-index: ${OGUI.zMenu + 50};
        font-family: ${OGUI.font};
      }
      #inv-window {
        display: flex;
        flex-direction: column;
        background: rgba(12,12,12,0.97);
        border: 1px solid ${OGUI.border};
        box-shadow: 0 8px 48px rgba(0,0,0,0.9);
        min-width: 660px;
        user-select: none;
      }
      #inv-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px 8px;
        border-bottom: 1px solid ${OGUI.borderDim};
        background: rgba(20,20,20,0.6);
      }
      #inv-header-title {
        font-size: 12px;
        letter-spacing: 4px;
        color: ${OGUI.textHead};
      }
      #inv-header-hint {
        font-size: 9px;
        letter-spacing: 1.5px;
        color: ${OGUI.textDim};
      }
      #inv-close-btn {
        background: transparent;
        border: 1px solid ${OGUI.borderDim};
        color: ${OGUI.textSec};
        padding: 3px 10px;
        cursor: pointer;
        font-family: ${OGUI.font};
        font-size: 11px;
        letter-spacing: 1px;
        transition: color 0.1s, border-color 0.1s;
      }
      #inv-close-btn:hover { color: ${OGUI.textPri}; border-color: ${OGUI.border}; }
      #inv-body {
        display: flex;
        gap: 0;
        padding: 14px;
      }
      #inv-equip-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-right: 14px;
        border-right: 1px solid ${OGUI.borderDim};
        margin-right: 14px;
        min-width: ${EQUIP_W_CELLS * CELL + 28}px;
      }
      .inv-section-label {
        font-size: 9px;
        letter-spacing: 2px;
        color: ${OGUI.textHead};
        margin-bottom: 6px;
      }
      .inv-equip-slot {
        width:  ${EQUIP_W_CELLS * CELL}px;
        height: ${EQUIP_H_MAP['weapon'] * CELL}px;
        border: 1px solid ${OGUI.borderDim};
        background: rgba(255,255,255,0.012);
        position: relative;
        cursor: pointer;
        transition: border-color 0.1s;
        box-sizing: border-box;
      }
      .inv-equip-slot:hover { border-color: ${OGUI.border}; }
      .inv-equip-slot-label {
        position: absolute;
        bottom: 4px;
        left: 0; right: 0;
        text-align: center;
        font-size: 8px;
        letter-spacing: 2px;
        color: ${OGUI.textDim};
        pointer-events: none;
      }
      .inv-equip-slot.equipped { border-color: ${OGUI.borderSel}; }
      #inv-grid-wrap { position: relative; }
      #inv-grid {
        position: relative;
        overflow: hidden;
      }
      .inv-grid-bg {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .inv-item {
        position: absolute;
        box-sizing: border-box;
        cursor: grab;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255,255,255,0.12);
        transition: box-shadow 0.08s, border-color 0.08s;
        overflow: hidden;
        z-index: 1;
      }
      .inv-item:hover { border-color: ${OGUI.borderSel}; box-shadow: 0 0 6px rgba(180,180,180,0.15); }
      .inv-item:active { cursor: grabbing; }
      .inv-item.equipped { border-color: ${OGUI.ok}; }
      .inv-item-symbol {
        font-size: 10px;
        letter-spacing: 1.5px;
        color: rgba(200,200,200,0.85);
        font-weight: bold;
        pointer-events: none;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      }
      .inv-item-qty {
        position: absolute;
        bottom: 2px;
        right: 4px;
        font-size: 8px;
        color: rgba(180,180,180,0.7);
        pointer-events: none;
      }
      .inv-item-equip-badge {
        position: absolute;
        top: 2px;
        right: 3px;
        font-size: 7px;
        letter-spacing: 0.5px;
        color: ${OGUI.ok};
        pointer-events: none;
      }
      #inv-highlight {
        position: absolute;
        pointer-events: none;
        z-index: 3;
        transition: background 0.05s;
      }
      #inv-ghost {
        position: fixed;
        pointer-events: none;
        z-index: ${OGUI.zMenu + 60};
        opacity: 0.82;
        cursor: grabbing;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid ${OGUI.borderSel};
        overflow: hidden;
      }
      #inv-ghost-sym {
        font-size: 10px;
        letter-spacing: 1.5px;
        color: rgba(200,200,200,0.85);
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      }
      #inv-info-bar {
        min-height: 52px;
        padding: 10px 16px;
        border-top: 1px solid ${OGUI.borderDim};
        background: rgba(10,10,10,0.5);
        display: flex;
        gap: 20px;
        align-items: flex-start;
      }
      #inv-info-name {
        font-size: 11px;
        color: ${OGUI.textPri};
        letter-spacing: 1px;
        white-space: nowrap;
      }
      #inv-info-desc {
        font-size: 10px;
        color: ${OGUI.textSec};
        letter-spacing: 0.5px;
        margin-top: 3px;
      }
      #inv-info-stats {
        font-size: 9px;
        color: ${OGUI.textHead};
        margin-top: 3px;
        letter-spacing: 0.8px;
      }
      #inv-ctx-menu {
        position: fixed;
        background: rgba(14,14,14,0.98);
        border: 1px solid ${OGUI.border};
        z-index: ${OGUI.zMenu + 70};
        min-width: 140px;
        padding: 4px 0;
        font-family: ${OGUI.font};
      }
      .inv-ctx-item {
        padding: 6px 16px;
        font-size: 10px;
        letter-spacing: 1px;
        color: ${OGUI.textPri};
        cursor: pointer;
        transition: background 0.08s;
      }
      .inv-ctx-item:hover { background: rgba(255,255,255,0.06); }
      .inv-ctx-item.danger { color: ${OGUI.warn}; }
    `;
    document.head.appendChild(s);
  }

  // ── Panel construction ────────────────────────────────────────────────────

  private _buildPanel(): void {
    this._panel = document.createElement('div');
    this._panel.id = 'inv-panel';

    const win = document.createElement('div');
    win.id = 'inv-window';

    // Header
    const header = document.createElement('div');
    header.id = 'inv-header';
    header.innerHTML = `
      <div>
        <div id="inv-header-title">INVENTORY</div>
        <div id="inv-header-hint">[I] TOGGLE &nbsp;·&nbsp; DRAG ITEMS TO MOVE &nbsp;·&nbsp; RIGHT-CLICK FOR OPTIONS</div>
      </div>
      <button id="inv-close-btn">✕ CLOSE</button>
    `;
    win.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.id = 'inv-body';

    // Equip panel
    this._equip = document.createElement('div');
    this._equip.id = 'inv-equip-panel';
    body.appendChild(this._equip);

    // Grid wrap
    const gridWrap = document.createElement('div');
    gridWrap.id = 'inv-grid-wrap';

    this._grid = document.createElement('div');
    this._grid.id = 'inv-grid';
    gridWrap.appendChild(this._grid);
    body.appendChild(gridWrap);
    win.appendChild(body);

    // Info bar
    this._infoBar = document.createElement('div');
    this._infoBar.id = 'inv-info-bar';
    this._infoBar.innerHTML = `
      <div id="inv-info-text">
        <div id="inv-info-name" style="color:${OGUI.textDim}">Hover an item</div>
        <div id="inv-info-desc"></div>
        <div id="inv-info-stats"></div>
      </div>
    `;
    win.appendChild(this._infoBar);

    this._panel.appendChild(win);
    document.body.appendChild(this._panel);

    // Click-outside to close [Tier 0A: Tracked listener]
    this._listenerRegistry.addEventListener(this._panel, 'mousedown', (e) => {
      if (e.target === this._panel) this.close();
    });

    // Close button [Tier 0A: Tracked listener]
    const closeBtn = win.querySelector('#inv-close-btn');
    if (closeBtn) {
      this._listenerRegistry.addEventListener(closeBtn, 'click', () => this.close());
    }

    // Context menu container
    this._ctxMenu = document.createElement('div');
    this._ctxMenu.id = 'inv-ctx-menu';
    this._ctxMenu.style.display = 'none';
    document.body.appendChild(this._ctxMenu);

    // Ghost drag element
    this._ghost = document.createElement('div');
    this._ghost.id = 'inv-ghost';
    this._ghost.style.display = 'none';
    this._ghost.innerHTML = `<span id="inv-ghost-sym"></span>`;
    document.body.appendChild(this._ghost);

    // Highlight overlay
    this._highlight = document.createElement('div');
    this._highlight.id = 'inv-highlight';
    this._highlight.style.display = 'none';
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** Full re-render of equip panel + grid from current inventory state. */
  private _render(): void {
    const inv = this._manager.getInventory();
    this._renderEquipPanel(inv);
    this._renderGrid(inv);
  }

  private _renderEquipPanel(inv: GridInventory | null): void {
    if (!this._equip) return;
    this._equip.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'inv-section-label';
    label.textContent = 'EQUIPPED';
    this._equip.appendChild(label);

    for (const slot of ['weapon', 'armor'] as const) {
      const equippedId = inv?.[slot === 'weapon' ? 'equippedWeapon' : 'equippedArmor'] ?? null;
      const equippedItem: GridItem | undefined = inv?.items.find(
        (i) => i.instanceId === equippedId,
      );
      const info: ItemInfo | undefined = equippedItem
        ? this._manager.getItemInfo(equippedItem.itemId)
        : undefined;

      const slotEl = document.createElement('div');
      slotEl.className = 'inv-equip-slot' + (equippedItem ? ' equipped' : '');
      slotEl.dataset['slot'] = slot;

      if (info && equippedItem) {
        slotEl.style.background = this._darken(info.color);
        slotEl.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.04), rgba(0,0,0,0.08)), url(${getGeneratedItemIconUrl(info.id)})`;
        slotEl.style.backgroundSize = '100% 100%, calc(100% - 12px) calc(100% - 12px)';
        slotEl.style.backgroundPosition = 'center, center';
        slotEl.style.backgroundRepeat = 'no-repeat';
        const sym = document.createElement('div');
        sym.className = 'inv-item-symbol';
        sym.textContent = info.symbol;
        sym.style.position = 'absolute';
        sym.style.bottom = '16px';
        sym.style.left = '0';
        sym.style.right = '0';
        sym.style.textAlign = 'center';
        slotEl.appendChild(sym);
        this._bindItemHover(slotEl, equippedItem, info);
      }

      const slotLbl = document.createElement('div');
      slotLbl.className = 'inv-equip-slot-label';
      slotLbl.textContent = slot.toUpperCase();
      slotEl.appendChild(slotLbl);

      // Click equip slot → unequip [Tier 0A: Tracked listener]
      this._listenerRegistry.addEventListener(slotEl, 'click', () => {
        if (equippedItem) {
          this._manager.equipItem(equippedItem.instanceId, slot);
        }
      });

      this._equip.appendChild(slotEl);
    }
  }

  private _renderGrid(inv: GridInventory | null): void {
    if (!this._grid) return;

    const cols = inv?.cols ?? 10;
    const rows = inv?.rows ?? 6;
    const W    = cols * CELL;
    const H    = rows * CELL;

    this._grid.style.width  = `${W}px`;
    this._grid.style.height = `${H}px`;

    // Clear previous items (keep highlight if present)
    Array.from(this._grid.children).forEach((c) => {
      if (c !== this._highlight) c.remove();
    });

    // Draw grid background with SVG lines
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width',  String(W));
    svg.setAttribute('height', String(H));
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

    // Vertical lines
    for (let c = 0; c <= cols; c++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(c * CELL));
      line.setAttribute('x2', String(c * CELL));
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(H));
      line.setAttribute('stroke', 'rgba(80,80,80,0.35)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }
    // Horizontal lines
    for (let r = 0; r <= rows; r++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(W));
      line.setAttribute('y1', String(r * CELL));
      line.setAttribute('y2', String(r * CELL));
      line.setAttribute('stroke', 'rgba(80,80,80,0.35)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }
    this._grid.appendChild(svg);

    // Highlight overlay (always on top)
    if (this._highlight) {
      this._highlight.style.display = 'none';
      this._grid.appendChild(this._highlight);
    }

    // Render items
    if (!inv) return;
    for (const item of inv.items) {
      const info = this._manager.getItemInfo(item.itemId);
      if (!info) continue;
      this._renderItem(item, info);
    }
  }

  private _renderItem(item: GridItem, info: ItemInfo): void {
    if (!this._grid) return;
    const el = document.createElement('div');
    el.className   = 'inv-item' + (item.equipped ? ' equipped' : '');
    el.dataset['id'] = item.instanceId;

    el.style.left       = `${item.gridX * CELL + 1}px`;
    el.style.top        = `${item.gridY * CELL + 1}px`;
    el.style.width      = `${info.gridW * CELL - 2}px`;
    el.style.height     = `${info.gridH * CELL - 2}px`;
    el.style.background = this._darken(info.color);
    el.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.03), rgba(0,0,0,0.08)), url(${getGeneratedItemIconUrl(info.id)})`;
    el.style.backgroundSize = '100% 100%, calc(100% - 12px) calc(100% - 12px)';
    el.style.backgroundPosition = 'center, center';
    el.style.backgroundRepeat = 'no-repeat';

    const sym = document.createElement('div');
    sym.className   = 'inv-item-symbol';
    sym.textContent = info.symbol;
    sym.style.position = 'absolute';
    sym.style.bottom = '4px';
    sym.style.left = '0';
    sym.style.right = '0';
    sym.style.textAlign = 'center';
    el.appendChild(sym);

    if (info.maxStack > 1 && item.quantity > 1) {
      const qty = document.createElement('div');
      qty.className   = 'inv-item-qty';
      qty.textContent = String(item.quantity);
      el.appendChild(qty);
    }

    if (item.equipped) {
      const badge = document.createElement('div');
      badge.className   = 'inv-item-equip-badge';
      badge.textContent = 'E';
      el.appendChild(badge);
    }

    this._bindItemHover(el, item, info);
    this._bindDragStart(el, item, info);
    this._bindRightClick(el, item, info);

    this._grid.appendChild(el);
  }

  // ── Hover tooltip ─────────────────────────────────────────────────────────

  private _bindItemHover(el: HTMLElement, item: GridItem, info: ItemInfo): void {
    // Tier 0A: Track hover listeners for cleanup
    this._listenerRegistry.addEventListener(el, 'mouseenter', () => this._showInfo(item, info));
    this._listenerRegistry.addEventListener(el, 'mouseleave', () => this._clearInfo());
  }

  private _showInfo(item: GridItem, info: ItemInfo): void {
    const name  = document.getElementById('inv-info-name');
    const desc  = document.getElementById('inv-info-desc');
    const stats = document.getElementById('inv-info-stats');
    if (name)  name.style.color = OGUI.textWhite;
    if (name)  name.textContent = `${info.label}${item.quantity > 1 ? ' ×' + item.quantity : ''}`;
    if (desc)  desc.textContent = info.description;
    if (stats) {
      const parts: string[] = [];
      if (info.stats) {
        for (const [k, v] of Object.entries(info.stats)) {
          parts.push(`${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`);
        }
      }
      parts.push(`${info.gridW}×${info.gridH}  STACK ${item.quantity}/${info.maxStack}`);
      stats.textContent = parts.join('  ·  ');
    }
  }

  private _clearInfo(): void {
    const name  = document.getElementById('inv-info-name');
    const desc  = document.getElementById('inv-info-desc');
    const stats = document.getElementById('inv-info-stats');
    if (name)  { name.textContent = 'Hover an item'; name.style.color = OGUI.textDim; }
    if (desc)  desc.textContent = '';
    if (stats) stats.textContent = '';
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  private _bindRightClick(el: HTMLElement, item: GridItem, info: ItemInfo): void {
    // Tier 0A: Track context menu listener for cleanup
    this._listenerRegistry.addEventListener(el, 'contextmenu', (e) => {
      e.preventDefault();
      this._showCtxMenu(e.clientX, e.clientY, item, info);
    });
  }

  private _showCtxMenu(x: number, y: number, item: GridItem, info: ItemInfo): void {
    if (!this._ctxMenu) return;
    this._ctxMenu.innerHTML = '';

    // Equip toggle
    const inv  = this._manager.getInventory();
    const slot: 'weapon' | 'armor' | null =
      info.type === 'weapon' ? 'weapon' :
      info.type === 'armor'  ? 'armor'  : null;

    if (slot) {
      const isEquipped = (
        (slot === 'weapon' && inv?.equippedWeapon === item.instanceId) ||
        (slot === 'armor'  && inv?.equippedArmor  === item.instanceId)
      );
      const equipBtn = document.createElement('div');
      equipBtn.className = 'inv-ctx-item';
      equipBtn.textContent = isEquipped ? '↩ UNEQUIP' : '⚙ EQUIP';
      // Tier 0A: Track context menu button listener
      this._listenerRegistry.addEventListener(equipBtn, 'click', () => {
        this._manager.equipItem(item.instanceId, slot);
        this._hideCtxMenu();
      });
      this._ctxMenu.appendChild(equipBtn);
    }

    // Drop [Tier 0A: Track listener]
    const dropBtn = document.createElement('div');
    dropBtn.className = 'inv-ctx-item danger';
    dropBtn.textContent = '✕ DROP';
    this._listenerRegistry.addEventListener(dropBtn, 'click', async () => {
      console.log('[InventoryGridUI] DROP BUTTON CLICKED for item:', item);
      console.log('[InventoryGridUI] Calling dropItem...');
      const success = await this._manager.dropItem(item.instanceId);
      if (!success) {
        console.warn('[InventoryGridUI] Drop failed, item remains in inventory');
        this._hideCtxMenu();
        return;
      }

      console.log('[InventoryGridUI] Drop confirmed, emitting ITEM_DROPPED_FROM_INVENTORY event...');
      // @ts-ignore - custom event not in GameEvents type
      gameBus.emit('ITEM_DROPPED_FROM_INVENTORY', {
        itemId: item.itemId,
        instanceId: item.instanceId,
        quantity: item.quantity ?? 1,
      });
      console.log('[InventoryGridUI] Event emitted');
      this._hideCtxMenu();
    });
    this._ctxMenu.appendChild(dropBtn);

    // Position and show
    this._ctxMenu.style.display = 'block';
    this._ctxMenu.style.left    = `${x}px`;
    this._ctxMenu.style.top     = `${y}px`;

    // Dismiss on click-outside
    const dismiss = (e: MouseEvent) => {
      if (!this._ctxMenu?.contains(e.target as Node)) {
        this._hideCtxMenu();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  private _hideCtxMenu(): void {
    if (this._ctxMenu) this._ctxMenu.style.display = 'none';
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  private _bindDragStart(el: HTMLElement, item: GridItem, info: ItemInfo): void {
    // Tier 0A: Track drag start listener for cleanup
    this._listenerRegistry.addEventListener(el, 'mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const gridRect = this._grid!.getBoundingClientRect();
      const elRect   = el.getBoundingClientRect();

      this._drag = {
        instanceId: item.instanceId,
        itemId:     item.itemId,
        def:        info,
        offPxX:     e.clientX - elRect.left,
        offPxY:     e.clientY - elRect.top,
        snapX:      item.gridX,
        snapY:      item.gridY,
        valid:      true,
      };

      // Build ghost
      if (this._ghost) {
        const sym = this._ghost.querySelector('#inv-ghost-sym') as HTMLElement;
        if (sym) sym.textContent = info.symbol;
        this._ghost.style.width      = `${info.gridW * CELL - 2}px`;
        this._ghost.style.height     = `${info.gridH * CELL - 2}px`;
        this._ghost.style.background = this._darken(info.color);
        this._ghost.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.03), rgba(0,0,0,0.08)), url(${getGeneratedItemIconUrl(info.id)})`;
        this._ghost.style.backgroundSize = '100% 100%, calc(100% - 12px) calc(100% - 12px)';
        this._ghost.style.backgroundPosition = 'center, center';
        this._ghost.style.backgroundRepeat = 'no-repeat';
        this._ghost.style.display    = 'flex';
        this._ghost.style.left       = `${e.clientX - this._drag.offPxX}px`;
        this._ghost.style.top        = `${e.clientY - this._drag.offPxY}px`;
      }

      // Dim original item
      el.style.opacity = '0.35';

      // Global move/up
      this._boundMouseMove = this._onMouseMove.bind(this);
      this._boundMouseUp   = this._onMouseUp.bind(this);
      document.addEventListener('mousemove', this._boundMouseMove);
      document.addEventListener('mouseup',   this._boundMouseUp);
    });
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._drag || !this._grid || !this._ghost) return;

    // Move ghost
    this._ghost.style.left = `${e.clientX - this._drag.offPxX}px`;
    this._ghost.style.top  = `${e.clientY - this._drag.offPxY}px`;

    // Calculate snap cell
    const rect     = this._grid.getBoundingClientRect();
    const relX     = e.clientX - rect.left - this._drag.offPxX;
    const relY     = e.clientY - rect.top  - this._drag.offPxY;
    const snapX    = Math.round(relX / CELL);
    const snapY    = Math.round(relY / CELL);
    const valid    = this._manager.canPlace(this._drag.instanceId, this._drag.itemId, snapX, snapY);

    this._drag.snapX = snapX;
    this._drag.snapY = snapY;
    this._drag.valid = valid;

    // Show highlight on grid
    if (this._highlight) {
      const inv = this._manager.getInventory();
      if (inv && this._grid.contains(this._highlight)) {
        this._highlight.style.display  = 'block';
        this._highlight.style.left     = `${snapX * CELL}px`;
        this._highlight.style.top      = `${snapY * CELL}px`;
        this._highlight.style.width    = `${this._drag.def.gridW * CELL}px`;
        this._highlight.style.height   = `${this._drag.def.gridH * CELL}px`;
        this._highlight.style.background = valid
          ? 'rgba(80, 180, 80, 0.25)'
          : 'rgba(180, 60, 60, 0.30)';
        this._highlight.style.border   = `1px solid ${valid ? 'rgba(80,180,80,0.6)' : 'rgba(180,60,60,0.6)'}`;
      }
    }
  }

  private _onMouseUp(_e: MouseEvent): void {
    if (!this._drag) return;

    const { instanceId, snapX, snapY, valid }        = this._drag;
    const originalItem = this._manager.getItem(instanceId);
    const origX        = originalItem?.gridX ?? 0;
    const origY        = originalItem?.gridY ?? 0;

    // Restore item opacity
    const origEl = this._grid?.querySelector<HTMLElement>(`[data-id="${instanceId}"]`);
    if (origEl) origEl.style.opacity = '';

    if (valid && (snapX !== origX || snapY !== origY)) {
      // Async move — grid re-render triggered by manager.onChange
      this._manager.moveItem(instanceId, snapX, snapY);
    }

    this._stopDrag();
  }

  private _stopDrag(): void {
    if (this._ghost)     this._ghost.style.display = 'none';
    if (this._highlight) this._highlight.style.display = 'none';

    // Restore opacity for any dimmed item
    this._grid?.querySelectorAll<HTMLElement>('.inv-item').forEach((el) => {
      el.style.opacity = '';
    });

    this._drag = null;

    if (this._boundMouseMove) {
      document.removeEventListener('mousemove', this._boundMouseMove);
      this._boundMouseMove = null;
    }
    if (this._boundMouseUp) {
      document.removeEventListener('mouseup', this._boundMouseUp);
      this._boundMouseUp = null;
    }
  }

  // ── Key bindings ──────────────────────────────────────────────────────────

  private _attachKeys(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._enabled) return;
      if (isConsoleOpen?.()) return;

      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this._open) {
        this.close();
      }
    };
    // Tier 0A: Track keyboard listener via EventListenerRegistry
    this._listenerRegistry.addEventListener(document, 'keydown', this._keyHandler);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Darken an item's theme colour slightly for the icon background. */
  private _darken(color: string): string {
    return color; // already dark in the catalog; pass through
  }

  destroy(): void {
    // Tier 0A: Dispose all tracked event listeners via EventListenerRegistry
    this._listenerRegistry.dispose();
    
    // Legacy cleanup for safety
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    this._stopDrag();
    this._panel?.remove();
    this._ghost?.remove();
    this._ctxMenu?.remove();
    document.getElementById('inv-styles')?.remove();
  }
}
