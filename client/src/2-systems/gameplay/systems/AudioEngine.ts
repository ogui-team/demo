/**
 * AudioEngine  —  Tier 0 Foundation
 * 3D positional audio via Web Audio API.
 *
 * Features
 *   - Spatial (PannerNode) sound sources tied to world positions
 *   - Sound categories: footsteps | ambient | enemy | music | ui
 *   - Reverb / convolution per-category (horror room acoustics)
 *   - Fog-based distance attenuation (denser fog → shorter range)
 *   - Master gain + per-category gain
 *   - PreloadSounds pool, auto-resume on user gesture
 *
 * Usage
 *   const audio = new AudioEngine();
 *   await audio.preload({ pistol_shot: '/sounds/pistol.ogg', ... });
 *   audio.playAt('pistol_shot', { x:2, y:0, z:5 }, { category:'enemy', volume:0.8 });
 *   audio.setListenerPosition(camera.position, camera.rotation);
 *   audio.setFogDensity(0.04);   // affects max hearing range
 */

import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SoundCategory = 'footstep' | 'ambient' | 'enemy' | 'music' | 'ui' | 'weapon' | string;

export interface SoundOptions {
  category?:  SoundCategory;
  volume?:    number;  // 0..1
  loop?:      boolean;
  pitch?:     number;  // playback rate multiplier, default 1
  /** Override rolloff distance. Falls back to category default. */
  maxDist?:   number;
  /** Attach to an entity ID — audio will silence when entity is removed. */
  entityId?:  string;
}

export interface ToneOptions extends SoundOptions {
  waveform?: OscillatorType;
  durationMs?: number;
}

export interface SoundHandle {
  id:         string;
  source:     AudioScheduledSourceNode;
  panner:     PannerNode;
  gainNode:   GainNode;
  category:   SoundCategory;
  entityId?:  string;
  stop():     void;
  setVolume(v: number): void;
  setPosition(pos: { x: number; y: number; z: number }): void;
}

interface CategoryConfig {
  gain:    number;   // 0..1
  maxDist: number;   // world units
  reverb:  boolean;  // use convolver
}

const CATEGORY_DEFAULTS: Record<SoundCategory, CategoryConfig> = {
  footstep: { gain: 0.6,  maxDist: 14,  reverb: true  },
  ambient:  { gain: 0.4,  maxDist: 40,  reverb: true  },
  enemy:    { gain: 0.9,  maxDist: 30,  reverb: true  },
  music:    { gain: 0.35, maxDist: 999, reverb: false },
  ui:       { gain: 0.8,  maxDist: 999, reverb: false },
  weapon:   { gain: 1.0,  maxDist: 35,  reverb: true  },
};

// ─── AudioEngine ──────────────────────────────────────────────────────────────

export class AudioEngine {
  private ctx:          AudioContext;
  private masterGain:   GainNode;
  private categoryGains: Map<SoundCategory, GainNode> = new Map();
  private reverbNode:   ConvolverNode | null = null;
  private reverbGain:   GainNode;

  private buffers:      Map<string, AudioBuffer> = new Map();
  private activeSounds: Map<string, SoundHandle> = new Map();
  private handleCounter = 0;

  /** World-unit fog density — affects hearing range scaling. */
  private fogDensity = 0;

  constructor() {
    this.ctx        = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.25;
    this.reverbGain.connect(this.masterGain);

    this._buildCategoryGains();
    this._buildReverb();
    this._listenForUserGesture();
  }

  // ─── Preloading ────────────────────────────────────────────────────────────

  async preload(manifest: Record<string, string>): Promise<void> {
    const tasks = Object.entries(manifest).map(async ([key, url]) => {
      try {
        const response  = await fetch(url);
        const arrayBuf  = await response.arrayBuffer();
        const audioBuf  = await this.ctx.decodeAudioData(arrayBuf);
        this.buffers.set(key, audioBuf);
      } catch (err) {
        console.warn(`[AudioEngine] Failed to load "${key}" from ${url}:`, err);
      }
    });
    await Promise.all(tasks);
    console.log(`[AudioEngine] Preloaded ${this.buffers.size} sounds`);
  }

  /** Register an already-decoded buffer directly. */
  registerBuffer(key: string, buffer: AudioBuffer): void {
    this.buffers.set(key, buffer);
  }

  // ─── Playback ──────────────────────────────────────────────────────────────

  /**
   * Play a 2D (non-positional) sound — music, UI clicks.
   */
  play(soundKey: string, opts: SoundOptions = {}): SoundHandle | null {
    return this._playInternal(soundKey, null, opts);
  }

