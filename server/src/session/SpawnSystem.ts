import * as fs from 'fs';
import * as path from 'path';
import type { EntityState, PlayerState } from '../core/GameSession';
import type { Vec3 } from '../sessionContracts';

interface PlayerSpawnResult {
  player: PlayerState;
  entity: EntityState;
}

interface PlayerPrefabDefinition {
  id: string;
  entityType: string;
  flags?: {
    isPlayerControlled?: boolean;
  };
  dodComponents?: {
    health?: {
      hp?: number;
      maxHp?: number;
    };
    inventory?: {
      loadout?: string[];
      equipped?: string;
    };
  };
}

const playerV1Prefab = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../prefabs/player_v1.json'), 'utf8')) as PlayerPrefabDefinition;

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
