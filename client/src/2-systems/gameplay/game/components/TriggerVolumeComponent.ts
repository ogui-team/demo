export interface TriggerVolumeSize {
  x: number;
  y: number;
  z: number;
}

export interface TriggerVolumeComponent {
  readonly type: 'triggerVolume';
  size: TriggerVolumeSize;
  enabled?: boolean;
  tags?: string[];
  editorColor?: number;
}

export function createTriggerVolumeComponent(
  size: TriggerVolumeSize,
  overrides: Partial<Omit<TriggerVolumeComponent, 'type' | 'size'>> = {},
): TriggerVolumeComponent {
  return {
    type: 'triggerVolume',
    size: {
      x: Math.max(0.01, size.x),
      y: Math.max(0.01, size.y),
      z: Math.max(0.01, size.z),
    },
    enabled: true,
    tags: [],
    ...overrides,
  };
}