import type { SoundCategory } from '../../systems/AudioEngine';

export interface AudioEmitterComponent {
  readonly type: 'audioEmitter';
  soundKey: string;
  category: SoundCategory;
  volume: number;
  loop: boolean;
  autoPlay: boolean;
  maxDist?: number;
  toneHz?: number;
  toneDurationMs?: number;
  waveform?: OscillatorType;
  playing?: boolean;
}

export function createAudioEmitterComponent(
  soundKey: string,
  overrides: Partial<Omit<AudioEmitterComponent, 'type' | 'soundKey'>> = {},
): AudioEmitterComponent {
  return {
    type: 'audioEmitter',
    soundKey,
    category: overrides.category ?? 'ambient',
    volume: overrides.volume ?? 0.5,
    loop: overrides.loop ?? false,
    autoPlay: overrides.autoPlay ?? true,
    maxDist: overrides.maxDist,
    playing: overrides.playing ?? false,
  };
}