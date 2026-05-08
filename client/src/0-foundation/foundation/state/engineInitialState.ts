import { normalizeAvatarAppearance } from '../../../2-systems/gameplay/game/AvatarBuilder';

export interface EngineInitialStateConfig {
  fogDensity: number;
  fogColor: number;
  ambientLightIntensity: number;
  directionalLightIntensity: number;
}

export function createInitialEngineState(engineConfig: EngineInitialStateConfig): Record<string, unknown> {
  return {
    engine: {
      appState: 'boot',
    },
    gameplay: {
      active: false,
    },
    mode: 'editor',
    camera: {
      position: { x: 0, y: 5, z: 10 },
      rotation: { x: -0.4636476090008061, y: 0, z: 0 },
      fov: 75,
    },
    fog: {
      density: engineConfig.fogDensity,
      color: engineConfig.fogColor,
      enabled: true,
    },
    lighting: {
      ambientIntensity: engineConfig.ambientLightIntensity,
      directionalIntensity: engineConfig.directionalLightIntensity,
    },
    atmosphericEffects: {
      fogPulsing: true,
      lightingFlicker: true,
      postProcessing: true,
      cameraEffects: true,
    },
    debug: {
      enabled: false,
      visible: false,
    },
    lobby: {
      status: 'idle',
      servers: [],
      localPlayer: {
        appearance: normalizeAvatarAppearance(),
      },
    },
  };
}
