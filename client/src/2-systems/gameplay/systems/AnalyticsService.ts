/**
 * AnalyticsService  —  Tier 0 Foundation
 * Lightweight session telemetry & combat stat tracking.
 *
 * Design goals
 *   - Zero external dependencies
 *   - Opt-in: disabled by default (must call enable())
 *   - Data stays local (console + in-memory); opt-in flush to server
 *   - Useful for balancing horror tension: tracks player stress signals
 *
 * Events (built-in names):
 *   session_start | session_end
 *   player_death | player_kill
 *   weapon_fired | weapon_hit | weapon_miss | weapon_reload
 *   enemy_spawned | enemy_killed | enemy_alerted
 *   item_picked_up | item_used
 *   level_entered | level_exited
 *   damage_taken | damage_dealt
 *   scare_trigger   ← horror-specific
 *
 * Usage:
 *   AnalyticsService.enable();
 *   AnalyticsService.startSession('player_01');
 *   AnalyticsService.track('weapon_fired', { weapon: 'pistol', ammo: 8 });
 *   const report = AnalyticsService.generateReport();
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnalyticsEventName =
  | 'session_start'
  | 'session_end'
  | 'player_death'
  | 'player_kill'
  | 'weapon_fired'
  | 'weapon_hit'
  | 'weapon_miss'
  | 'weapon_reload'
  | 'enemy_spawned'
  | 'enemy_killed'
  | 'enemy_alerted'
  | 'item_picked_up'
  | 'item_used'
  | 'level_entered'
  | 'level_exited'
  | 'damage_taken'
  | 'damage_dealt'
  | 'scare_trigger'
  | string;

export interface AnalyticsEvent {
  name:      AnalyticsEventName;
  playerId:  string;
  timestamp: number;  // ms since session start
  wallTime:  number;  // Engine.time.now()
  data:      Record<string, unknown>;
}

export interface SessionReport {
  sessionId:    string;
  playerId:     string;
  durationMs:   number;
  totalEvents:  number;
  deaths:       number;
  kills:        number;
  shotsFired:   number;
  shotsHit:     number;
  accuracy:     number;           // 0..1
  damageDealt:  number;
  damageTaken:  number;
  itemsPickedUp: number;
  scareTriggers: number;
  enemiesKilled: number;
  eventCounts:  Record<string, number>;
  /** Raw event log — may be empty if compactMode = true */
  events:       AnalyticsEvent[];
}

