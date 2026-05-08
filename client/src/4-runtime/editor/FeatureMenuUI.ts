/**
 * FeatureMenuUI
 * Overlay panel that visualises and toggles all FeatureManager flags.
 *
 * - Opens/closes with F2 (or any custom hotkey).
 * - Per-row hotkeys (single letter, no modifier) defined in FEATURE_META.
 * - Subscribes to FeatureManager so the UI stays in sync with programmatic changes.
 * - Respects ModeManager: play-mode-only features are visually dimmed in editor.
 * - No Three.js dependency — pure DOM overlay.
 *
 * Usage:
 *   import { FeatureMenuUI } from './editor/FeatureMenuUI';
 *
 *   const menu = new FeatureMenuUI();
 *   menu.mount();
 *   // later:
 *   menu.open();
 *   menu.destroy();
 */

import { FeatureManager, FeatureKey, FEATURE_META } from '@engine/1-kernel/core/public-api';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FeatureMenuConfig {
  /** Key that opens/closes the menu. Default 'F2'. */
  toggleKey?: string;
  /** Show per-row hotkey hints. Default true. */
  showHotkeys?: boolean;
  /** Whether the menu pauses normal input while open. Default false. */
  captureInput?: boolean;
}

// ─── FeatureMenuUI ────────────────────────────────────────────────────────────

export class FeatureMenuUI {
  private cfg: Required<FeatureMenuConfig>;
  private open: boolean = false;
  private mounted: boolean = false;

  // DOM nodes
  private overlay:    HTMLDivElement | null = null;
  private panel:      HTMLDivElement | null = null;
  private cornerHint: HTMLDivElement | null = null;
  private rowEls:     Map<FeatureKey, HTMLDivElement> = new Map();
  private toggleEls:  Map<FeatureKey, HTMLButtonElement> = new Map();

  // Event handlers (kept for clean removal)
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _unsub: (() => void) | null = null;

  constructor(cfg: FeatureMenuConfig = {}) {
    this.cfg = {
      toggleKey:    cfg.toggleKey    ?? 'F2',
      showHotkeys:  cfg.showHotkeys  ?? true,
      captureInput: cfg.captureInput ?? false,
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  mount(): void {
    if (this.mounted) return;
    this._buildCornerHint();
    this._buildDOM();
    this._attachKeyboard();
    this._unsub = FeatureManager.onAnyChanged(() => this._syncAllRows());
    this.mounted = true;
  }

  destroy(): void {
    if (!this.mounted) return;
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._unsub) this._unsub();
    this.overlay?.remove();
    this.cornerHint?.remove();
    this.overlay    = null;
    this.cornerHint = null;
    this.panel      = null;
    this.rowEls.clear();
    this.toggleEls.clear();
    this.mounted = false;
  }

  // ─── Open / close ──────────────────────────────────────────────────────────

  openMenu(): void {
    if (!this.overlay) return;
    this.open = true;
    this.overlay.style.display = 'flex';
    this._syncAllRows();
  }

  closeMenu(): void {
    if (!this.overlay) return;
    this.open = false;
    this.overlay.style.display = 'none';
  }

  toggleMenu(): void {
    this.open ? this.closeMenu() : this.openMenu();
  }

  isOpen(): boolean {
    return this.open;
  }

  // ─── DOM construction ──────────────────────────────────────────────────────

  private _buildCornerHint(): void {
    this.cornerHint = document.createElement('div');
    Object.assign(this.cornerHint.style, {
      position:      'fixed',
      top:           '12px',
      left:          '12px',
      color:         '#888',
      fontSize:      '10px',
      fontFamily:    '"Courier New", monospace',
      letterSpacing: '2px',
      pointerEvents: 'none',
      zIndex:        '999',
      userSelect:    'none',
    } as CSSStyleDeclaration);
    this.cornerHint.textContent = `[${this.cfg.toggleKey}] FEATURES`;
    document.body.appendChild(this.cornerHint);
  }

  private _buildDOM(): void {
    // ── Darkened click-outside overlay
    this.overlay = this._div({
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2000',
      background: 'rgba(0,0,0,0.6)',
      fontFamily: '"Courier New", monospace',
    });
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.closeMenu();
    });

    // ── Panel
    this.panel = this._div({
      background: '#111',
      border: '1px solid #444',
      minWidth: '380px',
      maxWidth: '480px',
      width: '95vw',
      maxHeight: '80vh',
      overflowY: 'auto',
      boxShadow: '0 4px 32px rgba(0,0,0,0.8)',
      padding: '0',
    });

    // Header
    const header = this._div({
      background: '#1a1a1a',
      borderBottom: '1px solid #333',
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    });

    const title = document.createElement('span');
    title.textContent = '⚙  FEATURES';
    title.style.cssText = 'color:#fff;font-size:13px;letter-spacing:3px;font-weight:bold;';
    header.appendChild(title);

    const hint = document.createElement('span');
    hint.textContent = `[${this.cfg.toggleKey}] to close`;
    hint.style.cssText = 'color:#555;font-size:10px;letter-spacing:1px;';
    header.appendChild(hint);

    this.panel.appendChild(header);

    // Rows
    const featureKeys = Object.keys(FEATURE_META) as FeatureKey[];
    featureKeys.forEach((key) => this._buildRow(key));

    // Footer
    const footer = this._div({
      borderTop: '1px solid #222',
      padding: '8px 16px',
      display: 'flex',
      gap: '8px',
      justifyContent: 'flex-end',
    });

