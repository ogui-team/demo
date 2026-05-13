import { EditorSelectionStore } from './EditorSelectionStore';

interface EntityManagerAdapter {
  getEntities(): Array<{ id: string; type: string; label?: string }>;
  onEntityCreated(cb: (entity: { id: string; type: string; label?: string }) => void): () => void;
  onEntityUpdated?(cb: (entity: { id: string; type: string; label?: string }) => void): () => void;
  onEntityDestroyed(cb: (entity: { id: string; type: string }) => void): () => void;
}

interface HierarchyPanelOptions {
  selectionStore: EditorSelectionStore;
  entityManager: EntityManagerAdapter;
}

export class HierarchyPanel {
  private readonly selectionStore: EditorSelectionStore;
  private readonly entityManager: EntityManagerAdapter;
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly rowMap = new Map<string, HTMLButtonElement>();
  private selectedIds: Set<string> = new Set();
  private readonly contextMenu: HTMLDivElement;
  private contextTargetId: string | null = null;
  private readonly destroyFns: Array<() => void> = [];

  constructor(options: HierarchyPanelOptions) {
    this.selectionStore = options.selectionStore;
    this.entityManager = options.entityManager;

    this.root = document.createElement('div');
    this.root.dataset.uiInteractive = 'true';
    this.root.dataset.pointerBarrier = 'true';
    this.root.style.cssText = [
      'height:100%',
      'display:flex',
      'flex-direction:column',
      'min-height:0',
      'background:transparent',
      'font-size:12px',
      'color:var(--suite-fg-0)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = [
      'padding:8px 10px',
      'border-bottom:1px solid var(--suite-border-soft)',
      'font-size:10px',
      'letter-spacing:0.08em',
      'text-transform:uppercase',
      'color:var(--suite-fg-2)',
    ].join(';');
    header.textContent = 'Scene Hierarchy';

    this.list = document.createElement('div');
    this.list.dataset.uiInteractive = 'true';
    this.list.dataset.pointerBarrier = 'true';
    this.list.style.cssText = [
      'flex:1 1 auto',
      'min-height:0',
      'overflow:auto',
      'padding:4px 0',
    ].join(';');

    this.root.append(header, this.list);
    this.contextMenu = this.createContextMenu();
    document.body.appendChild(this.contextMenu);

    this.renderRows();
    this.destroyFns.push(this.entityManager.onEntityCreated((entity) => this.addRow(entity.id, entity.label ?? entity.type)));
    if (typeof this.entityManager.onEntityUpdated === 'function') {
      this.destroyFns.push(this.entityManager.onEntityUpdated((entity) => this.updateRow(entity.id, entity.label ?? entity.type)));
    }
    this.destroyFns.push(this.entityManager.onEntityDestroyed((entity) => this.removeRow(entity.id)));
    this.destroyFns.push(this.selectionStore.subscribe((state) => {
      this.setSelected(new Set(state.selectedIds ?? (state.nodeId ? [state.nodeId] : [])));
    }));
  }

  getElement(): HTMLElement {
    return this.root;
  }

  destroy(): void {
    while (this.destroyFns.length > 0) {
      this.destroyFns.pop()?.();
    }
    this.contextMenu.remove();
    this.root.remove();
  }

  renderRows(): void {
    this.list.replaceChildren();
    this.rowMap.clear();

    const entities = this.entityManager.getEntities()
      .slice()
      .sort((left, right) => {
        const leftLabel = left.label?.toLowerCase() ?? left.type.toLowerCase();
        const rightLabel = right.label?.toLowerCase() ?? right.type.toLowerCase();
        if (leftLabel < rightLabel) return -1;
        if (leftLabel > rightLabel) return 1;
        return left.id.localeCompare(right.id);
      });

    for (const entity of entities) {
      this.addRow(entity.id, entity.label ?? entity.type);
    }
  }

  private addRow(entityId: string, label: string): void {
    if (this.rowMap.has(entityId)) {
      return;
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'height:24px',
      'width:100%',
      'border:0',
      'background:transparent',
      'color:inherit',
      'text-align:left',
      'cursor:pointer',
      'padding:0 8px',
      'box-sizing:border-box',
      'font-size:12px',
    ].join(';');
    row.dataset.nodeId = entityId;
    row.dataset.uiInteractive = 'true';
    row.dataset.pointerBarrier = 'true';
    row.textContent = label;

    row.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        this.selectionStore.toggleEntity(entityId, label);
      } else {
        this.selectionStore.selectEntity(entityId, label);
      }
    });

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.contextTargetId = entityId;
      this.openContextMenu(event.clientX, event.clientY);
    });

    row.addEventListener('mouseenter', () => {
      if (this.selectedIds.has(entityId)) return;
      row.style.background = 'var(--suite-accent-soft)';
    });

    row.addEventListener('mouseleave', () => {
      if (this.selectedIds.has(entityId)) return;
      row.style.background = 'transparent';
    });

    this.rowMap.set(entityId, row);
    this.list.appendChild(row);
  }

  private removeRow(entityId: string): void {
    const row = this.rowMap.get(entityId);
    if (!row) return;
    row.remove();
    this.rowMap.delete(entityId);
    this.selectedIds.delete(entityId);
  }

  updateRow(entityId: string, label: string): void {
    const row = this.rowMap.get(entityId);
    if (!row) {
      this.addRow(entityId, label);
      return;
    }
    row.textContent = label;
  }

  private setSelected(selectedIds: Set<string>): void {
    this.selectedIds = new Set(selectedIds);
    for (const [id, row] of this.rowMap.entries()) {
      if (this.selectedIds.has(id)) {
        row.style.background = 'var(--suite-accent-soft)';
        row.style.color = 'var(--suite-fg-0)';
      } else {
        row.style.background = 'transparent';
        row.style.color = 'var(--suite-fg-0)';
      }
    }
  }

  private createContextMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.dataset.uiInteractive = 'true';
    menu.dataset.pointerBarrier = 'true';
    menu.style.cssText = [
      'position:fixed',
      'display:none',
      'min-width:140px',
      'border:1px solid var(--suite-border)',
      'background:color-mix(in srgb, var(--suite-bg-0) 95%, transparent)',
      'box-shadow:var(--suite-shadow)',
      'z-index:9999',
      'padding:4px',
      'box-sizing:border-box',
    ].join(';');

    const actions: Array<{ id: string; label: string }> = [
      { id: 'rename', label: 'Rename' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'delete', label: 'Delete' },
    ];

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.style.cssText = [
        'display:block',
        'width:100%',
        'height:26px',
        'border:0',
        'background:transparent',
        'color:var(--suite-fg-0)',
        'text-align:left',
        'padding:0 8px',
        'cursor:pointer',
        'font-size:12px',
      ].join(';');
      button.addEventListener('click', () => {
        const target = this.contextTargetId ?? 'none';
        console.log(`[HierarchyPanel] ${action.id} requested for ${target}`);
        this.hideContextMenu();
      });
      menu.appendChild(button);
    }

    menu.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    window.addEventListener('click', () => this.hideContextMenu());
    window.addEventListener('blur', () => this.hideContextMenu());
    return menu;
  }

  private openContextMenu(x: number, y: number): void {
    this.contextMenu.style.display = 'block';
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
  }

  private hideContextMenu(): void {
    this.contextMenu.style.display = 'none';
  }
}
