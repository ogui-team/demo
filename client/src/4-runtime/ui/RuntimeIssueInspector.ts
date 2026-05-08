import { OGUI } from './OGUITheme';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';

export interface RuntimeIssueInspectorConfig {
  title?: string;
  hotkey?: string;
  getSnapshot: () => Record<string, unknown>;
}

export class RuntimeIssueInspector {
  private readonly title: string;
  private readonly hotkey: string;
  private readonly getSnapshot: RuntimeIssueInspectorConfig['getSnapshot'];
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly bodyEl: HTMLPreElement;
  private visible = false;
  private frozen = false;
  private snapshotText = '{}';
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private lastIssueUpdateTime = 0;

  constructor(config: RuntimeIssueInspectorConfig) {
    this.title = config.title ?? 'ISSUE INSPECTOR';
    this.hotkey = config.hotkey ?? 'F8';
    this.getSnapshot = config.getSnapshot;

    this.root = document.createElement('div');
    this.root.id = 'runtime-issue-inspector';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '50%',
      right: '20px',
      transform: 'translateY(-50%)',
      width: 'min(560px, 44vw)',
      maxWidth: '92vw',
      maxHeight: '78vh',
      display: 'none',
      flexDirection: 'column',
      zIndex: String(OGUI.zDialog + 5),
      background: OGUI.bgBase,
      border: `1px solid ${OGUI.border}`,
      boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
      pointerEvents: 'auto',
      fontFamily: OGUI.font,
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '10px 12px',
      borderBottom: `1px solid ${OGUI.borderDim}`,
      color: OGUI.textHead,
      fontSize: '12px',
      letterSpacing: '2px',
      fontWeight: 'bold',
    });

    const titleEl = document.createElement('div');
    titleEl.textContent = this.title;
    header.appendChild(titleEl);

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: OGUI.textSec,
      fontSize: '10px',
      letterSpacing: '1px',
      fontWeight: 'normal',
    });

    const freezeButton = this.createButton('FREEZE', () => {
      this.frozen = !this.frozen;
      freezeButton.textContent = this.frozen ? 'UNFREEZE' : 'FREEZE';
      this.setStatus(this.frozen ? 'Snapshot frozen' : 'Live updates resumed');
      if (!this.frozen) this.render();
    });
    const refreshButton = this.createButton('REFRESH', () => this.render());
    const copyButton = this.createButton('COPY', async () => {
      await this.copySnapshot();
    });
    const closeButton = this.createButton('CLOSE', () => this.hide());

    controls.appendChild(freezeButton);
    controls.appendChild(refreshButton);
    controls.appendChild(copyButton);
    controls.appendChild(closeButton);
    header.appendChild(controls);
    this.root.appendChild(header);

    this.statusEl = document.createElement('div');
    Object.assign(this.statusEl.style, {
      padding: '8px 12px',
      color: OGUI.textSec,
      fontSize: '10px',
      letterSpacing: '1px',
      borderBottom: `1px solid ${OGUI.borderDim}`,
      background: OGUI.bgPanel,
    });
    this.statusEl.textContent = `${this.hotkey} toggles panel`;
    this.root.appendChild(this.statusEl);

    this.bodyEl = document.createElement('pre');
    Object.assign(this.bodyEl.style, {
      margin: '0',
      padding: '12px',
      overflow: 'auto',
      color: OGUI.textPri,
      fontSize: '10px',
      lineHeight: '1.45',
      letterSpacing: '0.3px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      minHeight: '240px',
    });
    this.root.appendChild(this.bodyEl);

    document.body.appendChild(this.root);

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key !== this.hotkey) return;
      event.preventDefault();
      this.toggle();
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  update(): void {
    if (!this.visible || this.frozen) return;
    const mode = getRuntimePerformanceMode();
    if (mode === RuntimePerformanceMode.RELEASE) return;
    // Throttle JSON snapshot refresh to 1s in STABLE, 500ms in DEV
    const now = performance.now();
    const interval = mode === RuntimePerformanceMode.DEV ? 500 : 1000;
    if (now - this.lastIssueUpdateTime < interval) return;
    this.lastIssueUpdateTime = now;
    this.render();
  }

  destroy(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
    }
    this.root.remove();
  }

  getSnapshotText(): string {
    return this.snapshotText;
  }

  async copySnapshot(): Promise<void> {
    this.render();
    try {
      await navigator.clipboard.writeText(this.snapshotText);
      this.setStatus('Copied current snapshot to clipboard');
    } catch {
      this.setStatus('Clipboard write failed');
    }
  }

  private render(): void {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      ...this.getSnapshot(),
    };
    this.snapshotText = JSON.stringify(snapshot, null, 2);
    this.bodyEl.textContent = this.snapshotText;
    this.setStatus(`${this.hotkey} toggle • ${this.frozen ? 'frozen' : 'live'} • ${new Date().toLocaleTimeString()}`);
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  private createButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      padding: '5px 8px',
      background: OGUI.bgSelected,
      border: `1px solid ${OGUI.borderSel}`,
      color: OGUI.textWhite,
      cursor: 'pointer',
      fontFamily: OGUI.font,
      fontSize: '10px',
      letterSpacing: '1px',
    });
    button.addEventListener('click', () => {
      void onClick();
    });
    return button;
  }
}