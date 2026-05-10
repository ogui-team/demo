/**
 * LatencySimulator
 *
 * Wraps an INetworkTransport with configurable artificial latency.
 * Delays both outgoing sends and incoming receives using message queues.
 * Useful for testing client-side prediction and interpolation under lag.
 */

import { INetworkTransport, PlayerNetworkState } from './NetworkRuntimeContracts';

export interface LatencyConfig {
  /** One-way latency in ms applied to outgoing messages. */
  sendDelay: number;
  /** One-way latency in ms applied to incoming messages. */
  receiveDelay: number;
  /** Random jitter ± ms added to both directions. 0 = no jitter. */
  jitter: number;
  /** Packet loss ratio 0–1. 0 = no loss, 0.1 = 10% dropped. */
  packetLoss: number;
}

const DEFAULT_CONFIG: LatencyConfig = {
  sendDelay: 0,
  receiveDelay: 0,
  jitter: 0,
  packetLoss: 0,
};

export class LatencySimulator implements INetworkTransport {
  private inner: INetworkTransport;
  private config: LatencyConfig;
  private _timers: ReturnType<typeof setTimeout>[] = [];

  constructor(inner: INetworkTransport, config: Partial<LatencyConfig> = {}) {
    this.inner = inner;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Configuration ──────────────────────────────────────────────────

  setConfig(cfg: Partial<LatencyConfig>): void {
    Object.assign(this.config, cfg);
  }

  getConfig(): Readonly<LatencyConfig> {
    return { ...this.config };
  }

  /** Total simulated round-trip time (send + receive + avg jitter). */
  get estimatedRTT(): number {
    return this.config.sendDelay + this.config.receiveDelay + this.config.jitter;
  }

  // ─── INetworkTransport ──────────────────────────────────────────────

  sendState(state: PlayerNetworkState): void {
    if (this._shouldDrop()) return;

    const delay = this._computeDelay(this.config.sendDelay);
    if (delay <= 0) {
      this.inner.sendState(state);
    } else {
      const t = Engine.timer.setTimeout(() => this.inner.sendState(state), delay);
      this._timers.push(t);
    }
  }

  onStateReceived(callback: (state: PlayerNetworkState) => void): void {
    this.inner.onStateReceived((state: PlayerNetworkState) => {
      if (this._shouldDrop()) return;

      const delay = this._computeDelay(this.config.receiveDelay);
      if (delay <= 0) {
        callback(state);
      } else {
        const t = Engine.timer.setTimeout(() => callback(state), delay);
        this._timers.push(t);
      }
    });
  }

  disconnect(): void {
    for (const t of this._timers) Engine.timer.clearTimeout(t);
    this._timers.length = 0;
    this.inner.disconnect();
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private _computeDelay(base: number): number {
    const jitter = this.config.jitter > 0
      ? (Engine.random.next() * 2 - 1) * this.config.jitter
      : 0;
    return Math.max(0, Math.round(base + jitter));
  }

  private _shouldDrop(): boolean {
    return this.config.packetLoss > 0 && Engine.random.next() < this.config.packetLoss;
  }
}
