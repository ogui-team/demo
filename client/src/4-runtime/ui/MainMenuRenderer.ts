/**
 * MainMenuRenderer
 *
 * DOM overlay that renders a CS 1.6-styled text menu.
 * No game logic lives here — it receives a SubMenuDef and paints rows.
 *
 * Uses event delegation on the list container so that DOM rebuilds
 * during hover don't break click events.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface SubMenuItemDef {
  label: string;
  selected: boolean;
  header?: boolean;
  toggleState?: boolean;
  /** Optional secondary description line. */
  description?: string;
}

export interface SubMenuDef {
  title: string;
  items: SubMenuItemDef[];
  /** Small text below the title (e.g. "← ESC to go back"). */
  subtitle?: string;
}

// ─── MainMenuRenderer ─────────────────────────────────────────────────
import { OGUI, injectOGUIStylesheet } from './OGUITheme';
export class MainMenuRenderer {
  private root: HTMLDivElement;
  private contentRow: HTMLDivElement;
  private primaryColumn: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private listEl: HTMLDivElement;
  private versionEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private accessoryHost: HTMLDivElement;

  /* Callback wiring set by MainMenu */
  onHover: ((index: number) => void) | null = null;
  onClick: ((index: number) => void) | null = null;

  /** Cached items for in-place selection updates. */
  private _currentItems: SubMenuItemDef[] = [];

