/**
 * Editor Menu
 * In-game UI for object placement, property editing, and entity management
 * 
 * Features:
 * - Spawn object menu with predefined types
 * - Transform controls (position, rotation, scale)
 * - Attribute toggles (hitbox, script gates, visibility)
 * - Entity selection and deletion
 * - Properties panel
 * - 3D Transform Gizmo for moving, rotating, and scaling objects
 */

import * as THREE from 'three';
import * as Engine from '../../0-foundation/foundation/Engine';
import { Entity, initializeEntityAttributes, getEntityAttributes, setHitbox, setScriptGate, setInvisible, EntityAttributes as EntityAttributesType } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { OGUI } from '../ui/OGUITheme';
import { createClosablePanel } from '../ui/ClosablePanel';
import { saveLevelToStorage } from '../ui/LevelPersistence';
import type { SpawnLibraryMetadata } from '../ui/SpawnLibraryMetadata';

export interface EditorMenuConfig {
  container?: HTMLElement;
  hotkey?: string;
  enableLogging?: boolean;
}

export interface EditorSpawnEntry extends SpawnLibraryMetadata {
  spawn: (position: { x: number; y: number; z: number }) => Entity | null;
  buildSpawnRequest?: (position: { x: number; y: number; z: number }) => {
    entityType: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    renderData: {
      meshType: string;
      color: number;
      geometry: Record<string, unknown>;
    };
  } | null;
}

/**
 * EditorMenu - In-game UI for editing
 */
export class EditorMenu {
  private isOpen: boolean = false;
  private menuElement: HTMLElement | null = null;
  private containerElement: HTMLElement;
  private selectedEntity: Entity | null = null;
  private selectedSpawnCategory: string = 'All';
  private saveDialog: HTMLElement | null = null;
  private _keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private config: Required<EditorMenuConfig>;
  private builtinSpawnEntries: EditorSpawnEntry[] = [];
  private librarySpawnEntries: EditorSpawnEntry[] = [];
  private closePanelDispose: (() => void) | null = null;
  private readonly spawnButtonStyle = `
    padding:12px;cursor:pointer;text-align:left;
    font-family:'Courier New',Courier,monospace;font-size:11px;
    letter-spacing:0.8px;transition:transform 0.12s,background 0.12s,border-color 0.12s,box-shadow 0.12s;
    background:linear-gradient(180deg, rgba(34,34,34,0.92), rgba(20,20,20,0.98));
    color:#d2d2d2;border:1px solid rgba(90,90,90,0.45);border-radius:12px;
  `;

