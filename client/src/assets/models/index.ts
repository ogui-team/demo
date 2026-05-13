import * as THREE from 'three';
import { registerModelTemplate } from '../../2-systems/gameplay/systems/AssetRegistry';

function mesh(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

function createCrate(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), 0x7a5a34);
  body.position.y = 0.8;
  const bandA = mesh(new THREE.BoxGeometry(1.7, 0.18, 0.18), 0x49301d);
  bandA.position.y = 1.15;
  const bandB = bandA.clone();
  bandB.position.y = 0.45;
  const bandC = mesh(new THREE.BoxGeometry(0.18, 1.7, 0.18), 0x49301d);
  bandC.position.set(0.35, 0.8, 0);
  const bandD = bandC.clone();
  bandD.position.set(-0.35, 0.8, 0);
  group.add(body, bandA, bandB, bandC, bandD);
  return group;
}

function createBarrel(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.5, 10), 0x6c4c32);
  body.position.y = 0.75;
  const rimTop = mesh(new THREE.TorusGeometry(0.52, 0.08, 4, 10), 0x2f2f2f);
  rimTop.rotation.x = Math.PI / 2;
  rimTop.position.y = 1.4;
  const rimMid = rimTop.clone();
  rimMid.position.y = 0.75;
  const rimBottom = rimTop.clone();
  rimBottom.position.y = 0.1;
  group.add(body, rimTop, rimMid, rimBottom);
  return group;
}

function createPlayerSpawnPointMarker(): THREE.Group {
  const group = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.35, 0.06, 6, 12), 0x2ac7c1);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  const stem = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8), 0x2a6cff);
  stem.position.y = 0.45;
  const tip = mesh(new THREE.ConeGeometry(0.22, 0.35, 8), 0x7cf6ff);
  tip.position.y = 1.0;
  group.add(ring, stem, tip);
  return group;
}

function createDeadTree(): THREE.Group {
  const group = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.28, 3.8, 6), 0x4b3527);
  trunk.position.y = 1.9;
  group.add(trunk);
  for (const [x, y, z, ry] of [[0.4, 2.8, 0, 0.5], [-0.35, 2.3, 0.2, -0.8], [0.2, 3.2, -0.25, 1.1]] as const) {
    const branch = mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.4, 5), 0x4b3527);
    branch.position.set(x, y, z);
    branch.rotation.z = Math.PI / 2.5;
    branch.rotation.y = ry;
    group.add(branch);
  }
  return group;
}

function createPineTree(): THREE.Group {
  const group = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.3, 3.4, 6), 0x523723);
  trunk.position.y = 1.7;
  const canopyA = mesh(new THREE.ConeGeometry(1.5, 2.1, 7), 0x24412d);
  canopyA.position.y = 2.8;
  const canopyB = mesh(new THREE.ConeGeometry(1.1, 1.8, 7), 0x2f5938);
  canopyB.position.y = 3.8;
  group.add(trunk, canopyA, canopyB);
  return group;
}

function createRock(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.DodecahedronGeometry(1.1, 0), 0x6f746d);
  body.scale.set(1.2, 0.8, 1);
  const shard = mesh(new THREE.DodecahedronGeometry(0.45, 0), 0x81867d);
  shard.position.set(0.75, 0.2, -0.1);
  group.add(body, shard);
  return group;
}

function createCastleWall(): THREE.Group {
  const group = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(4, 2.5, 0.75), 0x8b7f6f);
  base.position.y = 1.25;
  const battlement = mesh(new THREE.BoxGeometry(0.5, 0.6, 0.75), 0x8b7f6f);
  for (let i = -1.5; i <= 1.5; i += 1.0) {
    const block = battlement.clone();
    block.position.set(i, 2.55, 0);
    group.add(block);
  }
  group.add(base);
  return group;
}