  constructor() {
    injectOGUIStylesheet();
    this.root = document.createElement('div');
    this.root.id = 'cs-main-menu';
    this.applyRootStyle();

    this.contentRow = document.createElement('div');
    this.applyContentRowStyle();
    this.root.appendChild(this.contentRow);

    this.primaryColumn = document.createElement('div');
    this.applyPrimaryColumnStyle();
    this.contentRow.appendChild(this.primaryColumn);

    // title bar
    this.titleEl = document.createElement('div');
    this.applyTitleStyle();
    this.primaryColumn.appendChild(this.titleEl);

    // subtitle
    this.subtitleEl = document.createElement('div');
    this.applySubtitleStyle();
    this.primaryColumn.appendChild(this.subtitleEl);

    // item list
    this.listEl = document.createElement('div');
    this.applyListStyle();
    this.primaryColumn.appendChild(this.listEl);

    // footer hint
    this.footerEl = document.createElement('div');
    this.applyFooterStyle();
    this.primaryColumn.appendChild(this.footerEl);

    this.accessoryHost = document.createElement('div');
    this.applyAccessoryHostStyle();
    this.contentRow.appendChild(this.accessoryHost);

    // bottom version string
    this.versionEl = document.createElement('div');
    this.applyVersionStyle();
    this.versionEl.textContent = 'NEXUS ENGINE v0.3.1 | Transactional DOD Kernel';
    this.root.appendChild(this.versionEl);

    // ── Event delegation on list container ─────────────────────────
    this.listEl.addEventListener('mouseover', (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest('[data-menu-index]') as HTMLElement | null;
      if (row) {
        const idx = parseInt(row.dataset.menuIndex!, 10);
        if (!isNaN(idx)) this.onHover?.(idx);
      }
    });

    // Use mousedown — click doesn't fire if hover re-renders between
    // mousedown and mouseup (the target element gets replaced).
    this.listEl.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault(); // prevent focus / text-selection side-effects
      const row = (e.target as HTMLElement).closest('[data-menu-index]') as HTMLElement | null;
      if (row) {
        const idx = parseInt(row.dataset.menuIndex!, 10);
        if (!isNaN(idx)) this.onClick?.(idx);
      }
    });

    document.body.appendChild(this.root);
    this.hide();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  render(def: SubMenuDef): void {
    this._currentItems = def.items;
    this.titleEl.textContent = def.title;
    this.subtitleEl.textContent = def.subtitle ?? '';
    this.subtitleEl.style.display = def.subtitle ? 'block' : 'none';
    this.listEl.innerHTML = '';

    def.items.forEach((item, i) => {
      const row = document.createElement('div');
      this.applyRowStyle(row, item);

      // Rows that are not headers get a data attribute for delegation
      if (!item.header) {
        row.dataset.menuIndex = String(i);
      }

      // Toggle indicator
      if (item.toggleState !== undefined) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        row.appendChild(labelSpan);

        const badge = document.createElement('span');
        badge.textContent = item.toggleState ? ' [ON]' : ' [OFF]';
      badge.style.color = item.toggleState ? OGUI.toggleOn : OGUI.toggleOff;
        badge.style.marginLeft = '8px';
        badge.style.fontWeight = 'bold';
        row.appendChild(badge);
      } else {
        row.textContent = item.label;
      }

      // Optional description
      if (item.description) {
        const desc = document.createElement('div');
        desc.textContent = item.description;
        desc.style.fontSize = '11px';
        desc.style.color = OGUI.textDim;
        desc.style.marginTop = '2px';
        desc.style.lineHeight = '1.3';
        row.appendChild(desc);
      }

      this.listEl.appendChild(row);
    });
  }

  /**
   * Update only the visual selection state without rebuilding the DOM.
   * This is used by hover so that click targets remain stable.
   */
  updateSelection(selectedIndex: number): void {
    const rows = this.listEl.children;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLDivElement;
      const item = this._currentItems[i];
      if (!item || item.header) continue;
      const isSelected = i === selectedIndex;
      row.style.color = isSelected ? OGUI.textWhite : OGUI.textSec;
      row.style.background = isSelected ? OGUI.bgSelected : 'transparent';
      row.style.borderLeftColor = isSelected ? OGUI.borderSel : 'transparent';
    }
  }

  setFooter(text: string): void {
    this.footerEl.textContent = text;
    this.footerEl.style.display = text ? 'block' : 'none';
  }

  setAccessoryPanel(element: HTMLElement | null): void {
    this.accessoryHost.innerHTML = '';
    if (!element) {
      this.accessoryHost.style.display = 'none';
      return;
    }
    this.accessoryHost.style.display = 'block';
    this.accessoryHost.appendChild(element);
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.remove();
  }

  // ─── Styling ─────────────────────────────────────────────────────────

  private applyRootStyle(): void {
    const s = this.root.style;
    s.position = 'fixed';
    s.top = '0';
    s.left = '0';
    s.width = '100vw';
    s.height = '100vh';
    s.display = 'flex';
    s.flexDirection = 'column';
    s.alignItems = 'flex-start';
    s.justifyContent = 'flex-start';
    s.padding = '60px 0 60px 9vw';
    s.zIndex = String(OGUI.zMenu);
    s.fontFamily = "'Inter', system-ui, sans-serif";
    s.userSelect = 'none';
    s.backgroundColor = 'rgba(8, 14, 28, 0.72)';
    s.backgroundImage = 'radial-gradient(circle at top left, rgba(46, 147, 255, 0.12), transparent 24%), radial-gradient(circle at bottom right, rgba(113, 218, 255, 0.06), transparent 30%)';
    s.backdropFilter = 'blur(10px)';
    s.color = OGUI.textPri;
  }

  private applyContentRowStyle(): void {
    const s = this.contentRow.style;
    s.display = 'flex';
    s.alignItems = 'stretch';
    s.justifyContent = 'flex-start';
    s.gap = '36px';
    s.width = 'min(1360px, 90vw)';
    s.height = 'calc(100vh - 120px)';
    s.padding = '18px 0';
    s.minHeight = '0';
  }

  private applyPrimaryColumnStyle(): void {
    const s = this.primaryColumn.style;
    s.display = 'flex';
    s.flexDirection = 'column';
    s.alignItems = 'stretch';
    s.justifyContent = 'flex-start';
    s.flex = '0 0 380px';
  }

  private applyTitleStyle(): void {
    const s = this.titleEl.style;
    s.fontSize = '22px';
    s.fontWeight = '700';
    s.letterSpacing = '2px';
    s.color = '#f7fbff';
    s.textTransform = 'uppercase';
    s.marginBottom = '12px';
    s.textShadow = '0 18px 50px rgba(35, 143, 255, 0.2)';
    s.fontFamily = "'Inter', system-ui, sans-serif";
    s.whiteSpace = 'nowrap';
  }

  private applySubtitleStyle(): void {
    const s = this.subtitleEl.style;
    s.fontSize = '14px';
    s.color = '#adc5e1';
    s.marginBottom = '28px';
    s.lineHeight = '1.45';
    s.letterSpacing = '0.3px';
    s.display = 'none';
    s.maxWidth = '420px';
  }

  private applyListStyle(): void {
    const s = this.listEl.style;
    s.display = 'flex';
    s.flexDirection = 'column';
    s.gap = '6px';
    s.minWidth = '320px';
    s.maxWidth = '480px';
    s.width = 'clamp(320px, 55vw, 480px)';
    s.maxHeight = '70vh';
    s.overflowY = 'auto';
    s.border = '1px solid rgba(255, 255, 255, 0.08)';
    s.borderRadius = '18px';
    s.padding = '14px';
    s.backgroundColor = 'rgba(8, 14, 28, 0.86)';
    s.boxShadow = '0 36px 140px rgba(4, 12, 24, 0.32)';
    s.backdropFilter = 'blur(18px)';
  }

  private applyFooterStyle(): void {
    const s = this.footerEl.style;
    s.marginTop = '18px';
    s.fontSize = '12px';
    s.color = '#7f95b1';
    s.letterSpacing = '0.3px';
    s.display = 'none';
  }

  private applyAccessoryHostStyle(): void {
    const s = this.accessoryHost.style;
    s.display = 'none';
    s.flex = '1 1 0';
    s.minWidth = '520px';
    s.alignSelf = 'stretch';
    s.padding = '24px';
    s.borderRadius = '28px';
    s.background = 'rgba(6,12,24,0.95)';
    s.border = '1px solid rgba(255,255,255,0.08)';
    s.boxShadow = '0 38px 140px rgba(2,6,18,0.38)';
    s.overflow = 'hidden';
    s.height = '100%';
    s.minHeight = '0';
  }

  private applyVersionStyle(): void {
    const s = this.versionEl.style;
    s.position = 'absolute';
    s.bottom = '18px';
    s.right = '24px';
    s.fontSize = '12px';
    s.color = '#7d95b2';
    s.letterSpacing = '1px';
    s.fontFamily = "'Inter', system-ui, sans-serif";
  }

  private applyRowStyle(el: HTMLDivElement, item: SubMenuItemDef): void {
    const s = el.style;
    s.display = 'flex';
    s.flexDirection = 'column';
    s.padding = '8px 12px';
    s.minHeight = item.header ? 'auto' : '38px';
    s.fontSize = item.header ? '10px' : '13px';
    s.letterSpacing = item.header ? '1px' : '0.3px';
    s.cursor = item.header ? 'default' : 'pointer';
    s.transition = 'background 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease';
    s.borderRadius = item.header ? '10px' : '16px';
    s.borderLeft = item.header ? 'none' : '3px solid transparent';
    s.fontFamily = "'Inter', system-ui, sans-serif";

    if (item.header) {
      s.color = '#8c9eb6';
      s.fontWeight = '700';
      s.textTransform = 'uppercase';
      s.opacity = '0.76';
      s.background = 'transparent';
      s.boxShadow = 'none';
      return;
    }

    if (item.selected) {
      s.color = '#ffffff';
      s.background = 'rgba(92, 150, 255, 0.22)';
      s.borderLeftColor = '#7fb2ff';
      s.boxShadow = 'inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 60px rgba(20, 40, 80, 0.24)';
      s.transform = 'translateX(0)';
    } else {
      s.color = '#dbe7f5';
      s.background = 'rgba(255, 255, 255, 0.06)';
      s.borderLeftColor = 'transparent';
      s.boxShadow = '0 0 0 1px rgba(255, 255, 255, 0.02)';
    }
  }
}
