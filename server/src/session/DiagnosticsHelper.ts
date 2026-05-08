import { WebSocket } from 'ws';
import { type RoundState, type Vec3 } from '../sessionContracts';
import { type EntityState } from '../core/GameSession';
import { isEntityAllowedForSnapshot } from './SnapshotFilter';

export class DiagnosticsHelper {
  /**
   * Dump world state for debugging/auditing
   */
  static dumpWorldState(
    tick: number,
    entities: Map<string, EntityState>,
    players: Map<string, { id: string }>,
    worldObjects: Map<string, unknown>,
    prefix: string = 'WORLD_STATE',
  ): void {
    const allEntities = Array.from(entities.values());
    const playerEntities = allEntities.filter((e) => (e as any).type === 'player');
    const nonPlayerEntities = allEntities.filter((e) => (e as any).type !== 'player');
    
    console.log(`[SERVER_STATE_DUMP] ${prefix}`, {
      tick,
      totalEntities: entities.size,
      totalPlayers: players.size,
      playerEntitiesInState: playerEntities.length,
      nonPlayerEntitiesInState: nonPlayerEntities.length,
      playerList: Array.from(players.keys()),
      playerEntityIds: playerEntities.map(e => e.id),
      nonPlayerEntityTypes: Array.from(new Set(nonPlayerEntities.map(e => e.type))),
      worldObjects: worldObjects.size,
      timestamp: Date.now(),
    });
  }

  /**
   * Force full snapshot delivery to specific player
   */
  static forceFullSnapshot(
    targetPlayerId: string,
    targetPlayer: { ws: WebSocket | undefined | null },
    tick: number,
    entities: EntityState[],
    roundState: RoundState,
  ): void {
    if (!targetPlayer.ws || targetPlayer.ws.readyState !== WebSocket.OPEN) {
      console.warn('[SERVER_FORCE_SNAPSHOT] Target player not found or disconnected', {
        targetPlayerId,
        timestamp: Date.now(),
      });
      return;
    }

    const timestamp = Date.now();
    const entitiesToSnapshot = entities.filter((entity) => isEntityAllowedForSnapshot(entity));

    const payloadEntities: Array<Record<string, unknown>> = [];
    
    for (const entity of entitiesToSnapshot) {
      const nextSnapshot = {
        ...entity,
        position: { ...entity.position },
        rotation: { ...entity.rotation },
        velocity: entity.velocity ? { ...entity.velocity } : undefined,
        equipment: entity.equipment ? [...entity.equipment] : undefined,
        isPlayerControlled: entity.type === 'player' && entity.id === targetPlayerId,
        IS_PLAYER_CONTROLLED: entity.type === 'player' && entity.id === targetPlayerId,
      };
      payloadEntities.push({ ...nextSnapshot });
    }

    // ─ FORCE SNAPSHOT: Full snapshot with flag for client ─
    const message = {
      type: 'WORLD_DELTA',
      schemaVersion: 2,
      deltaMode: 'full-snapshot-force',
      isForcedFullSnapshot: true,  // ← FORCE FLAG: Client should reset state before processing
      forceFullSnapshotReason: 'server_initiated_state_sync',
      tick,
      localPlayerId: targetPlayerId,
      timestamp,
      entities: payloadEntities,
      round: roundState,
      events: [],
    };

    const encoded = JSON.stringify(message);
    targetPlayer.ws.send(encoded);

    console.log('[SERVER_FORCE_SNAPSHOT] Sent full snapshot to player', {
      targetPlayerId,
      entityCount: payloadEntities.length,
      messageSize: Buffer.byteLength(encoded, 'utf8'),
      tick,
      timestamp,
    });
  }

  /**
   * Log snapshot audit for consistency checking
   */
  static logSnapshotAudit(
    source: string,
    tick: number,
    allEntities: EntityState[],
    entitiesToBroadcast: Array<EntityState | (EntityState & { isPlayerControlled?: boolean })>,
    localPlayerId: string | null = null,
  ): void {
    console.log('ServerWorldState: Total entities:', allEntities.length, {
      source,
      tick,
    });

    if (allEntities.length === 0) {
      console.error('FATAL: Server WorldState is empty. Player registry missing?', {
        source,
        tick,
        timestamp: Date.now(),
      });
    }

    const playerEntities = entitiesToBroadcast.filter((entity) => entity.type === 'player');
    const npcEntities = entitiesToBroadcast.filter((entity) => entity.type !== 'player');
    console.log('[ServerSnapshotAudit]', {
      source,
      tick,
      totalEntities: allEntities.length,
      broadcastEntities: entitiesToBroadcast.length,
      playerEntities: playerEntities.length,
      npcEntities: npcEntities.length,
      localPlayerIncluded: localPlayerId ? entitiesToBroadcast.some((entity) => entity.id === localPlayerId) : null,
      playerEntityIds: playerEntities.map((entity) => entity.id),
      npcEntityTypes: npcEntities.map((entity) => entity.type),
      timestamp: Date.now(),
    });
  }
}
