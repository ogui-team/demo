import { WebSocket } from 'ws';

interface Player {
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  lastUpdate: number;
}

export class GameState {
  private players: Map<WebSocket, Player> = new Map();
  private gameObjects: any[] = [];

  addPlayer(ws: WebSocket, playerData: any) {
    const player: Player = {
      id: playerData.id || this.generateId(),
      position: playerData.position || { x: 0, y: 0, z: 0 },
      rotation: playerData.rotation || { x: 0, y: 0, z: 0 },
      lastUpdate: Date.now(),
    };
    this.players.set(ws, player);
  }

  updatePlayer(ws: WebSocket, update: any) {
    const player = this.players.get(ws);
    if (player) {
      player.position = update.position || player.position;
      player.rotation = update.rotation || player.rotation;
      player.lastUpdate = Date.now();
    }
  }

  removePlayer(ws: WebSocket) {
    this.players.delete(ws);
  }

  getState() {
    return {
      players: Array.from(this.players.values()),
      gameObjects: this.gameObjects,
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}