function createCastleArch(): THREE.Group {
  const group = new THREE.Group();
  // Pillar: height=2.5, centered at y=1.25 → bottom sits exactly on y=0 (floor)
  const side = mesh(new THREE.BoxGeometry(0.5, 2.5, 0.75), 0x8b7f6f);
  // Beam: height=0.5, sits on top of pillars (pillar top = 2.5 → beam center = 2.75)
  const top = mesh(new THREE.BoxGeometry(2.0, 0.5, 0.75), 0x8b7f6f);
  side.position.set(-1.1, 1.25, 0);
  const sideRight = side.clone();
  sideRight.position.x = 1.1;
  top.position.set(0, 2.75, 0);
  group.add(side, sideRight, top);
  return group;
}

function createCastleFloorTile(): THREE.Group {
  const group = new THREE.Group();
  const tile = mesh(new THREE.BoxGeometry(2, 0.2, 2), 0x7c6f5e);
  group.add(tile);
  return group;
}

function createCastleBridgeSegment(): THREE.Group {
  const group = new THREE.Group();
  const deck = mesh(new THREE.BoxGeometry(3.5, 0.3, 1.8), 0x8b7f6f);
  deck.position.y = 0.1;
  const left = mesh(new THREE.BoxGeometry(0.2, 0.8, 1.8), 0x6f5e4f);
  const right = left.clone();
  left.position.set(-1.65, 0.5, 0);
  right.position.set(1.65, 0.5, 0);
  group.add(deck, left, right);
  return group;
}

function createDungeonCorridor(): THREE.Group {
  const group = new THREE.Group();
  const floor = mesh(new THREE.BoxGeometry(4, 0.2, 2), 0x4b4b4b);
  const left = mesh(new THREE.BoxGeometry(0.3, 3, 2), 0x525252);
  const right = left.clone();
  left.position.set(-1.85, 1.5, 0);
  right.position.set(1.85, 1.5, 0);
  const ceiling = mesh(new THREE.BoxGeometry(4, 0.3, 2), 0x3f3f3f);
  ceiling.position.y = 3.0;
  group.add(floor, left, right, ceiling);
  return group;
}

function createDungeonRitualRoom(): THREE.Group {
  const group = new THREE.Group();
  const floor = mesh(new THREE.BoxGeometry(5.5, 0.2, 5.5), 0x3d3636);
  const pillarA = mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 8), 0x4b4545);
  pillarA.position.set(-2.1, 1.5, -2.1);
  const pillarB = pillarA.clone();
  pillarB.position.set(2.1, 1.5, 2.1);
  const altar = mesh(new THREE.BoxGeometry(2.0, 0.6, 1.4), 0x2f2727);
  altar.position.set(0, 0.4, 0);
  group.add(floor, pillarA, pillarB, altar);
  return group;
}

function createDungeonVerticalShaft(): THREE.Group {
  const group = new THREE.Group();
  const shaft = mesh(new THREE.BoxGeometry(3, 6, 3), 0x484848);
  shaft.position.y = 3.0;
  const rung = mesh(new THREE.BoxGeometry(2.5, 0.1, 0.1), 0x403f3f);
  for (let y = 0.5; y < 5.5; y += 1.0) {
    const rungClone = rung.clone();
    rungClone.position.set(0, y, -1.4);
    group.add(rungClone);
  }
  group.add(shaft);
  return group;
}

function createVegetationVine(): THREE.Group {
  const group = new THREE.Group();
  const vine = mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), 0x3f6a2f);
  vine.position.y = 1.7;
  const leaf = mesh(new THREE.BoxGeometry(0.5, 0.1, 0.2), 0x4b7f3f);
  leaf.position.set(0.15, 2.3, 0);
  group.add(vine, leaf);
  return group;
}