  /**
   * Play a 3D positional sound attached to a world position.
   */
  playAt(
    soundKey: string,
    position: { x: number; y: number; z: number },
    opts:     SoundOptions = {}
  ): SoundHandle | null {
    return this._playInternal(soundKey, position, opts);
  }

  /**
   * Play a footstep for an entity (slightly randomised pitch).
   */
  playFootstep(soundKey: string, position: { x: number; y: number; z: number }, entityId?: string): SoundHandle | null {
    return this.playAt(soundKey, position, {
      category: 'footstep',
      pitch:    0.9 + Math.random() * 0.2,
      entityId,
    });
  }

  stopAll(category?: SoundCategory): void {
    for (const [id, handle] of this.activeSounds) {
      if (!category || handle.category === category) {
        handle.stop();
        this.activeSounds.delete(id);
      }
    }
  }

  stopEntity(entityId: string): void {
    for (const [id, handle] of this.activeSounds) {
      if (handle.entityId === entityId) {
        handle.stop();
        this.activeSounds.delete(id);
      }
    }
  }

  // ─── Listener (Camera) ─────────────────────────────────────────────────────

  setListenerPosition(position: { x: number; y: number; z: number }, rotation?: THREE.Euler): void {
    if (this.ctx.state === 'suspended') return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = position.x;
      l.positionY.value = position.y;
      l.positionZ.value = position.z;
    } else {
      l.setPosition(position.x, position.y, position.z);
    }

    if (rotation) {
      // Forward vector from Euler
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(rotation);
      const up  = new THREE.Vector3(0, 1,  0).applyEuler(rotation);
      if (l.forwardX) {
        l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
        l.upX.value = up.x;       l.upY.value = up.y;       l.upZ.value = up.z;
      } else {
        l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
    }
  }

  // ─── Config ────────────────────────────────────────────────────────────────

  setMasterVolume(v: number): void { this.masterGain.gain.value = Math.max(0, Math.min(1, v)); }

