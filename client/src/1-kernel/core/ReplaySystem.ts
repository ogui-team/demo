/**
 * ReplaySystem
 * ============
 * Records gameplay as a stream of discrete events (inputs + world events).
 * Playback re-feeds recorded events into registered handler callbacks so the
 * engine reproduces the same state deterministically.
 *
 * Design principles
 * ─────────────────
 * • Records EVENTS, not snapshots — minimal storage footprint.
 * • Deterministic: uses a seeded LCG replacing Math.random during playback.
 * • Decoupled: the system does not import Three.js or engine internals.
 *   Callers hook in via recordEvent() / onPlaybackEvent().
 * • Camera is free during playback (caller responsibility to unlock camera).
 *
 * Usage
 * ─────
 * const replay = new ReplaySystem();
 * replay.startRecording('session-123');
 * replay.recordEvent({ type: 'player_input', data: { ... } });
 * const rec = replay.stopRecording();          // returns ReplayRecording
 * replay.loadRecording(rec);
 * replay.onPlaybackEvent((evt) => { ... });    // hook systems back in
 * replay.playReplay();
 */

// ─── Seeded RNG ───────────────────────────────────────────────────────────────

/** Simple 32-bit LCG — fast, seedable, same output on every platform. */
import { gameBus } from './EventBus';

export class SeededRandom {
  private state: number;
  private generatedCount = 0;

  constructor(seed: number) {
    this.state = seed >>> 0;
    gameBus.emit('stateMutation', {
      source: 'rng',
      path: 'seed',
      changedCount: 1,
    });
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    this.generatedCount += 1;
    return this.state / 0xffffffff;
  }

  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.nextRange(min, max + 1));
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        state: this.state,
        count: this.generatedCount,
      },
    };
  }
}

// ─── Core types ──────────────────────────────────────────────────────────────

export interface ReplayEvent {
  /** Milliseconds since recording start */
  time: number;
  type: ReplayEventType | string;
  data: unknown;
}

export type ReplayEventType =
  | 'player_input'
  | 'player_hit'
  | 'player_killed'
  | 'entity_spawn'
  | 'entity_destroy'
  | 'custom';

export interface ReplayRecording {
  sessionId: string;
  seed: number;
  startedAt: number;
  durationMs: number;
  events: ReplayEvent[];
}

export type PlaybackState = 'idle' | 'recording' | 'playing' | 'paused';

// ─── ReplaySystem ─────────────────────────────────────────────────────────────

export class ReplaySystem {
  private state: PlaybackState = 'idle';

  // Recording
  private recordingSessionId = '';
  private recordingSeed = 0;
  private recordingStart = 0;
  private recordedEvents: ReplayEvent[] = [];

  // Playback
  private currentRecording: ReplayRecording | null = null;
  private playbackIndex = 0;
  private playbackOffset = 0;   // ms into the recording
  private playbackStartWall = 0; // wall clock when play started/resumed
  private playbackPausedAt = 0;  // playbackOffset at pause point
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private rng: SeededRandom | null = null;

  // Callbacks
  private eventHandlers: Array<(evt: ReplayEvent) => void> = [];
  private stateChangeHandlers: Array<(state: PlaybackState) => void> = [];

  // ─── Recording API ──────────────────────────────────────────────────────

  /** Start a new recording for the given session.  seed defaults to Engine.time.now(). */
  startRecording(sessionId: string, seed?: number): void {
    if (this.state === 'recording') this.stopRecording();
    this.recordingSessionId = sessionId;
    this.recordingSeed = seed ?? Engine.time.now();
    this.recordingStart = performance.now();
    this.recordedEvents = [];
    this._setState('recording');
  }

  /** Append an event to the active recording. No-op when not recording. */
  recordEvent(type: ReplayEventType | string, data: unknown = {}): void {
    if (this.state !== 'recording') return;
    this.recordedEvents.push({
      time: performance.now() - this.recordingStart,
      type,
      data,
    });
  }

  /** Stop recording and return the completed ReplayRecording. */
  stopRecording(): ReplayRecording {
    const durationMs = this.state === 'recording'
      ? performance.now() - this.recordingStart
      : 0;
    const recording: ReplayRecording = {
      sessionId: this.recordingSessionId,
      seed: this.recordingSeed,
      startedAt: this.recordingStart,
      durationMs,
      events: [...this.recordedEvents],
    };
    this.recordedEvents = [];
    this._setState('idle');
    return recording;
  }

  // ─── Playback API ───────────────────────────────────────────────────────

  /** Load a recording ready for playback. Does not auto-play. */
  loadRecording(recording: ReplayRecording): void {
    this._stopPlaybackTimer();
    this.currentRecording = recording;
    this.playbackIndex = 0;
    this.playbackOffset = 0;
    this.playbackPausedAt = 0;
    this.rng = new SeededRandom(recording.seed);
    this._setState('idle');
  }

