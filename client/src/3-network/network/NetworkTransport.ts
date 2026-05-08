/**
 * Local Network Transport
 * Test implementation of INetworkTransport for local/development use
 * Simulates network communication without a real server
 */

import {
  INetworkTransport,
  NetworkAbilityRequest,
  NetworkAbilityValidation,
  NetworkHitValidationRequest,
  NetworkHitValidationResult,
  NetworkInputCommand,
  NetworkSnapshot,
  PlayerNetworkState,
} from './NetworkRuntimeContracts';

/**
 * LocalNetworkTransport - In-memory network simulation
 * Useful for testing and local development
 */
export class LocalNetworkTransport implements INetworkTransport {
  private stateCallbacks: Array<(state: PlayerNetworkState) => void> = [];
  private inputCallbacks: Array<(command: NetworkInputCommand) => void> = [];
  private snapshotCallbacks: Array<(snapshot: NetworkSnapshot) => void> = [];
  private hitRequestCallbacks: Array<(request: NetworkHitValidationRequest) => void> = [];
  private hitResultCallbacks: Array<(result: NetworkHitValidationResult) => void> = [];
  private abilityRequestCallbacks: Array<(request: NetworkAbilityRequest) => void> = [];
  private abilityValidationCallbacks: Array<(validation: NetworkAbilityValidation) => void> = [];
  private allPlayers: Map<string, PlayerNetworkState> = new Map();
  private broadcastInterval: NodeJS.Timeout | null = null;
  private simulatedLatency: number = 0; // ms
  private enableLogging: boolean = false;

  constructor(simulatedLatency: number = 50, enableLogging: boolean = false) {
    this.simulatedLatency = simulatedLatency;
    this.enableLogging = enableLogging;

    if (this.enableLogging) {
      console.log(`[LocalNetworkTransport] Initialized with ${simulatedLatency}ms latency`);
    }
  }

  /**
   * Send player state (broadcast to all listeners)
   */
  sendState(state: PlayerNetworkState): void {
    // Store state
    this.allPlayers.set(state.playerId, { ...state });

    // Simulate latency and broadcast
    if (this.simulatedLatency > 0) {
      setTimeout(() => {
        this.broadcastState(state);
      }, this.simulatedLatency);
    } else {
      this.broadcastState(state);
    }
  }

  /**
   * Register callback for state reception
   */
  onStateReceived(callback: (state: PlayerNetworkState) => void): void {
    this.stateCallbacks.push(callback);
  }

  sendInput(command: NetworkInputCommand): void {
    this.schedule(() => {
      this.inputCallbacks.forEach((callback) => callback(command));
    });
  }

  onInputReceived(callback: (command: NetworkInputCommand) => void): void {
    this.inputCallbacks.push(callback);
  }

  sendSnapshot(snapshot: NetworkSnapshot): void {
    this.schedule(() => {
      this.snapshotCallbacks.forEach((callback) => callback(snapshot));
    });
  }

  onSnapshotReceived(callback: (snapshot: NetworkSnapshot) => void): void {
    this.snapshotCallbacks.push(callback);
  }

  sendHitValidationRequest(request: NetworkHitValidationRequest): void {
    this.schedule(() => {
      this.hitRequestCallbacks.forEach((callback) => callback(request));
    });
  }

  onHitValidationRequestReceived(callback: (request: NetworkHitValidationRequest) => void): void {
    this.hitRequestCallbacks.push(callback);
  }

  sendHitValidationResult(result: NetworkHitValidationResult): void {
    this.schedule(() => {
      this.hitResultCallbacks.forEach((callback) => callback(result));
    });
  }

  onHitValidationResultReceived(callback: (result: NetworkHitValidationResult) => void): void {
    this.hitResultCallbacks.push(callback);
  }

  sendAbilityRequest(request: NetworkAbilityRequest): void {
    this.schedule(() => {
      this.abilityRequestCallbacks.forEach((callback) => callback(request));
    });
  }

  onAbilityRequestReceived(callback: (request: NetworkAbilityRequest) => void): void {
    this.abilityRequestCallbacks.push(callback);
  }

  sendAbilityValidation(validation: NetworkAbilityValidation): void {
    this.schedule(() => {
      this.abilityValidationCallbacks.forEach((callback) => callback(validation));
    });
  }

  onAbilityValidationReceived(callback: (validation: NetworkAbilityValidation) => void): void {
    this.abilityValidationCallbacks.push(callback);
  }

  /**
   * Broadcast state to all registered callbacks
   */
  private broadcastState(state: PlayerNetworkState): void {
    for (const callback of this.stateCallbacks) {
      try {
        callback(state);
      } catch (error) {
        console.error('[LocalNetworkTransport] Error in state callback:', error);
      }
    }

    if (this.enableLogging) {
      console.log(`[LocalNetworkTransport] Broadcast state from ${state.playerId}`);
    }
  }

  private schedule(callback: () => void): void {
    if (this.simulatedLatency > 0) {
      setTimeout(callback, this.simulatedLatency);
    } else {
      callback();
    }
  }

  /**
   * Get all known players
   */
  getKnownPlayers(): PlayerNetworkState[] {
    return Array.from(this.allPlayers.values());
  }

  /**
   * Disconnect (cleanup)
   */
  disconnect(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }

    this.stateCallbacks = [];
    this.inputCallbacks = [];
    this.snapshotCallbacks = [];
    this.hitRequestCallbacks = [];
    this.hitResultCallbacks = [];
    this.abilityRequestCallbacks = [];
    this.abilityValidationCallbacks = [];
    this.allPlayers.clear();

