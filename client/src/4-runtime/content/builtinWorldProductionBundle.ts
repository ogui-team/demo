import type {
  BiomeRegionDefinition,
  MaterialLayerDefinition,
  RuntimePrefabVariantDefinition,
  SharedAudioTriggerDefinition,
  SharedMusicTrackDefinition,
  WorldProductionBundle,
} from '@shared/contracts';

const biomeRegions: BiomeRegionDefinition[] = [
  {
    id: 'biome_castle',
    label: 'Castle Keep',
    tags: ['castle', 'medieval'],
    atmosphere: {
      fogColor: 0x8a9cad,
      fogDensity: 0.03,
      ambientTrackId: 'castle_reverb',
      lightingPreset: 'moonlight',
      metadata: { mood: 'gothic', style: 'stone' },
    },
    spawnTable: [
      { id: 'castle_wall_spawn', weight: 8, prefabId: 'castle_wall' },
      { id: 'castle_floor_spawn', weight: 5, prefabId: 'castle_floor_tile' },
      { id: 'castle_arch_spawn', weight: 4, prefabId: 'castle_arch' },
      { id: 'castle_battlement_spawn', weight: 3, prefabId: 'castle_battlement' },
      { id: 'castle_stair_spawn', weight: 2, prefabId: 'castle_stair_step' },
    ],
  },
  {
    id: 'biome_dungeon',
    label: 'Dungeon Depths',
    tags: ['dungeon', 'dark_fantasy'],
    atmosphere: {
      fogColor: 0x11111a,
      fogDensity: 0.08,
      ambientTrackId: 'dungeon_drone',
      lightingPreset: 'horror',
      metadata: { mood: 'ancient', soundscape: 'drip' },
    },
    spawnTable: [
      { id: 'dungeon_corridor_spawn', weight: 8, prefabId: 'dungeon_corridor' },
      { id: 'dungeon_corner_spawn', weight: 5, prefabId: 'dungeon_corner' },
      { id: 'dungeon_ritual_spawn', weight: 3, prefabId: 'dungeon_ritual_room' },
      { id: 'dungeon_shaft_spawn', weight: 2, prefabId: 'dungeon_vertical_shaft' },
    ],
  },
  {
    id: 'biome_swamp',
    label: 'Swamp Gloom',
    tags: ['swamp', 'overgrown'],
    atmosphere: {
      fogColor: 0x324422,
      fogDensity: 0.06,
      ambientTrackId: 'swamp_ambience',
      weatherPreset: 'drizzle',
      metadata: { wetness: 'high', foliage: 'dense' },
    },
    spawnTable: [
      { id: 'vine_spawn', weight: 10, prefabId: 'vegetation_vine' },
      { id: 'grass_spawn', weight: 7, prefabId: 'vegetation_grass_cluster' },
      { id: 'mushroom_spawn', weight: 4, prefabId: 'vegetation_mushroom_cluster' },
      { id: 'overgrown_wall_spawn', weight: 3, prefabId: 'castle_wall_overgrown' },
    ],
  },
  {
    id: 'biome_volcanic',
    label: 'Volcanic Ruins',
    tags: ['volcanic'],
    atmosphere: {
      fogColor: 0x5c260f,
      fogDensity: 0.05,
      ambientTrackId: 'lava_glow',
      lightingPreset: 'lava',
      metadata: { heat: 'intense', ash: true },
    },
    spawnTable: [
      { id: 'lava_wall_spawn', weight: 5, prefabId: 'castle_wall_volcanic' },
      { id: 'rubble_spawn', weight: 6, prefabId: 'rock_rubble_pile' },
      { id: 'beam_spawn', weight: 4, prefabId: 'pillar_industrial_beam' },
    ],
  },
];

const materialLayers: MaterialLayerDefinition[] = [
  {
    id: 'stone_natural',
    label: 'Stone Volume',
    tags: ['castle', 'dungeon', 'wall', 'floor'],
    tint: 0x8b8b7f,
    emissive: 0x222222,
    metadata: { type: 'stone', triplanarReady: true },
  },
  {
    id: 'moss_overlay',
    label: 'Moss Overlay',
    tags: ['overgrown', 'moss'],
    tint: 0x6b8b5d,
    emissive: 0x2f4f2f,
    opacity: 0.9,
    metadata: { wetness: 'low', decalReady: true },
  },
  {
    id: 'lava_rock',
    label: 'Lava Rock',
    tags: ['volcanic', 'lava'],
    tint: 0x7d2f1a,
    emissive: 0xee4400,
    metadata: { emissivePulseHz: 1.2 },
  },
  {
    id: 'corrupted_biomass',
    label: 'Corrupted Biomass',
    tags: ['corrupted', 'biomass'],
    tint: 0x662f78,
    emissive: 0x440044,
    metadata: { organic: true },
  },
];

