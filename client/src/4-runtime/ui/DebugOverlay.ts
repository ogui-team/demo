import { getContext } from '@engine/1-kernel/core/public-api';
import type { EngineStats } from '@engine/1-kernel/core/public-api';
import { getRecentEvents } from '@engine/1-kernel/core/public-api';
import { listSystems } from '@engine/1-kernel/core/public-api';
import { OGUI } from './OGUITheme';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';
import type { ControlTowerState } from '../runtime/ControlTower';

export interface DebugOverlayConfig {
  diagnostics: { getDiagnostics(): EngineStats };
  getEngineState: () => string;
  getPointerLock: () => boolean;
  getSelectedEntity: () => string | null;
  getControlTowerSnapshot?: () => ControlTowerState | null;
}

export class DebugOverlay {
  private static readonly STORAGE_KEY = 'ps1-engine.debugOverlay.visible';
  private root: HTMLDivElement;
  private visible = false;
  private diagnostics: DebugOverlayConfig['diagnostics'];
  private getEngineState: DebugOverlayConfig['getEngineState'];
  private getPointerLock: DebugOverlayConfig['getPointerLock'];
  private getSelectedEntity: DebugOverlayConfig['getSelectedEntity'];
  private getControlTowerSnapshot: DebugOverlayConfig['getControlTowerSnapshot'] | null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private overlayUpdateAccumulator = 0;
  private lastOverlayUpdateTime = 0;

  constructor(config: DebugOverlayConfig) {
    this.diagnostics = config.diagnostics;
    this.getEngineState = config.getEngineState;
    this.getPointerLock = config.getPointerLock;
    this.getSelectedEntity = config.getSelectedEntity;
    this.getControlTowerSnapshot = config.getControlTowerSnapshot ?? null;

    this.root = document.createElement('div');
    this.root.id = 'debug-overlay';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      zIndex: String(OGUI.zDebug),
      display: 'none',
      width: 'min(960px, 94vw)',
      maxHeight: '82vh',
      overflow: 'auto',
      pointerEvents: 'none',
      background: OGUI.bgBase,
      border: `1px solid ${OGUI.border}`,
      color: OGUI.textPri,
      padding: '8px 10px',
      fontFamily: OGUI.font,
      fontSize: '10px',
      lineHeight: '1.45',
      letterSpacing: '1px',
      whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(this.root);

    if (localStorage.getItem(DebugOverlay.STORAGE_KEY) === '1') {
      this.show();
    }

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'block';
    localStorage.setItem(DebugOverlay.STORAGE_KEY, '1');
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    localStorage.setItem(DebugOverlay.STORAGE_KEY, '0');
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(): void {
    if (!this.visible) return;
    const mode = getRuntimePerformanceMode();
    if (mode === RuntimePerformanceMode.RELEASE) return;
    const now = performance.now();
    const interval = mode === RuntimePerformanceMode.DEV ? 250 : 500;
    if (now - this.lastOverlayUpdateTime < interval) return;
    this.lastOverlayUpdateTime = now;
    this.render();
  }

  destroy(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
    }
    this.root.remove();
  }

