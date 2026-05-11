import type { IAudioService, GamePlugin, PluginInitContext } from '@shared/contracts';

const AUDIO_SERVICE_ID = 'audio';
const AUDIO_MUTED_PATH = 'sdk.services.audio.muted';
const AUDIO_MASTER_VOLUME_PATH = 'sdk.services.audio.masterVolume';

class AudioService implements IAudioService {
  readonly id = AUDIO_SERVICE_ID;

  constructor(private readonly context: PluginInitContext) {}

  play(trackId: string, options?: { volume?: number; loop?: boolean }): void {
    if (this.isMuted()) {
      return;
    }

    this.context.gameBus.emit('audio:play', {
      trackId,
      volume: options?.volume ?? this.getMasterVolume(),
      loop: options?.loop === true,
    });
  }

  stop(trackId: string): void {
    this.context.gameBus.emit('audio:stop', { trackId });
  }

  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.context.stateManager.set(AUDIO_MASTER_VOLUME_PATH, clamped);
  }

  getMasterVolume(): number {
    const value = this.context.stateManager.get(AUDIO_MASTER_VOLUME_PATH);
    if (typeof value === 'number') {
      return value;
    }
    return 1;
  }

  setMuted(muted: boolean): void {
    this.context.stateManager.set(AUDIO_MUTED_PATH, muted);
  }

  isMuted(): boolean {
    return this.context.stateManager.get(AUDIO_MUTED_PATH) === true;
  }

  dispose(): void {
    // State persists in StateManager. No listeners/resources held.
  }
}

export class AudioPlugin implements GamePlugin {
  readonly id = 'sdk-audio-plugin';
  readonly name = 'SDK Audio Plugin';
  readonly version = '0.3.0';
  readonly description = 'Registers a deterministic audio service abstraction.';

  private context: PluginInitContext | null = null;

  init(context: PluginInitContext): void {
    this.context = context;
    context.sdk.registerService(AUDIO_SERVICE_ID, new AudioService(context));

    const audio = context.sdk.getService<IAudioService>(AUDIO_SERVICE_ID);
    if (audio) {
      if (context.stateManager.get(AUDIO_MASTER_VOLUME_PATH) === undefined) {
        audio.setMasterVolume(1);
      }
      if (context.stateManager.get(AUDIO_MUTED_PATH) === undefined) {
        audio.setMuted(false);
      }
    }

    context.logger.log('[AudioPlugin] Registered audio service');
  }

  dispose(): void {
    if (!this.context) {
      return;
    }
    this.context.sdk.unregisterService(AUDIO_SERVICE_ID);
    this.context = null;
  }
}