const audioTracks: SharedMusicTrackDefinition[] = [
  {
    id: 'castle_reverb',
    label: 'Castle Reverberation',
    loop: true,
    volume: 0.14,
  },
  {
    id: 'dungeon_drone',
    label: 'Dungeon Drone',
    loop: true,
    volume: 0.12,
  },
  {
    id: 'swamp_ambience',
    label: 'Swamp Ambience',
    loop: true,
    volume: 0.16,
  },
  {
    id: 'lava_glow',
    label: 'Lava Glow',
    loop: true,
    volume: 0.18,
  },
];

const audioTriggers: SharedAudioTriggerDefinition[] = [
  { id: 'sewer_ambience', label: 'Sewer Ambience', category: 'ambient', loop: true, volume: 0.2 },
  { id: 'wind_tunnel', label: 'Wind Tunnel', category: 'ambient', loop: true, volume: 0.18 },
  { id: 'combat_echo', label: 'Combat Echo', category: 'ambient', loop: true, volume: 0.22 },
  { id: 'ritual_hum', label: 'Ritual Hum', category: 'ambient', loop: true, volume: 0.2 },
  { id: 'machine_ambience', label: 'Machine Ambience', category: 'ambient', loop: true, volume: 0.18 },
];

const prefabVariants: RuntimePrefabVariantDefinition[] = [
  {
    id: 'castle_wall_ruined',
    basePrefabId: 'castle_wall',
    color: 0x7f6e60,
    tags: ['ruined', 'dark_fantasy', 'corrupted'],
    metadata: {
      runtimeMetadata: {
        affinities: ['dark_fantasy', 'ruins'],
        destruction: { state: 'cracked' },
        renderCompatibility: ['3d', 'orthographic', 'top-down', 'side-scroller'],
      },
    },
  },
  {
    id: 'castle_wall_overgrown',
    basePrefabId: 'castle_wall',
    color: 0x5a7a4c,
    tags: ['overgrown', 'swamp'],
    metadata: {
      runtimeMetadata: {
        affinities: ['overgrown', 'swamp'],
        destruction: { state: 'mossed' },
        audioSurfaceType: 'foliage',
      },
    },
  },
  {
    id: 'castle_wall_volcanic',
    basePrefabId: 'castle_wall',
    color: 0x6b2f1c,
    tags: ['volcanic', 'lava'],
    metadata: {
      runtimeMetadata: {
        affinities: ['volcanic'],
        destruction: { state: 'burned' },
        audioSurfaceType: 'lava_rock',
      },
    },
  },
  {
    id: 'vegetation_vine_tangle',
    basePrefabId: 'vegetation_vine',
    color: 0x43702d,
    tags: ['overgrown', 'climbable'],
    metadata: {
      runtimeMetadata: {
        affinities: ['overgrown', 'swamp'],
        traversal: { climbable: true },
        renderCompatibility: ['3d', 'side-scroller', 'top-down'],
      },
    },
  },
  {
    id: 'pillar_gothic_broken',
    basePrefabId: 'pillar_gothic',
    color: 0x5b5247,
    tags: ['broken', 'ruined'],
    metadata: {
      runtimeMetadata: {
        affinities: ['dark_fantasy', 'ruins'],
        destruction: { state: 'collapsed' },
      },
    },
  },
  {
    id: 'dungeon_ritual_room_corrupted',
    basePrefabId: 'dungeon_ritual_room',
    color: 0x5b274a,
    tags: ['corrupted', 'ritual'],
    metadata: {
      runtimeMetadata: {
        affinities: ['dark_fantasy', 'dungeon'],
        audioSurfaceType: 'corrupted_biomass',
        renderCompatibility: ['3d', 'orthographic'],
      },
    },
  },
];

export const BUILTIN_MODULAR_CONTENT_BUNDLE: WorldProductionBundle = {
  id: 'modular_content_ecosystem',
  label: 'Modular Content Ecosystem',
  version: 1,
  biomeRegions,
  proceduralWorld: {
    id: 'modular_content_procedural',
    baseSeed: 123456789,
    chunkSize: 32,
    defaultBiomeId: 'biome_castle',
    spawnDensity: 0.3,
    metadata: { system: 'modular_content' },
    runtimePolicy: { navRebuildOnGenerate: true },
  },
  eventGraphs: [],
  cinematicSequences: [],
  materialLayers,
  audioTracks,
  audioTriggers,
  authoring: {
    prefabVariants,
    metadata: { platform: 'modular_content_ecosystem' },
  },
  metadata: {
    description: 'Built-in modular content layer for castle, dungeon, vegetation, and structural kit authoring.',
  },
};
