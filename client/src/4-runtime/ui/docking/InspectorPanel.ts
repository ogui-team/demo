import { EditorSelectionStore } from './EditorSelectionStore';
import { getGlobalSelectionStore } from './GlobalSelectionStore';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SpawnLibraryMetadata } from '../SpawnLibraryMetadata';

interface InspectorPanelOptions {
  selectionStore: EditorSelectionStore;
  toggleFeature: (feature: 'fog' | 'audio' | 'debugTools') => void;
  requestTool: (tool: 'SELECT' | 'PAINT' | 'WHITEBOX') => void;
  spawnPrefab: (prefabId: string) => void;
}

type InspectorSpawnEntry = SpawnLibraryMetadata;

export class InspectorPanel {
  private readonly root: HTMLDivElement;
  private readonly selectionLine: HTMLDivElement;
  private readonly componentSection: HTMLDivElement;
  private readonly spawnSearchInput: HTMLInputElement;
  private readonly spawnList: HTMLDivElement;
  private readonly destroyFns: Array<() => void> = [];
  private currentSelectionType: 'none' | 'map-node' | 'entity' | 'entities' = 'none';
  private lastEntitySelectionPayload: any = null;
  private spawnEntries: InspectorSpawnEntry[] = [];
  private selectionPullFrame: number | null = null;
  private lastSelectionVersion = -1;

  constructor(private readonly options: InspectorPanelOptions) {
    this.root = document.createElement('div');
    this.root.dataset.uiInteractive = 'true';
    this.root.style.cssText = [
      'height:100%',
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'padding:10px',
      'box-sizing:border-box',
      'overflow:auto',
      'font-size:12px',
      'color:var(--suite-fg-0)',
    ].join(';');

    this.selectionLine = document.createElement('div');
    this.selectionLine.style.cssText = 'font-size:12px;color:var(--suite-fg-1);';
    this.selectionLine.textContent = 'Selection: none';

    const toolSection = this.createSection('Tools');
    toolSection.append(
      this.createActionButton('Select', () => this.options.requestTool('SELECT')),
      this.createActionButton('Paint', () => this.options.requestTool('PAINT')),
      this.createActionButton('Whitebox', () => this.options.requestTool('WHITEBOX')),
    );

    const featureSection = this.createSection('World Toggles');
    featureSection.append(
      this.createActionButton('Toggle Fog', () => this.options.toggleFeature('fog')),
      this.createActionButton('Toggle Audio', () => this.options.toggleFeature('audio')),
      this.createActionButton('Toggle Debug Tools', () => this.options.toggleFeature('debugTools')),
    );

    const spawnSection = this.createSection('Spawn Library');
    this.spawnSearchInput = document.createElement('input');
    this.spawnSearchInput.type = 'text';
    this.spawnSearchInput.placeholder = 'Filter prefabs';
    this.spawnSearchInput.style.cssText = [
      'height:30px',
      'border:1px solid var(--suite-border)',
      'background:var(--suite-bg-0)',
      'color:var(--suite-fg-0)',
      'padding:0 8px',
      'outline:none',
    ].join(';');
    this.spawnSearchInput.dataset.uiInteractive = 'true';
    this.spawnSearchInput.addEventListener('input', () => {
      this.renderSpawnLibrary();
    });

    const spawnHint = document.createElement('div');
    spawnHint.textContent = 'Click to spawn at the default editor point, or drag into the viewport to place.';
    spawnHint.style.cssText = 'font-size:10px;color:var(--suite-fg-2);line-height:1.4;';

    this.spawnList = document.createElement('div');
    this.spawnList.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto;padding-right:2px;';
    this.spawnList.dataset.uiInteractive = 'true';

    spawnSection.append(this.spawnSearchInput, spawnHint, this.spawnList);

    this.componentSection = document.createElement('div');
    this.componentSection.style.cssText = 'padding:8px;';
    this.root.append(this.selectionLine, this.componentSection, toolSection, featureSection, spawnSection);

    const unsub = this.options.selectionStore.subscribe((state) => {
      const next = state.label ?? state.nodeId ?? 'none';
      this.selectionLine.textContent = `Selection: ${next}`;
      this.currentSelectionType = state.type;
      if (state.type === 'entity' && this.lastEntitySelectionPayload?.entityId === state.nodeId) {
        this.renderComponents(this.lastEntitySelectionPayload);
      } else if (state.type === 'entities') {
        this.renderMultiSelectionSummary(state.selectedIds ?? []);
      } else if (state.type === 'none') {
        this.componentSection.replaceChildren();
      }
    });
    this.destroyFns.push(unsub);

    this.destroyFns.push(gameBus.on('EDITOR_ENTITY_SELECTED', (payload) => {
      this.lastEntitySelectionPayload = payload;
      const selectionState = this.options.selectionStore.getState();
      if (selectionState.type !== 'entity' && selectionState.nodeId !== payload.entityId) return;
      this.renderComponents(payload);
    }));
    this.destroyFns.push(gameBus.on('EDITOR_ENTITY_DESELECTED', () => {
      this.lastEntitySelectionPayload = null;
      this.componentSection.replaceChildren();
    }));

    this.startSelectionPullLoop();
  }

