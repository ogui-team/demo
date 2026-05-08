import type { MultiplayerDebugStats } from '../../3-network/network/MultiplayerClient';
import { OGUI } from './OGUITheme';

export class NetGraph {
  private static readonly STORAGE_KEY = 'ps1-engine.netgraph.visible';
  private root: HTMLDivElement;
  private visible = false;
  private statsProvider: () => MultiplayerDebugStats;

  constructor(statsProvider: () => MultiplayerDebugStats) {
    this.statsProvider = statsProvider;
    this.root = document.createElement('div');
    this.root.id = 'netgraph-overlay';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: String(OGUI.zNetGraph),
      pointerEvents: 'none',
      display: 'none',
      minWidth: '180px',
      background: OGUI.bgBase,
      border: `1px solid ${OGUI.border}`,
      color: OGUI.textPri,
      padding: '8px 10px',
      fontFamily: OGUI.font,
      fontSize: '10px',
      lineHeight: '1.45',
      letterSpacing: '1px',
    });
    document.body.appendChild(this.root);

    if (localStorage.getItem(NetGraph.STORAGE_KEY) === '1') {
      this.show();
    }
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'block';
    localStorage.setItem(NetGraph.STORAGE_KEY, '1');
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    localStorage.setItem(NetGraph.STORAGE_KEY, '0');
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(): void {
    if (!this.visible) return;
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  private render(): void {
    const stats = this.statsProvider();
    this.root.innerHTML = [
      `<div style="color:${OGUI.textHead};font-weight:bold;margin-bottom:4px;">NETGRAPH</div>`,
      `ping: ${stats.pingMs} ms`,
      `in: ${stats.packetsInPerSec} pkt/s`,
      `out: ${stats.packetsOutPerSec} pkt/s`,
      `lat sim: ${stats.latencySimulation}`,
      `interp: ${Math.max(0, Math.round(stats.interpolationDelayMs))} ms`,
    ].join('<br>');
  }
}
