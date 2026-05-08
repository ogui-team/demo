import barrelRust from './barrel_rust.json';
import crateSupply from './crate_supply.json';
import hangingLight from './hanging_light.json';
import lockerRust from './locker_rust.json';
import pickupAmmoBox from './pickup_ammo_box.json';
import pickupMedkit from './pickup_medkit.json';
import pickupShotgun from './pickup_shotgun.json';
import pickupPistol from './pickup_pistol.json';
import pickupGrenadeLauncher from './pickup_grenade_launcher.json';
import pickupFlareGun from './pickup_flare_gun.json';
import pickupAssaultRifle from './pickup_assault_rifle.json';
import pickupSniperRifle from './pickup_sniper_rifle.json';
import pickupIncineratorGauntlet from './pickup_incinerator_gauntlet.json';
import pickupTomeNecromancy from './pickup_tome_necromancy.json';
import pickupOffhandArcane from './pickup_offhand_arcane.json';
import pickupDebugFireball from './pickup_debug_fireball.json';
import pickupTomeIceLance from './pickup_tome_ice_lance.json';
import pickupTomeFireImp from './pickup_tome_fire_imp.json';
import pickupTomeIceGolem from './pickup_tome_ice_golem.json';
import pickupTomeArcaneAdvanced from './pickup_tome_arcane_advanced.json';
import pickupTomePoison from './pickup_tome_poison.json';
import pickupTomeHoly from './pickup_tome_holy.json';
import pickupTomeStormLoop from './pickup_tome_storm_loop.json';
import pickupRingDash from './pickup_ring_dash.json';
import pickupRingSummoner from './pickup_ring_summoner.json';
import pickupPrismGuardian from './pickup_prism_guardian.json';
import playerV1 from './player_v1.json';
import rockLarge from './rock_large.json';
import treeDead from './tree_dead.json';
import treePine from './tree_pine.json';
import universalDummy from './universal_dummy.json';
import castleWall from './castle_wall.json';
import castleArch from './castle_arch.json';
import castleTowerSection from './castle_tower_section.json';
import castleBattlement from './castle_battlement.json';
import castleStairStep from './castle_stair_step.json';
import castleBridgeSegment from './castle_bridge_segment.json';
import castleFloorTile from './castle_floor_tile.json';
import castleWindow from './castle_window.json';
import dungeonCorridor from './dungeon_corridor.json';
import dungeonCorner from './dungeon_corner.json';
import dungeonRitualRoom from './dungeon_ritual_room.json';
import dungeonVerticalShaft from './dungeon_vertical_shaft.json';
import vegetationVine from './vegetation_vine.json';
import vegetationGrassCluster from './vegetation_grass_cluster.json';
import vegetationMushroomCluster from './vegetation_mushroom_cluster.json';
import pillarGothic from './pillar_gothic.json';
import pillarIndustrialBeam from './pillar_industrial_beam.json';
import rockRubblePile from './rock_rubble_pile.json';

export const BUILTIN_PREFABS = {
  barrel_rust: barrelRust,
  crate_supply: crateSupply,
  hanging_light: hangingLight,
  locker_rust: lockerRust,
  pickup_ammo_box: pickupAmmoBox,
  pickup_medkit: pickupMedkit,
  pickup_shotgun: pickupShotgun,
  pickup_pistol: pickupPistol,
  pickup_grenade_launcher: pickupGrenadeLauncher,
  pickup_flare_gun: pickupFlareGun,
  pickup_assault_rifle: pickupAssaultRifle,
  pickup_sniper_rifle: pickupSniperRifle,
  pickup_incinerator_gauntlet: pickupIncineratorGauntlet,
  pickup_tome_necromancy: pickupTomeNecromancy,
  pickup_offhand_arcane: pickupOffhandArcane,
  pickup_debug_fireball: pickupDebugFireball,
  pickup_tome_ice_lance: pickupTomeIceLance,
  pickup_tome_fire_imp: pickupTomeFireImp,
  pickup_tome_ice_golem: pickupTomeIceGolem,
  pickup_tome_arcane_advanced: pickupTomeArcaneAdvanced,
  pickup_tome_poison: pickupTomePoison,
  pickup_tome_holy: pickupTomeHoly,
  pickup_tome_storm_loop: pickupTomeStormLoop,
  pickup_ring_dash: pickupRingDash,
  pickup_ring_summoner: pickupRingSummoner,
  pickup_prism_guardian: pickupPrismGuardian,
  player_v1: playerV1,
  rock_large: rockLarge,
  tree_dead: treeDead,
  tree_pine: treePine,
  castle_wall: castleWall,
  castle_arch: castleArch,
  castle_tower_section: castleTowerSection,
  castle_battlement: castleBattlement,
  castle_stair_step: castleStairStep,
  castle_bridge_segment: castleBridgeSegment,
  castle_floor_tile: castleFloorTile,
  castle_window: castleWindow,
  dungeon_corridor: dungeonCorridor,
  dungeon_corner: dungeonCorner,
  dungeon_ritual_room: dungeonRitualRoom,
  dungeon_vertical_shaft: dungeonVerticalShaft,
  vegetation_vine: vegetationVine,
  vegetation_grass_cluster: vegetationGrassCluster,
  vegetation_mushroom_cluster: vegetationMushroomCluster,
  pillar_gothic: pillarGothic,
  pillar_industrial_beam: pillarIndustrialBeam,
  rock_rubble_pile: rockRubblePile,
  universal_dummy: universalDummy,
} as const;

export type BuiltinPrefabName = keyof typeof BUILTIN_PREFABS;