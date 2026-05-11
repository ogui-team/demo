import type { GamePlugin, PluginInitContext } from '@shared/contracts';
import { OGUI } from '../ui/OGUITheme';

type SnapshotValue =
  | string
  | number
  | boolean
  | null
  | SnapshotValue[]
  | { [key: string]: SnapshotValue };

type HUDLike = {
  showNotification?: (text: string, durationSeconds?: number) => void;
};

type InspectorSummary = {
  visible: boolean;
  selectedSystem: string | null;
  systemCount: number;
};

export class DODInspectorPlugin implements GamePlugin {
  readonly id = 'dod-inspector-plugin';
  readonly name = 'DOD Inspector Plugin';
  readonly version = '0.3.0';
  readonly description = 'Read-only runtime inspector for DOD system buffers and state snapshots.';

  private context: PluginInitContext | null = null;
  private root: HTMLDivElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private snapshotEl: HTMLPreElement | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private selectedSystem: string | null = null;
  private visible = false;

  init(context: PluginInitContext): void {
    this.context = context;

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      context.logger.warn('[DODInspectorPlugin] DOM unavailable, inspector UI disabled');
      return;
    }

    const ui2DSystem = context.systemRegistry.getSystem('ui2DSystem');
    if (!ui2DSystem) {
      context.logger.warn('[DODInspectorPlugin] ui2DSystem not available; inspector requires Phase 5 UI runtime');
      return;
    }

    this.buildUi();
    this.startRefreshLoop();
    this.installHotkey();
    this.refreshSystemList();

