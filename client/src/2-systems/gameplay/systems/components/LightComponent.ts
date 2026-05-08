export type LightComponentType = 'point' | 'spot';

export interface LightComponentData {
  type: LightComponentType;
  color: number;
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  castShadow?: boolean;
  shadowBias?: number;
  shadowRadius?: number;
  targetOffset?: { x: number; y: number; z: number };
}

export interface LightComponent {
  name: 'light';
  data: LightComponentData;
}

export function createPointLightComponent(
  overrides: Partial<LightComponentData> = {},
): LightComponent {
  return {
    name: 'light',
    data: {
      type: 'point',
      color: 0xffffff,
      intensity: 1.4,
      distance: 14,
      decay: 2,
      castShadow: true,
      shadowBias: -0.001,
      shadowRadius: 2,
      ...overrides,
    },
  };
}

export function createSpotLightComponent(
  overrides: Partial<LightComponentData> = {},
): LightComponent {
  return {
    name: 'light',
    data: {
      type: 'spot',
      color: 0xffd8b4,
      intensity: 2.4,
      distance: 18,
      decay: 2,
      angle: Math.PI * 0.34,
      penumbra: 0.45,
      castShadow: true,
      shadowBias: -0.001,
      shadowRadius: 3,
      targetOffset: { x: 0, y: -1, z: 0 },
      ...overrides,
    },
  };
}