  private render(): void {
    const stats = this.diagnostics.getDiagnostics();
    const systems = listSystems()
      .map((entry) => `${entry.name}:${entry.status}`)
      .slice(0, 10)
      .join(', ');
    const events = getRecentEvents(10)
      .map((entry) => `${new Date(entry.timestamp).toLocaleTimeString()} [${entry.type}] ${entry.message}`)
      .join('\n');
    const controlTower = this.getControlTowerSnapshot?.() ?? null;

    if (!controlTower) {
      this.root.textContent = [
        'DEBUG OVERLAY',
        `state: ${this.getEngineState()}`,
        `context: ${getContext()}`,
        `pointer lock: ${this.getPointerLock() ? 'locked' : 'unlocked'}`,
        `selected: ${this.getSelectedEntity() ?? 'none'}`,
        `fps: ${stats.fps}`,
        `frame: ${stats.frameTimeMs.toFixed(2)} ms`,
        `memory: ${stats.memoryUsageMB ?? 'n/a'} MB`,
        `entities: ${stats.entityCount}`,
        `draw calls: ${stats.drawCalls}`,
        `systems: ${stats.activeSystems.join(', ') || 'none'}`,
        `registry: ${systems || 'none'}`,
        '',
        'events:',
        events || 'none',
      ].join('\n');
      return;
    }

    const localPlayer = controlTower.players.find((player) => player.animationState.source === 'local') ?? null;
    const movementRows = this.renderRows([
      ['Local player', localPlayer?.id ?? 'none'],
      ['Client pos', this.formatVector(localPlayer?.clientPosition ?? null)],
      ['Server pos', this.formatVector(localPlayer?.serverPosition ?? null)],
      ['Velocity', this.formatVector(localPlayer?.velocity ?? null)],
      ['Intent', localPlayer?.movementIntent ? this.formatMovementIntent(localPlayer.movementIntent) : 'none'],
      ['Status', this.formatStatusModifier(localPlayer?.statusModifier ?? null)],
      ['Animation', localPlayer ? `${localPlayer.animationState.crouching ? 'crouch' : 'stand'} / ${localPlayer.animationState.airborne ? 'air' : 'ground'}` : 'none'],
      ['Desync', localPlayer ? `${localPlayer.desyncDelta.toFixed(3)}` : '0.000'],
    ]);

    const replicationRows = this.renderRows([
      ['Snapshot rate', `${controlTower.replication.snapshotRate}/s`],
      ['Packet in/out', `${controlTower.replication.packetIn} / ${controlTower.replication.packetOut}`],
      ['Snapshot age', controlTower.replication.snapshotAgeMs === null ? 'n/a' : `${Math.round(controlTower.replication.snapshotAgeMs)} ms`],
      ['Desync delta', controlTower.replication.desyncDelta.toFixed(3)],
      ['Ack seq', controlTower.replication.ackInputSeq === null ? 'n/a' : String(controlTower.replication.ackInputSeq)],
      ['Applied tick', controlTower.replication.lastAppliedSnapshotTick === null ? 'n/a' : String(controlTower.replication.lastAppliedSnapshotTick)],
    ]);

    const abilityRows = this.renderRows([
      ['Status state', controlTower.systems.status],
      ['Active systems', String(controlTower.systems.activeCount)],
      ['Degraded systems', String(controlTower.systems.degradedCount)],
      ['Recovering systems', String(controlTower.systems.recoveringCount)],
      ['Top system', controlTower.systems.entries[0] ? `${controlTower.systems.entries[0].id}:${controlTower.systems.entries[0].status}` : 'none'],
      ['Insights', controlTower.insights.map((insight) => insight.message).slice(0, 2).join(' | ') || 'none'],
    ]);

    const animationRows = this.renderRows([
      ['Tracked players', String(controlTower.players.length)],
      ['Local animation', localPlayer ? `${localPlayer.animationState.source}:${localPlayer.animationState.crouching ? 'crouch' : 'stand'}:${localPlayer.animationState.airborne ? 'air' : 'ground'}` : 'none'],
      ['Mismatches', controlTower.insights.some((insight) => insight.id === 'animation-mismatch') ? 'detected' : 'none'],
      ['Jump override', controlTower.insights.some((insight) => insight.id === 'jump-overridden') ? 'detected' : 'none'],
    ]);

    const entityRows = this.renderRows([
      ['Active entities', String(controlTower.entities.active)],
      ['Tracked entities', String(controlTower.entities.tracked)],
      ['World objects', String(controlTower.entities.worldObjects)],
      ['Physics bodies', String(controlTower.entities.physicsBodies)],
      ['Orphan candidates', String(controlTower.entities.orphanCandidates)],
    ]);

    const playerLines = controlTower.players.slice(0, 4).map((player) => `${player.id} | c:${this.formatVector(player.clientPosition)} s:${this.formatVector(player.serverPosition)} v:${this.formatVector(player.velocity)} d:${player.desyncDelta.toFixed(2)} | ${player.animationState.source}:${player.animationState.crouching ? 'crouch' : 'stand'}:${player.animationState.airborne ? 'air' : 'ground'}`);

    const insightLines = controlTower.insights.map((insight) => `${insight.severity.toUpperCase()} ${insight.source}: ${insight.message}`);

    this.root.innerHTML = [
      `<div style="display:flex;flex-direction:column;gap:8px;">`,
      this.renderHeader(stats, systems, controlTower.systems.status),
      this.renderPanel('Movement Truth', movementRows),
      this.renderPanel('Replication Health', replicationRows),
      this.renderPanel('Ability / Status Layer', abilityRows),
      this.renderPanel('Animation State', animationRows),
      this.renderPanel('Entity Integrity', entityRows),
      this.renderPanel('Players', this.renderLines(playerLines)),
      this.renderPanel('Derived Insights', this.renderLines(insightLines)),
      events ? this.renderPanel('Recent Events', this.renderLines(events.split('\n'))) : '',
      `</div>`,
    ].join('');
  }