    context.logger.log('[DODInspectorPlugin] Initialized (read-only mode)');
  }

  getDebugState(): InspectorSummary {
    return {
      visible: this.visible,
      selectedSystem: this.selectedSystem,
      systemCount: this.context?.systemRegistry.listSystems().length ?? 0,
    };
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.keyHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    if (this.root) {
      this.root.remove();
      this.root = null;
    }

    this.listEl = null;
    this.snapshotEl = null;
    this.selectedSystem = null;
    this.visible = false;
    this.context = null;
  }

  private buildUi(): void {
    const root = document.createElement('div');
    root.id = 'dod-inspector-overlay';
    Object.assign(root.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      width: 'min(860px, 96vw)',
      maxHeight: '48vh',
      display: 'none',
      gridTemplateColumns: '280px 1fr',
      overflow: 'hidden',
      zIndex: String(OGUI.zDebug + 40),
      border: `1px solid ${OGUI.border}`,
      background: OGUI.bgBase,
      boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
      color: OGUI.textPri,
      fontFamily: OGUI.font,
      fontSize: '11px',
      letterSpacing: '0.6px',
      pointerEvents: 'auto',
    });

    const listPane = document.createElement('div');
    Object.assign(listPane.style, {
      borderRight: `1px solid ${OGUI.borderDim}`,
      background: 'rgba(255,255,255,0.02)',
      overflowY: 'auto',
      minHeight: '240px',
      maxHeight: '48vh',
    });

    const snapshotPane = document.createElement('div');
    Object.assign(snapshotPane.style, {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '240px',
      maxHeight: '48vh',
      overflow: 'hidden',
    });

    const title = document.createElement('div');
    title.textContent = 'DOD INSPECTOR [F4]';
    Object.assign(title.style, {
      padding: '8px 10px',
      color: OGUI.textHead,
      borderBottom: `1px solid ${OGUI.borderDim}`,
      fontWeight: 'bold',
      letterSpacing: '2px',
    });
    listPane.appendChild(title);

    this.listEl = document.createElement('div');
    Object.assign(this.listEl.style, {
      padding: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    });
    listPane.appendChild(this.listEl);

    const snapshotTitle = document.createElement('div');
    snapshotTitle.textContent = 'BUFFER SNAPSHOT';
    Object.assign(snapshotTitle.style, {
      padding: '8px 10px',
      color: OGUI.textHead,
      borderBottom: `1px solid ${OGUI.borderDim}`,
      fontWeight: 'bold',
      letterSpacing: '2px',
    });
    snapshotPane.appendChild(snapshotTitle);

    this.snapshotEl = document.createElement('pre');
    this.snapshotEl.textContent = 'Select a system from the list to inspect its DOD buffer/state snapshot.';
    Object.assign(this.snapshotEl.style, {
      margin: '0',
      padding: '10px',
      overflow: 'auto',
      flex: '1 1 auto',
      color: OGUI.textPri,
      fontFamily: 'Consolas, Courier New, monospace',
      fontSize: '11px',
      lineHeight: '1.35',
      background: 'rgba(0,0,0,0.2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
    snapshotPane.appendChild(this.snapshotEl);

    root.appendChild(listPane);
    root.appendChild(snapshotPane);
    document.body.appendChild(root);
    this.root = root;
  }

  private installHotkey(): void {
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key !== 'F4') {
        return;
      }

      event.preventDefault();
      this.setVisible(!this.visible);
    };

    window.addEventListener('keydown', this.keyHandler);
  }

  private startRefreshLoop(): void {
    this.refreshTimer = setInterval(() => {
      this.refreshSystemList();
      if (this.selectedSystem) {
        this.renderSnapshot(this.selectedSystem);
      }
    }, 500);
  }

  private setVisible(nextVisible: boolean): void {
    this.visible = nextVisible;
    if (this.root) {
      this.root.style.display = this.visible ? 'grid' : 'none';
    }
  }

  private refreshSystemList(): void {
    const context = this.context;
    const listEl = this.listEl;

    if (!context || !listEl) {
      return;
    }

    const systemIds = context.systemRegistry.listSystems().slice().sort((a, b) => a.localeCompare(b));
    const existingSelection = this.selectedSystem && systemIds.includes(this.selectedSystem)
      ? this.selectedSystem
      : systemIds[0] ?? null;

    if (existingSelection !== this.selectedSystem) {
      this.selectedSystem = existingSelection;
    }

    listEl.innerHTML = '';
    for (const systemId of systemIds) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = systemId;
      button.addEventListener('click', () => {
        this.selectedSystem = systemId;
        this.renderSnapshot(systemId);
      });

      Object.assign(button.style, {
        textAlign: 'left',
        width: '100%',
        border: `1px solid ${systemId === this.selectedSystem ? OGUI.textHead : OGUI.borderDim}`,
        background: systemId === this.selectedSystem ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.25)',
        color: OGUI.textPri,
        padding: '6px 7px',
        cursor: 'pointer',
        fontFamily: OGUI.font,
        fontSize: '10px',
        letterSpacing: '0.8px',
      });

      listEl.appendChild(button);
    }

    if (this.selectedSystem) {
      this.renderSnapshot(this.selectedSystem);
    }
  }

  private renderSnapshot(systemId: string): void {
    const context = this.context;
    if (!context || !this.snapshotEl) {
      return;
    }

    const system = context.systemRegistry.getSystem(systemId);
    if (!system) {
      this.snapshotEl.textContent = `System "${systemId}" is no longer available.`;
      return;
    }

    const snapshot = this.createSystemSnapshot(systemId, system);
    const formatted = JSON.stringify(snapshot, null, 2);
    this.snapshotEl.textContent = formatted;

    const hud = context.systemRegistry.getSystem('hud') as HUDLike | undefined;
    hud?.showNotification?.(`DOD Snapshot: ${systemId}`, 1.5);
  }

  private createSystemSnapshot(systemId: string, system: unknown): SnapshotValue {
    const target = system as Record<string, unknown>;
    const snapshot: Record<string, SnapshotValue> = {
      systemId,
      capturedAt: new Date().toISOString(),
      type: this.getTag(system),
    };

    if (target && typeof target === 'object') {
      const maybeGetDebugState = target['getDebugState'];
      if (typeof maybeGetDebugState === 'function') {
        snapshot.debugState = this.toSnapshotValue(
          this.safeCall(() => (maybeGetDebugState as () => unknown)()),
          0,
          new WeakSet<object>(),
        );
      }

      const maybeExportState = target['exportState'];
      if (typeof maybeExportState === 'function') {
        snapshot.exportState = this.toSnapshotValue(
          this.safeCall(() => (maybeExportState as () => unknown)()),
          0,
          new WeakSet<object>(),
        );
      }

      snapshot.buffers = this.pickInterestingFields(target);
    }

    return snapshot;
  }

  private pickInterestingFields(source: Record<string, unknown>): SnapshotValue {
    const keys = Object.keys(source);
    const preferred = keys.filter((key) => /(buffer|state|cache|queue|pool|map|list|metrics|snapshot|data)/i.test(key));
    const selected = (preferred.length > 0 ? preferred : keys).slice(0, 20);

    const out: Record<string, SnapshotValue> = {};
    const seen = new WeakSet<object>();
    for (const key of selected) {
      out[key] = this.toSnapshotValue(source[key], 0, seen);
    }

    return out;
  }

  private safeCall<T>(fn: () => T): T | string {
    try {
      return fn();
    } catch (err) {
      return `[error: ${String(err)}]`;
    }
  }

  private toSnapshotValue(value: unknown, depth: number, seen: WeakSet<object>): SnapshotValue {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'function') {
      return `[function ${(value as Function).name || 'anonymous'}]`;
    }

    if (depth >= 3) {
      return `[max-depth ${this.getTag(value)}]`;
    }

    if (ArrayBuffer.isView(value)) {
      const typed = value as unknown as ArrayLike<number>;
      return {
        type: this.getTag(value),
        length: typed.length ?? 0,
        sample: Array.from(typed).slice(0, 24),
      };
    }

    if (value instanceof Map) {
      const mapOut: Record<string, SnapshotValue> = {};
      let index = 0;
      for (const [k, v] of value.entries()) {
        if (index >= 16) break;
        mapOut[String(k)] = this.toSnapshotValue(v, depth + 1, seen);
        index += 1;
      }
      return {
        type: 'Map',
        size: value.size,
        entries: mapOut,
      };
    }

    if (value instanceof Set) {
      return {
        type: 'Set',
        size: value.size,
        entries: Array.from(value.values()).slice(0, 16).map((entry) => this.toSnapshotValue(entry, depth + 1, seen)),
      };
    }

    if (Array.isArray(value)) {
      return value.slice(0, 24).map((item) => this.toSnapshotValue(item, depth + 1, seen));
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (seen.has(obj)) {
        return '[circular]';
      }
      seen.add(obj);

      const out: Record<string, SnapshotValue> = {};
      const keys = Object.keys(obj).slice(0, 20);
      for (const key of keys) {
        out[key] = this.toSnapshotValue(obj[key], depth + 1, seen);
      }
      return out;
    }

    return String(value);
  }

  private getTag(value: unknown): string {
    return Object.prototype.toString.call(value).slice(8, -1);
  }
}