function createVegetationGrassCluster(): THREE.Group {
  const group = new THREE.Group();
  for (let offset of [ -0.25, 0, 0.25 ]) {
    const blade = mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), 0x4b7f3f);
    blade.position.set(offset, 0.55, 0);
    blade.rotation.z = Math.PI / 10;
    group.add(blade);
  }
  const base = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.4, 6), 0x2f4f2f);
  base.position.y = 0.2;
  group.add(base);
  return group;
}

function createVegetationMushroomCluster(): THREE.Group {
  const group = new THREE.Group();
  const stemA = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), 0xdcc6ae);
  stemA.position.set(-0.3, 0.3, 0);
  const capA = mesh(new THREE.ConeGeometry(0.3, 0.4, 8), 0x935e9f);
  capA.position.set(-0.3, 0.6, 0);
  const stemB = stemA.clone();
  stemB.position.set(0.3, 0.25, 0);
  const capB = capA.clone();
  capB.position.set(0.3, 0.55, 0);
  group.add(stemA, capA, stemB, capB);
  return group;
}

function createPillarGothic(): THREE.Group {
  const group = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.35, 0.35, 4.2, 10), 0x7b6f63);
  base.position.y = 2.1;
  const ring = mesh(new THREE.TorusGeometry(0.38, 0.08, 6, 20), 0x6b5f53);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 3.3;
  group.add(base, ring);
  return group;
}

function createPillarIndustrialBeam(): THREE.Group {
  const group = new THREE.Group();
  const beam = mesh(new THREE.BoxGeometry(1.0, 4.0, 1.0), 0x5a5a5a);
  beam.position.y = 2.0;
  const brace = mesh(new THREE.BoxGeometry(0.2, 3.0, 0.2), 0x3f3f3f);
  brace.position.set(0.25, 2.0, 0.25);
  group.add(beam, brace);
  return group;
}

function createRockRubblePile(): THREE.Group {
  const group = new THREE.Group();
  const left = mesh(new THREE.DodecahedronGeometry(0.7, 0), 0x5b5b5b);
  left.position.set(-0.4, 0.3, 0);
  const right = mesh(new THREE.DodecahedronGeometry(0.5, 0), 0x6f6f6f);
  right.position.set(0.3, 0.2, 0.2);
  const top = mesh(new THREE.DodecahedronGeometry(0.4, 0), 0x4f4f4f);
  top.position.set(0.1, 0.6, -0.2);
  group.add(left, right, top);
  return group;
}

function createStructuralBlock(): THREE.Group {
  const group = new THREE.Group();
  const cube = mesh(new THREE.BoxGeometry(2.0, 1.2, 1.2), 0x7f7f7f);
  cube.position.y = 0.6;
  group.add(cube);
  return group;
}

function createLightFixture(): THREE.Group {
  const group = new THREE.Group();
  const chain = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), 0x303030);
  chain.position.y = 0.6;
  const shade = mesh(new THREE.ConeGeometry(0.45, 0.5, 8), 0xcaa15e);
  shade.position.y = 0.1;
  shade.rotation.x = Math.PI;
  const bulb = mesh(new THREE.SphereGeometry(0.18, 8, 8), 0xffe5a3);
  bulb.position.y = -0.18;
  group.add(chain, shade, bulb);
  return group;
}

function createLocker(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.2, 2.8, 1), 0x48505b);
  body.position.y = 1.4;
  const door = mesh(new THREE.BoxGeometry(1.05, 2.55, 0.06), 0x5e6874);
  door.position.set(0, 1.4, 0.53);
  const vent = mesh(new THREE.BoxGeometry(0.72, 0.08, 0.04), 0x2b2f36);
  vent.position.set(0, 1.95, 0.57);
  const handle = mesh(new THREE.BoxGeometry(0.08, 0.25, 0.05), 0xc9c9c9);
  handle.position.set(0.42, 1.35, 0.58);
  group.add(body, door, vent, handle);
  return group;
}