interface FlushTarget {
  url:     string;
  headers?: Record<string, string>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class _AnalyticsService {
  private _enabled        = false;
  private _compactMode    = false;  // if true, don't store full event log
  private _sessionId      = '';
  private _playerId       = '';
  private _sessionStart   = 0;
  private _events:        AnalyticsEvent[] = [];
  private _flushTarget:   FlushTarget | null = null;
  private _flushInterval  = 30_000;  // ms
  private _flushTimer:    ReturnType<typeof setInterval> | null = null;

  // Counters (always tracked even in compactMode)
  private _counts: Record<string, number> = {};

  // Combat accumulators
  private _shotsHit      = 0;
  private _shotsFired    = 0;
  private _damageDealt   = 0;
  private _damageTaken   = 0;

  // ─── Control ─────────────────────────────────────────────────────────────

  enable(compact = false): void {
    this._enabled     = true;
    this._compactMode = compact;
  }

  disable(): void { this._enabled = false; }
  get isEnabled(): boolean { return this._enabled; }

  // ─── Session ─────────────────────────────────────────────────────────────

  startSession(playerId: string, sessionId?: string): void {
    this._playerId    = playerId;
    this._sessionId   = sessionId ?? `sess_${Engine.time.now()}_${Engine.random.next().toString(36).slice(2, 6)}`;
    this._sessionStart = Engine.time.now();
    this._events      = [];
    this._counts      = {};
    this._shotsHit    = 0;
    this._shotsFired  = 0;
    this._damageDealt = 0;
    this._damageTaken = 0;

    this.track('session_start', { sessionId: this._sessionId });

    if (this._flushTarget) {
      this._flushTimer = Engine.timer.setInterval(() => this._flush(), this._flushInterval);
    }
  }

  endSession(): SessionReport {
    this.track('session_end', { durationMs: this._elapsed() });
    if (this._flushTimer) { Engine.timer.clearInterval(this._flushTimer); this._flushTimer = null; }
    return this.generateReport();
  }

  // ─── Event tracking ──────────────────────────────────────────────────────

  track(name: AnalyticsEventName, data: Record<string, unknown> = {}): void {
    if (!this._enabled) return;

    const evt: AnalyticsEvent = {
      name,
      playerId:  this._playerId,
      timestamp: this._elapsed(),
      wallTime:  Engine.time.now(),
      data,
    };

    if (!this._compactMode) this._events.push(evt);

    // Increment counter
    this._counts[name] = (this._counts[name] ?? 0) + 1;

    // Update accumulators
    switch (name) {
      case 'weapon_hit':    this._shotsHit++;    break;
      case 'weapon_fired':  this._shotsFired++;  break;
      case 'damage_dealt':  this._damageDealt += (data.amount as number) ?? 0; break;
      case 'damage_taken':  this._damageTaken += (data.amount as number) ?? 0; break;
    }
  }

  // ─── Shorthand helpers ────────────────────────────────────────────────────

  trackWeaponFired(weapon: string, ammoLeft: number): void {
    this.track('weapon_fired', { weapon, ammoLeft });
  }

  trackHit(weapon: string, targetId: string, damage: number): void {
    this.track('weapon_hit', { weapon, targetId, damage });
    this.track('damage_dealt', { amount: damage, weapon });
  }

  trackMiss(weapon: string): void {
    this.track('weapon_miss', { weapon });
  }

  trackDeath(killedBy: string, position?: { x: number; y: number; z: number }): void {
    this.track('player_death', { killedBy, position });
  }

  trackScare(triggerType: string, intensity: number): void {
    this.track('scare_trigger', { triggerType, intensity });
  }

  trackLevel(action: 'enter' | 'exit', levelId: string): void {
    this.track(action === 'enter' ? 'level_entered' : 'level_exited', { levelId });
  }

  // ─── Reporting ────────────────────────────────────────────────────────────

  generateReport(): SessionReport {
    const duration = this._elapsed();
    const fired    = this._shotsFired;
    const hit      = this._shotsHit;

    return {
      sessionId:     this._sessionId,
      playerId:      this._playerId,
      durationMs:    duration,
      totalEvents:   this._compactMode
                       ? Object.values(this._counts).reduce((a, b) => a + b, 0)
                       : this._events.length,
      deaths:        this._counts['player_death']   ?? 0,
      kills:         this._counts['player_kill']    ?? 0,
      shotsFired:    fired,
      shotsHit:      hit,
      accuracy:      fired > 0 ? hit / fired : 0,
      damageDealt:   this._damageDealt,
      damageTaken:   this._damageTaken,
      itemsPickedUp: this._counts['item_picked_up'] ?? 0,
      scareTriggers: this._counts['scare_trigger']  ?? 0,
      enemiesKilled: this._counts['enemy_killed']   ?? 0,
      eventCounts:   { ...this._counts },
      events:        this._compactMode ? [] : [...this._events],
    };
  }

  /** Print a human-readable summary to the console. */
  printReport(): void {
    const r = this.generateReport();
    console.group(`[Analytics] Session report — ${r.sessionId}`);
    console.log(`Player   : ${r.playerId}`);
    console.log(`Duration : ${(r.durationMs / 1000).toFixed(1)}s`);
    console.log(`Deaths   : ${r.deaths}    Kills: ${r.kills}`);
    console.log(`Accuracy : ${(r.accuracy * 100).toFixed(1)}%  (${r.shotsHit}/${r.shotsFired})`);
    console.log(`Damage   : dealt ${r.damageDealt}  taken ${r.damageTaken}`);
    console.log(`Scares   : ${r.scareTriggers}`);
    console.groupEnd();
  }

  // ─── Remote flush (optional) ──────────────────────────────────────────────

  /**
   * Configure optional remote telemetry endpoint.
   * Events are POSTed as JSON every `intervalMs`. No PII is sent by default.
   */
  setFlushTarget(target: FlushTarget, intervalMs = 30_000): void {
    this._flushTarget   = target;
    this._flushInterval = intervalMs;
  }

  private async _flush(): Promise<void> {
    if (!this._flushTarget || this._events.length === 0) return;
    const batch = this._compactMode ? [this.generateReport()] : [...this._events];
    try {
      await fetch(this._flushTarget.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(this._flushTarget.headers ?? {}) },
        body:    JSON.stringify({ sessionId: this._sessionId, batch }),
      });
    } catch (_) { /* non-critical */ }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  getSessionId(): string { return this._sessionId; }
  getPlayerId():  string { return this._playerId; }

  private _elapsed(): number {
    return this._sessionStart ? Engine.time.now() - this._sessionStart : 0;
  }
}

export const AnalyticsService = new _AnalyticsService();
