import { WebSocket } from 'ws';
import { type PlayerState } from '../core/GameSession';

export interface BroadcastRuntimeOptions {
  players: Map<string, PlayerState>;
}

/**
 * Broadcast a message to all connected players
 */
export function broadcastAll(message: unknown, options: BroadcastRuntimeOptions): void {
  const payload = JSON.stringify(message);
  for (const player of options.players.values()) {
    if (player.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
  }
}

/**
 * Broadcast a message to all players except one
 */
export function broadcastOthers(excludePlayerId: string, message: unknown, options: BroadcastRuntimeOptions): void {
  const payload = JSON.stringify(message);
  for (const player of options.players.values()) {
    if (player.id === excludePlayerId) continue;
    if (player.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
  }
}

/**
 * Send a message to a specific player (by WebSocket)
 */
export function sendTo(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
