export interface AudioListenerComponent {
  readonly type: 'audioListener';
  enabled: boolean;
}

export function createAudioListenerComponent(
  overrides: Partial<Omit<AudioListenerComponent, 'type'>> = {},
): AudioListenerComponent {
  return {
    type: 'audioListener',
    enabled: overrides.enabled ?? true,
  };
}