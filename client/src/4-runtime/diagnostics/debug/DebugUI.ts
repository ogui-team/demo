import { ParameterRegistry, ParameterBinding } from './ParameterBinding';
import {
  getSystemDebugProperties,
  getSystemDebugValue,
  getSystemStateSnapshot,
  listSystems,
  setSystemDebugValue,
  type RegisteredSystem,
  type SystemDebugProperty,
} from '@engine/1-kernel/core/public-api';
import { OGUI } from '../../ui/OGUITheme';

const MANUAL_GROUP_SYSTEMS: Record<string, string[]> = {
  'Mode': ['modeManager'],
  'Gameplay Modes': ['gameModeManager'],
  'HUD & Overlay': ['hudSystem', 'debugOverlay'],
  'Network Diagnostics': ['multiplayerClient', 'networkSyncSystem', 'debugManager'],
  'Health Channels': ['healthSystem'],
  'PS1 Pipeline': ['renderingPipeline'],
  'Atmosphere': ['renderingPipeline'],
  'Fog': ['renderingPipeline'],
  'Camera': ['playController', 'editorController'],
  'Features': ['featureManager'],
  'Character': ['gameModeManager', 'healthSystem', 'hudSystem', 'playController', 'playerModelSystem'],
  'Match': ['gameModeManager'],
  'Map': ['saveLoadManager'],
  'Adaptive Runtime': ['adaptiveRuntime'],
  'Audio Manager': ['gameAudioManager'],
  'Rendering Diagnostics': ['cullingSystem', 'engineDiagnostics', 'debugManager'],
};

export class DebugUI {
  private overlay: HTMLDivElement | null = null;
  private listPane: HTMLDivElement | null = null;
  private inspectorPane: HTMLDivElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private registry: ParameterRegistry;
  private visible = false;
  private collapsedGroups = new Set<string>();
  private collapsedCategories = new Set<string>();
  private selectedSystemName: string | null = null;
  private searchQuery = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastValueSignatures = new Map<string, string>();

  constructor(registry: ParameterRegistry) {
    this.registry = registry;
    this.create();
  }