  /** Begin (or resume) replay playback. */
  playReplay(): void {
    if (!this.currentRecording) {
      console.warn('[ReplaySystem] No recording loaded.');
      return;
    }
    if (this.state === 'playing') return;

    if (this.state === 'paused') {
      // Resume from pause point
      this.playbackStartWall = performance.now() - this.playbackPausedAt;
    } else {
      // Fresh start (or restart from a seek)
      this.playbackStartWall = performance.now() - this.playbackOffset;
    }

    this._setState('playing');
    this._scheduleNext();
  }

  /** Pause playback at the current position. */
  pauseReplay(): void {
    if (this.state !== 'playing') return;
    this._stopPlaybackTimer();
    this.playbackPausedAt = performance.now() - this.playbackStartWall;
    this.playbackOffset = this.playbackPausedAt;
    this._setState('paused');
  }

  /** Seek to a specific time (ms from start). Only valid when paused or idle. */
  seek(timeMs: number): void {
    if (!this.currentRecording) return;
    const clampedTime = Math.max(0, Math.min(timeMs, this.currentRecording.durationMs));

    if (this.state === 'playing') this.pauseReplay();

    // Find the event index that corresponds to this time
    const events = this.currentRecording.events;
    let idx = 0;
    while (idx < events.length && events[idx].time <= clampedTime) idx++;
    this.playbackIndex = idx;
    this.playbackOffset = clampedTime;
    this.playbackPausedAt = clampedTime;

    // Re-seed RNG to reproduce deterministic state at that point
    this.rng = new SeededRandom(this.currentRecording.seed);
    for (let i = 0; i < idx; i++) {
      // Advance RNG by consuming one call per event (keeps parity with live)
      this.rng.next();
    }
  }

  stopReplay(): void {
    this._stopPlaybackTimer();
    this.playbackIndex = 0;
    this.playbackOffset = 0;
    this._setState('idle');
  }

  // ─── Serialise / Deserialise ────────────────────────────────────────────

  exportJSON(recording: ReplayRecording): string {
    return JSON.stringify(recording);
  }

  importJSON(json: string): ReplayRecording {
    const parsed = JSON.parse(json) as ReplayRecording;
    if (typeof parsed.seed !== 'number' || !Array.isArray(parsed.events)) {
      throw new Error('[ReplaySystem] Invalid recording JSON.');
    }
    return parsed;
  }

  // ─── Callbacks ──────────────────────────────────────────────────────────

  /**
   * Register a handler called for each event during playback.
   * Multiple handlers can be registered (one per system: input, physics, etc.).
   */
  onPlaybackEvent(handler: (evt: ReplayEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => { this.eventHandlers = this.eventHandlers.filter((h) => h !== handler); };
  }

  /** Subscribe to playback state changes. */
  onStateChange(handler: (state: PlaybackState) => void): () => void {
    this.stateChangeHandlers.push(handler);
    return () => { this.stateChangeHandlers = this.stateChangeHandlers.filter((h) => h !== handler); };
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  getState(): PlaybackState { return this.state; }
  isRecording(): boolean { return this.state === 'recording'; }
  isPlaying(): boolean { return this.state === 'playing'; }

  /** Current playback position in ms. 0 when idle/stopped. */
  getPlaybackTime(): number {
    if (this.state === 'playing') return performance.now() - this.playbackStartWall;
    return this.playbackOffset;
  }

  getDuration(): number {
    return this.currentRecording?.durationMs ?? 0;
  }

  /** Seeded random accessor — use this instead of Math.random for determinism. */
  getRng(): SeededRandom {
    if (!this.rng) this.rng = new SeededRandom(Engine.time.now());
    return this.rng;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private _setState(next: PlaybackState): void {
    this.state = next;
    for (const h of this.stateChangeHandlers) h(next);
  }

  private _scheduleNext(): void {
    if (this.state !== 'playing' || !this.currentRecording) return;

    const events = this.currentRecording.events;
    if (this.playbackIndex >= events.length) {
      // Playback finished
      this._setState('idle');
      return;
    }

    const nextEvt = events[this.playbackIndex];
    const currentOffset = performance.now() - this.playbackStartWall;
    const delay = Math.max(0, nextEvt.time - currentOffset);

    this.playbackTimer = Engine.timer.setTimeout(() => {
      if (this.state !== 'playing') return;

      // Fire all due events (in case multiple share the same timestamp)
      while (
        this.playbackIndex < events.length &&
        events[this.playbackIndex].time <= performance.now() - this.playbackStartWall + 1
      ) {
        const evt = events[this.playbackIndex];
        this.rng?.next(); // Advance RNG parity
        for (const h of this.eventHandlers) h(evt);
        this.playbackIndex++;
      }

      this._scheduleNext();
    }, delay);
  }

  private _stopPlaybackTimer(): void {
    if (this.playbackTimer !== null) {
      Engine.timer.clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }
}