    if (this.enableLogging) {
      console.log('[LocalNetworkTransport] Disconnected');
    }
  }
}

/**
 * WebSocket Network Transport
 * Real network implementation using WebSocket
 * (Structure for future implementation)
 */
export class WebSocketNetworkTransport implements INetworkTransport {
  private ws: WebSocket | null = null;
  private stateCallbacks: Array<(state: PlayerNetworkState) => void> = [];
  private inputCallbacks: Array<(command: NetworkInputCommand) => void> = [];
  private snapshotCallbacks: Array<(snapshot: NetworkSnapshot) => void> = [];
  private hitRequestCallbacks: Array<(request: NetworkHitValidationRequest) => void> = [];
  private hitResultCallbacks: Array<(result: NetworkHitValidationResult) => void> = [];
  private abilityRequestCallbacks: Array<(request: NetworkAbilityRequest) => void> = [];
  private abilityValidationCallbacks: Array<(validation: NetworkAbilityValidation) => void> = [];
  private url: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private enableLogging: boolean = false;

  constructor(url: string, enableLogging: boolean = false) {
    this.url = url;
    this.enableLogging = enableLogging;

    this.connect();
  }

  /**
   * Connect to WebSocket server
   */
  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        if (this.enableLogging) {
          console.log('[WebSocketNetworkTransport] Connected');
        }
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>;
          if (message.kind === 'player_input') {
            this.inputCallbacks.forEach((callback) => callback(message.payload as NetworkInputCommand));
          } else if (message.kind === 'snapshot') {
            this.snapshotCallbacks.forEach((callback) => callback(message.payload as NetworkSnapshot));
          } else if (message.kind === 'hit_request') {
            this.hitRequestCallbacks.forEach((callback) => callback(message.payload as NetworkHitValidationRequest));
          } else if (message.kind === 'hit_result') {
            this.hitResultCallbacks.forEach((callback) => callback(message.payload as NetworkHitValidationResult));
          } else if (message.kind === 'ability_request') {
            this.abilityRequestCallbacks.forEach((callback) => callback(message.payload as NetworkAbilityRequest));
          } else if (message.kind === 'ability_validation') {
            this.abilityValidationCallbacks.forEach((callback) => callback(message.payload as NetworkAbilityValidation));
          } else {
            const state = message as unknown as PlayerNetworkState;
            for (const callback of this.stateCallbacks) {
              callback(state);
            }
          }
        } catch (error) {
          console.error('[WebSocketNetworkTransport] Error parsing message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocketNetworkTransport] Error:', error);
      };

      this.ws.onclose = () => {
        if (this.enableLogging) {
          console.log('[WebSocketNetworkTransport] Disconnected');
        }
        this.attemptReconnect();
      };
    } catch (error) {
      console.error('[WebSocketNetworkTransport] Connection failed:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocketNetworkTransport] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    if (this.enableLogging) {
      console.log(`[WebSocketNetworkTransport] Attempting to reconnect in ${delay}ms`);
    }

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Send player state
   */
  sendState(state: PlayerNetworkState): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(state));
    } else if (this.enableLogging) {
      console.warn('[WebSocketNetworkTransport] WebSocket not connected');
    }
  }

  /**
   * Register callback for state reception
   */
  onStateReceived(callback: (state: PlayerNetworkState) => void): void {
    this.stateCallbacks.push(callback);
  }

  sendInput(command: NetworkInputCommand): void {
    this.sendEnvelope('player_input', command);
  }

  onInputReceived(callback: (command: NetworkInputCommand) => void): void {
    this.inputCallbacks.push(callback);
  }

  sendSnapshot(snapshot: NetworkSnapshot): void {
    this.sendEnvelope('snapshot', snapshot);
  }

  onSnapshotReceived(callback: (snapshot: NetworkSnapshot) => void): void {
    this.snapshotCallbacks.push(callback);
  }

  sendHitValidationRequest(request: NetworkHitValidationRequest): void {
    this.sendEnvelope('hit_request', request);
  }

  onHitValidationRequestReceived(callback: (request: NetworkHitValidationRequest) => void): void {
    this.hitRequestCallbacks.push(callback);
  }

  sendHitValidationResult(result: NetworkHitValidationResult): void {
    this.sendEnvelope('hit_result', result);
  }

  onHitValidationResultReceived(callback: (result: NetworkHitValidationResult) => void): void {
    this.hitResultCallbacks.push(callback);
  }

  sendAbilityRequest(request: NetworkAbilityRequest): void {
    this.sendEnvelope('ability_request', request);
  }

  onAbilityRequestReceived(callback: (request: NetworkAbilityRequest) => void): void {
    this.abilityRequestCallbacks.push(callback);
  }

  sendAbilityValidation(validation: NetworkAbilityValidation): void {
    this.sendEnvelope('ability_validation', validation);
  }

  onAbilityValidationReceived(callback: (validation: NetworkAbilityValidation) => void): void {
    this.abilityValidationCallbacks.push(callback);
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stateCallbacks = [];
    this.inputCallbacks = [];
    this.snapshotCallbacks = [];
    this.hitRequestCallbacks = [];
    this.hitResultCallbacks = [];
    this.abilityRequestCallbacks = [];
    this.abilityValidationCallbacks = [];

    if (this.enableLogging) {
      console.log('[WebSocketNetworkTransport] Disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private sendEnvelope(kind: string, payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind, payload }));
    }
  }
}
