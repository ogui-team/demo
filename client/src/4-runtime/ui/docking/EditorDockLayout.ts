import { DockHandle } from './DockHandle';
import { DockManager } from './DockManager';

type DockSlotId = 'left' | 'center' | 'right' | 'bottom' | 'topbar';

const STYLE_ID = 'editor-dock-layout-style';

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.editor-dock-layout {
  --dock-left-width: 300px;
  --dock-right-width: 360px;
  --dock-bottom-height: 220px;
  position: fixed;
  inset: 0;
  z-index: 1200;
  pointer-events: none;
  display: none;
}
.editor-dock-layout.editor-dock-layout--is-dragging {
  pointer-events: auto;
}
.editor-dock-layout.is-active {
  display: block;
}
.editor-dock-layout__viewport {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
.editor-dock-layout__grid {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  display: grid;
  grid-template-columns: var(--dock-left-width) minmax(0, 1fr) var(--dock-right-width);
  grid-template-rows: minmax(0, 1fr) var(--dock-bottom-height);
  grid-template-areas:
    "left center right"
    "bottom bottom bottom";
}
.editor-dock-layout__slot {
  min-width: 0;
  min-height: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}
.editor-dock-layout__slot--left { grid-area: left; }
.editor-dock-layout__slot--center { grid-area: center; }
.editor-dock-layout__slot--right { grid-area: right; }
.editor-dock-layout__slot--bottom { grid-area: bottom; }
.editor-dock-layout__slot--topbar {
  position: absolute;
  top: 8px;
  left: calc(var(--dock-left-width) + 12px);
  right: calc(var(--dock-right-width) + 12px);
  height: 38px;
  z-index: 4;
}
.editor-dock-layout__panel {
  pointer-events: auto;
  border: 1px solid var(--suite-border);
  background: color-mix(in srgb, var(--suite-bg-1) 90%, transparent);
  color: var(--suite-fg-0);
  box-shadow: var(--suite-shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  backdrop-filter: blur(2px);
}
.editor-dock-layout__panel-header {
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--suite-border-soft);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--suite-fg-1);
  flex: 0 0 auto;
}
.editor-dock-layout__panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.editor-dock-layout__slot--left .editor-dock-layout__panel,
.editor-dock-layout__slot--right .editor-dock-layout__panel,
.editor-dock-layout__slot--bottom .editor-dock-layout__panel {
  height: 100%;
}
.editor-dock-layout__slot--center {
  position: relative;
  pointer-events: auto;
}
.editor-dock-layout__center-workspace {
  pointer-events: none;
  height: 100%;
}
.editor-dock-layout__center-title {
  position: absolute;
  top: 12px;
  left: 14px;
  font-size: 11px;
  letter-spacing: 0.09em;
  color: var(--suite-fg-2);
  text-transform: uppercase;
}
.editor-dock-layout__handle {
  position: absolute;
  pointer-events: auto;
  z-index: 5;
}
.editor-dock-layout__handle::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--suite-accent-soft);
  opacity: 0;
  transition: opacity 90ms linear;
}
.editor-dock-layout__handle:hover::after,
.editor-dock-layout__handle:active::after {
  opacity: 1;
}
.editor-dock-layout__handle--left {
  top: 0;
  bottom: var(--dock-bottom-height);
  left: calc(var(--dock-left-width) - 3px);
  width: 6px;
  cursor: col-resize;
}
.editor-dock-layout__handle--right {
  top: 0;
  bottom: var(--dock-bottom-height);
  right: calc(var(--dock-right-width) - 3px);
  width: 6px;
  cursor: col-resize;
}
.editor-dock-layout__handle--bottom {
  left: 0;
  right: 0;
  bottom: calc(var(--dock-bottom-height) - 3px);
  height: 6px;
  cursor: row-resize;
}
`;
  document.head.appendChild(style);
}

function createPanel(title: string, content: HTMLElement): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'editor-dock-layout__panel';
  panel.dataset.uiInteractive = 'true';
  panel.dataset.pointerBarrier = 'true';

  const header = document.createElement('div');
  header.className = 'editor-dock-layout__panel-header';
  header.dataset.uiInteractive = 'true';
  header.dataset.pointerBarrier = 'true';
  header.textContent = title;

  const body = document.createElement('div');
  body.className = 'editor-dock-layout__panel-body';
  body.dataset.uiInteractive = 'true';
  body.dataset.pointerBarrier = 'true';
  body.appendChild(content);

  panel.append(header, body);
  panel.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  }, true);
  header.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  }, true);
  body.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  }, true);
  return panel;
}

function createSlot(id: DockSlotId): HTMLDivElement {
  const slot = document.createElement('div');
  slot.className = `editor-dock-layout__slot editor-dock-layout__slot--${id}`;
  return slot;
}

export class EditorDockLayout {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly viewportLayer: HTMLDivElement;
  private readonly slotMap: Record<DockSlotId, HTMLDivElement>;
  private readonly manager: DockManager;
  private readonly handles: DockHandle[];

  constructor() {
    ensureStyle();

    this.root = document.createElement('div');
    this.root.className = 'editor-dock-layout';

    this.viewportLayer = document.createElement('div');
    this.viewportLayer.className = 'editor-dock-layout__viewport';

    this.grid = document.createElement('div');
    this.grid.className = 'editor-dock-layout__grid';

    this.slotMap = {
      left: createSlot('left'),
      center: createSlot('center'),
      right: createSlot('right'),
      bottom: createSlot('bottom'),
      topbar: createSlot('topbar'),
    };
    this.slotMap.center.id = 'editor-center-viewport';

    const centerWorkspace = document.createElement('div');
    centerWorkspace.className = 'editor-dock-layout__center-workspace';
    const centerTitle = document.createElement('div');
    centerTitle.className = 'editor-dock-layout__center-title';
    centerTitle.textContent = 'Viewport';
    centerWorkspace.appendChild(centerTitle);
    this.slotMap.center.appendChild(centerWorkspace);

    this.grid.append(
      this.slotMap.left,
      this.slotMap.center,
      this.slotMap.right,
      this.slotMap.bottom,
    );

    this.root.append(this.viewportLayer, this.grid, this.slotMap.topbar);

    this.manager = new DockManager(this.root);
    this.handles = [
      new DockHandle({ target: 'left', className: 'editor-dock-layout__handle editor-dock-layout__handle--left', manager: this.manager }),
      new DockHandle({ target: 'right', className: 'editor-dock-layout__handle editor-dock-layout__handle--right', manager: this.manager }),
      new DockHandle({ target: 'bottom', className: 'editor-dock-layout__handle editor-dock-layout__handle--bottom', manager: this.manager }),
    ];

    for (const handle of this.handles) {
      this.root.appendChild(handle.getElement());
    }

    this.mountDefaultPanels();
    document.body.appendChild(this.root);
  }

  setEditorMode(active: boolean): void {
    this.root.classList.toggle('is-active', active);
  }

  getSlot(slot: DockSlotId): HTMLElement {
    return this.slotMap[slot];
  }

  getViewportLayer(): HTMLElement {
    return this.viewportLayer;
  }

  getViewportBounds(): { width: number; height: number } {
    const centerSlot = this.slotMap.center;
    const rect = centerSlot.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  setPanel(slot: Exclude<DockSlotId, 'center' | 'topbar'>, title: string, content: HTMLElement): void {
    const target = this.slotMap[slot];
    target.replaceChildren(createPanel(title, content));
  }

  setTopbar(content: HTMLElement): void {
    const target = this.slotMap.topbar;
    content.dataset.uiInteractive = 'true';
    content.dataset.pointerBarrier = 'true';
    content.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    }, true);
    target.replaceChildren(content);
  }

  destroy(): void {
    for (const handle of this.handles) {
      handle.destroy();
    }
    this.manager.destroy();
    this.root.remove();
  }

  private mountDefaultPanels(): void {
    this.setPanel('left', 'Hierarchy', this.buildPlaceholder('Hierarchy tree and scene nodes will live here.'));
    this.setPanel('right', 'Inspector', this.buildPlaceholder('Context inspector and property editors will live here.'));
    this.setPanel('bottom', 'Console', this.buildPlaceholder('Build output, runtime logs and diagnostics will live here.'));

    const topbarContent = document.createElement('div');
    topbarContent.style.cssText = [
      'pointer-events:auto',
      'height:100%',
      'display:flex',
      'align-items:center',
      'padding:0 10px',
      'border:1px solid var(--suite-border)',
      'background:color-mix(in srgb, var(--suite-bg-0) 92%, transparent)',
      'color:var(--suite-fg-1)',
      'font-size:11px',
      'letter-spacing:0.08em',
      'text-transform:uppercase',
    ].join(';');
    topbarContent.textContent = 'Top Action Bar';
    this.setTopbar(topbarContent);
  }

  private buildPlaceholder(copy: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'height:100%',
      'padding:10px',
      'box-sizing:border-box',
      'font-size:12px',
      'line-height:1.5',
      'color:var(--suite-fg-2)',
      'overflow:auto',
    ].join(';');
    wrapper.textContent = copy;
    return wrapper;
  }
}
