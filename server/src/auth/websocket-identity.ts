import type { WebSocket } from 'ws';
import type { RequestAuthContext } from './types';

export interface SocketIdentityBinding {
  connectionId: string;
  authContext: RequestAuthContext;
  connectedAt: number;
}

export class WebSocketIdentityTunnel {
  private readonly bindings = new Map<WebSocket, SocketIdentityBinding>();

  bind(ws: WebSocket, binding: SocketIdentityBinding): void {
    this.bindings.set(ws, binding);
  }

  get(ws: WebSocket): SocketIdentityBinding | null {
    return this.bindings.get(ws) ?? null;
  }

  delete(ws: WebSocket): void {
    this.bindings.delete(ws);
  }
}

export const webSocketIdentityTunnel = new WebSocketIdentityTunnel();