  private renderHeader(stats: EngineStats, systems: string, towerStatus: string): string {
    return [
      '<section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">',
      this.renderStatCard('CONTROL TOWER', [
        ['state', this.getEngineState()],
        ['context', getContext()],
        ['pointer', this.getPointerLock() ? 'locked' : 'unlocked'],
        ['selected', this.getSelectedEntity() ?? 'none'],
      ]),
      this.renderStatCard('ENGINE', [
        ['fps', String(stats.fps)],
        ['frame', `${stats.frameTimeMs.toFixed(2)} ms`],
        ['entities', String(stats.entityCount)],
        ['draw', String(stats.drawCalls)],
      ]),
      this.renderStatCard('SYSTEMS', [
        ['tower', towerStatus],
        ['active', stats.activeSystems.join(', ') || 'none'],
        ['registry', systems || 'none'],
      ]),
      '</section>',
    ].join('');
  }

  private renderPanel(title: string, body: string): string {
    return `
      <section style="border:1px solid ${OGUI.borderDim};background:${OGUI.bgPanel};padding:8px 10px;">
        <div style="margin-bottom:6px;color:${OGUI.textHead};font-size:11px;letter-spacing:1.5px;font-weight:bold;">${this.escapeHtml(title)}</div>
        <div style="color:${OGUI.textPri};font-size:10px;line-height:1.45;white-space:pre-wrap;word-break:break-word;">${this.escapeHtml(body)}</div>
      </section>
    `;
  }

  private renderStatCard(title: string, rows: Array<[string, string]>): string {
    return `
      <div style="border:1px solid ${OGUI.border};background:${OGUI.bgBase};padding:8px 10px;min-width:0;">
        <div style="color:${OGUI.textHead};font-size:10px;letter-spacing:1.5px;font-weight:bold;margin-bottom:6px;">${this.escapeHtml(title)}</div>
        <div style="display:grid;grid-template-columns:max-content 1fr;gap:2px 8px;color:${OGUI.textPri};font-size:10px;line-height:1.4;">
          ${rows.map(([label, value]) => `<div style="color:${OGUI.textSec};">${this.escapeHtml(label)}</div><div style="min-width:0;word-break:break-word;">${this.escapeHtml(value)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  private renderRows(rows: Array<[string, string]>): string {
    return rows.map(([label, value]) => `${label}: ${value}`).join('\n');
  }

  private renderLines(lines: string[]): string {
    return lines.length > 0 ? lines.join('\n') : 'none';
  }

  private formatVector(value: { x: number; y: number; z: number } | null): string {
    if (!value) return 'n/a';
    return `(${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)})`;
  }

  private formatMovementIntent(intent: { horizontalImpulse: number; direction: { x: number; y: number; z: number }; jump?: boolean; crouch?: boolean }): string {
    return `impulse=${intent.horizontalImpulse.toFixed(2)} dir=${this.formatVector(intent.direction)} jump=${intent.jump === true ? 'y' : 'n'} crouch=${intent.crouch === true ? 'y' : 'n'}`;
  }

  private formatStatusModifier(modifier: Record<string, unknown> | null): string {
    if (!modifier) return 'none';
    const parts: string[] = [];
    if (typeof modifier.speedMultiplier === 'number') parts.push(`speed=${modifier.speedMultiplier.toFixed(2)}`);
    if (modifier.blockMovement === true) parts.push('blocked');
    if (modifier.impulseOverride && typeof modifier.impulseOverride === 'object') parts.push('impulse');
    return parts.length > 0 ? parts.join(' | ') : 'none';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}