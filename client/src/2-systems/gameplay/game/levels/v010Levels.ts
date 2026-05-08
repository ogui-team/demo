import type { LevelDefinition } from '../ScriptedLevelSystem';

export const V010_LEVELS: LevelDefinition[] = [
  {
    id: 'quarry_outpost',
    name: 'Quarry Outpost',
    description: 'A compact combat yard with rusty cover, pickup loops, and ember-lit choke points.',
    playerSpawn: { x: 0, y: 1.6, z: 8 },
    spawnPoints: [
      { x: 0, y: 1.6, z: 8 },
      { x: -7, y: 1.6, z: -6 },
      { x: 8, y: 1.6, z: -8 },
      { x: 10, y: 1.6, z: 3 },
    ],
    environment: {
      fogDensity: 0.026,
      fogColor: 0x4b524c,
      pipelineColorBits: 5,
    },
    primitives: [
      { id: 'ground', kind: 'plane', position: { x: 0, y: 0, z: 0 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 }, size: { width: 34, depth: 34 }, useTerrainSplat: true },
      { id: 'north_wall', kind: 'box', position: { x: 0, y: 2, z: -16 }, size: { width: 30, height: 4, depth: 1.2 }, materialProfile: 'corrodedSteel' },
      { id: 'south_wall', kind: 'box', position: { x: 0, y: 2, z: 16 }, size: { width: 30, height: 4, depth: 1.2 }, materialProfile: 'corrodedSteel' },
      { id: 'west_wall', kind: 'box', position: { x: -16, y: 2, z: 0 }, size: { width: 1.2, height: 4, depth: 30 }, materialProfile: 'corrodedSteel' },
      { id: 'east_wall', kind: 'box', position: { x: 16, y: 2, z: 0 }, size: { width: 1.2, height: 4, depth: 30 }, materialProfile: 'corrodedSteel' },
      { id: 'catwalk', kind: 'box', position: { x: 0, y: 1.1, z: 0 }, size: { width: 10, height: 0.35, depth: 3 }, materialProfile: 'bunkerFloor' },
    ],
    prefabs: [
      { id: 'crate_a', prefab: 'crate_supply', position: { x: -4, y: 0.9, z: -2 } },
      { id: 'crate_b', prefab: 'crate_supply', position: { x: 4, y: 0.9, z: 4 } },
      { id: 'barrel_a', prefab: 'barrel_rust', position: { x: -9, y: 0.9, z: 9 } },
      { id: 'barrel_b', prefab: 'barrel_rust', position: { x: 8, y: 0.9, z: -4 } },
      { id: 'light_a', prefab: 'hanging_light', position: { x: -5, y: 3.1, z: 0 } },
      { id: 'light_b', prefab: 'hanging_light', position: { x: 6, y: 3.1, z: -6 } },
      { id: 'ammo_pickup', prefab: 'pickup_ammo_box', position: { x: 9, y: 0.45, z: 9 } },
      { id: 'med_pickup', prefab: 'pickup_medkit', position: { x: -10, y: 0.45, z: -10 } },
      { id: 'shotgun_pickup', prefab: 'pickup_shotgun', position: { x: 0, y: 0.45, z: -8 } },
    ],
    ambientVfx: [
      { id: 'embers_a', preset: 'emberTorch', position: { x: -5, y: 2.4, z: 0 } },
      { id: 'embers_b', preset: 'emberTorch', position: { x: 6, y: 2.4, z: -6 } },
    ],
    scripts: [
      { type: 'playMusic', trackId: 'quarry_combat' },
      { type: 'triggerBurst', preset: 'spawnBurst', position: { x: 0, y: 1.2, z: 8 } },
    ],
  },
  {
    id: 'dead_pines',
    name: 'Dead Pines',
    description: 'Open-air woodland with prefab foliage, rocks, and low-visibility lanes for freeplay exploration.',
    playerSpawn: { x: 0, y: 1.6, z: 12 },
    spawnPoints: [
      { x: 0, y: 1.6, z: 12 },
      { x: -12, y: 1.6, z: 0 },
      { x: 10, y: 1.6, z: -8 },
      { x: 12, y: 1.6, z: 10 },
    ],
    environment: {
      fogDensity: 0.038,
      fogColor: 0x2e3b2f,
      pipelineColorBits: 5,
    },
    primitives: [
      { id: 'forest_ground', kind: 'plane', position: { x: 0, y: 0, z: 0 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 }, size: { width: 56, depth: 56 }, useTerrainSplat: true },
      { id: 'ridge_a', kind: 'box', position: { x: -9, y: 1.2, z: -10 }, size: { width: 10, height: 2.4, depth: 3 }, materialProfile: 'bunkerFloor' },
      { id: 'ridge_b', kind: 'box', position: { x: 11, y: 1.6, z: 8 }, size: { width: 8, height: 3.2, depth: 4 }, materialProfile: 'bunkerFloor' },
    ],
    prefabs: [
      { id: 'pine_a', prefab: 'tree_pine', position: { x: -14, y: 2.2, z: -14 } },
      { id: 'pine_b', prefab: 'tree_pine', position: { x: 13, y: 2.2, z: -10 } },
      { id: 'pine_c', prefab: 'tree_pine', position: { x: 16, y: 2.2, z: 12 } },
      { id: 'dead_a', prefab: 'tree_dead', position: { x: -18, y: 2.2, z: 5 } },
      { id: 'rock_a', prefab: 'rock_large', position: { x: -6, y: 0.8, z: -4 } },
      { id: 'rock_b', prefab: 'rock_large', position: { x: 8, y: 0.8, z: 6 } },
      { id: 'crate_a', prefab: 'crate_supply', position: { x: 2, y: 0.9, z: -6 } },
      { id: 'locker_a', prefab: 'locker_rust', position: { x: -10, y: 0.9, z: 11 } },
      { id: 'medkit', prefab: 'pickup_medkit', position: { x: 12, y: 0.45, z: -2 } },
    ],
    ambientVfx: [
      { id: 'dust_lane', preset: 'ambientDust', position: { x: 0, y: 0.5, z: 0 } },
      { id: 'dust_ridge', preset: 'ambientDust', position: { x: -9, y: 1.4, z: -10 } },
    ],
    scripts: [
      { type: 'playMusic', trackId: 'menu_theme' },
      { type: 'setFog', density: 0.04, color: 0x263326 },
    ],
  },
];