function createMedkit(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(0.9, 0.45, 0.9), 0xd9d9d9);
  const crossV = mesh(new THREE.BoxGeometry(0.18, 0.28, 0.04), 0xb11f1f);
  crossV.position.z = 0.47;
  const crossH = mesh(new THREE.BoxGeometry(0.42, 0.12, 0.04), 0xb11f1f);
  crossH.position.z = 0.47;
  group.add(body, crossV, crossH);
  return group;
}

function createAmmoBox(): THREE.Group {
  const group = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), 0x3f5f2f);
  const lid = mesh(new THREE.BoxGeometry(0.95, 0.08, 0.65), 0x2f4124);
  lid.position.y = 0.24;
  const stripe = mesh(new THREE.BoxGeometry(0.82, 0.1, 0.03), 0xe3d56b);
  stripe.position.set(0, 0, 0.32);
  group.add(box, lid, stripe);
  return group;
}

function createShotgunPickup(): THREE.Group {
  const group = new THREE.Group();
  const stock = mesh(new THREE.BoxGeometry(0.55, 0.14, 0.12), 0x6e4827);
  stock.position.x = -0.15;
  const barrel = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), 0x595f68);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.x = 0.35;
  const pump = mesh(new THREE.BoxGeometry(0.25, 0.1, 0.14), 0x4b3420);
  pump.position.x = 0.1;
  group.add(stock, barrel, pump);
  return group;
}

function createTomeDark(): THREE.Group {
  const group = new THREE.Group();
  const cover = mesh(new THREE.BoxGeometry(0.5, 0.7, 0.08), 0x1a0a2e);
  cover.position.y = 0.35;
  const pages = mesh(new THREE.BoxGeometry(0.44, 0.62, 0.06), 0xd4c9a0);
  pages.position.set(0.02, 0.35, 0);
  const spine = mesh(new THREE.BoxGeometry(0.06, 0.7, 0.1), 0x2a1244);
  spine.position.set(-0.28, 0.35, 0);
  group.add(cover, pages, spine);
  return group;
}

function createArcaneOrb(): THREE.Group {
  const group = new THREE.Group();
  const orb = mesh(new THREE.SphereGeometry(0.25, 12, 12), 0x8844ff);
  orb.position.y = 0.25;
  const ring1 = mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 16), 0xaa66ff);
  ring1.position.y = 0.25;
  ring1.rotation.x = Math.PI / 3;
  const ring2 = ring1.clone();
  ring2.rotation.x = -Math.PI / 3;
  ring2.rotation.z = Math.PI / 2;
  group.add(orb, ring1, ring2);
  return group;
}

function createRingPickup(): THREE.Group {
  const group = new THREE.Group();
  const band = mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 16), 0xd4a017);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.03;
  const gem = mesh(new THREE.OctahedronGeometry(0.05, 0), 0x4444ff);
  gem.position.set(0, 0.09, 0.12);
  group.add(band, gem);
  return group;
}

function createPlayerAvatar(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 8), 0x4f8fd8);
  body.position.y = 1.0;
  const head = mesh(new THREE.SphereGeometry(0.22, 8, 8), 0xf5c5a3);
  head.position.y = 1.9;
  group.add(body, head);
  return group;
}

function createPistolPickup(): THREE.Group {
  const group = new THREE.Group();
  const grip = mesh(new THREE.BoxGeometry(0.12, 0.28, 0.08), 0x3a3a3a);
  grip.rotation.z = -0.3;
  grip.position.set(0, 0.1, 0);
  const slide = mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), 0x555555);
  slide.position.set(0.1, 0.28, 0);
  group.add(grip, slide);
  return group;
}

function createAssaultRiflePickup(): THREE.Group {
  const group = new THREE.Group();
  const receiver = mesh(new THREE.BoxGeometry(0.8, 0.12, 0.08), 0x454545);
  receiver.position.set(0, 0.12, 0);
  const stock = mesh(new THREE.BoxGeometry(0.3, 0.1, 0.08), 0x3a3222);
  stock.position.set(-0.55, 0.06, 0);
  const mag = mesh(new THREE.BoxGeometry(0.08, 0.2, 0.06), 0x2f2f2f);
  mag.position.set(0.05, -0.04, 0);
  const barrel = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), 0x4a4a4a);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.6, 0.12, 0);
  group.add(receiver, stock, mag, barrel);
  return group;
}