  private _onEntityPlaced: ((data: { id: string; entityType: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; renderData: any }) => void) | null = null;
  private _onEntityRemoved: ((id: string) => void) | null = null;
  private _onTransformApplied: ((data: { id: string; before: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }; after: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } } }) => void) | null = null;
  private _onEntityRemoveRequest: ((entity: Entity) => boolean) | null = null;
  private _onSpawnRequested: ((data: {
    entityType: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    renderData: {
      meshType: string;
      color: number;
      geometry: Record<string, unknown>;
    };
  }) => boolean) | null = null;

  setOnEntityPlaced(cb: (data: { id: string; entityType: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; renderData: any }) => void): void {
    this._onEntityPlaced = cb;
  }

  setOnEntityRemoved(cb: (id: string) => void): void {
    this._onEntityRemoved = cb;
  }

  setOnTransformApplied(cb: (data: { id: string; before: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }; after: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } } }) => void): void {
    this._onTransformApplied = cb;
  }

  setOnEntityRemoveRequest(cb: (entity: Entity) => boolean): void {
    this._onEntityRemoveRequest = cb;
  }

  setOnSpawnRequested(cb: (data: {
    entityType: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    renderData: {
      meshType: string;
      color: number;
      geometry: Record<string, unknown>;
    };
  }) => boolean): void {
    this._onSpawnRequested = cb;
  }

  setSpawnLibrary(entries: EditorSpawnEntry[]): void {
    this.librarySpawnEntries = [...entries];
    this.renderSpawnCatalog();
    window.dispatchEvent(new CustomEvent('editor:spawn-library-updated', {
      detail: { entries: this.getSpawnLibraryEntries() },
    }));
  }

  getSpawnLibraryEntries(): EditorSpawnEntry[] {
    return [...this.builtinSpawnEntries, ...this.librarySpawnEntries];
  }

  constructor(config: EditorMenuConfig = {}) {
    this.config = {
      container: config.container || document.body,
      hotkey: config.hotkey || 'm',
      enableLogging: config.enableLogging ?? false,
    };

    this.containerElement = this.config.container;
    this.initializeBuiltinSpawnEntries();

    if (this.config.enableLogging) {
      console.log('[EditorMenu] Initialized');
    }

    // Connect selection system
    const selectionSystem = Engine.getSelectionSystem();
    if (selectionSystem) {
      selectionSystem.onSelect((entityId: string) => {
        const entityManager = Engine.getEntityManager();
        const entity = entityManager?.getEntity(entityId);
        if (entity) {
          this.selectEntity(entity);
        }
      });
      selectionSystem.onDeselect(() => {
        this.clearSelection();
      });
    }

    this.setupHotkey();
    this.createMenuUI();
  }

  /**
   * Setup hotkey toggle
   */
  private setupHotkey(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if ((e.key === this.config.hotkey || e.key === this.config.hotkey.toUpperCase()) && !e.ctrlKey && !e.shiftKey) {
        this.toggle();
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  /**
   * Toggle menu visibility
   */
  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Open menu
   */
  open(): void {
    if (this.menuElement) {
      this.menuElement.style.display = 'flex';
      this.isOpen = true;

      if (this.config.enableLogging) {
        console.log('[EditorMenu] Opened');
      }
    }
  }

  /**
   * Close menu
   */
  close(): void {
    if (this.menuElement) {
      this.menuElement.style.display = 'none';
      this.isOpen = false;

      if (this.config.enableLogging) {
        console.log('[EditorMenu] Closed');
      }
    }
  }

  /**
   * Create menu UI
   */
  private createMenuUI(): void {
    // ── Inject resize handle + scrollbar styles ────────────────────────────
    const styleTag = document.createElement('style');
    styleTag.textContent = `
      #editor-menu { box-sizing: border-box; }
      #editor-menu::-webkit-scrollbar { width: 6px; }
      #editor-menu::-webkit-scrollbar-track { background: #0e0e0e; }
      #editor-menu::-webkit-scrollbar-thumb { background: rgba(80,80,80,0.45); border-radius: 3px; }
      #editor-menu::-webkit-scrollbar-thumb:hover { background: rgba(120,120,120,0.6); }
      #editor-menu-resize-handle {
        position: absolute; right: 0; top: 0; bottom: 0; width: 5px;
        cursor: ew-resize; z-index: 1;
        background: transparent;
        transition: background 0.15s;
      }
      #editor-menu-resize-handle:hover { background: rgba(80,80,80,0.3); }
      #editor-menu .editor-spawn-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 28px rgba(0,0,0,0.28);
      }
    `;
    document.head.appendChild(styleTag);

    this.menuElement = document.createElement('div');
    this.menuElement.id = 'editor-menu';
    this.menuElement.style.cssText = `
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 760px;
      min-width: 520px;
      max-width: 90vw;
      max-height: 90vh;
      background: rgba(14, 14, 14, 0.97);
      border: 1px solid rgba(80,80,80,0.55);
      border-radius: 18px;
      color: #909090;
      font-family: 'Courier New', Courier, monospace;
      z-index: 10000;
      overflow-y: auto;
      overflow-x: hidden;
      box-shadow: 0 0 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(80,80,80,0.08);
      flex-direction: column;
    `;

    // ── Drag-to-resize handle ──────────────────────────────────────────────
    const resizeHandle = document.createElement('div');
    resizeHandle.id = 'editor-menu-resize-handle';
    let _dragging = false;
    let _startX = 0;
    let _startW = 0;
    resizeHandle.addEventListener('mousedown', (e) => {
      _dragging = true;
      _startX = e.clientX;
      _startW = this.menuElement!.offsetWidth;
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!_dragging || !this.menuElement) return;
      const delta = e.clientX - _startX;
      const newW = Math.max(260, Math.min(window.innerWidth * 0.75, _startW + delta));
      this.menuElement.style.width = newW + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (_dragging) { _dragging = false; document.body.style.userSelect = ''; }
    });

    const btnBase = `
      padding:8px 12px;cursor:pointer;
      font-family:'Courier New',Courier,monospace;font-size:11px;
      letter-spacing:1px;transition:background 0.12s,border-color 0.12s;
      text-transform:uppercase;
    `;
    const dangerBtn = `${btnBase}background:rgba(200,50,50,0.07);color:#e87070;border:1px solid rgba(200,50,50,0.32);`;
    const closeBtn = `padding:5px 12px;cursor:pointer;font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:1px;background:transparent;color:#727272;border:1px solid rgba(80,80,80,0.4);transition:color 0.12s,border-color 0.12s;`;

    this.menuElement.innerHTML = `
      <!-- sticky header -->
      <div id="editor-header" style="
        position:sticky;top:0;z-index:2;
        display:flex;justify-content:space-between;align-items:center;
        padding:12px 16px 10px;
        background:rgba(18,18,18,0.97);
        border-bottom:1px solid rgba(80,80,80,0.55);
      ">
        <div>
          <div style="color:#c0c0c0;font-size:13px;letter-spacing:4px;font-weight:bold;">OBJECT EDITOR</div>
          <div style="color:#585858;font-size:9px;letter-spacing:2px;margin-top:2px;">[M] TOGGLE &nbsp;·&nbsp; DRAG RIGHT EDGE TO RESIZE</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="editor-save-btn" style="${closeBtn}padding:6px 12px;min-width:90px;">SAVE LEVEL</button>
          <button id="editor-close-btn" style="${closeBtn}">✕</button>
        </div>
      </div>

      <div id="editor-save-dialog" style="display:none;position:absolute;top:80px;left:50%;transform:translateX(-50%);z-index:10002;width:460px;max-width:88%;padding:14px 16px;background:rgba(15,15,15,0.98);border:1px solid rgba(110,110,110,0.35);border-radius:14px;box-shadow:0 0 32px rgba(0,0,0,0.6);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="color:#e0e0e0;font-size:12px;letter-spacing:1px;">SAVE LEVEL</div>
          <button id="editor-save-dialog-close" type="button" style="background:transparent;border:none;color:#999;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <input id="editor-save-dialog-input" type="text" placeholder="Level name" style="width:100%;padding:10px 12px;background:#111;border:1px solid rgba(120,120,120,0.4);border-radius:10px;color:#f0f0f0;font-family:'Courier New',monospace;font-size:11px;outline:none;">
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
          <button id="editor-save-dialog-cancel" type="button" style="padding:8px 12px;background:rgba(80,80,80,0.12);border:1px solid rgba(80,80,80,0.4);color:#b0b0b0;border-radius:10px;cursor:pointer;">CANCEL</button>
          <button id="editor-save-dialog-confirm" type="button" style="padding:8px 12px;background:rgba(90,150,90,0.16);border:1px solid rgba(90,150,90,0.4);color:#c8ffc8;border-radius:10px;cursor:pointer;">SAVE</button>
        </div>
      </div>

      <!-- gizmo hint -->
      <div style="
        margin:12px 14px 0;padding:8px 12px;
        background:rgba(40,40,40,0.5);
        border:1px solid rgba(60,60,60,0.5);
        border-left:2px solid rgba(100,100,100,0.6);
        font-size:10px;line-height:1.8;color:#606060;letter-spacing:0.5px;
      ">
        <span style="color:#a0a0a0;letter-spacing:1px;">GIZMO</span>
        &nbsp;·&nbsp; Click object to select
        &nbsp;·&nbsp; Drag axis arrows to transform
        &nbsp;·&nbsp; Click gizmo to cycle MOVE / ROTATE / SCALE
      </div>
      <div style="
        margin:10px 14px 0;padding:8px 12px;
        background:rgba(40,40,40,0.5);
        border:1px solid rgba(60,60,60,0.5);
        border-left:2px solid rgba(100,100,100,0.6);
        font-size:10px;line-height:1.8;color:#606060;letter-spacing:0.5px;
      ">
        <span style="color:#a0a0a0;letter-spacing:1px;">EDITOR</span>
        &nbsp;·&nbsp; Press <strong>Q</strong> to toggle editor menu
        &nbsp;·&nbsp; Drag right edge to resize
      </div>

      <!-- spawn section -->
      <div id="editor-object-spawn" style="margin:14px 0 0;padding:0 14px 14px;border-bottom:1px solid rgba(60,60,60,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;padding-top:2px;gap:12px;">
          <div>
            <div style="font-size:9px;letter-spacing:3px;color:#606060;margin-bottom:4px;">OBJECT LIBRARY</div>
              <div style="font-size:11px;color:#9a9a9a;letter-spacing:0.6px;line-height:1.5;">Pick a category, then choose from the filtered asset inventory on the right.</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:160px 1fr;gap:10px;">
            <div id="editor-spawn-categories" style="display:flex;flex-direction:column;gap:8px;padding:10px;background:#111111;border:1px solid rgba(80,80,80,0.35);border-radius:12px;min-height:240px;">
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <input id="editor-spawn-search" type="text" placeholder="Filter items in the selected category" style="
                width:100%;box-sizing:border-box;padding:10px 12px;
                background:#111111;color:#c0c0c0;border:1px solid rgba(80,80,80,0.4);border-radius:10px;
                font-family:'Courier New',Courier,monospace;font-size:11px;outline:none;
              ">
              <div id="editor-spawn-catalog" style="display:flex;flex-direction:column;gap:10px;"></div>
              <div id="editor-spawn-summary" style="font-size:9px;color:#626262;letter-spacing:0.8px;margin-top:0;">
                Loading object library... Objects spawn 5m in front of the camera.
              </div>
            </div>
      <div id="editor-entity-list" style="margin:0;padding:12px 14px 14px;border-bottom:1px solid rgba(60,60,60,0.5);">
        <div style="font-size:9px;letter-spacing:3px;color:#606060;margin-bottom:8px;">SCENE ENTITIES</div>
        <div id="editor-entity-items" style="
          max-height:200px;overflow-y:auto;
          background:#111111;
          border:1px solid rgba(60,60,60,0.5);
          padding:8px;font-size:11px;
        ">
          <div style="color:#505050;">No entities</div>
        </div>
      </div>

      <!-- properties section -->
      <div id="editor-properties" style="margin:0;padding:12px 14px 14px;border-bottom:1px solid rgba(60,60,60,0.5);">
        <div style="font-size:9px;letter-spacing:3px;color:#606060;margin-bottom:8px;">PROPERTIES</div>
        <div id="editor-properties-content" style="
          background:#111111;
          border:1px solid rgba(60,60,60,0.5);
          padding:12px;font-size:11px;
        ">
          <div style="color:#505050;">Select an entity</div>
        </div>
      </div>

      <!-- action strip -->
      <div id="editor-controls" style="padding:12px 14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button id="editor-delete-btn" style="${dangerBtn}opacity:0.4;pointer-events:none;">DELETE</button>
        <button id="editor-clear-all-btn" style="${dangerBtn}">CLEAR ALL</button>
      </div>
    `;

    // Append resize handle last so it renders on top
    this.menuElement.appendChild(resizeHandle);

    // Hover effects
    const addHover = (selector: string, hoverBg: string, baseBg: string): void => {
      this.menuElement!.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.addEventListener('mouseenter', () => { el.style.background = hoverBg; });
        el.addEventListener('mouseleave', () => { el.style.background = baseBg; });
      });
    };
    addHover('#editor-delete-btn,#editor-clear-all-btn', 'rgba(200,50,50,0.18)', 'rgba(200,50,50,0.07)');
    const cb = this.menuElement.querySelector<HTMLElement>('#editor-close-btn');
    cb?.addEventListener('mouseenter', () => { if(cb){ cb.style.color='#c0c0c0'; cb.style.borderColor='rgba(120,120,120,0.5)'; } });
    cb?.addEventListener('mouseleave', () => { if(cb){ cb.style.color='#727272'; cb.style.borderColor='rgba(80,80,80,0.4)'; } });

    this.containerElement.appendChild(this.menuElement);
    this.closePanelDispose = createClosablePanel(this.menuElement);
    this.attachEventListeners();
    this.renderSpawnCatalog();
    this.refreshEntityList();
  }

  /**
   * Attach event listeners to menu
   */
  private attachEventListeners(): void {
    const saveDialog = this.menuElement!.querySelector('#editor-save-dialog') as HTMLElement | null;
    const saveInput = this.menuElement!.querySelector('#editor-save-dialog-input') as HTMLInputElement | null;
    const saveConfirm = this.menuElement!.querySelector('#editor-save-dialog-confirm') as HTMLElement | null;
    const saveCancel = this.menuElement!.querySelector('#editor-save-dialog-cancel') as HTMLElement | null;
    const saveDialogClose = this.menuElement!.querySelector('#editor-save-dialog-close') as HTMLElement | null;
    this.saveDialog = saveDialog;

    const showSaveDialog = (): void => {
      if (!saveDialog || !saveInput) return;
      saveDialog.style.display = 'block';
      saveInput.value = '';
      saveInput.focus();
    };

    const hideSaveDialog = (): void => {
      if (!saveDialog) return;
      saveDialog.style.display = 'none';
    };

    const performSave = (): void => {
      if (!saveInput) return;
      const name = saveInput.value.trim();
      if (!name) return;
      if (saveLevelToStorage(name)) {
        alert(`Level saved: ${name}`);
        hideSaveDialog();
      } else {
        alert('Failed to save level.');
      }
    };

    const saveBtn = this.menuElement!.querySelector('#editor-save-btn');
    saveBtn?.addEventListener('click', showSaveDialog);
    saveConfirm?.addEventListener('click', performSave);
    saveCancel?.addEventListener('click', hideSaveDialog);
    saveDialogClose?.addEventListener('click', hideSaveDialog);
    saveInput?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        performSave();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSaveDialog();
      }
    });

    // Close button
    const closeBtn = this.menuElement!.querySelector('#editor-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    const spawnSearch = this.menuElement!.querySelector('#editor-spawn-search') as HTMLInputElement | null;
    spawnSearch?.addEventListener('input', () => this.renderSpawnCatalog(spawnSearch.value));

    // Delete button
    const deleteBtn = this.menuElement!.querySelector('#editor-delete-btn');
    deleteBtn?.addEventListener('click', () => {
      if (this.selectedEntity) {
        this.deleteEntity(this.selectedEntity);
      }
    });

    // Clear all button
    const clearBtn = this.menuElement!.querySelector('#editor-clear-all-btn');
    clearBtn?.addEventListener('click', () => {
      if (confirm('Delete ALL entities? This cannot be undone.')) {
        this.clearAll();
      }
    });
  }

  private initializeBuiltinSpawnEntries(): void {
    this.builtinSpawnEntries = [
      { id: 'cube', label: 'Cube', category: 'Primitives', glyph: '□', accentColor: '#d68f5b', description: 'Simple blockout cube for collision and scale checks.', spawn: (position) => this.spawnPrimitive('cube', position), buildSpawnRequest: (position) => this.buildPrimitiveSpawnRequest('cube', position) },
      { id: 'sphere', label: 'Sphere', category: 'Primitives', glyph: '◉', accentColor: '#6d9cff', description: 'Round debug marker for focal points and pickups.', spawn: (position) => this.spawnPrimitive('sphere', position), buildSpawnRequest: (position) => this.buildPrimitiveSpawnRequest('sphere', position) },
      { id: 'plane', label: 'Plane', category: 'Surfaces', glyph: '▱', accentColor: '#7bcf8c', description: 'Flat surface for floor, decal, and collision experiments.', spawn: (position) => this.spawnPrimitive('plane', position), buildSpawnRequest: (position) => this.buildPrimitiveSpawnRequest('plane', position) },
      { id: 'arch', label: 'Arch', category: 'Structures', glyph: '∩', accentColor: '#b08fdf', description: 'Arched opening for paths, portals and decorative structures.', spawn: (position) => this.spawnPrimitive('arch', position), buildSpawnRequest: (position) => this.buildPrimitiveSpawnRequest('arch', position) },
      { id: 'dust2_template', label: 'Dust2 Shell', category: 'Templates', glyph: '∴', accentColor: '#d6b56c', description: 'Spawn a Dust2-inspired level shell with bombsite walls, mid connector, and walkways.', spawn: (position) => this.spawnDust2Template(position) },
      { id: 'capsule', label: 'Capsule', category: 'Primitives', glyph: '⬭', accentColor: '#ff8a76', description: 'Character-sized volume for traversal and hitbox testing.', spawn: (position) => this.spawnPrimitive('capsule', position), buildSpawnRequest: (position) => this.buildPrimitiveSpawnRequest('capsule', position) },
      { id: 'script-gate', label: 'Script Gate', category: 'Logic', glyph: '◇', accentColor: '#e5d169', description: 'Invisible trigger volume for scripted interactions.', spawn: (position) => this.spawnPrimitive('script-gate', position), buildSpawnRequest: (position) => this.buildPrimitiveSpawnRequest('script-gate', position) },
      { id: 'debug_fireball', label: 'Fireball Tome', category: 'Tomes', glyph: '🔥', accentColor: '#ff8f33', description: 'Spawn a pickup that grants the Fireball ability.', spawn: (position) => this.spawnItemPickup('debug_fireball', 'Fireball Tome', position, { meshType: 'box', color: 0xff8f33, geometry: { width: 1.4, height: 0.6, depth: 0.4 } }) },
      { id: 'weapon_assault_rifle', label: 'Assault Rifle', category: 'Weapons', glyph: '⟹', accentColor: '#4c87c3', description: 'Spawn an assault rifle pickup.', spawn: (position) => this.spawnItemPickup('weapon_assault_rifle', 'Assault Rifle', position, { meshType: 'box', color: 0x4c87c3, geometry: { width: 1.8, height: 0.4, depth: 0.5 } }) },
      { id: 'weapon_sniper_rifle', label: 'Sniper Rifle', category: 'Weapons', glyph: '⌖', accentColor: '#2f4e6d', description: 'Spawn a sniper rifle pickup.', spawn: (position) => this.spawnItemPickup('weapon_sniper_rifle', 'Sniper Rifle', position, { meshType: 'box', color: 0x2f4e6d, geometry: { width: 2.0, height: 0.35, depth: 0.35 } }) },
      { id: 'weapon_incinerator_gauntlet', label: 'Incinerator Gauntlet', category: 'Weapons', glyph: '✹', accentColor: '#d94f22', description: 'Spawn a fire gauntlet pickup.', spawn: (position) => this.spawnItemPickup('weapon_incinerator_gauntlet', 'Incinerator Gauntlet', position, { meshType: 'box', color: 0xd94f22, geometry: { width: 1.2, height: 0.8, depth: 0.5 } }) },
      { id: 'tome_necromancy', label: 'Necromancy Tome', category: 'Tomes', glyph: '☠', accentColor: '#6e3b7e', description: 'Spawn a necromancy tome pickup.', spawn: (position) => this.spawnItemPickup('tome_necromancy', 'Necromancy Tome', position, { meshType: 'box', color: 0x6e3b7e, geometry: { width: 1.2, height: 0.5, depth: 0.4 } }) },
      { id: 'offhand_arcane', label: 'Arcane Focus', category: 'Tomes', glyph: '✦', accentColor: '#4f75d4', description: 'Spawn an arcane focus pickup.', spawn: (position) => this.spawnItemPickup('offhand_arcane', 'Arcane Focus', position, { meshType: 'box', color: 0x4f75d4, geometry: { width: 1.0, height: 0.4, depth: 0.4 } }) },
      { id: 'tome_ice_lance', label: 'Ice Lance Tome', category: 'Tomes', glyph: '❄', accentColor: '#73d4ff', description: 'Spawn an ice lance tome pickup.', spawn: (position) => this.spawnItemPickup('tome_ice_lance', 'Ice Lance Tome', position, { meshType: 'box', color: 0x73d4ff, geometry: { width: 1.2, height: 0.5, depth: 0.4 } }) },
      { id: 'tome_fire_imp', label: 'Infernal Grimoire', category: 'Tomes', glyph: '☄', accentColor: '#ff5e5e', description: 'Spawn a fire imp tome pickup.', spawn: (position) => this.spawnItemPickup('tome_fire_imp', 'Infernal Grimoire', position, { meshType: 'box', color: 0xff5e5e, geometry: { width: 1.2, height: 0.5, depth: 0.4 } }) },
      { id: 'tome_ice_golem', label: 'Frostbound Grimoire', category: 'Tomes', glyph: '⛄', accentColor: '#91d8ff', description: 'Spawn an ice golem tome pickup.', spawn: (position) => this.spawnItemPickup('tome_ice_golem', 'Frostbound Grimoire', position, { meshType: 'box', color: 0x91d8ff, geometry: { width: 1.2, height: 0.5, depth: 0.4 } }) },
      { id: 'tome_arcane_advanced', label: 'Grand Arcane Tome', category: 'Tomes', glyph: '✺', accentColor: '#c8c8ff', description: 'Spawn a grand arcane tome pickup.', spawn: (position) => this.spawnItemPickup('tome_arcane_advanced', 'Grand Arcane Tome', position, { meshType: 'box', color: 0xc8c8ff, geometry: { width: 1.3, height: 0.5, depth: 0.4 } }) },
      { id: 'tome_poison', label: 'Tome of Plagues', category: 'Tomes', glyph: '☣', accentColor: '#4f8f2f', description: 'Spawn a poison tome pickup.', spawn: (position) => this.spawnItemPickup('tome_poison', 'Tome of Plagues', position, { meshType: 'box', color: 0x4f8f2f, geometry: { width: 1.3, height: 0.5, depth: 0.4 } }) },
      { id: 'tome_holy', label: 'Holy Scripture', category: 'Tomes', glyph: '✙', accentColor: '#f2e68c', description: 'Spawn a holy tome pickup.', spawn: (position) => this.spawnItemPickup('tome_holy', 'Holy Scripture', position, { meshType: 'box', color: 0xf2e68c, geometry: { width: 1.3, height: 0.5, depth: 0.4 } }) },
      { id: 'tome_storm_loop', label: 'Storm Loop Sigil', category: 'Tomes', glyph: '⟳', accentColor: '#9fd4ff', description: 'Spawn a storm loop sigil pickup.', spawn: (position) => this.spawnItemPickup('tome_storm_loop', 'Storm Loop Sigil', position, { meshType: 'box', color: 0x9fd4ff, geometry: { width: 1.1, height: 0.5, depth: 0.4 } }) },
      { id: 'ring_dash', label: 'Ring of Momentum', category: 'Accessories', glyph: '◯', accentColor: '#92edf7', description: 'Spawn a dash ring pickup.', spawn: (position) => this.spawnItemPickup('ring_dash', 'Ring of Momentum', position, { meshType: 'box', color: 0x92edf7, geometry: { width: 1.0, height: 0.3, depth: 1.0 } }) },
      { id: 'ring_summoner', label: "Necromancer's Seal", category: 'Accessories', glyph: '✪', accentColor: '#7c5ccf', description: 'Spawn a summon ring pickup.', spawn: (position) => this.spawnItemPickup('ring_summoner', "Necromancer's Seal", position, { meshType: 'box', color: 0x7c5ccf, geometry: { width: 1.0, height: 0.3, depth: 1.0 } }) },
      { id: 'prism_guardian', label: 'Guardian Prism', category: 'Accessories', glyph: '◇', accentColor: '#8aa2f5', description: 'Spawn a guardian prism pickup.', spawn: (position) => this.spawnItemPickup('prism_guardian', 'Guardian Prism', position, { meshType: 'box', color: 0x8aa2f5, geometry: { width: 1.0, height: 1.0, depth: 1.0 } }) },
    ];
  }

  private getSpawnEntries(): EditorSpawnEntry[] {
    return [...this.builtinSpawnEntries, ...this.librarySpawnEntries];
  }

  private translateSpawnCategory(category: string): string {
    switch (category) {
      case 'Primitives': return 'Geometry';
      case 'Surfaces': return 'Geometry';
      case 'Structures': return 'Worldbuilding';
      case 'Logic': return 'Logic';
      case 'Templates': return 'Templates';
      default: return category;
    }
  }

  private getSpawnCategories(): string[] {
    const categoryOrder = [
      'All',
      'Geometry',
      'Worldbuilding',
      'Logic',
      'Templates',
      'Spawnpoints',
      'Weapons',
      'Healthkits',
      'Enemy Spawners',
      'Misc',
    ];
    const categories = new Map<string, boolean>();
    for (const category of categoryOrder) {
      categories.set(category, true);
    }
    for (const entry of this.getSpawnEntries()) {
      categories.set(this.translateSpawnCategory(entry.category), true);
    }
    return [...categories.keys()];
  }

  private renderSpawnCategories(): void {
    const categoryContainer = this.menuElement?.querySelector('#editor-spawn-categories') as HTMLElement | null;
    const searchInput = this.menuElement?.querySelector('#editor-spawn-search') as HTMLInputElement | null;
    if (!categoryContainer || !searchInput) return;

    const categories = this.getSpawnCategories();
    categoryContainer.innerHTML = categories.map((category) => `
      <button class="editor-spawn-category-btn" data-category="${category}" style="
        width:100%;text-align:left;padding:10px 12px;
        border-radius:10px;border:1px solid rgba(90,90,90,0.35);
        background:${this.selectedSpawnCategory === category ? 'rgba(130,142,159,0.18)' : 'transparent'};
        color:${this.selectedSpawnCategory === category ? '#e0e0e0' : '#b0b0b0'};
        font-family:'Courier New',Courier,monospace;font-size:11px;cursor:pointer;
      ">
        ${category}
      </button>
    `).join('');

    categoryContainer.querySelectorAll('.editor-spawn-category-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const category = (button as HTMLElement).getAttribute('data-category');
        if (!category) return;
        this.selectedSpawnCategory = category;
        this.renderSpawnCatalog(searchInput.value);
      });
    });
  }

  private renderSpawnCatalog(filterText: string = ''): void {
    const catalog = this.menuElement?.querySelector('#editor-spawn-catalog') as HTMLElement | null;
    const summary = this.menuElement?.querySelector('#editor-spawn-summary') as HTMLElement | null;
    if (!catalog || !summary) return;

    this.renderSpawnCategories();

    const query = filterText.trim().toLowerCase();
    const entries = this.getSpawnEntries()
      .filter((entry) => {
        if (this.selectedSpawnCategory !== 'All' && this.translateSpawnCategory(entry.category) !== this.selectedSpawnCategory) {
          return false;
        }
        if (!query) return true;
        const haystack = `${entry.id} ${entry.label} ${entry.category} ${entry.description ?? ''}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => left.label.localeCompare(right.label));

    if (entries.length === 0) {
      catalog.innerHTML = '<div style="padding:12px;border:1px dashed rgba(80,80,80,0.4);color:#585858;font-size:11px;">No items found in this category.</div>';
      summary.textContent = `0 items in ${this.selectedSpawnCategory}`;
      return;
    }

    catalog.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
        ${entries.map((entry) => `
          <button class="editor-spawn-btn" data-type="${entry.id}" style="${this.spawnButtonStyle}border-color:${entry.accentColor ?? 'rgba(90,90,90,0.45)'}55;display:flex;flex-direction:column;gap:10px;min-height:96px;">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <div style="width:36px;height:36px;flex:0 0 36px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:${entry.accentColor ?? '#4e4e4e'}22;border:1px solid ${entry.accentColor ?? '#4e4e4e'}55;color:${entry.accentColor ?? '#c0c0c0'};font-size:18px;line-height:1;">
                ${entry.glyph ?? '·'}
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;min-width:0;">
                <span style="font-size:11px;color:#d4d4d4;letter-spacing:1px;white-space:normal;">${entry.label}</span>
                <span style="font-size:8px;color:${entry.accentColor ?? '#7a7a7a'};letter-spacing:1.4px;">${this.translateSpawnCategory(entry.category).toUpperCase()}</span>
              </div>
            </div>
            <span style="font-size:9px;color:#737373;letter-spacing:0.35px;line-height:1.5;white-space:normal;">${entry.description ?? entry.id}</span>
          </button>
        `).join('')}
      </div>
    `;

    summary.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'} in ${this.selectedSpawnCategory}`;

    catalog.querySelectorAll('.editor-spawn-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const type = (button as HTMLElement).getAttribute('data-type');
        if (type) this.spawnObject(type);
      });
    });
  }

  private getSpawnPosition(): { x: number; y: number; z: number } | null {
    const camera = Engine.getEngineCamera();
    if (!camera) return null;

    const cameraPos = camera.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.normalize().multiplyScalar(5);

    return {
      x: cameraPos.x + forward.x,
      y: cameraPos.y + forward.y,
      z: cameraPos.z + forward.z,
    };
  }

  private spawnPrimitive(type: string, spawnPos: { x: number; y: number; z: number }): Entity | null {
    const entityManager = Engine.getEntityManager();
    const entityRenderer = Engine.getEntityRenderer();
    const stateManager = Engine.getStateManagerInstance();

    if (!entityManager || !entityRenderer || !stateManager) {
      console.warn('[EditorMenu] Required systems not available');
      return null;
    }

    let entity: Entity | null = null;
    let renderData: any = null;
    const attributes: Partial<EntityAttributesType> = {
      hasHitbox: type !== 'script-gate',
      isScriptGate: type === 'script-gate',
      isInvisible: type === 'script-gate',
    };

    switch (type) {
      case 'cube':
        entity = entityManager.createEntity('EditorObject_Cube', { position: spawnPos, rotation: { x: 0, y: 0, z: 0 } });
        renderData = { meshType: 'box', color: 0xff6b6b, geometry: { width: 2, height: 2, depth: 2 } };
        break;
      case 'sphere':
        entity = entityManager.createEntity('EditorObject_Sphere', { position: spawnPos, rotation: { x: 0, y: 0, z: 0 } });
        renderData = { meshType: 'sphere', color: 0x6b9eff, geometry: { radius: 1, segments: 32 } };
        break;
      case 'plane':
        entity = entityManager.createEntity('EditorObject_Plane', { position: spawnPos, rotation: { x: -Math.PI / 2, y: 0, z: 0 } });
        renderData = { meshType: 'plane', color: 0x90ee90, geometry: { width: 4, height: 4 } };
        break;
      case 'script-gate':
        entity = entityManager.createEntity('EditorObject_ScriptGate', { position: spawnPos, rotation: { x: 0, y: 0, z: 0 } });
        renderData = { meshType: 'box', color: 0xffff00, geometry: { width: 2, height: 3, depth: 2 } };
        break;
      case 'wall':
        entity = entityManager.createEntity('EditorObject_Wall', { position: spawnPos, rotation: { x: 0, y: 0, z: 0 } });
        renderData = { meshType: 'box', color: 0x8fac8f, geometry: { width: 8, height: 3, depth: 0.5 } };
        break;
      case 'arch':
        entity = entityManager.createEntity('EditorObject_Arch', { position: spawnPos, rotation: { x: 0, y: 0, z: 0 } });
        renderData = { meshType: 'box', color: 0xa085c4, geometry: { width: 6, height: 4, depth: 0.5 } };
        break;
      case 'capsule':
        entity = entityManager.createEntity('EditorObject_Capsule', { position: spawnPos, rotation: { x: 0, y: 0, z: 0 } });
        renderData = { meshType: 'capsule', color: 0xff6b6b, geometry: { radius: 0.4, height: 1.2, radialSegments: 8 } };
        break;
      default:
        return null;
    }

    entity.addComponent({ name: 'render', data: renderData });
    entityRenderer.syncEntity(entity);
    initializeEntityAttributes(entity, stateManager, attributes);
    return entity;
  }

  private createTemplateEntity(
    entityManager: any,
    entityRenderer: any,
    stateManager: any,
    entityType: string,
    position: { x: number; y: number; z: number },
    renderData: { meshType: string; color: number; geometry: Record<string, unknown> },
    rotation = { x: 0, y: 0, z: 0 },
  ): Entity {
    const entity = entityManager.createEntity(entityType, { position, rotation });
    entity.addComponent({ name: 'render', data: renderData });
    entityRenderer.syncEntity(entity);
    initializeEntityAttributes(entity, stateManager, { hasHitbox: true, isScriptGate: false, isInvisible: false });
    return entity;
  }

  private spawnItemPickup(
    itemId: string,
    label: string,
    position: { x: number; y: number; z: number },
    renderData: { meshType: string; color: number; geometry: Record<string, unknown> },
  ): Entity | null {
    const entityManager = Engine.getEntityManager();
    const entityRenderer = Engine.getEntityRenderer();
    const stateManager = Engine.getStateManagerInstance();

    if (!entityManager || !entityRenderer || !stateManager) {
      console.warn('[EditorMenu] Required systems not available for item pickup spawn');
      return null;
    }

    const entity = entityManager.createEntity('EditorObject_Cube', { position, rotation: { x: 0, y: 0, z: 0 } });
    entity.addComponent({ name: 'render', data: renderData });
    entity.addComponent({
      name: 'interactable',
      data: {
        type: 'interactable',
        interactionType: 'item',
        pickupable: true,
        highlightable: true,
        itemId,
        prompt: label,
      },
    });
    entityRenderer.syncEntity(entity);
    initializeEntityAttributes(entity, stateManager, { hasHitbox: true, isScriptGate: false, isInvisible: false });
    return entity;
  }

  private spawnDust2Template(spawnPos: { x: number; y: number; z: number }): Entity | null {
    const entityManager = Engine.getEntityManager();
    const entityRenderer = Engine.getEntityRenderer();
    const stateManager = Engine.getStateManagerInstance();
    if (!entityManager || !entityRenderer || !stateManager) {
      console.warn('[EditorMenu] Required systems not available for Dust2 template');
      return null;
    }

    const origin = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    const createdEntities: Entity[] = [];

    const addWall = (offset: { x: number; y: number; z: number }, size: { width: number; height: number; depth: number }, color = 0x7d6a52) => {
      createdEntities.push(
        this.createTemplateEntity(
          entityManager,
          entityRenderer,
          stateManager,
          'EditorObject_Wall',
          { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z },
          { meshType: 'box', color, geometry: { width: size.width, height: size.height, depth: size.depth } },
        ),
      );
    };

    const addPlane = (offset: { x: number; y: number; z: number }, size: { width: number; height: number }, color = 0x9a8f7f) => {
      createdEntities.push(
        this.createTemplateEntity(
          entityManager,
          entityRenderer,
          stateManager,
          'EditorObject_Floor',
          { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z },
          { meshType: 'plane', color, geometry: { width: size.width, height: size.height } },
          { x: -Math.PI / 2, y: 0, z: 0 },
        ),
      );
    };

    const addArch = (offset: { x: number; y: number; z: number }, size: { width: number; height: number; depth: number }, color = 0xb08fdf) => {
      createdEntities.push(
        this.createTemplateEntity(
          entityManager,
          entityRenderer,
          stateManager,
          'EditorObject_Arch',
          { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z },
          { meshType: 'box', color, geometry: { width: size.width, height: size.height, depth: size.depth } },
        ),
      );
    };

    addPlane({ x: 0, y: -0.01, z: 0 }, { width: 80, height: 80 }, 0x8f826c);

    // Outside perimeter walls
    addWall({ x: 0, y: 1.75, z: 39 }, { width: 80, height: 3.5, depth: 1 });
    addWall({ x: 0, y: 1.75, z: -39 }, { width: 80, height: 3.5, depth: 1 });
    addWall({ x: 39, y: 1.75, z: 0 }, { width: 1, height: 3.5, depth: 80 });
    addWall({ x: -39, y: 1.75, z: 0 }, { width: 1, height: 3.5, depth: 80 });

    // B bombsite and A bombsite blocks
    addWall({ x: -20, y: 1.75, z: 20 }, { width: 20, height: 3.5, depth: 1 });
    addWall({ x: 20, y: 1.75, z: -20 }, { width: 20, height: 3.5, depth: 1 });
    addArch({ x: -18, y: 2, z: 0 }, { width: 10, height: 4, depth: 1 }, 0xaf8fbd);

    // Mid connector
    addWall({ x: 0, y: 1.75, z: 6 }, { width: 40, height: 3.5, depth: 1 });
    addWall({ x: -18, y: 1.75, z: 6 }, { width: 1, height: 3.5, depth: 18 });
    addWall({ x: 18, y: 1.75, z: 6 }, { width: 1, height: 3.5, depth: 18 });

    // Lower tunnels / ramps
    addWall({ x: -22, y: 1.75, z: -8 }, { width: 16, height: 3.5, depth: 1 });
    addWall({ x: 22, y: 1.75, z: 8 }, { width: 16, height: 3.5, depth: 1 });
    addWall({ x: 0, y: 1.75, z: -10 }, { width: 1, height: 3.5, depth: 24 });

    return createdEntities[0] ?? null;
  }

  private buildPrimitiveSpawnRequest(type: string, position: { x: number; y: number; z: number }): {
    entityType: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    renderData: {
      meshType: string;
      color: number;
      geometry: Record<string, unknown>;
    };
  } | null {
    switch (type) {
      case 'cube':
        return {
          entityType: 'EditorObject_Cube',
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: { meshType: 'box', color: 0xff6b6b, geometry: { width: 2, height: 2, depth: 2 } },
        };
      case 'sphere':
        return {
          entityType: 'EditorObject_Sphere',
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: { meshType: 'sphere', color: 0x6b9eff, geometry: { radius: 1, segments: 32 } },
        };
      case 'plane':
        return {
          entityType: 'EditorObject_Plane',
          position: { ...position },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          renderData: { meshType: 'plane', color: 0x90ee90, geometry: { width: 4, height: 4 } },
        };
      case 'script-gate':
        return {
          entityType: 'EditorObject_ScriptGate',
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: { meshType: 'box', color: 0xffff00, geometry: { width: 2, height: 3, depth: 2 } },
        };
      case 'wall':
        return {
          entityType: 'EditorObject_Wall',
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: { meshType: 'box', color: 0x8fac8f, geometry: { width: 8, height: 3, depth: 0.5 } },
        };
      case 'arch':
        return {
          entityType: 'EditorObject_Arch',
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: { meshType: 'box', color: 0xa085c4, geometry: { width: 6, height: 4, depth: 0.5 } },
        };
      case 'capsule':
        return {
          entityType: 'EditorObject_Capsule',
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: { meshType: 'capsule', color: 0xff6b6b, geometry: { radius: 0.4, height: 1.2, radialSegments: 8 } },
        };
      default:
        return null;
    }
  }

  private finalizeSpawnedEntity(entity: Entity, spawnPos: { x: number; y: number; z: number }): Entity {
    const renderData = entity.getComponent('render')?.data;

    if (this._onEntityPlaced && renderData) {
      this._onEntityPlaced({
        id: entity.id,
        entityType: entity.type,
        position: { ...spawnPos },
        rotation: { ...entity.getRotation() },
        renderData,
      });
    }

    this.selectEntity(entity);
    this.refreshEntityList();
    return entity;
  }

  private isPlayerEntity(entity: Entity): boolean {
    return entity.type === 'LocalPlayer' || entity.type === 'RemotePlayer';
  }

  private isEditableSceneEntity(entity: Entity): boolean {
    if (this.isPlayerEntity(entity)) return false;
    return entity.type.startsWith('EditorObject_') || entity.type.startsWith('Prefab_') || entity.hasComponent('prefab');
  }

  private getEntityDisplayName(entity: Entity): string {
    const prefabName = entity.getComponent('prefab')?.data?.prefabName as string | undefined;
    const base = prefabName ?? entity.type.replace('EditorObject_', '').replace('Prefab_', '');
    return base
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  /**
   * Spawn object at camera position
   */
  spawnObject(type: string): Entity | null {
    const spawnPos = this.getSpawnPosition();
    if (!spawnPos) {
      console.warn('[EditorMenu] Camera not available for spawning');
      return null;
    }

    const entry = this.getSpawnEntries().find((item) => item.id === type || item.label.toLowerCase() === type.toLowerCase());
    if (!entry) return null;

    const spawnRequest = entry.buildSpawnRequest?.(spawnPos) ?? null;
    if (spawnRequest && this._onSpawnRequested?.(spawnRequest)) {
      this.refreshEntityList();
      return null;
    }

    const entity = entry.spawn(spawnPos);
    if (!entity) return null;

    // Stamp editorPlacement so the entity is visible in the hierarchy panel and
    // survives the editor serialization / play-restore cycle.
    if (!entity.hasComponent('editorPlacement')) {
      entity.addComponent({
        name: 'editorPlacement',
        data: {
          serialize: true,
          kind: 'entity',
          prefabId: null,
          entityType: entity.type,
          authority: 'local',
          label: entry.label,
        },
      });
      const pos = entity.getPosition();
      const rot = entity.getRotation();
      gameBus.emit('EDITOR_PREFAB_PLACED', {
        prefabId: entry.id,
        entityId: entity.id,
        authority: 'local',
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rot.x, y: rot.y, z: rot.z },
        scale: { x: 1, y: 1, z: 1 },
        timestamp: Date.now(),
      });
    }

    if (this.config.enableLogging) {
      console.log(`[EditorMenu] Spawned ${entry.id}: ${entity.id}`);
    }

    return this.finalizeSpawnedEntity(entity, spawnPos);
  }

  /**
   * Select entity for editing
   */
  selectEntity(entity: Entity): void {
    this.selectedEntity = entity;
    Engine.getGizmoSystem()?.attachEntity(entity);
    
    this.updatePropertiesPanel();
    this.refreshEntityList();

    if (this.config.enableLogging) {
      console.log(`[EditorMenu] Selected entity: ${entity.id}`);
    }
  }

  refreshSelectedEntity(): void {
    if (!this.selectedEntity) {
      this.refreshEntityList();
      return;
    }
    const selected = Engine.getEntityManager()?.getEntity(this.selectedEntity.id) ?? null;
    if (!selected) {
      this.clearSelection();
      return;
    }
    this.selectedEntity = selected;
    this.updatePropertiesPanel();
    this.refreshEntityList();
  }

  clearSelection(): void {
    if (!this.selectedEntity) {
      this.updatePropertiesPanel();
      this.refreshEntityList();
      return;
    }

    Engine.getGizmoSystem()?.detachEntity();
    this.selectedEntity = null;
    this.updatePropertiesPanel();
    this.refreshEntityList();
  }

  /**
   * Delete entity
   */
  private deleteEntity(entity: Entity): void {
    const entityManager = Engine.getEntityManager();

    if (!entityManager) return;

    // Notify network layer before destroying
    if (this._onEntityRemoved) {
      this._onEntityRemoved(entity.id);
    }

    if (this.selectedEntity?.id === entity.id) {
      Engine.getGizmoSystem()?.detachEntity();
    }

    const removed = this._onEntityRemoveRequest
      ? this._onEntityRemoveRequest(entity)
      : entityManager.destroyEntity(entity);
    if (!removed) return;

    this.selectedEntity = null;
    this.updatePropertiesPanel();
    this.refreshEntityList();

    if (this.config.enableLogging) {
      console.log(`[EditorMenu] Deleted entity: ${entity.id}`);
    }
  }

  /**
   * Clear all entities
   */
  private clearAll(): void {
    const entityManager = Engine.getEntityManager();

    if (!entityManager) return;

    Engine.getGizmoSystem()?.detachEntity();

    const entities = entityManager.getEntities().filter((entity: Entity) => this.isEditableSceneEntity(entity));
    entities.forEach((entity: Entity) => {
      this._onEntityRemoved?.(entity.id);
      const removed = this._onEntityRemoveRequest
        ? this._onEntityRemoveRequest(entity)
        : entityManager.destroyEntity(entity);
      if (!removed && this.config.enableLogging) {
        console.warn(`[EditorMenu] Failed to remove entity during clearAll: ${entity.id}`);
      }
    });

    this.selectedEntity = null;
    this.updatePropertiesPanel();
    this.refreshEntityList();
  }

  /**
   * Refresh entity list in UI
   */
  private refreshEntityList(): void {
    const entityManager = Engine.getEntityManager();
    const itemsContainer = this.menuElement!.querySelector('#editor-entity-items');

    if (!itemsContainer || !entityManager) return;

    const sceneObjects = entityManager
      .getEntities()
      .filter((e: Entity) => this.isEditableSceneEntity(e));

    const playerEntities = entityManager
      .getEntities()
      .filter((e: Entity) => this.isPlayerEntity(e));

    if (sceneObjects.length === 0 && playerEntities.length === 0) {
      itemsContainer.innerHTML = '<div style="color:#505050;font-size:11px;">No scene objects</div>';
      return;
    }

    const renderItem = (entity: Entity, labelPrefix: string, accentColor: string): string => {
      const isSelected = this.selectedEntity?.id === entity.id;
      const bg = isSelected ? `rgba(${accentColor},0.15)` : 'transparent';
      const border = isSelected ? `rgba(${accentColor},0.5)` : `rgba(${accentColor},0.2)`;
      const color = isSelected ? '#c0c0c0' : '#909090';
      const prefabName = entity.getComponent('prefab')?.data?.prefabName as string | undefined;
      const subtitle = prefabName ? `PREFAB · ${prefabName}` : entity.type;
      return `
        <div
          class="editor-entity-item"
          data-entity-id="${entity.id}"
          style="
            background: ${bg};
            border: 1px solid ${border};
            padding: 5px 8px;
            margin-bottom: 5px;
            cursor: pointer;
            font-size: 11px;
            color: ${color};
            letter-spacing: 0.5px;
            word-break: break-all;
          "
        >
          <div>${labelPrefix}${this.getEntityDisplayName(entity)}</div>
          <div style="font-size:9px;color:#585858;margin-top:2px;letter-spacing:0.6px;">${subtitle}</div>
        </div>
      `;
    };

    let html = '';
    if (playerEntities.length > 0) {
      html += `<div style="color:#5a8a50;font-size:9px;letter-spacing:1px;margin-bottom:4px;margin-top:2px;">PLAYERS</div>`;
      html += playerEntities.map((e) => renderItem(e, '', '80,180,80')).join('');
    }
    if (sceneObjects.length > 0) {
      if (playerEntities.length > 0) {
        html += `<div style="color:#707070;font-size:9px;letter-spacing:1px;margin-bottom:4px;margin-top:8px;">SCENE OBJECTS</div>`;
      }
      html += sceneObjects.map((e) => renderItem(e, '', '100,100,100')).join('');
    }

    itemsContainer.innerHTML = html;

    // Attach click listeners
    itemsContainer.querySelectorAll('.editor-entity-item').forEach((item) => {
      item.addEventListener('click', () => {
        const entityId = (item as HTMLElement).getAttribute('data-entity-id');
        if (entityId) {
          const entity = entityManager!.getEntity(entityId);
          if (entity) {
            this.selectEntity(entity);
          }
        }
      });
    });
  }

  /**
   * Update properties panel
   */
  private updatePropertiesPanel(): void {
    const propertiesContent = this.menuElement!.querySelector('#editor-properties-content');
    const transformSystem = Engine.getTransformSystem();
    const stateManager = Engine.getStateManagerInstance();

    if (!propertiesContent || !this.selectedEntity || !transformSystem || !stateManager) {
      propertiesContent!.innerHTML = '<div style="color:#505050;font-size:11px;">Select an entity</div>';
      return;
    }

    const entity = this.selectedEntity;
    const transform = transformSystem.getTransform(entity);
    const isPlayer = entity.type === 'LocalPlayer' || entity.type === 'RemotePlayer';
    const prefabName = entity.getComponent('prefab')?.data?.prefabName as string | undefined;
    const prefabTags = entity.getComponent('prefab')?.data?.tags as string[] | undefined;

    const deleteBtn = this.menuElement!.querySelector('#editor-delete-btn') as HTMLElement;
    deleteBtn.style.opacity = isPlayer ? '0.4' : '1';
    deleteBtn.style.cursor = isPlayer ? 'default' : 'pointer';
    deleteBtn.style.pointerEvents = isPlayer ? 'none' : 'auto';

    const renderData = entity.getComponent('render')?.data as { meshType?: string; color?: number } | undefined;
    const currentMeshType = renderData?.meshType ?? 'capsule';
    const currentColorHex = renderData?.color != null
      ? '#' + renderData.color.toString(16).padStart(6, '0')
      : (isPlayer ? '#ffff00' : '#ffffff');
    const sceneGraph = Engine.getSceneGraph();
    const hierarchyPath = sceneGraph ? sceneGraph.getHierarchyPath(entity.id) : [entity.id];
    const parentId = sceneGraph?.getParent(entity.id) ?? null;

    const attributesSection = isPlayer ? '' : (() => {
      const attributes = getEntityAttributes(entity, stateManager);
      return `
        <div style="padding-top:10px;border-top:1px solid rgba(80,80,80,0.3);">
          <div style="color:#909090;font-size:10px;letter-spacing:1px;margin-bottom:6px;">ATTRIBUTES</div>
          <label style="display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;">
            <input type="checkbox" ${attributes.hasHitbox ? 'checked' : ''} class="editor-attr-hitbox" style="accent-color:#a0a0a0;cursor:pointer;">
            <span>Hitbox</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;">
            <input type="checkbox" ${attributes.isScriptGate ? 'checked' : ''} class="editor-attr-gate" style="accent-color:#a0a0a0;cursor:pointer;">
            <span>Script Gate</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;">
            <input type="checkbox" ${attributes.isInvisible ? 'checked' : ''} class="editor-attr-invisible" style="accent-color:#a0a0a0;cursor:pointer;">
            <span>Invisible</span>
          </label>
        </div>
      `;
    })();

    const appearanceSection = isPlayer ? `
      <div style="padding-top:10px;border-top:1px solid rgba(80,80,80,0.3);">
        <div style="color:#909090;font-size:10px;letter-spacing:1px;margin-bottom:8px;">APPEARANCE</div>
        <div style="margin-bottom:8px;">
          <div style="color:#727272;font-size:10px;margin-bottom:4px;">Model</div>
          <select id="editor-player-model" style="width:100%;background:#111111;color:#c0c0c0;border:1px solid rgba(80,80,80,0.45);padding:4px 6px;font-family:'Courier New',Courier,monospace;font-size:11px;cursor:pointer;">
            <option value="capsule" ${currentMeshType === 'capsule' ? 'selected' : ''}>CAPSULE (pill)</option>
            <option value="sphere" ${currentMeshType === 'sphere' ? 'selected' : ''}>SPHERE</option>
            <option value="box" ${currentMeshType === 'box' ? 'selected' : ''}>BOX</option>
          </select>
        </div>
        <div style="margin-bottom:10px;">
          <div style="color:#727272;font-size:10px;margin-bottom:4px;">Color</div>
          <input type="color" id="editor-player-color" value="${currentColorHex}" style="width:100%;height:28px;border:1px solid rgba(80,80,80,0.45);background:#111111;cursor:pointer;padding:2px;">
        </div>
        <button id="editor-apply-appearance" style="width:100%;padding:7px;background:rgba(80,160,80,0.12);color:#90e090;border:1px solid rgba(80,160,80,0.35);font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:1px;cursor:pointer;">APPLY</button>
      </div>
    ` : '';

    const inputStyle = `
      width:100%;box-sizing:border-box;padding:4px 6px;
      background:#111111;color:#c0c0c0;
      border:1px solid rgba(80,80,80,0.45);
      font-family:'Courier New',Courier,monospace;font-size:11px;
      outline:none;
      -moz-appearance:textfield;
    `;
    const vecRow = (label: string, x: number, y: number, z: number, idPrefix: string) => `
      <div style="margin-bottom:10px;">
        <div style="color:#606060;font-size:9px;letter-spacing:2px;margin-bottom:6px;">${label}</div>
        <div style="display:grid;grid-template-columns:16px 1fr 16px 1fr 16px 1fr;align-items:center;gap:4px;">
          <span style="color:#909090;font-size:10px;">X</span>
          <input type="number" step="0.1" id="${idPrefix}_x" value="${x.toFixed(3)}" style="${inputStyle}">
          <span style="color:#909090;font-size:10px;">Y</span>
          <input type="number" step="0.1" id="${idPrefix}_y" value="${y.toFixed(3)}" style="${inputStyle}">
          <span style="color:#909090;font-size:10px;">Z</span>
          <input type="number" step="0.1" id="${idPrefix}_z" value="${z.toFixed(3)}" style="${inputStyle}">
        </div>
      </div>
    `;

    const scaleVec = transform.scale ?? { x: 1, y: 1, z: 1 };

    propertiesContent.innerHTML = `
      <style>
        .ep-num::-webkit-inner-spin-button,.ep-num::-webkit-outer-spin-button{opacity:0.4;}
        .ep-num:focus{border-color:rgba(120,120,120,0.6)!important;}
      </style>
      <div style="font-size:11px;color:#909090;">
        <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(60,60,60,0.5);">
          <div style="color:#c0c0c0;letter-spacing:1px;">${this.getEntityDisplayName(entity)}</div>
          <div style="color:#727272;font-size:9px;margin-top:3px;letter-spacing:1px;">${isPlayer ? 'RUNTIME PLAYER' : prefabName ? 'PREFAB INSTANCE' : 'EDITOR OBJECT'}</div>
          <div style="color:#484848;font-size:9px;margin-top:2px;word-break:break-all;">${entity.id}</div>
        </div>

        ${prefabName ? `
          <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(60,60,60,0.5);">
            <div style="color:#909090;font-size:10px;letter-spacing:1px;margin-bottom:4px;">PREFAB</div>
            <div style="color:#c0c0c0;font-size:11px;">${prefabName}</div>
            <div style="color:#727272;font-size:9px;margin-top:4px;line-height:1.5;">${prefabTags?.length ? prefabTags.join(' · ') : 'No prefab tags'}</div>
          </div>
        ` : ''}

        ${vecRow('POSITION', transform.position.x, transform.position.y, transform.position.z, 'ep_pos')}
        ${vecRow('ROTATION  (rad)', transform.rotation.x, transform.rotation.y, transform.rotation.z, 'ep_rot')}
        ${vecRow('SCALE', scaleVec.x, scaleVec.y, scaleVec.z, 'ep_scl')}

        <div style="margin-bottom:10px;padding-top:10px;border-top:1px solid rgba(80,80,80,0.3);">
          <div style="color:#909090;font-size:10px;letter-spacing:1px;margin-bottom:6px;">HIERARCHY</div>
          <div style="color:#727272;font-size:10px;line-height:1.6;word-break:break-all;">${hierarchyPath.join(' → ')}</div>
          ${parentId ? '<button id="editor-unparent-btn" style="margin-top:8px;width:100%;padding:6px;background:rgba(110,110,180,0.1);color:#b8c8ff;border:1px solid rgba(110,110,180,0.35);font-family:\'Courier New\',Courier,monospace;font-size:11px;letter-spacing:1px;cursor:pointer;">UNPARENT</button>' : ''}
        </div>

        ${attributesSection}
        ${appearanceSection}
      </div>
    `;

    // Add ep-num class to all number inputs for CSS targeting
    propertiesContent.querySelectorAll<HTMLInputElement>('input[type=number]').forEach(inp => inp.classList.add('ep-num'));

    // Helper: apply transform update and push to renderer
    const applyTransform = (): void => {
      const before = {
        position: { ...entity.getPosition() },
        rotation: { ...entity.getRotation() },
        scale: { ...entity.getScale() },
      };
      const px = parseFloat((propertiesContent.querySelector('#ep_pos_x') as HTMLInputElement).value) || 0;
      const py = parseFloat((propertiesContent.querySelector('#ep_pos_y') as HTMLInputElement).value) || 0;
      const pz = parseFloat((propertiesContent.querySelector('#ep_pos_z') as HTMLInputElement).value) || 0;
      const rx = parseFloat((propertiesContent.querySelector('#ep_rot_x') as HTMLInputElement).value) || 0;
      const ry = parseFloat((propertiesContent.querySelector('#ep_rot_y') as HTMLInputElement).value) || 0;
      const rz = parseFloat((propertiesContent.querySelector('#ep_rot_z') as HTMLInputElement).value) || 0;
      const sx = parseFloat((propertiesContent.querySelector('#ep_scl_x') as HTMLInputElement).value) || 1;
      const sy = parseFloat((propertiesContent.querySelector('#ep_scl_y') as HTMLInputElement).value) || 1;
      const sz = parseFloat((propertiesContent.querySelector('#ep_scl_z') as HTMLInputElement).value) || 1;
      entity.setPosition({ x: px, y: py, z: pz });
      entity.setRotation({ x: rx, y: ry, z: rz });
      entity.setScale({ x: sx, y: sy, z: sz });
      // Immediately update the mesh without waiting for the game loop
      const er = Engine.getEntityRenderer();
      const mesh = er?.getMeshForEntity(entity.id) as any;
      if (mesh) {
        mesh.position.set(px, py, pz);
        mesh.rotation.set(rx, ry, rz);
        mesh.scale.set(sx, sy, sz);
      }
      // Also sync gizmo position if this entity is selected
      if (this.selectedEntity?.id === entity.id) {
        Engine.getGizmoSystem()?.attachEntity(entity);
      }

      this._onTransformApplied?.({
        id: entity.id,
        before,
        after: {
          position: entity.getPosition(),
          rotation: entity.getRotation(),
          scale: entity.getScale(),
        },
      });
    };

    propertiesContent.querySelectorAll<HTMLInputElement>('input[type=number]').forEach(inp => {
      inp.addEventListener('change', applyTransform);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyTransform(); });
    });

    // Attach attribute change listeners (non-player only)
    if (!isPlayer) {
      const hitboxCheckbox = propertiesContent.querySelector('.editor-attr-hitbox') as HTMLInputElement;
      const gateCheckbox = propertiesContent.querySelector('.editor-attr-gate') as HTMLInputElement;
      const invisibleCheckbox = propertiesContent.querySelector('.editor-attr-invisible') as HTMLInputElement;

      hitboxCheckbox?.addEventListener('change', () => {
        setHitbox(entity, stateManager, hitboxCheckbox.checked);
      });

      gateCheckbox?.addEventListener('change', () => {
        setScriptGate(entity, stateManager, gateCheckbox.checked);
      });

      invisibleCheckbox?.addEventListener('change', () => {
        setInvisible(entity, stateManager, invisibleCheckbox.checked);
        const entityRenderer = Engine.getEntityRenderer();
        if (entityRenderer) {
          entityRenderer.syncEntity(entity);
        }
      });
    }

    // Attach appearance apply listener (player only)
    if (isPlayer) {
      const applyBtn = propertiesContent.querySelector('#editor-apply-appearance') as HTMLButtonElement;
      applyBtn?.addEventListener('click', () => {
        const colorInput = propertiesContent.querySelector('#editor-player-color') as HTMLInputElement;
        const colorHex = colorInput?.value ?? '#ffff00';
        const colorNum = parseInt(colorHex.replace('#', ''), 16);

        // Write to the canonical StateManager appearance path so that
        // PlayerModelSystem's subscription rebuilds the avatar and the
        // change propagates to multiplayer peers via PLAYER_APPEARANCE_CHANGED.
        // Never manipulate the render component directly for a player entity.
        const sm = Engine.getStateManagerInstance();
        if (sm) {
          const existing = (sm.get('player.local.appearance') ?? {}) as Record<string, unknown>;
          sm.set('player.local.appearance', { ...existing, bodyColor: colorNum });
        }
      });
    }

    const unparentBtn = propertiesContent.querySelector('#editor-unparent-btn') as HTMLButtonElement | null;
    unparentBtn?.addEventListener('click', () => {
      const sg = Engine.getSceneGraph();
      if (!sg) return;
      sg.reparent(entity.id, undefined);
      this.refreshSelectedEntity();
      Engine.getGizmoSystem()?.attachEntity(entity);
    });
  }

  /**
   * Destroy editor menu and clean all listeners.
   */
  destroy(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    this.closePanelDispose?.();
    if (this.menuElement && this.menuElement.parentElement) {
      this.menuElement.parentElement.removeChild(this.menuElement);
      this.menuElement = null;
    }
  }

  /**
   * Log current selected entity info
   */
  getSelectedEntity(): Entity | null {
    return this.selectedEntity;
  }
}