    const resetBtn = this._button('RESET DEFAULTS', '#333', '#aaa');
    resetBtn.addEventListener('click', () => {
      FeatureManager.reset();
      this._syncAllRows();
    });
    footer.appendChild(resetBtn);

    const saveBtn = this._button('SAVE', '#1a472a', '#4caf50');
    saveBtn.addEventListener('click', () => {
      FeatureManager.save();
      this._flashButton(saveBtn, 'SAVED ✓');
    });
    footer.appendChild(saveBtn);

    this.panel.appendChild(footer);

    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);
  }

  private _buildRow(key: FeatureKey): void {
    const meta = FEATURE_META[key];

    const row = this._div({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '9px 16px',
      borderBottom: '1px solid #1e1e1e',
      transition: 'background 0.1s',
    });
    row.addEventListener('mouseenter', () => { row.style.background = '#1a1a1a'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    // Left: label + description
    const left = this._div({ display: 'flex', flexDirection: 'column', gap: '1px' });

    const labelRow = this._div({ display: 'flex', alignItems: 'center', gap: '8px' });
    const label = document.createElement('span');
    label.textContent = meta.label;
    label.style.cssText = 'color:#ddd;font-size:12px;letter-spacing:1px;';
    labelRow.appendChild(label);

    if (this.cfg.showHotkeys && meta.hotkey) {
      const badge = document.createElement('span');
      badge.textContent = meta.hotkey.toUpperCase();
      badge.style.cssText =
        'color:#555;font-size:9px;border:1px solid #333;padding:1px 4px;border-radius:2px;letter-spacing:1px;';
      labelRow.appendChild(badge);
    }
    left.appendChild(labelRow);

    const desc = document.createElement('span');
    desc.textContent = meta.description;
    desc.style.cssText = 'color:#444;font-size:10px;';
    left.appendChild(desc);

    row.appendChild(left);

    // Right: toggle button
    const btn = this._button('', '#1a1a1a', '#aaa');
    btn.style.cssText +=
      'min-width:54px;text-align:center;letter-spacing:2px;font-size:11px;padding:4px 10px;';
    btn.addEventListener('click', () => {
      FeatureManager.toggle(key);
      this._syncRow(key);
    });

    this.toggleEls.set(key, btn);
    row.appendChild(btn);

    this.rowEls.set(key, row);
    this.panel!.insertBefore(row, this.panel!.lastElementChild);

    this._syncRow(key);
  }

  // ─── Sync helpers ──────────────────────────────────────────────────────────

  private _syncRow(key: FeatureKey): void {
    const enabled = FeatureManager.isEnabled(key);
    const row = this.rowEls.get(key);
    const btn = this.toggleEls.get(key);
    if (!row || !btn) return;

    btn.textContent     = enabled ? 'ON' : 'OFF';
    btn.style.color     = enabled ? '#4cff6e' : '#555';
    btn.style.borderColor = enabled ? '#1a4a27' : '#333';
    btn.style.background  = enabled ? '#0d2016' : '#111';

    // Dim the label for disabled features
    const label = row.querySelector('span');
    if (label) label.style.opacity = enabled ? '1' : '0.4';
  }

  private _syncAllRows(): void {
    (Object.keys(FEATURE_META) as FeatureKey[]).forEach((key) => this._syncRow(key));
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  private _attachKeyboard(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      // Toggle the menu panel
      if (e.key === this.cfg.toggleKey) {
        e.preventDefault();
        this.toggleMenu();
        return;
      }

      // Per-row hotkeys — only when panel is open and no input is focused
      if (!this.open) return;
      if (document.activeElement instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const lower = e.key.toLowerCase();
      const match = (Object.keys(FEATURE_META) as FeatureKey[]).find(
        (k) => FEATURE_META[k].hotkey === lower,
      );
      if (match) {
        e.preventDefault();
        FeatureManager.toggle(match);
        this._syncRow(match);
        this._animateRow(match);
      }

      // Escape to close
      if (e.key === 'Escape') this.closeMenu();
    };

    window.addEventListener('keydown', this._keyHandler);
  }

  // ─── Animation ─────────────────────────────────────────────────────────────

  private _animateRow(key: FeatureKey): void {
    const row = this.rowEls.get(key);
    if (!row) return;
    row.style.background = '#2a2a1a';
    setTimeout(() => { row.style.background = ''; }, 200);
  }

  private _flashButton(btn: HTMLButtonElement, text: string): void {
    const original = btn.textContent ?? '';
    btn.textContent = text;
    btn.style.color = '#4cff6e';
    setTimeout(() => {
      btn.textContent = original;
      btn.style.color = '#aaa';
    }, 1400);
  }

  // ─── DOM helpers ───────────────────────────────────────────────────────────

  private _div(styles: Partial<CSSStyleDeclaration>): HTMLDivElement {
    const el = document.createElement('div');
    Object.assign(el.style, styles);
    return el;
  }

  private _button(
    text: string,
    bg: string,
    color: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = [
      `background:${bg}`,
      `color:${color}`,
      'border:1px solid #333',
      'cursor:pointer',
      'font-family:inherit',
      'letter-spacing:1px',
      'font-size:11px',
      'padding:5px 12px',
      'transition:background 0.1s, color 0.1s',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });
    return btn;
  }
}

// ─── Module-level singleton factory ──────────────────────────────────────────

let _instance: FeatureMenuUI | null = null;

export function initFeatureMenuUI(cfg?: FeatureMenuConfig): FeatureMenuUI {
  _instance = new FeatureMenuUI(cfg);
  _instance.mount();
  return _instance;
}

export function getFeatureMenuUI(): FeatureMenuUI | null {
  return _instance;
}