  getElement(): HTMLElement {
    return this.root;
  }

  destroy(): void {
    if (this.selectionPullFrame !== null) {
      window.cancelAnimationFrame(this.selectionPullFrame);
      this.selectionPullFrame = null;
    }
    while (this.destroyFns.length > 0) {
      this.destroyFns.pop()?.();
    }
    this.root.remove();
  }

  setSpawnLibrary(entries: InspectorSpawnEntry[]): void {
    this.spawnEntries = [...entries];
    this.renderSpawnLibrary();
  }

  private createSection(label: string): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding-top:4px',
      'border-top:1px solid var(--suite-border-soft)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = label;
    title.style.cssText = [
      'font-size:10px',
      'letter-spacing:0.08em',
      'text-transform:uppercase',
      'color:var(--suite-fg-2)',
    ].join(';');

    section.appendChild(title);
    return section;
  }

  private createActionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = [
      'height:28px',
      'border:1px solid var(--suite-border)',
      'background:var(--suite-bg-2)',
      'color:var(--suite-fg-0)',
      'text-align:left',
      'padding:0 8px',
      'cursor:pointer',
      'font-size:12px',
    ].join(';');
    button.addEventListener('click', onClick);
    return button;
  }

  private dispatchSpawnLibraryDragEvent(
    eventName: 'editor:spawn-library-drag-start' | 'editor:spawn-library-drag-end',
    prefabId: string,
  ): void {
    const detail = { prefabId, timestamp: Date.now() };
    const dockRoot = typeof document !== 'undefined'
      ? document.querySelector('.editor-dock-layout') as HTMLElement | null
      : null;

    if (dockRoot) {
      dockRoot.dispatchEvent(new CustomEvent(eventName, {
        detail,
        bubbles: true,
      }));
    }

    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  private renderSpawnLibrary(): void {
    this.spawnList.replaceChildren();
    const query = this.spawnSearchInput.value.trim().toLowerCase();
    const entries = this.spawnEntries.filter((entry) => {
      if (query.length === 0) return true;
      return [entry.label, entry.id, entry.category, entry.description ?? '']
        .some((value) => value.toLowerCase().includes(query));
    });

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No prefab matches the current filter.';
      empty.style.cssText = 'font-size:11px;color:var(--suite-fg-2);padding:4px 0;';
      this.spawnList.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.draggable = true;
      button.dataset.uiInteractive = 'true';
      button.style.cssText = [
        'display:flex',
        'align-items:flex-start',
        'gap:8px',
        'padding:8px',
        'border:1px solid var(--suite-border)',
        'background:var(--suite-bg-1)',
        'color:var(--suite-fg-0)',
        'text-align:left',
        'cursor:grab',
      ].join(';');
      button.addEventListener('click', () => this.options.spawnPrefab(entry.id));
      button.addEventListener('dragstart', (event) => {
        this.dispatchSpawnLibraryDragEvent('editor:spawn-library-drag-start', entry.id);
        event.dataTransfer?.setData('EDITOR_SPAWN_PREFAB', entry.id);
        event.dataTransfer?.setData('application/x-editor-prefab', entry.id);
        event.dataTransfer?.setData('text/plain', entry.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'copy';
        }
      });
      button.addEventListener('dragend', () => {
        this.dispatchSpawnLibraryDragEvent('editor:spawn-library-drag-end', entry.id);
      });

      const glyph = document.createElement('div');
      glyph.textContent = entry.glyph ?? '◼';
      glyph.style.cssText = `width:20px;font-size:14px;color:${entry.accentColor ?? 'var(--suite-fg-1)'};line-height:1.2;flex:0 0 auto;`;

      const meta = document.createElement('div');
      meta.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0;';

      const title = document.createElement('div');
      title.textContent = entry.label;
      title.style.cssText = 'font-size:12px;color:var(--suite-fg-0);';

      const subtitle = document.createElement('div');
      subtitle.textContent = `${entry.category} · ${entry.id}`;
      subtitle.style.cssText = 'font-size:10px;color:var(--suite-fg-2);';

      meta.append(title, subtitle);
      if (entry.description) {
        const description = document.createElement('div');
        description.textContent = entry.description;
        description.style.cssText = 'font-size:10px;color:var(--suite-fg-2);line-height:1.35;';
        meta.appendChild(description);
      }

      button.append(glyph, meta);
      this.spawnList.appendChild(button);
    }
  }

  private startSelectionPullLoop(): void {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }

    const tick = () => {
      const snapshot = getGlobalSelectionStore().getSnapshot();
      if (snapshot.version !== this.lastSelectionVersion) {
        this.lastSelectionVersion = snapshot.version;
        this.pullSelectionSnapshot(snapshot);
      }
      this.selectionPullFrame = window.requestAnimationFrame(tick);
    };

    this.selectionPullFrame = window.requestAnimationFrame(tick);
  }

  private pullSelectionSnapshot(snapshot: { selectedId: string | null; payload: unknown | null }): void {
    const selectionState = this.options.selectionStore.getState();
    if (!snapshot.selectedId) {
      if (selectionState.type === 'none') {
        this.lastEntitySelectionPayload = null;
        this.componentSection.replaceChildren();
      }
      return;
    }

    if (selectionState.type !== 'entity' || selectionState.nodeId !== snapshot.selectedId) {
      return;
    }

    if (!snapshot.payload) {
      return;
    }

    this.lastEntitySelectionPayload = snapshot.payload;
    this.renderComponents(snapshot.payload as any);
  }

  private renderComponents(payload: any): void {
    this.componentSection.replaceChildren();

    const typeLabel = document.createElement('div');
    typeLabel.textContent = `Type: ${payload.entityType}`;
    typeLabel.style.cssText = 'font-size:11px;color:var(--suite-fg-2);padding:4px 0;';
    this.componentSection.appendChild(typeLabel);

    if (payload.transform) {
      this.componentSection.appendChild(this.renderTransformSection(payload.entityId, payload.transform));
    }

    for (const component of payload.components ?? []) {
      this.componentSection.appendChild(this.renderComponentSection(payload.entityId, component));
    }
  }

  private renderMultiSelectionSummary(selectedIds: string[]): void {
    this.componentSection.replaceChildren();

    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--suite-fg-2);';

    const title = document.createElement('div');
    title.textContent = `${selectedIds.length} entities selected`;
    title.style.cssText = 'font-size:12px;color:var(--suite-fg-0);';

    const hint = document.createElement('div');
    hint.textContent = 'Use the gizmo to move the current selection as a group.';

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    for (const entityId of selectedIds.slice(0, 12)) {
      const badge = document.createElement('span');
      badge.textContent = entityId;
      badge.style.cssText = 'padding:3px 6px;border:1px solid var(--suite-border);background:var(--suite-bg-0);color:var(--suite-fg-1);';
      list.appendChild(badge);
    }

    summary.append(title, hint, list);
    this.componentSection.appendChild(summary);
  }

  private renderTransformSection(entityId: string, transform: any): HTMLElement {
    const section = this.createSection('Transform');

    for (const axis of ['x', 'y', 'z'] as const) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';

      const label = document.createElement('span');
      label.textContent = `pos.${axis}`;
      label.style.cssText = 'font-size:11px;color:var(--suite-fg-2);width:50px;';

      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(transform.position[axis]?.toFixed?.(3) ?? transform.position[axis] ?? 0);
      input.step = '0.1';
      input.style.cssText = 'width:80px;height:22px;background:var(--suite-bg-0);border:1px solid var(--suite-border);color:var(--suite-fg-0);padding:0 4px;';

      input.addEventListener('change', () => {
        gameBus.emit('EDITOR_UPDATE_COMPONENT', {
          entityId,
          componentName: 'transform',
          path: ['position', axis],
          value: parseFloat(input.value),
          source: 'editor_inspector',
          timestamp: Date.now(),
        });
      });

      row.append(label, input);
      section.appendChild(row);
    }

    return section;
  }

  private renderComponentSection(entityId: string, component: { name: string; data: any }): HTMLElement {
    const section = this.createSection(component.name);
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(component.data, null, 2);
    pre.style.cssText = 'font-size:10px;color:var(--suite-fg-2);overflow:auto;max-height:120px;margin:0;';
    section.appendChild(pre);
    return section;
  }
}