  setCategoryVolume(cat: SoundCategory, v: number): void {
    const gain = this.categoryGains.get(cat);
    if (gain) gain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Denser fog shortens hearing range. density ~0..0.1 */
  setFogDensity(density: number): void { this.fogDensity = density; }

  /** Reverb wet mix 0..1 */
  setReverbMix(mix: number): void { this.reverbGain.gain.value = Math.max(0, Math.min(1, mix)); }

  // ─── Ambient loops ─────────────────────────────────────────────────────────

  /** Start a looping ambient sound (no position). Returns handle key. */
  startAmbient(soundKey: string, volume = 0.4): string | null {
    const handle = this.play(soundKey, { category: 'ambient', loop: true, volume });
    return handle ? handle.id : null;
  }

  stopAmbient(handleId: string): void {
    const h = this.activeSounds.get(handleId);
    if (h) { h.stop(); this.activeSounds.delete(handleId); }
  }

  // ─── Per-frame ─────────────────────────────────────────────────────────────

  /**
   * Call each frame to clean up finished sounds and update entity-attached sources.
   * entityPositions: map of entityId → current world position.
   */
  update(entityPositions?: Map<string, { x: number; y: number; z: number }>): void {
    for (const [id, handle] of this.activeSounds) {
      // Update position for entity-attached sounds
      if (handle.entityId && entityPositions) {
        const pos = entityPositions.get(handle.entityId);
        if (pos) handle.setPosition(pos);
        else {
          // Entity no longer exists — fade & remove
          handle.stop();
          this.activeSounds.delete(id);
        }
      }
    }
  }

  destroy(): void {
    this.stopAll();
    this.ctx.close();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private _playInternal(
    soundKey: string,
    position: { x: number; y: number; z: number } | null,
    opts:     SoundOptions
  ): SoundHandle | null {
    const buffer = this.buffers.get(soundKey);
    if (!buffer) {
      console.warn(`[AudioEngine] Sound "${soundKey}" not loaded`);
      return null;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const cat   = opts.category ?? 'ui';
    const catCfg = CATEGORY_DEFAULTS[cat] ?? { gain: 1, maxDist: 30, reverb: false };

    // Graph: source → gainNode → panner → categoryGain → masterGain
    const source   = this.ctx.createBufferSource();
    const gainNode = this.ctx.createGain();
    const panner   = this.ctx.createPanner();

    source.buffer             = buffer;
    source.loop               = opts.loop ?? false;
    source.playbackRate.value = opts.pitch ?? 1;

    gainNode.gain.value = opts.volume ?? 1.0;

    const maxDist = this._adjustedMaxDist(opts.maxDist ?? catCfg.maxDist);
    panner.panningModel    = 'HRTF';
    panner.distanceModel   = 'inverse';
    panner.refDistance     = 1;
    panner.maxDistance     = maxDist;
    panner.rolloffFactor   = 2;

    if (position) {
      panner.setPosition(position.x, position.y, position.z);
    }

    const catGain = this.categoryGains.get(cat) ?? this.masterGain;

    source.connect(gainNode);
    gainNode.connect(panner);

    if (catCfg.reverb && this.reverbNode) {
      // Dry path
      panner.connect(catGain);
      // Wet (reverb) path
      const dryGain = this.ctx.createGain(); dryGain.gain.value = 0.7;
      const wetGain = this.ctx.createGain(); wetGain.gain.value = 0.3;
      panner.connect(dryGain); dryGain.connect(catGain);
      panner.connect(wetGain); wetGain.connect(this.reverbNode);
    } else {
      panner.connect(catGain);
    }

    source.start(0);

    const id = `snd_${++this.handleCounter}`;

    const handle: SoundHandle = {
      id, source, panner, gainNode, category: cat, entityId: opts.entityId,
      stop: () => {
        try { source.stop(); } catch (_) {}
        source.disconnect();
        gainNode.disconnect();
        panner.disconnect();
      },
      setVolume: (v) => { gainNode.gain.value = Math.max(0, Math.min(1, v)); },
      setPosition: (pos) => { panner.setPosition(pos.x, pos.y, pos.z); },
    };

    this.activeSounds.set(id, handle);

    source.onended = () => { this.activeSounds.delete(id); };

    return handle;
  }

  playToneAt(
    frequency: number,
    position: { x: number; y: number; z: number },
    opts: ToneOptions = {},
  ): SoundHandle | null {
    if (!Number.isFinite(frequency) || frequency <= 0) {
      return null;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const cat = opts.category ?? 'ui';
    const catCfg = CATEGORY_DEFAULTS[cat] ?? { gain: 1, maxDist: 30, reverb: false };
    const source = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    const panner = this.ctx.createPanner();

    source.type = opts.waveform ?? 'triangle';
    source.frequency.value = frequency;
    gainNode.gain.value = opts.volume ?? 1.0;

    const maxDist = this._adjustedMaxDist(opts.maxDist ?? catCfg.maxDist);
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = maxDist;
    panner.rolloffFactor = 2;
    panner.setPosition(position.x, position.y, position.z);

    const catGain = this.categoryGains.get(cat) ?? this.masterGain;

    source.connect(gainNode);
    gainNode.connect(panner);

    if (catCfg.reverb && this.reverbNode) {
      panner.connect(catGain);
      const dryGain = this.ctx.createGain(); dryGain.gain.value = 0.7;
      const wetGain = this.ctx.createGain(); wetGain.gain.value = 0.3;
      panner.connect(dryGain); dryGain.connect(catGain);
      panner.connect(wetGain); wetGain.connect(this.reverbNode);
    } else {
      panner.connect(catGain);
    }

    source.start(0);
    if (!opts.loop) {
      const durationSeconds = Math.max(0.05, (opts.durationMs ?? 180) / 1000);
      source.stop(this.ctx.currentTime + durationSeconds);
    }

    const id = `snd_${++this.handleCounter}`;
    const handle: SoundHandle = {
      id,
      source,
      panner,
      gainNode,
      category: cat,
      entityId: opts.entityId,
      stop: () => {
        try { source.stop(); } catch (_) {}
        source.disconnect();
        gainNode.disconnect();
        panner.disconnect();
      },
      setVolume: (v) => { gainNode.gain.value = Math.max(0, Math.min(1, v)); },
      setPosition: (pos) => { panner.setPosition(pos.x, pos.y, pos.z); },
    };

    this.activeSounds.set(id, handle);
    source.onended = () => { this.activeSounds.delete(id); };
    return handle;
  }

  private _buildCategoryGains(): void {
    for (const [cat, cfg] of Object.entries(CATEGORY_DEFAULTS)) {
      const g = this.ctx.createGain();
      g.gain.value = cfg.gain;
      g.connect(this.masterGain);
      this.categoryGains.set(cat as SoundCategory, g);
    }
  }

  private _buildReverb(): void {
    // Synthesise a basic impulse response (exponential decay noise)
    const sr       = this.ctx.sampleRate;
    const length   = sr * 1.5; // 1.5 second reverb tail
    const impulse  = this.ctx.createBuffer(2, length, sr);

    for (let c = 0; c < 2; c++) {
      const channel = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }

    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = impulse;
    this.reverbNode.connect(this.reverbGain);
  }

  private _listenForUserGesture(): void {
    const resume = () => {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      window.removeEventListener('click',   resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('click',   resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  private _adjustedMaxDist(base: number): number {
    // Fog density 0.04 → halve range; linear interpolation
    const fogScale = Math.max(0.2, 1 - this.fogDensity * 25);
    return base * fogScale;
  }
}
