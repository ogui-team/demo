import { WebSocket } from 'ws';
import { type Vec3 } from '../sessionContracts';

export interface LegacySessionActor {
  id: string;
  dead: boolean;
  health: number;
  appearance?: Record<string, unknown> | null;
  ws?: WebSocket;
}

export interface LegacyWorldObject {
  id: string;
  position: Vec3;
  rotation: Vec3;
}

interface ExecuteLegacySessionActionOptions<TActor extends LegacySessionActor, TWorldObject extends LegacyWorldObject> {
  action: string;
  actor: TActor;
  data: Record<string, unknown>;
  readFiniteNumber: (value: unknown) => number | undefined;
  sanitizePlayerAppearancePayload: (value: unknown) => Record<string, unknown> | null;
  applyDamage: (targetId: string, amount: number, sourceId: string) => void;
  respawnPlayer: (playerId: string) => void;
  createWorldObjectFromRequest: (data: Record<string, unknown>, actorId: string) => TWorldObject | null;
  getWorldObject: (id: string) => TWorldObject | undefined;
  setWorldObject: (id: string, object: TWorldObject) => void;
  deleteWorldObject: (id: string) => void;
  upsertWorldObjectCollider: (id: string, position: Vec3, halfExtents: Vec3) => void;
  removeWorldObjectCollider: (id: string) => void;
  getWorldObjectHalfExtents: (object: TWorldObject) => Vec3;
  broadcastAll: (message: unknown) => void;
  broadcastOthers: (excludePlayerId: string, message: unknown) => void;
  syncPlayerEntity: (playerId: string) => void;
}

export function shouldIgnoreLegacyAction(action: string): boolean {
  return action === 'AMMO_STATE_SYNC'
    || action === 'ABILITY_STATE_SYNC'
    || action === 'INVENTORY_STATE_SYNC'
    || action === 'ATTRIBUTE_STATE_SYNC'
    || action === 'PLAYER_HIT'
    || action === 'PLAYER_DAMAGE';
}

export function executeLegacySessionAction<TActor extends LegacySessionActor, TWorldObject extends LegacyWorldObject>(
  options: ExecuteLegacySessionActionOptions<TActor, TWorldObject>,
): void {
  const { action, actor, data } = options;

  switch (action) {
    case 'PLAYER_APPEARANCE': {
      const appearance = options.sanitizePlayerAppearancePayload(data.appearance);
      if (!appearance) break;
      actor.appearance = { ...appearance };
      options.broadcastOthers(actor.id, {
        type: 'PLAYER_APPEARANCE',
        playerId: actor.id,
        appearance,
      });
      break;
    }
    case 'RESPAWN_REQUEST': {
      if (actor.dead) options.respawnPlayer(actor.id);
      break;
    }
    case 'WORLD_OBJECT_PLACE': {
      const obj = options.createWorldObjectFromRequest(data, actor.id);
      if (!obj) break;
      options.setWorldObject(obj.id, obj);
      options.upsertWorldObjectCollider(obj.id, obj.position, options.getWorldObjectHalfExtents(obj));
      options.broadcastAll({ type: 'WORLD_OBJECT_PLACE', object: obj });
      break;
    }
    case 'WORLD_OBJECT_REMOVE': {
      const removeId = typeof data.id === 'string' ? data.id : '';
      if (!removeId) break;
      options.deleteWorldObject(removeId);
      options.removeWorldObjectCollider(removeId);
      options.broadcastOthers(actor.id, { type: 'WORLD_OBJECT_REMOVE', id: removeId });
      break;
    }
    case 'WORLD_OBJECT_UPDATE': {
      const updateId = typeof data.id === 'string' ? data.id : '';
      if (!updateId) break;

      const existing = options.getWorldObject(updateId);
      if (!existing) break;

      const updated = {
        ...existing,
        position: (data.position as Vec3) ?? existing.position,
        rotation: (data.rotation as Vec3) ?? existing.rotation,
      } as TWorldObject;

      options.setWorldObject(updateId, updated);
      options.upsertWorldObjectCollider(updateId, updated.position, options.getWorldObjectHalfExtents(updated));
      options.broadcastOthers(actor.id, { type: 'WORLD_OBJECT_UPDATE', object: updated });
      break;
    }
    case 'PLAYER_MODE_CHANGE': {
      const requestedMode = typeof data.mode === 'string' ? data.mode : '';
      if (requestedMode === 'spectator') {
        actor.dead = true;
        actor.health = 0;
        options.syncPlayerEntity(actor.id);
        options.broadcastAll({ type: 'PLAYER_SPECTATE', playerId: actor.id });
      } else if (requestedMode === 'play') {
        if (actor.dead) options.respawnPlayer(actor.id);
      }
      break;
    }
    default:
      break;
  }
}