  private create(): void {
    this.overlay = document.createElement('div');
    this.overlay.id = 'debug-dashboard-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.62);
      z-index: ${OGUI.zDebug + 950};
      font-family: ${OGUI.font};
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      width: min(1180px, 94vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(20,20,20,0.98), rgba(10,10,10,0.98));
      border: 1px solid ${OGUI.border};
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.72);
      color: ${OGUI.textPri};
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid ${OGUI.borderDim};
      background: rgba(255, 255, 255, 0.02);
    `;

    const title = document.createElement('div');
    title.textContent = 'SYSTEM DASHBOARD';
    title.style.cssText = `
      flex: 0 0 auto;
      color: ${OGUI.textHead};
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 2px;
    `;
    header.appendChild(title);

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Filter systems';
    this.searchInput.style.cssText = `
      flex: 1 1 auto;
      min-width: 180px;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid ${OGUI.borderDim};
      color: ${OGUI.textPri};
      font: inherit;
      outline: none;
    `;
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput?.value.trim().toLowerCase() ?? '';
      this.render();
    });
    header.appendChild(this.searchInput);

    const badge = document.createElement('div');
    badge.textContent = 'F3';
    badge.style.cssText = `
      flex: 0 0 auto;
      padding: 4px 8px;
      border: 1px solid ${OGUI.borderDim};
      color: ${OGUI.textSec};
      font-size: 10px;
      letter-spacing: 1px;
    `;
    header.appendChild(badge);

    const body = document.createElement('div');
    body.style.cssText = `
      display: grid;
      grid-template-columns: minmax(260px, 30%) minmax(0, 1fr);
      min-height: 0;
      flex: 1 1 auto;
    `;

    this.listPane = document.createElement('div');
    this.listPane.style.cssText = `
      min-height: 0;
      overflow: auto;
      border-right: 1px solid ${OGUI.borderDim};
      background: rgba(255, 255, 255, 0.02);
    `;
    body.appendChild(this.listPane);

    this.inspectorPane = document.createElement('div');
    this.inspectorPane.style.cssText = `
      min-height: 0;
      overflow: auto;
      padding: 16px 18px 18px;
      background: rgba(0, 0, 0, 0.15);
    `;
    body.appendChild(this.inspectorPane);

    const footer = document.createElement('div');
    footer.textContent = 'Registry-driven inspector. Systems appear automatically when registered.';
    footer.style.cssText = `
      padding: 10px 18px;
      border-top: 1px solid ${OGUI.borderDim};
      color: ${OGUI.textDim};
      font-size: 10px;
      letter-spacing: 1px;
    `;

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  private getFilteredSystems(): RegisteredSystem[] {
    const systems = listSystems().sort((left, right) => {
      const leftCategory = left.metadata.category ?? 'Other';
      const rightCategory = right.metadata.category ?? 'Other';
      if (leftCategory !== rightCategory) return leftCategory.localeCompare(rightCategory);

      const leftOrder = left.metadata.order ?? 999;
      const rightOrder = right.metadata.order ?? 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftLabel = left.metadata.displayName ?? left.name;
      const rightLabel = right.metadata.displayName ?? right.name;
      return leftLabel.localeCompare(rightLabel);
    });

    if (!this.searchQuery) return systems;

    return systems.filter((entry) => {
      const haystack = [
        entry.name,
        entry.metadata.displayName ?? '',
        entry.metadata.category ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(this.searchQuery);
    });
  }

  private render(): void {
    if (!this.listPane || !this.inspectorPane) return;

    const systems = this.getFilteredSystems();
    if (!this.selectedSystemName || !systems.some((entry) => entry.name === this.selectedSystemName)) {
      this.selectedSystemName = systems[0]?.name ?? null;
    }

    this.renderSystemList(systems);
    this.renderInspector(systems.find((entry) => entry.name === this.selectedSystemName) ?? null);
  }

  private renderSystemList(systems: RegisteredSystem[]): void {
    if (!this.listPane) return;
    this.listPane.innerHTML = '';

    if (systems.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No systems match the current filter.';
      empty.style.cssText = `padding: 16px; color: ${OGUI.textDim}; font-size: 11px;`;
      this.listPane.appendChild(empty);
      return;
    }

    const grouped = new Map<string, RegisteredSystem[]>();
    for (const entry of systems) {
      const category = entry.metadata.category ?? 'Other';
      const bucket = grouped.get(category) ?? [];
      bucket.push(entry);
      grouped.set(category, bucket);
    }

    for (const [category, entries] of grouped.entries()) {
      const section = document.createElement('div');
      const collapsed = this.collapsedCategories.has(category);

      const header = document.createElement('button');
      header.type = 'button';
      header.textContent = `${collapsed ? 'â–¸' : 'â–¾'} ${category}`;
      header.style.cssText = `
        width: 100%;
        padding: 10px 14px;
        background: transparent;
        border: 0;
        border-bottom: 1px solid ${OGUI.borderDim};
        color: ${OGUI.textSec};
        text-align: left;
        font: inherit;
        font-size: 10px;
        letter-spacing: 1.5px;
        cursor: pointer;
      `;
      header.addEventListener('click', () => {
        if (collapsed) this.collapsedCategories.delete(category);
        else this.collapsedCategories.add(category);
        this.render();
      });
      section.appendChild(header);

      if (!collapsed) {
        for (const entry of entries) {
          const row = document.createElement('button');
          row.type = 'button';
          row.style.cssText = `
            width: 100%;
            padding: 10px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            background: ${entry.name === this.selectedSystemName ? OGUI.bgSelected : 'transparent'};
            border: 0;
            border-left: 3px solid ${entry.name === this.selectedSystemName ? OGUI.borderSel : 'transparent'};
            color: ${entry.name === this.selectedSystemName ? OGUI.textWhite : OGUI.textPri};
            cursor: pointer;
            text-align: left;
            font: inherit;
          `;
          row.addEventListener('click', () => {
            this.selectedSystemName = entry.name;
            this.render();
          });

          const label = document.createElement('div');
          label.innerHTML = `<div style="font-size:11px;">${this.escapeHtml(entry.metadata.displayName ?? entry.name)}</div><div style="font-size:10px;color:${OGUI.textDim};">${this.escapeHtml(entry.name)}</div>`;
          row.appendChild(label);

          const status = document.createElement('div');
          status.textContent = entry.status.toUpperCase();
          status.style.cssText = `
            flex: 0 0 auto;
            font-size: 9px;
            letter-spacing: 1px;
            color: ${entry.status === 'error' ? '#ff7b72' : entry.status === 'disabled' ? '#d29922' : '#56d364'};
          `;
          row.appendChild(status);

          section.appendChild(row);
        }
      }

      this.listPane.appendChild(section);
    }
  }

  private renderInspector(entry: RegisteredSystem | null): void {
    if (!this.inspectorPane) return;
    this.inspectorPane.innerHTML = '';

    if (!entry) {
      const empty = document.createElement('div');
      empty.textContent = 'Select a system to inspect.';
      empty.style.cssText = `color: ${OGUI.textDim}; font-size: 12px;`;
      this.inspectorPane.appendChild(empty);
      return;
    }

    const title = document.createElement('div');
    title.innerHTML = `
      <div style="font-size:16px;color:${OGUI.textHead};letter-spacing:1px;">${this.escapeHtml(entry.metadata.displayName ?? entry.name)}</div>
      <div style="margin-top:4px;font-size:11px;color:${OGUI.textDim};">${this.escapeHtml(entry.name)} Â· ${(entry.metadata.category ?? 'Other').toUpperCase()} Â· ${entry.status.toUpperCase()}</div>
    `;
    this.inspectorPane.appendChild(title);

    this.inspectorPane.appendChild(this.buildReadonlyGrid('Registry', {
      status: entry.status,
      registeredAt: new Date(entry.registeredAt).toLocaleTimeString(),
      lastUpdateAt: entry.lastUpdateAt > 0 ? new Date(entry.lastUpdateAt).toLocaleTimeString() : 'n/a',
      updateCount: entry.updateCount,
      lastError: entry.lastError ?? 'none',
    }, `${entry.name}:registry`));

    const properties = getSystemDebugProperties(entry.name);
    if (properties.length > 0) {
      const section = this.buildSection('Controls');
      for (const property of properties) {
        section.appendChild(this.buildSystemControl(entry.name, property));
      }
      this.inspectorPane.appendChild(section);
    }

    const customPanel = this.getSystemDebugPanel(entry);
    if (customPanel) {
      this.inspectorPane.appendChild(customPanel);
    }

    this.inspectorPane.appendChild(this.buildReadonlyGrid('State', getSystemStateSnapshot(entry.name), `${entry.name}:state`));

    const groups = this.getManualGroupsForSystem(entry.name);
    if (groups.length > 0) {
      const manualSection = this.buildSection('Panel Controls');
      for (const group of groups) {
        manualSection.appendChild(this.buildParameterGroup(group.name, group.parameters));
      }
      this.inspectorPane.appendChild(manualSection);
    }
  }

  private getManualGroupsForSystem(systemName: string) {
    return this.registry.getGroups().filter((group) => this.shouldShowManualGroup(group.name, systemName));
  }

  private shouldShowManualGroup(groupName: string, systemName: string): boolean {
    const owners = MANUAL_GROUP_SYSTEMS[groupName];
    if (!owners || owners.length === 0) {
      return systemName === 'debugManager';
    }
    return owners.includes(systemName);
  }

  private getSystemDebugPanel(entry: RegisteredSystem): HTMLElement | null {
    const provider = entry.system as { getDebugPanel?: (requestRefresh: () => void) => HTMLElement | null };
    if (typeof provider.getDebugPanel !== 'function') return null;
    return provider.getDebugPanel(() => this.render());
  }

  private buildSection(title: string): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = `margin-top: 18px; border: 1px solid ${OGUI.borderDim}; background: rgba(255,255,255,0.02);`;

    const header = document.createElement('div');
    header.textContent = title;
    header.style.cssText = `padding: 10px 12px; border-bottom: 1px solid ${OGUI.borderDim}; color: ${OGUI.textSec}; font-size: 10px; letter-spacing: 1.5px;`;
    section.appendChild(header);

    return section;
  }

  private buildReadonlyGrid(title: string, state: Record<string, unknown>, keyPrefix: string): HTMLDivElement {
    const section = this.buildSection(title);
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;';

    const entries = Object.entries(state).sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No state available.';
      empty.style.cssText = `padding: 12px; color: ${OGUI.textDim}; font-size: 11px;`;
      body.appendChild(empty);
    }

    for (const [key, value] of entries) {
      const row = document.createElement('div');
      row.style.cssText = `
        display: grid;
        grid-template-columns: minmax(140px, 220px) minmax(0, 1fr);
        gap: 12px;
        padding: 8px 12px;
        border-top: 1px solid rgba(255,255,255,0.03);
        background: ${this.didValueChange(`${keyPrefix}:${key}`, value) ? 'rgba(86, 211, 100, 0.12)' : 'transparent'};
      `;
      row.innerHTML = `
        <div style="color:${OGUI.textSec};font-size:11px;">${this.escapeHtml(key)}</div>
        <div style="color:${OGUI.textPri};font-size:11px;word-break:break-word;">${this.escapeHtml(this.formatValue(value))}</div>
      `;
      body.appendChild(row);
    }

    section.appendChild(body);
    return section;
  }

  private buildSystemControl(systemName: string, property: SystemDebugProperty): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.03);';

    const label = document.createElement('div');
    label.textContent = property.label ?? property.key;
    label.style.cssText = `color:${OGUI.textPri};font-size:11px;margin-bottom:6px;`;
    wrapper.appendChild(label);

    if (property.description) {
      const description = document.createElement('div');
      description.textContent = property.description;
      description.style.cssText = `color:${OGUI.textDim};font-size:10px;margin-bottom:8px;line-height:1.4;`;
      wrapper.appendChild(description);
    }

    const value = getSystemDebugValue(systemName, property.key);

    switch (property.type) {
      case 'boolean': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(value);
        input.style.cssText = 'width:16px;height:16px;accent-color:#56d364;';
        input.addEventListener('change', () => {
          setSystemDebugValue(systemName, property.key, input.checked);
          this.render();
        });
        wrapper.appendChild(input);
        break;
      }
      case 'number': {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;';

        if (typeof property.min === 'number' && typeof property.max === 'number') {
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(property.min);
          slider.max = String(property.max);
          slider.step = String(property.step ?? 0.01);
          slider.value = String(typeof value === 'number' ? value : Number(value ?? 0));
          slider.style.cssText = 'flex:1 1 auto;';

          const display = document.createElement('div');
          display.textContent = this.formatNumber(value);
          display.style.cssText = `min-width:64px;color:${OGUI.textSec};font-size:11px;text-align:right;`;

          slider.addEventListener('input', () => {
            const next = Number(slider.value);
            setSystemDebugValue(systemName, property.key, next);
            display.textContent = this.formatNumber(next);
          });

          row.appendChild(slider);
          row.appendChild(display);
        } else {
          const input = document.createElement('input');
          input.type = 'number';
          input.step = String(property.step ?? 0.01);
          input.value = String(typeof value === 'number' ? value : Number(value ?? 0));
          input.style.cssText = `padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};color:${OGUI.textPri};font:inherit;width:140px;`;
          input.addEventListener('change', () => {
            setSystemDebugValue(systemName, property.key, Number(input.value));
            this.render();
          });
          row.appendChild(input);
        }

        wrapper.appendChild(row);
        break;
      }
      case 'string': {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = String(value ?? '');
        input.style.cssText = `padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};color:${OGUI.textPri};font:inherit;width:100%;box-sizing:border-box;`;
        input.addEventListener('change', () => {
          setSystemDebugValue(systemName, property.key, input.value);
          this.render();
        });
        wrapper.appendChild(input);
        break;
      }
      case 'action': {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = property.label ?? property.key;
        button.style.cssText = `padding:8px 12px;background:${OGUI.bgSelected};border:1px solid ${OGUI.borderSel};color:${OGUI.textWhite};font:inherit;cursor:pointer;`;
        button.addEventListener('click', () => {
          setSystemDebugValue(systemName, property.key, true);
          this.render();
        });
        wrapper.appendChild(button);
        break;
      }
      case 'readonly':
      default: {
        const readonly = document.createElement('div');
        readonly.textContent = this.formatValue(value);
        readonly.style.cssText = `color:${OGUI.textPri};font-size:11px;word-break:break-word;`;
        wrapper.appendChild(readonly);
        break;
      }
    }

    return wrapper;
  }

  private buildParameterGroup(name: string, params: ParameterBinding[]): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.03);';
    const collapsed = this.collapsedGroups.has(name);

    const header = document.createElement('button');
    header.type = 'button';
    header.textContent = `${collapsed ? 'â–¸' : 'â–¾'} ${name}`;
    header.style.cssText = `
      width: 100%;
      padding: 10px 12px;
      background: transparent;
      border: 0;
      color: ${OGUI.textSec};
      text-align: left;
      font: inherit;
      cursor: pointer;
      font-size: 10px;
      letter-spacing: 1px;
    `;
    header.addEventListener('click', () => {
      if (collapsed) this.collapsedGroups.delete(name);
      else this.collapsedGroups.add(name);
      this.render();
    });
    section.appendChild(header);

    if (!collapsed) {
      const body = document.createElement('div');
      body.style.cssText = 'padding: 0 12px 10px;';
      for (const binding of params) {
        body.appendChild(this.buildLegacyControl(binding));
      }
      section.appendChild(body);
    }

    return section;
  }

  private buildLegacyControl(binding: ParameterBinding): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom: 8px;';

    if (binding.type === 'checkbox') {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;color:#bbb;font-size:11px;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(binding.get());
      input.addEventListener('change', () => binding.set?.(input.checked));
      row.appendChild(input);
      row.appendChild(document.createTextNode(binding.name));
      wrapper.appendChild(row);
      return wrapper;
    }

    const label = document.createElement('div');
    label.textContent = binding.name;
    label.style.cssText = `color:${OGUI.textDim};font-size:10px;margin-bottom:4px;`;
    wrapper.appendChild(label);

    if (binding.type === 'slider') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(binding.min ?? 0);
      input.max = String(binding.max ?? 100);
      input.step = String(binding.step ?? 0.01);
      input.value = String(binding.get());
      input.style.cssText = 'width:100%;';
      input.addEventListener('input', () => binding.set?.(Number(input.value)));
      wrapper.appendChild(input);
    } else if (binding.type === 'button') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = binding.name;
      button.style.cssText = `padding:7px 10px;background:${OGUI.bgSelected};border:1px solid ${OGUI.borderSel};color:${OGUI.textWhite};font:inherit;cursor:pointer;`;
      button.addEventListener('click', () => binding.set?.(1));
      wrapper.appendChild(button);
    } else if (binding.type === 'select') {
      const select = document.createElement('select');
      const options = binding.getOptions ? binding.getOptions() : (binding.options ?? []);
      for (const option of options) {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        if (option === binding.get()) node.selected = true;
        select.appendChild(node);
      }
      select.addEventListener('change', () => binding.set?.(select.value));
      wrapper.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.type = binding.type === 'color' ? 'color' : 'text';
      input.value = String(binding.get());
      input.style.cssText = `width:100%;box-sizing:border-box;padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};color:${OGUI.textPri};font:inherit;`;
      input.addEventListener('change', () => binding.set?.(input.value));
      wrapper.appendChild(input);
    }

    return wrapper;
  }

  private didValueChange(key: string, value: unknown): boolean {
    const next = this.createSignature(value);
    const previous = this.lastValueSignatures.get(key);
    this.lastValueSignatures.set(key, next);
    return previous !== undefined && previous !== next;
  }

  private createSignature(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }
    return String(value);
  }

  private formatNumber(value: unknown): string {
    const numeric = typeof value === 'number' ? value : Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric.toFixed(3) : '0.000';
  }

  private formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NaN';
    if (typeof value === 'boolean' || typeof value === 'string') return String(value);
    if (Array.isArray(value)) {
      return value.length === 0 ? '[]' : `[${value.length}] ${JSON.stringify(value).slice(0, 180)}`;
    }
    try {
      const json = JSON.stringify(value);
      return json.length > 220 ? `${json.slice(0, 217)}...` : json;
    } catch {
      return '[object]';
    }
  }

  private escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(() => {
      if (this.visible) this.render();
    }, 250);
  }

  private stopRefreshTimer(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    if (this.overlay) {
      this.overlay.style.display = 'flex';
      this.render();
      this.startRefreshTimer();
      this.searchInput?.focus();
    }
  }

  hide(): void {
    this.visible = false;
    this.stopRefreshTimer();
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  refresh(): void {
    if (this.visible) this.render();
  }

  destroy(): void {
    this.stopRefreshTimer();
    this.overlay?.remove();
  }
}

