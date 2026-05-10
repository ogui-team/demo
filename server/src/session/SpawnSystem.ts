import * as fs from 'fs';
import * as path from 'path';
import type { EntityState, PlayerState, PlayerPrefabDefinition, PlayerSpawnResult, Vec3 } from '@shared/contracts';

function resolvePlayerPrefabPath(fileName: string): string {
  const candidates = [
    path.resolve(__dirname, `../prefabs/${fileName}`),
    path.resolve(__dirname, `../../../../src/prefabs/${fileName}`),
    path.resolve(process.cwd(), `src/prefabs/${fileName}`),
    path.resolve(process.cwd(), `server/src/prefabs/${fileName}`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Prefab file not found: ${fileName}. Checked: ${candidates.join(', ')}`);
}

const playerV1PrefabPath = resolvePlayerPrefabPath('player_v1.json');
const playerV1Prefab = JSON.parse(fs.readFileSync(playerV1PrefabPath, 'utf8')) as PlayerPrefabDefinition;

const PLAYER_PREFABS: Record<string, PlayerPrefabDefinition> = {
  player_v1: playerV1Prefab,
};

function cloneVec3(source: Vec3): Vec3 {
  return { x: source.x, y: source.y, z: source.z };
}

export class SpawnSystem {
  spawnPlayer(player: PlayerState, prefabId: string, spawn: Vec3): PlayerSpawnResult {
    const prefab = PLAYER_PREFABS[prefabId];
    if (!prefab) {
      throw new Error(`Unknown player prefab: ${prefabId}`);
    }

    const health = prefab.dodComponents?.health;
    const inventory = prefab.dodComponents?.inventory;
    const loadout = inventory?.loadout?.length ? [...inventory.loadout] : ['pistol', 'knife'];

    player.position = cloneVec3(spawn);
    player.rotation = { x: 0, y: 0, z: 0 };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.health = health?.hp ?? 100;
    player.maxHealth = health?.maxHp ?? 100;
    player.equipment = loadout;

    const entity: EntityState = {
      id: player.id,
      type: prefab.entityType,
      position: cloneVec3(spawn),
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: player.health,
      maxHealth: player.maxHealth,
      equipment: [...loadout],
      activeWeaponId: inventory?.equipped ?? loadout[0] ?? 'pistol',
      isPlayerControlled: prefab.flags?.isPlayerControlled === true,
      IS_PLAYER_CONTROLLED: prefab.flags?.isPlayerControlled === true,
    };

    return { player, entity };
  }
}
