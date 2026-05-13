import * as THREE from 'three';
import { AudioEngine, SoundCategory } from './AudioEngine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { FeatureManager } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

export type AudioChannel = 'master' | 'music' | 'sfx';

export interface ToneSequenceStep {
  time: string;
  note: string;
  duration: string;
  velocity?: number;
}

export interface MusicTrackDefinition {
  id: string;
  label: string;
  description?: string;
  soundKey?: string;
  soundUrl?: string;
  loop?: boolean;
  volume?: number;
  toneSequence?: {
    bpm?: number;
    loopEnd?: string;
    reverb?: number;
    steps: ToneSequenceStep[];
  };
}

export interface AudioTriggerDefinition {
  id: string;
  label: string;
  soundKey?: string;
  soundUrl?: string;
  category?: SoundCategory;
  volume?: number;
  loop?: boolean;
}

export interface AudioMixerState {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  toneAvailable: boolean;
}

type ToneRuntime = {
  start?: () => Promise<void>;
  now?: () => number;
  Part?: new (...args: any[]) => any;
  PolySynth?: new (...args: any[]) => any;
  Reverb?: new (...args: any[]) => any;
  Transport?: {
    bpm?: { value: number };
    loop?: boolean;
    loopEnd?: string;
    start?: () => void;
    stop?: () => void;
    cancel?: () => void;
  };
  Destination?: {
    volume?: { value: number };
    mute?: boolean;
  };
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function linearToDb(value: number): number {
  if (value <= 0.0001) return -60;
  return 20 * Math.log10(value);
}

export const EXAMPLE_AUDIO_TRACKS: MusicTrackDefinition[] = [
  {
    id: 'menu_theme',
    label: 'Ambient Drift',
    description: 'Slow floating ambient pads — relaxing and atmospheric.',
    loop: true,
    volume: 0.28,
    toneSequence: {
      bpm: 48,
      loopEnd: '8m',
      reverb: 5.0,
      steps: [
        // Bar 0 — root chord (Fmaj7 spread)
        { time: '0:0:0', note: 'F2',  duration: '2m',  velocity: 0.35 },
        { time: '0:0:0', note: 'A3',  duration: '2m',  velocity: 0.28 },
        { time: '0:0:0', note: 'C4',  duration: '2m',  velocity: 0.22 },
        { time: '0:0:0', note: 'E4',  duration: '2m',  velocity: 0.18 },
        // Bar 2 — Am7
        { time: '2:0:0', note: 'A2',  duration: '2m',  velocity: 0.35 },
        { time: '2:0:0', note: 'C4',  duration: '2m',  velocity: 0.28 },
        { time: '2:0:0', note: 'E4',  duration: '2m',  velocity: 0.22 },
        { time: '2:0:0', note: 'G4',  duration: '2m',  velocity: 0.18 },
        // Bar 4 — Cmaj7
        { time: '4:0:0', note: 'C3',  duration: '2m',  velocity: 0.35 },
        { time: '4:0:0', note: 'E4',  duration: '2m',  velocity: 0.28 },
        { time: '4:0:0', note: 'G4',  duration: '2m',  velocity: 0.22 },
        { time: '4:0:0', note: 'B4',  duration: '2m',  velocity: 0.18 },
        // Bar 6 — G add9
        { time: '6:0:0', note: 'G2',  duration: '2m',  velocity: 0.35 },
        { time: '6:0:0', note: 'B3',  duration: '2m',  velocity: 0.28 },
        { time: '6:0:0', note: 'D4',  duration: '2m',  velocity: 0.22 },
        { time: '6:0:0', note: 'A4',  duration: '2m',  velocity: 0.18 },
      ],
    },
  },
  {
    id: 'quarry_combat',
    label: 'Quarry Pulse',
    description: 'Slow textural loop for in-game ambience.',
    loop: true,
    volume: 0.25,
    toneSequence: {
      bpm: 56,
      loopEnd: '4m',
      reverb: 3.5,
      steps: [
        { time: '0:0:0', note: 'D2',  duration: '1m',  velocity: 0.30 },
        { time: '0:0:0', note: 'A3',  duration: '1m',  velocity: 0.22 },
        { time: '1:0:0', note: 'F3',  duration: '1m',  velocity: 0.26 },
        { time: '1:0:0', note: 'C4',  duration: '1m',  velocity: 0.20 },
        { time: '2:0:0', note: 'G2',  duration: '1m',  velocity: 0.30 },
        { time: '2:0:0', note: 'D4',  duration: '1m',  velocity: 0.22 },
        { time: '3:0:0', note: 'A2',  duration: '1m',  velocity: 0.26 },
        { time: '3:0:0', note: 'E4',  duration: '1m',  velocity: 0.20 },
      ],
    },
  },
];

export const EXAMPLE_AUDIO_TRIGGERS: AudioTriggerDefinition[] = [
  { id: 'ui_confirm', label: 'UI Confirm', category: 'ui', volume: 0.5 },
  { id: 'steam_hiss', label: 'Steam Hiss', category: 'ambient', volume: 0.35, loop: true },
  { id: 'pickup_ping', label: 'Pickup Ping', category: 'ui', volume: 0.45 },
];

export class GameAudioManager {
  private readonly audioEngine: AudioEngine;
  private readonly tone: ToneRuntime | null;
  private readonly tracks = new Map<string, MusicTrackDefinition>();
  private readonly triggers = new Map<string, AudioTriggerDefinition>();
  private readonly activeHandles = new Map<string, { stop: () => void }>();

  // Footstep tracking
  private readonly lastFootstepTime = new Map<string, number>();
  private readonly footstepInterval = 0.3; // seconds between footsteps

  private mixer: AudioMixerState = {
    master: 0.8,
    music: 0.55,
    sfx: 0.75,
    muted: false,
    toneAvailable: false,
  };

  private listenerCamera: THREE.Camera | null = null;
  private activeMusicId: string | null = null;
  private activeTonePart: any = null;
  private activeToneNodes: any[] = [];
  private systemContext: SystemContext | null = null;

  constructor() {
    this.audioEngine = new AudioEngine();
    this.tone = ((globalThis as any).Tone ?? null) as ToneRuntime | null;
    this.mixer.toneAvailable = !!this.tone;
    this._applyMixerState();
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
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.activeMusicId ? 'active' : 'idle',
      active: this.activeMusicId !== null,
      metrics: {
        activeMusicId: this.activeMusicId,
        trackCount: this.tracks.size,
        triggerCount: this.triggers.size,
        activeHandleCount: this.activeHandles.size,
        toneAvailable: this.mixer.toneAvailable,
        hasSystemContext: this.systemContext !== null,
      },
      mixer: this.getMixerState(),
    };
  }

  hasToneJs(): boolean {
    return !!this.tone;
  }

  registerTrack(track: MusicTrackDefinition): void {
    this.tracks.set(track.id, track);
    if (track.soundKey && track.soundUrl) {
      void this.audioEngine.preload({ [track.soundKey]: track.soundUrl });
    }
  }

  registerTrigger(trigger: AudioTriggerDefinition): void {
    this.triggers.set(trigger.id, trigger);
    if (trigger.soundKey && trigger.soundUrl) {
      void this.audioEngine.preload({ [trigger.soundKey]: trigger.soundUrl });
    }
  }

  registerDefaults(): void {
    for (const track of EXAMPLE_AUDIO_TRACKS) this.registerTrack(track);
    for (const trigger of EXAMPLE_AUDIO_TRIGGERS) this.registerTrigger(trigger);
  }

  getTrack(trackId: string): MusicTrackDefinition | null {
    return this.tracks.get(trackId) ?? null;
  }

  getTrackDefinitions(): MusicTrackDefinition[] {
    return Array.from(this.tracks.values());
  }

  getActiveMusicId(): string | null {
    return this.activeMusicId;
  }

  attachCamera(camera: THREE.Camera | null): void {
    this.listenerCamera = camera;
  }

  // Synthesized ambient drone handles (used when Tone.js is unavailable)
  private ambientDroneNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private ambientDroneCtx: AudioContext | null = null;

  playMusic(trackId: string): void {
    const track = this.tracks.get(trackId);
    if (!track) return;

    this.stopMusic();
    this.activeMusicId = trackId;
    gameBus.emit('stateMutation', {
      source: 'gameAudioManager',
      path: 'audio.music',
      changedCount: 1,
    });

    if (this.tone && track.toneSequence) {
      void this._playToneTrack(track);
      return;
    }

    if (track.soundKey) {
      const handle = this.audioEngine.play(track.soundKey, {
        category: 'music',
        loop: track.loop ?? true,
        volume: track.volume ?? 0.4,
      });
      if (handle) {
        this.activeHandles.set(handle.id, handle);
      }
      return;
    }

    // No Tone.js and no soundKey — synthesize a relaxing ambient drone using raw Web Audio
    this._startAmbientDrone(track.volume ?? 0.25);
  }

  stopMusic(): void {
    for (const [id, handle] of [...this.activeHandles.entries()]) {
      handle.stop();
      this.activeHandles.delete(id);
    }
    this.activeMusicId = null;
    gameBus.emit('stateMutation', {
      source: 'gameAudioManager',
      path: 'audio.music',
      changedCount: 1,
    });

    if (this.tone?.Transport) {
      this.tone.Transport.stop?.();
      this.tone.Transport.cancel?.();
    }
    this.activeTonePart?.dispose?.();
    this.activeTonePart = null;
    for (const node of this.activeToneNodes) {
      node.dispose?.();
    }
    this.activeToneNodes = [];
    this._stopAmbientDrone();
  }

  playTrigger(triggerId: string, position?: { x: number; y: number; z: number }): string | null {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return null;
    if (!trigger.soundKey) {
      return this.playSyntheticTrigger(triggerId, trigger, position);
    }
    const handle = position
      ? this.audioEngine.playAt(trigger.soundKey, position, {
          category: trigger.category ?? 'ambient',
          volume: trigger.volume ?? 0.5,
          loop: trigger.loop ?? false,
        })
      : this.audioEngine.play(trigger.soundKey, {
          category: trigger.category ?? 'ui',
          volume: trigger.volume ?? 0.5,
          loop: trigger.loop ?? false,
        });

    if (!handle) return null;
    this.activeHandles.set(handle.id, handle);
    return handle.id;
  }

  private playSyntheticTrigger(
    triggerId: string,
    trigger: AudioTriggerDefinition,
    position?: { x: number; y: number; z: number },
  ): string | null {
    if ((trigger.category ?? 'ui') !== 'ui') {
      return null;
    }

    const listenerPosition = this.listenerCamera
      ? {
          x: this.listenerCamera.position.x,
          y: this.listenerCamera.position.y,
          z: this.listenerCamera.position.z,
        }
      : { x: 0, y: 0, z: 0 };
    const tonePosition = position ?? listenerPosition;
    const frequency = triggerId === 'ui_confirm' ? 880 : 1320;
    const handle = this.audioEngine.playToneAt(frequency, tonePosition, {
      category: 'ui',
      durationMs: triggerId === 'ui_confirm' ? 90 : 60,
      volume: trigger.volume ?? 0.2,
      waveform: triggerId === 'ui_confirm' ? 'triangle' : 'sine',
      maxDist: 1000,
    });
    if (!handle) {
      return null;
    }
    this.activeHandles.set(handle.id, handle);
    return handle.id;
  }

  /**
   * Play a synthetic footstep sound at the given position.
   * Uses tone generation for a simple thud/click sound.
   */
  playFootstep(position: { x: number; y: number; z: number }, entityId?: string): string | null {
    // Generate a simple footstep sound: short low-frequency tone with slight randomization
    const frequency = 80 + Engine.random.next() * 40; // 80-120 Hz for a thud
    const handle = this.audioEngine.playToneAt(frequency, position, {
      category: 'footstep',
      volume: 0.4 + Engine.random.next() * 0.2, // 0.4-0.6
      durationMs: 150 + Engine.random.next() * 100, // 150-250ms
      pitch: 0.8 + Engine.random.next() * 0.4, // slight pitch variation
      entityId,
    });
    if (!handle) return null;
    this.activeHandles.set(handle.id, handle);
    return handle.id;
  }

  /**
   * Play a synthetic enemy growl or attack sound.
   */
  playEnemySound(soundType: 'growl' | 'attack' | 'death', position: { x: number; y: number; z: number }, entityId?: string): string | null {
    let frequency: number;
    let duration: number;
    let volume: number;

    switch (soundType) {
      case 'growl':
        frequency = 100 + Engine.random.next() * 50; // low growl
        duration = 500 + Engine.random.next() * 500;
        volume = 0.6;
        break;
      case 'attack':
        frequency = 200 + Engine.random.next() * 100; // higher pitched attack
        duration = 200 + Engine.random.next() * 200;
        volume = 0.8;
        break;
      case 'death':
        frequency = 150 + Engine.random.next() * 50; // medium death groan
        duration = 800 + Engine.random.next() * 400;
        volume = 0.7;
        break;
    }

    const handle = this.audioEngine.playToneAt(frequency, position, {
      category: 'enemy',
      volume,
      durationMs: duration,
      entityId,
    });
    if (!handle) return null;
    this.activeHandles.set(handle.id, handle);
    return handle.id;
  }

  stopHandle(handleId: string): void {
    const handle = this.activeHandles.get(handleId);
    if (!handle) return;
    handle.stop();
    this.activeHandles.delete(handleId);
  }

  toggleMute(): void {
    this.mixer.muted = !this.mixer.muted;
    this._applyMixerState();
  }

  setMuted(value: boolean): void {
    this.mixer.muted = value;
    this._applyMixerState();
  }

  setChannelVolume(channel: AudioChannel, value: number): void {
    this.mixer[channel] = clamp01(value);
    this._applyMixerState();
    gameBus.emit('stateMutation', {
      source: 'gameAudioManager',
      path: `audio.${channel}`,
      changedCount: 1,
    });
  }

  adjustChannelVolume(channel: AudioChannel, delta: number): void {
    this.setChannelVolume(channel, this.mixer[channel] + delta);
  }

  getMixerState(): AudioMixerState {
    return { ...this.mixer };
  }

  update(_dt: number, entityPositions?: Map<string, { x: number; y: number; z: number }>): void {
    if (this.listenerCamera instanceof THREE.PerspectiveCamera) {
      this.audioEngine.setListenerPosition(this.listenerCamera.position, this.listenerCamera.rotation);
    }
    this.audioEngine.update(entityPositions);

    // Handle footstep sounds
    this.updateFootsteps(_dt, entityPositions);
  }

  private updateFootsteps(dt: number, entityPositions?: Map<string, { x: number; y: number; z: number }>): void {
    if (!entityPositions || !FeatureManager.isEnabled('audio')) return;

    const now = performance.now() / 1000; // seconds

    for (const [entityId, position] of entityPositions) {
      const lastTime = this.lastFootstepTime.get(entityId) ?? 0;
      if (now - lastTime >= this.footstepInterval) {
        // Check if entity is moving (simple distance check from last position)
        // For now, assume all entities make footsteps when position updates
        // In a real implementation, you'd check velocity or movement state
        this.playFootstep(position, entityId);
        this.lastFootstepTime.set(entityId, now);
      }
    }
  }

  dispose(): void {
    this.stopMusic();
    this.audioEngine.destroy();
  }

  private async _playToneTrack(track: MusicTrackDefinition): Promise<void> {
    if (!this.tone || !track.toneSequence) return;

    await this.tone.start?.();
    this.tone.Transport?.cancel?.();
    if (this.tone.Transport?.bpm) {
      this.tone.Transport.bpm.value = track.toneSequence.bpm ?? 48;
    }
    if (this.tone.Transport) {
      this.tone.Transport.loop = track.loop ?? true;
      this.tone.Transport.loopEnd = track.toneSequence.loopEnd ?? '8m';
    }

    // Use a soft sine-wave PolySynth for ambient pads
    const synthOptions = {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 2.5,
        decay: 1.0,
        sustain: 0.85,
        release: 5.0,
      },
    };
    const synth = this.tone.PolySynth ? new this.tone.PolySynth(undefined, synthOptions).toDestination() : null;
    let reverb: any = null;
    if (this.tone.Reverb && synth) {
      reverb = new this.tone.Reverb(track.toneSequence.reverb ?? 5.0).toDestination();
      if (typeof reverb.generate === 'function') {
        await reverb.generate();
      }
      if (typeof synth.connect === 'function') {
        synth.connect(reverb);
      }
    }

    if (this.tone.Part && synth) {
      this.activeTonePart = new this.tone.Part((time: unknown, event: ToneSequenceStep) => {
        synth.triggerAttackRelease(event.note, event.duration, time, event.velocity ?? 0.3);
      }, track.toneSequence.steps.map((step) => [step.time, step])).start(0);
    }

    this.activeToneNodes = [synth, reverb].filter(Boolean);
    this._applyMixerState();
    this.tone.Transport?.start?.();
  }

  /**
   * Synthesize a soft ambient drone directly with the Web Audio API.
   * Layered detuned sine oscillators with slow LFO volume modulation — produces
   * a relaxing, gently evolving pad without any external library.
   */
  private _startAmbientDrone(targetVolume: number): void {
    const ctx = (this.audioEngine as any).ctx as AudioContext | undefined;
    if (!ctx) return;
    this.ambientDroneCtx = ctx;

    // F2 major7 chord as drone: F2, A2, C3, E3 with slight detuning per layer
    const baseFreqs = [87.31, 110.00, 130.81, 164.81]; // F2, A2, C3, E3
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    // Slow fade-in over 4 seconds
    masterGain.gain.setTargetAtTime(targetVolume * (this.mixer.muted ? 0 : this.mixer.master * this.mixer.music), ctx.currentTime, 4.0);

    for (let i = 0; i < baseFreqs.length; i++) {
      const baseF = baseFreqs[i];
      // Two detuned sines per note for a lush beating effect
      for (const detune of [-3, +3]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = baseF * Math.pow(2, detune / 1200);

        const gain = ctx.createGain();
        // Each partial gets a soft LFO on volume for organic movement
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.05 + i * 0.017; // very slow, different per partial
        lfoGain.gain.value = 0.08;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start();

        gain.gain.value = 0.18 - i * 0.03; // higher partials softer
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();

        this.ambientDroneNodes.push({ osc, gain });
      }
    }
  }

  private _stopAmbientDrone(): void {
    const ctx = this.ambientDroneCtx;
    for (const { osc, gain } of this.ambientDroneNodes) {
      try {
        // Fade out before stopping to avoid clicks
        if (ctx) {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
          osc.stop(ctx.currentTime + 2.0);
        } else {
          osc.stop();
        }
      } catch (_) {}
    }
    this.ambientDroneNodes = [];
    this.ambientDroneCtx = null;
  }

  private _applyMixerState(): void {
    const master = this.mixer.muted ? 0 : this.mixer.master;
    this.audioEngine.setMasterVolume(master);
    this.audioEngine.setCategoryVolume('music', master * this.mixer.music);
    this.audioEngine.setCategoryVolume('ui', master * this.mixer.sfx);
    this.audioEngine.setCategoryVolume('weapon', master * this.mixer.sfx);
    this.audioEngine.setCategoryVolume('ambient', master * this.mixer.sfx);
    this.audioEngine.setCategoryVolume('enemy', master * this.mixer.sfx);
    this.audioEngine.setCategoryVolume('footstep', master * this.mixer.sfx);

    if (this.tone?.Destination) {
      if (typeof this.tone.Destination.mute === 'boolean') {
        this.tone.Destination.mute = this.mixer.muted;
      }
      if (this.tone.Destination.volume) {
        this.tone.Destination.volume.value = linearToDb(master * this.mixer.music);
      }
    }
  }
}