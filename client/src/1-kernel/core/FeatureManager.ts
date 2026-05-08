/**
 * FeatureManager
 * Centralized feature flag registry for the engine.
 *
 * All systems query `FeatureManager.isEnabled(key)` before running.
 * Changes are broadcast to subscribers (FeatureMenuUI listens here).
 *
 * Usage:
 *   import { FeatureManager } from './FeatureManager';
 *
 *   if (FeatureManager.isEnabled('enemyAI')) { ... }
 *   FeatureManager.toggle('fog');
 *   FeatureManager.onChanged('weapons', (enabled) => console.log('weapons:', enabled));
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** All known feature keys typed strictly. */
export interface FeatureConfig {
  multiplayer:       boolean;
  enemyAI:           boolean;
  weapons:           boolean;
  fog:               boolean;
  audio:             boolean;
  visualEffects:     boolean;
  proceduralLevels:  boolean;
  debugTools:        boolean;
}

export type FeatureKey = keyof FeatureConfig;

/** Human-readable display metadata for the UI. */
export interface FeatureMeta {
  label:       string;
  description: string;
  /** Hotkey character (no modifier, single letter). Optional. */
  hotkey?:     string;
  /** Features that only make sense in play mode. */
  playModeOnly?: boolean;
}

export type ChangeCallback = (enabled: boolean, key: FeatureKey) => void;

import { gameBus } from './EventBus';
import type { SystemCapabilities, SystemContext } from './types';

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: FeatureConfig = {
  multiplayer:       false,
  enemyAI:           true,
  weapons:           true,
  fog:               true,
  audio:             false,
  visualEffects:     true,
  proceduralLevels:  false,
  debugTools:        false,
};

/** Display metadata shown in FeatureMenuUI. */
export const FEATURE_META: Readonly<Record<FeatureKey, FeatureMeta>> = {
  multiplayer:      { label: 'Multiplayer',        description: 'WebSocket peer sync',               hotkey: 'm', playModeOnly: false },
  enemyAI:          { label: 'Enemy AI',            description: 'FSM patrol / chase / attack',       hotkey: 'e', playModeOnly: false },
  weapons:          { label: 'Weapons',             description: 'Hitscan & projectile weapons',      hotkey: 'w', playModeOnly: false },
  fog:              { label: 'Fog',                 description: 'Scene fog & density effects',       hotkey: 'f', playModeOnly: false },
  audio:            { label: 'Audio',               description: 'Ambient & SFX (Web Audio API)',     hotkey: 'a', playModeOnly: false },
  visualEffects:    { label: 'Visual Effects',      description: 'PS1 pipeline, vignette, grain',     hotkey: 'v', playModeOnly: false },
  proceduralLevels: { label: 'Procedural Levels',   description: 'Runtime level generation',          hotkey: 'p', playModeOnly: false },
  debugTools:       { label: 'Debug Tools',         description: 'Debug overlays & dev console',      hotkey: 'd', playModeOnly: false },
};

// ─── FeatureManager class ─────────────────────────────────────────────────────

class FeatureManagerClass {
  private features: FeatureConfig;
  /** Per-key subscriber lists. */
  private subscribers: Map<FeatureKey, ChangeCallback[]> = new Map();
  /** Global subscriber — fired on any change. */
  private globalSubscribers: ChangeCallback[] = [];
  private systemContext: SystemContext | null = null;

  constructor(initial: Partial<FeatureConfig> = {}) {
    this.features = { ...DEFAULT_CONFIG, ...initial };
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        enabledFeatures: Object.values(this.features).filter(Boolean).length,
        totalFeatures: Object.keys(this.features).length,
        subscriberGroups: this.subscribers.size,
        globalSubscriberCount: this.globalSubscribers.length,
        hasSystemContext: this.systemContext !== null,
      },
      features: this.getAll(),
    };
  }

  // ─── Core API ──────────────────────────────────────────────────────────────

  enable(key: FeatureKey): void {
    this._set(key, true);
  }

  disable(key: FeatureKey): void {
    this._set(key, false);
  }

  toggle(key: FeatureKey): boolean {
    const next = !this.features[key];
    this._set(key, next);
    return next;
  }

  isEnabled(key: FeatureKey): boolean {
    return this.features[key];
  }

  /** Return a frozen snapshot of the full feature config. */
  getAll(): Readonly<FeatureConfig> {
    return { ...this.features };
  }

  /**
   * Merge a partial config in one call.
   * Fires individual change events for each changed key.
   */
  configure(partial: Partial<FeatureConfig>): void {
    (Object.keys(partial) as FeatureKey[]).forEach((key) => {
      const val = partial[key];
      if (val !== undefined && val !== this.features[key]) {
        this._set(key, val);
      }
    });
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * Subscribe to changes on a specific feature key.
   * Returns an unsubscribe function.
   */
  onChanged(key: FeatureKey, cb: ChangeCallback): () => void {
    if (!this.subscribers.has(key)) this.subscribers.set(key, []);
    this.subscribers.get(key)!.push(cb);
    return () => {
      const list = this.subscribers.get(key);
      if (list) this.subscribers.set(key, list.filter((c) => c !== cb));
    };
  }

  /**
   * Subscribe to any feature change.
   * Returns an unsubscribe function.
   */
  onAnyChanged(cb: ChangeCallback): () => void {
    this.globalSubscribers.push(cb);
    return () => {
      this.globalSubscribers = this.globalSubscribers.filter((c) => c !== cb);
    };
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  /** Persist current config to localStorage under `engine_features`. */
  save(): void {
    try {
      localStorage.setItem('engine_features', JSON.stringify(this.features));
    } catch {
      // localStorage may be unavailable (SSR, security restrictions)
    }
  }

  /** Load config from localStorage (if present). Fires change events for diffs. */
  load(): void {
    try {
      const raw = localStorage.getItem('engine_features');
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<FeatureConfig>;
      this.configure(saved);
    } catch {
      /* ignore malformed data */
    }
  }

  /** Reset all features to engine defaults. */
  reset(): void {
    this.configure(DEFAULT_CONFIG);
  }

  // ─── ModeManager integration ───────────────────────────────────────────────

  /**
   * Called by the engine when entering editor mode.
   * Play-mode-only features are not affected — they simply won't run
   * because systems check isEnabled() independently.
   */
  onEnterEditor(): void {
    // Nothing to force-disable; systems guard themselves.
    this._emitAll();
  }

  onEnterPlay(): void {
    this._emitAll();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _set(key: FeatureKey, value: boolean): void {
    if (this.features[key] === value) return;
    this.features[key] = value;
    gameBus.emit('stateMutation', {
      source: 'featureManager',
      path: `features.${key}`,
      changedCount: 1,
    });
    const cbs = this.subscribers.get(key) ?? [];
    cbs.forEach((cb) => cb(value, key));
    this.globalSubscribers.forEach((cb) => cb(value, key));
  }

  /** Re-broadcast the current state of every feature to global subscribers. */
  private _emitAll(): void {
    (Object.keys(this.features) as FeatureKey[]).forEach((key) => {
      this.globalSubscribers.forEach((cb) => cb(this.features[key], key));
    });
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

export const FeatureManager = new FeatureManagerClass();
