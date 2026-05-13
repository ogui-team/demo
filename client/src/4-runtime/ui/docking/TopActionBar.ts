import { EditorSelectionStore, type EditorSelectionState } from './EditorSelectionStore';

interface TopActionBarOptions {
  selectionStore: EditorSelectionStore;
  onSelectTool: (tool: 'SELECT' | 'PAINT' | 'WHITEBOX') => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetGizmoMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  onToggleGizmoOrientation: () => void;
  onToggleGizmoSnap: () => void;
  getGizmoState: () => {
    mode: 'translate' | 'rotate' | 'scale';
    orientation: 'world' | 'local';
    snapEnabled: boolean;
  };
  onBuildWorld: () => void;
  onSave: () => void;
  onExport: () => void;
  onImport: () => void;
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = [
    'height:26px',
    'padding:0 10px',
    'border:1px solid var(--suite-border)',
    'background:var(--suite-bg-2)',
    'color:var(--suite-fg-0)',
    'font-size:11px',
    'letter-spacing:0.03em',
    'cursor:pointer',
  ].join(';');
  button.addEventListener('click', onClick);
  return button;
}

export class TopActionBar {
  private readonly root: HTMLDivElement;
  private readonly leftGroup: HTMLDivElement;
  private readonly rightGroup: HTMLDivElement;
  private readonly unsubSelection: () => void;
  private lastSignature = '';
  private readonly options: TopActionBarOptions;

  constructor(options: TopActionBarOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'pointer-events:auto',
      'height:100%',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:8px',
      'padding:0 10px',
      'border:1px solid var(--suite-border)',
      'background:color-mix(in srgb, var(--suite-bg-0) 92%, transparent)',
      'box-sizing:border-box',
    ].join(';');

    this.leftGroup = document.createElement('div');
    this.leftGroup.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:6px',
      'opacity:1',
      'transition:opacity 150ms ease',
    ].join(';');

    this.rightGroup = document.createElement('div');
    this.rightGroup.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:6px',
      'flex:0 0 auto',
    ].join(';');

    this.root.append(this.leftGroup, this.rightGroup);

    this.unsubSelection = options.selectionStore.subscribe((state) => {
      this.renderContext(state);
    });
  }

  getElement(): HTMLElement {
    return this.root;
  }

  mountRight(content: HTMLElement): void {
    this.rightGroup.replaceChildren(content);
  }

  destroy(): void {
    this.unsubSelection();
    this.root.remove();
  }

  private renderContext(state: EditorSelectionState): void {
    const gizmoState = this.options.getGizmoState();
    const signature = [
      state.type,
      state.nodeId ?? '',
      (state.selectedIds ?? []).join(','),
      gizmoState.mode,
      gizmoState.orientation,
      gizmoState.snapEnabled ? 'snap-on' : 'snap-off',
    ].join(':');
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    this.leftGroup.style.opacity = '0';
    window.setTimeout(() => {
      const fragment = document.createDocumentFragment();

      if (state.type === 'map-node') {
        fragment.appendChild(createActionButton('Pencil', () => this.options.onSelectTool('PAINT')));
        fragment.appendChild(createActionButton('Fill', () => window.dispatchEvent(new CustomEvent('editor:map-fill-request'))));
        fragment.appendChild(createActionButton('Eraser', () => this.options.onSelectTool('SELECT')));

        const info = document.createElement('div');
        info.style.cssText = 'margin-left:8px;font-size:11px;color:var(--suite-fg-2);letter-spacing:0.02em;';
        info.textContent = `Map node: ${state.label ?? state.nodeId}`;
        fragment.appendChild(info);
      } else {
        fragment.appendChild(createActionButton('Undo', () => this.options.onUndo()));
        fragment.appendChild(createActionButton('Redo', () => this.options.onRedo()));

        if (state.type === 'entity' || state.type === 'entities') {
          fragment.appendChild(createActionButton('Move', () => {
            this.options.onSetGizmoMode('translate');
            this.renderContext(this.options.selectionStore.getState());
          }));
          fragment.appendChild(createActionButton('Rotate', () => {
            this.options.onSetGizmoMode('rotate');
            this.renderContext(this.options.selectionStore.getState());
          }));
          fragment.appendChild(createActionButton('Scale', () => {
            this.options.onSetGizmoMode('scale');
            this.renderContext(this.options.selectionStore.getState());
          }));
          fragment.appendChild(createActionButton(
            gizmoState.orientation === 'world' ? 'World' : 'Local',
            () => {
              this.options.onToggleGizmoOrientation();
              this.renderContext(this.options.selectionStore.getState());
            },
          ));
          fragment.appendChild(createActionButton(
            gizmoState.snapEnabled ? 'Snap On' : 'Snap Off',
            () => {
              this.options.onToggleGizmoSnap();
              this.renderContext(this.options.selectionStore.getState());
            },
          ));
        }

        fragment.appendChild(createActionButton('Build World', () => this.options.onBuildWorld()));
        fragment.appendChild(createActionButton('Save', () => this.options.onSave()));
        fragment.appendChild(createActionButton('Export', () => this.options.onExport()));
        fragment.appendChild(createActionButton('Import', () => this.options.onImport()));

        const info = document.createElement('div');
        info.style.cssText = 'margin-left:8px;font-size:11px;color:var(--suite-fg-2);letter-spacing:0.02em;';
        info.textContent = state.type === 'entities'
          ? `Selection: ${state.selectedIds?.length ?? 0} entities`
          : `Selection: ${state.label ?? 'none'}`;
        fragment.appendChild(info);
      }

      this.leftGroup.replaceChildren(fragment);
      this.leftGroup.style.opacity = '1';
    }, 150);
  }
}