function createSniperRiflePickup(): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.3, 0.1, 0.08), 0x3a3a2f);
  body.position.set(0, 0.1, 0);
  const stock = mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), 0x2e2e22);
  stock.position.set(-0.77, 0.08, 0);
  const scope = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), 0x222222);
  scope.rotation.z = Math.PI / 2;
  scope.position.set(0.1, 0.19, 0);
  const barrel = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), 0x444444);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.9, 0.1, 0);
  group.add(body, stock, scope, barrel);
  return group;
}

function createGrenadeLauncherPickup(): THREE.Group {
  const group = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(0.7, 0.16, 0.12), 0x4a4a3a);
  frame.position.set(0, 0.16, 0);
  const tube = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.65, 8), 0x3a3a2a);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0.17, 0.24, 0);
  const grip = mesh(new THREE.BoxGeometry(0.1, 0.24, 0.1), 0x333323);
  grip.position.set(-0.18, 0.04, 0);
  group.add(frame, tube, grip);
  return group;
}

export function registerBuiltinModelAssets(): void {
  registerModelTemplate('model_crate_supply', createCrate);
  registerModelTemplate('model_barrel_rust', createBarrel);
  registerModelTemplate('model_player_spawn_point', createPlayerSpawnPointMarker);
  registerModelTemplate('model_tree_dead', createDeadTree);
  registerModelTemplate('model_tree_pine', createPineTree);
  registerModelTemplate('model_rock_large', createRock);
  registerModelTemplate('model_castle_wall', createCastleWall);
  registerModelTemplate('model_castle_arch', createCastleArch);
  registerModelTemplate('model_castle_floor_tile', createCastleFloorTile);
  registerModelTemplate('model_castle_bridge_segment', createCastleBridgeSegment);
  registerModelTemplate('model_dungeon_corridor', createDungeonCorridor);
  registerModelTemplate('model_dungeon_ritual_room', createDungeonRitualRoom);
  registerModelTemplate('model_dungeon_vertical_shaft', createDungeonVerticalShaft);
  registerModelTemplate('model_vegetation_vine', createVegetationVine);
  registerModelTemplate('model_vegetation_grass_cluster', createVegetationGrassCluster);
  registerModelTemplate('model_vegetation_mushroom_cluster', createVegetationMushroomCluster);
  registerModelTemplate('model_pillar_gothic', createPillarGothic);
  registerModelTemplate('model_pillar_industrial_beam', createPillarIndustrialBeam);
  registerModelTemplate('model_rock_rubble_pile', createRockRubblePile);
  registerModelTemplate('model_structural_block', createStructuralBlock);
  registerModelTemplate('model_hanging_light', createLightFixture);
  registerModelTemplate('model_locker_rust', createLocker);
  registerModelTemplate('model_medkit_pickup', createMedkit);
  registerModelTemplate('model_ammo_box', createAmmoBox);
  registerModelTemplate('model_weapon_shotgun', createShotgunPickup);
  registerModelTemplate('model_tome_dark', createTomeDark);
  registerModelTemplate('model_arcane_orb', createArcaneOrb);
  registerModelTemplate('model_ring', createRingPickup);
  registerModelTemplate('model_player_avatar', createPlayerAvatar);
  registerModelTemplate('model_pistol', createPistolPickup);
  registerModelTemplate('model_assault_rifle', createAssaultRiflePickup);
  registerModelTemplate('model_sniper_rifle', createSniperRiflePickup);
  registerModelTemplate('model_grenade_launcher', createGrenadeLauncherPickup);
}