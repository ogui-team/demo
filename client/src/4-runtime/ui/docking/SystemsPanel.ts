import * as Engine from '../../../0-foundation/foundation/Engine';
import { getSystemCapabilitiesSnapshot, getSystemStateSnapshot } from '@engine/1-kernel/core/public-api';

export class SystemsPanel {
  private readonly root: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly timer: number;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'height:100%',
      'display:flex',
      'flex-direction:column',
      'min-height:0',
      'padding:8px',
      'box-sizing:border-box',
      'gap:8px',
      'color:var(--suite-fg-0)',
      'font-size:12px',
    ].join(';');

    this.header = document.createElement('div');
    this.header.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'border-bottom:1px solid var(--suite-border-soft)',
      'padding-bottom:6px',
      'font-size:11px',
      'letter-spacing:0.06em',
      'text-transform:uppercase',
      'color:var(--suite-fg-2)',
    ].join(';');

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.textContent = 'Refresh';
    refreshButton.style.cssText = [
      'height:24px',
      'border:1px solid var(--suite-border)',
      'background:var(--suite-bg-2)',
      'color:var(--suite-fg-1)',
      'font-size:11px',
      'cursor:pointer',
      'padding:0 8px',
    ].join(';');
    refreshButton.addEventListener('click', () => this.render());

    this.list = document.createElement('div');
    this.list.style.cssText = [
      'flex:1 1 auto',
      'min-height:0',
      'overflow:auto',
      'display:grid',
      'grid-template-columns: minmax(180px, 2fr) minmax(80px, 0.8fr) minmax(90px, 0.8fr) minmax(260px, 2.4fr)',
      'gap:1px',
      'background:var(--suite-border-soft)',
      'border:1px solid var(--suite-border-soft)',
    ].join(';');

    this.header.append(document.createTextNode('Runtime Systems'), refreshButton);
    this.root.append(this.header, this.list);

    this.render();
    this.timer = window.setInterval(() => this.render(), 2000);
  }

  getElement(): HTMLElement {
    return this.root;
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.root.remove();
  }

  private render(): void {
    const registry = Engine.getSystemRegistry();
    if (!registry) {
      this.list.replaceChildren(this.createFullRow('System registry unavailable', 'n/a', 'n/a', 'No runtime registry is currently active.'));
      return;
    }

    const diagnostics = registry.getDiagnostics();
    const ids = registry.getSystemIds();
    const sorted = ids.slice().sort((a: string, b: string) => a.localeCompare(b));

    this.header.firstChild!.textContent = `Runtime Systems (${diagnostics.totalSystems})`;

    this.list.replaceChildren();

    const headName = this.createCell('System', true);
    const headPhase = this.createCell('Phase', true);
    const headStatus = this.createCell('Status', true);
    const headSummary = this.createCell('Summary', true);
    this.list.append(headName, headPhase, headStatus, headSummary);

    for (const id of sorted) {
      const phase = registry.getPhaseOwner(id) ?? 'core';
      const snapshot = getSystemStateSnapshot(id);
      const status = typeof snapshot.status === 'string' ? snapshot.status : 'active';
      const summary = this.summarizeSnapshot(id, snapshot);
      this.list.append(
        this.createCell(id, false),
        this.createCell(phase, false),
        this.createCell(status, false),
        this.createCell(summary, false),
      );
    }
  }

  private createFullRow(left: string, middle: string, right: string, summary: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'display:grid',
      'grid-template-columns:minmax(180px,2fr) minmax(80px,0.8fr) minmax(90px,0.8fr) minmax(260px,2.4fr)',
      'gap:1px',
      'background:var(--suite-border-soft)',
      'width:100%',
    ].join(';');
    wrapper.append(
      this.createCell(left, false),
      this.createCell(middle, false),
      this.createCell(right, false),
      this.createCell(summary, false),
    );
    return wrapper;
  }

  private summarizeSnapshot(id: string, snapshot: Record<string, unknown>): string {
    const debugState = this.asRecord(snapshot.debugState);
    const metrics = this.asRecord(debugState.metrics);
    const metricEntries = Object.entries(metrics)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 3)
      .map(([key, value]) => `${key}=${String(value)}`);
    if (metricEntries.length > 0) {
      return metricEntries.join(' • ');
    }

    const capabilities = getSystemCapabilitiesSnapshot(id);
    const capabilityEntries = Object.entries(capabilities)
      .filter(([, value]) => value === true)
      .slice(0, 3)
      .map(([key]) => key);
    if (capabilityEntries.length > 0) {
      return capabilityEntries.join(' • ');
    }

    if (typeof snapshot.lastError === 'string' && snapshot.lastError.length > 0) {
      return snapshot.lastError;
    }

    return 'No debug summary';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  }

  private createCell(text: string, head: boolean): HTMLDivElement {
    const cell = document.createElement('div');
    cell.textContent = text;
    cell.style.cssText = [
      'height:24px',
      'display:flex',
      'align-items:center',
      'padding:0 8px',
      'box-sizing:border-box',
      `background:${head ? 'var(--suite-bg-0)' : 'var(--suite-bg-1)'}`,
      `color:${head ? 'var(--suite-fg-1)' : 'var(--suite-fg-0)'}`,
      `font-size:${head ? '11px' : '12px'}`,
      'overflow:hidden',
      'text-overflow:ellipsis',
      'white-space:nowrap',
    ].join(';');
    return cell;
  }
}
