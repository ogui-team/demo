import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { AudioEngine, type SoundCategory, type SoundHandle } from './AudioEngine';

interface AudioEmitterData {
  soundKey: string;
  category?: SoundCategory;
  volume?: number;
  loop?: boolean;
  autoPlay?: boolean;
  maxDist?: number;
  toneHz?: number;
  toneDurationMs?: number;
  waveform?: OscillatorType;
  playing?: boolean;
}

interface AudioListenerData {
  enabled?: boolean;
}

interface AudioBackend {
  playAt(
    soundKey: string,
    position: { x: number; y: number; z: number },
    opts?: {
      category?: SoundCategory;
      volume?: number;
      loop?: boolean;
      maxDist?: number;
      entityId?: string;
    },
  ): SoundHandle | null;
  playToneAt?(
    frequency: number,
    position: { x: number; y: number; z: number },
    opts?: {
      category?: SoundCategory;
      volume?: number;
      loop?: boolean;
      maxDist?: number;
      entityId?: string;
      durationMs?: number;
      waveform?: OscillatorType;
    },
  ): SoundHandle | null;
  setListenerPosition(position: { x: number; y: number; z: number }, rotation?: THREE.Euler): void;
  update(entityPositions?: Map<string, { x: number; y: number; z: number }>): void;
  stopEntity(entityId: string): void;
  destroy(): void;
}

export class AudioSystem {
  private readonly audioEngine: AudioBackend;
  private systemContext: SystemContext | null = null;
  private readonly activeEmitterIds = new Set<string>();

  constructor(audioEngine: AudioBackend = new AudioEngine()) {
    this.audioEngine = audioEngine;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
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
      status: this.activeEmitterIds.size > 0 ? 'active' : 'idle',
      active: this.activeEmitterIds.size > 0,
      metrics: {
        activeEmitterCount: this.activeEmitterIds.size,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  playOneShotAt(
    soundKey: string,
    position: { x: number; y: number; z: number },
    overrides: Partial<AudioEmitterData> = {},
  ): SoundHandle | null {
    return this.playEmitterAt({ autoPlay: true, ...overrides, soundKey }, position);
  }

  update(_dt: number): void {
    const entityManager = this.systemContext?.entityManager;
    if (!entityManager) {
      return;
    }

    const entityPositions = new Map<string, { x: number; y: number; z: number }>();
    const nextEmitterIds = new Set<string>();

    for (const entity of entityManager.getEntities()) {
      if (!entity.active) {
        continue;
      }

      const listener = entity.getComponent('audioListener')?.data as AudioListenerData | undefined;
      if (listener?.enabled !== false) {
        this.audioEngine.setListenerPosition(
          entity.getPosition(),
          new THREE.Euler(entity.getRotation().x, entity.getRotation().y, entity.getRotation().z),
        );
      }

      const emitter = entity.getComponent('audioEmitter')?.data as AudioEmitterData | undefined;
      if (!emitter) {
        continue;
      }

      nextEmitterIds.add(entity.id);
      entityPositions.set(entity.id, entity.getPosition());

      if (emitter.autoPlay === false || emitter.playing) {
        continue;
      }

      const handle = this.playEmitterAt(emitter, entity.getPosition(), entity.id);
      if (handle) {
        emitter.playing = true;
      }
    }

    for (const emitterId of this.activeEmitterIds) {
      if (!nextEmitterIds.has(emitterId)) {
        this.audioEngine.stopEntity(emitterId);
      }
    }

    this.activeEmitterIds.clear();
    for (const emitterId of nextEmitterIds) {
      this.activeEmitterIds.add(emitterId);
    }

    this.audioEngine.update(entityPositions);
  }

  private playEmitterAt(
    emitter: AudioEmitterData,
    position: { x: number; y: number; z: number },
    entityId?: string,
  ): SoundHandle | null {
    const handle = this.audioEngine.playAt(emitter.soundKey, position, {
      category: emitter.category,
      volume: emitter.volume,
      loop: emitter.loop,
      maxDist: emitter.maxDist,
      entityId,
    });
    if (handle) {
      return handle;
    }

    if (typeof emitter.toneHz === 'number' && this.audioEngine.playToneAt) {
      return this.audioEngine.playToneAt(emitter.toneHz, position, {
        category: emitter.category,
        volume: emitter.volume,
        loop: emitter.loop,
        maxDist: emitter.maxDist,
        entityId,
        durationMs: emitter.toneDurationMs,
        waveform: emitter.waveform,
      });
    }

    return null;
  }

  dispose(): void {
    this.audioEngine.destroy();
    this.activeEmitterIds.clear();
  }
}