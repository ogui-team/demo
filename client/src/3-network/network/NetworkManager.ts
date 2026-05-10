/**
 * Network Manager
 * Minimal multiplayer synchronization system
 * Handles player state sync, interpolation, and remote player management
 */

import { Entity } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type {
  INetworkTransport,
  NetworkAbilityRequest,
  NetworkAbilityValidation,
  NetworkHitValidationRequest,
  NetworkHitValidationResult,
  NetworkInputCommand,
  NetworkReplicatedEntityState,
  NetworkSnapshot,
  PlayerNetworkState,
} from './NetworkRuntimeContracts';

interface NetworkEntityManagerAdapter {
  createEntity(entityType: string, config: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }): Entity;
  getEntities(): Entity[];
  destroyEntity(entity: Entity | string): void;
}

/**
 * Remote player interpolation data
 */
interface RemotePlayerData {
  playerId: string; // Track the player ID for reference
  entity?: Entity | null; // Optional: PlayerModelSystem handles entity creation from authoritative snapshots
  currentState: PlayerNetworkState;
  previousState: PlayerNetworkState;
  interpolationFactor: number;
}

/**
 * NetworkManager - Handles multiplayer state synchronization
 */
export class NetworkManager {
  private entityManager: NetworkEntityManagerAdapter;
  private networkTransport: INetworkTransport;
  private localPlayerId: string;
  private remotePlayersMap: Map<string, RemotePlayerData> = new Map();
  private stateUpdateInterval: number = 1 / 60; // MILESTONE 1: Fixed to 60Hz (16.67ms) to match server kernel tick
  private stateSendAccumulator: number = 0;
  private maxInterpolationDelay: number = 0.2; // Max 200ms interpolation
  private enableLogging: boolean = false;
  private inputSequence: number = 0;
  private inputCallbacks: Array<(command: NetworkInputCommand) => void> = [];
  private snapshotCallbacks: Array<(snapshot: NetworkSnapshot) => void> = [];
  private hitRequestCallbacks: Array<(request: NetworkHitValidationRequest) => void> = [];
  private hitResultCallbacks: Array<(result: NetworkHitValidationResult) => void> = [];
  private abilityRequestCallbacks: Array<(request: NetworkAbilityRequest) => void> = [];
  private abilityValidationCallbacks: Array<(validation: NetworkAbilityValidation) => void> = [];
  private systemContext: SystemContext | null = null;

  constructor(
    entityManager: NetworkEntityManagerAdapter,
    networkTransport: INetworkTransport,
    localPlayerId: string,
    enableLogging: boolean = false
  ) {
    this.entityManager = entityManager;
    this.networkTransport = networkTransport;
    this.localPlayerId = localPlayerId;
    this.enableLogging = enableLogging;

    // Setup network listener
    this.networkTransport.onStateReceived((state) => {
      this.handleRemoteStateReceived(state);
    });
    this.networkTransport.onInputReceived?.((command) => {
      this.inputCallbacks.forEach((callback) => callback(command));
    });
    this.networkTransport.onSnapshotReceived?.((snapshot) => {
      this.snapshotCallbacks.forEach((callback) => callback(snapshot));
    });
    this.networkTransport.onHitValidationRequestReceived?.((request) => {
      this.hitRequestCallbacks.forEach((callback) => callback(request));
    });
    this.networkTransport.onHitValidationResultReceived?.((result) => {
      this.hitResultCallbacks.forEach((callback) => callback(result));
    });
    this.networkTransport.onAbilityRequestReceived?.((request) => {
      this.abilityRequestCallbacks.forEach((callback) => callback(request));
    });
    this.networkTransport.onAbilityValidationReceived?.((validation) => {
      this.abilityValidationCallbacks.forEach((callback) => callback(validation));
    });

    if (this.enableLogging) {
      console.log(`[NetworkManager] Initialized with player: ${localPlayerId}`);
    }
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (ctx.entityManager) {
      this.entityManager = ctx.entityManager as NetworkEntityManagerAdapter;
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: this.getDiagnostics(),
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      localPlayerId: this.localPlayerId,
      remotePlayerCount: this.remotePlayersMap.size,
      inputSequence: this.inputSequence,
      inputCallbackCount: this.inputCallbacks.length,
      snapshotCallbackCount: this.snapshotCallbacks.length,
      predictionDelaySeconds: this.maxInterpolationDelay,
      hasSystemContext: this.systemContext !== null,
    };
  }

  /**
   * Update network state (called every frame)
   */
  update(deltaTime: number): void {
    // Send local player state at regular intervals
    this.stateSendAccumulator += deltaTime;
    if (this.stateSendAccumulator >= this.stateUpdateInterval) {
      this.sendLocalPlayerState();
      this.stateSendAccumulator = 0;
    }

    // Update remote player interpolation
    this.updateRemotePlayersInterpolation(deltaTime);
  }

  nextInputSequence(): number {
    this.inputSequence += 1;
    return this.inputSequence;
  }

  sendInputCommand(command: NetworkInputCommand): void {
    this.networkTransport.sendInput?.(command);
  }

  onInputCommand(callback: (command: NetworkInputCommand) => void): () => void {
    this.inputCallbacks.push(callback);
    return () => {
      this.inputCallbacks = this.inputCallbacks.filter((current) => current !== callback);
    };
  }

  sendSnapshot(snapshot: NetworkSnapshot): void {
    this.networkTransport.sendSnapshot?.(snapshot);
  }

  onSnapshot(callback: (snapshot: NetworkSnapshot) => void): () => void {
    this.snapshotCallbacks.push(callback);
    return () => {
      this.snapshotCallbacks = this.snapshotCallbacks.filter((current) => current !== callback);
    };
  }

  sendHitValidationRequest(request: NetworkHitValidationRequest): void {
    this.networkTransport.sendHitValidationRequest?.(request);
  }

  onHitValidationRequest(callback: (request: NetworkHitValidationRequest) => void): () => void {
    this.hitRequestCallbacks.push(callback);
    return () => {
      this.hitRequestCallbacks = this.hitRequestCallbacks.filter((current) => current !== callback);
    };
  }

  sendHitValidationResult(result: NetworkHitValidationResult): void {
    this.networkTransport.sendHitValidationResult?.(result);
  }

  onHitValidationResult(callback: (result: NetworkHitValidationResult) => void): () => void {
    this.hitResultCallbacks.push(callback);
    return () => {
      this.hitResultCallbacks = this.hitResultCallbacks.filter((current) => current !== callback);
    };
  }

  sendAbilityRequest(request: NetworkAbilityRequest): void {
    this.networkTransport.sendAbilityRequest?.(request);
  }

  onAbilityRequest(callback: (request: NetworkAbilityRequest) => void): () => void {
    this.abilityRequestCallbacks.push(callback);
    return () => {
      this.abilityRequestCallbacks = this.abilityRequestCallbacks.filter((current) => current !== callback);
    };
  }

  sendAbilityValidation(validation: NetworkAbilityValidation): void {
    this.networkTransport.sendAbilityValidation?.(validation);
  }

  onAbilityValidation(callback: (validation: NetworkAbilityValidation) => void): () => void {
    this.abilityValidationCallbacks.push(callback);
    return () => {
      this.abilityValidationCallbacks = this.abilityValidationCallbacks.filter((current) => current !== callback);
    };
  }

  /**
   * Send local player state to network
   */
  private sendLocalPlayerState(): void {
    // Find local player entity
    const localPlayerEntity = this.findLocalPlayerEntity();
    if (!localPlayerEntity) {
      return;
    }

    const transform = localPlayerEntity.getTransform();
    const state: PlayerNetworkState = {
      playerId: this.localPlayerId,
      position: { ...transform.position },
      rotation: { ...transform.rotation },
      timestamp: Engine.time.now(),
    };

    this.networkTransport.sendState(state);

    if (this.enableLogging) {
      console.log(`[NetworkManager] Sent state for player ${this.localPlayerId}`);
    }
  }

  /**
   * Handle incoming remote player state
   */
  private handleRemoteStateReceived(state: PlayerNetworkState): void {
    // Ignore our own state broadcasts
    if (state.playerId === this.localPlayerId) {
      return;
    }

    // Check if remote player entity exists
    let remotePlayerData = this.remotePlayersMap.get(state.playerId);

    if (!remotePlayerData) {
      // DISABLED: Entity spawning moved to PlayerModelSystem which handles authoritative snapshots
      // This prevents duplicate entity creation from two independent spawn sources
      // createRemotePlayer(state.playerId);
      
      // Instead, create tracking data entry (PlayerModelSystem will handle actual entity creation)
      remotePlayerData = {
        playerId: state.playerId,
        entity: undefined,
        previousState: state,
        currentState: state,
        interpolationFactor: 0,
      };
      this.remotePlayersMap.set(state.playerId, remotePlayerData);
    }

    if (remotePlayerData) {
      // Update interpolation data
      remotePlayerData.previousState = remotePlayerData.currentState;
      remotePlayerData.currentState = state;
      remotePlayerData.interpolationFactor = 0; // Start interpolation from 0

      if (this.enableLogging) {
        console.log(`[NetworkManager] Received state from player ${state.playerId}`);
      }
    }
  }

  /**
   * Create a remote player entity
   */
  private createRemotePlayer(playerId: string): void {
    // Get default position
    const defaultPosition = {
      x: Engine.random.next() * 10 - 5,
      y: 0,
      z: Engine.random.next() * 10 - 5,
    };

    // Create entity
    const entity = this.entityManager.createEntity('RemotePlayer', {
      position: defaultPosition,
      rotation: { x: 0, y: 0, z: 0 },
    });

    // Add render component
    entity.addComponent({
      name: 'render',
      data: {
        meshType: 'capsule',
        color: 0x00ff00, // Green for remote players
        geometry: { radius: 0.4, height: 1.0, radialSegments: 8 },
      },
    });

    // Store in remote players map
    this.remotePlayersMap.set(playerId, {
      playerId,
      entity,
      currentState: {
        playerId,
        position: defaultPosition,
        rotation: { x: 0, y: 0, z: 0 },
        timestamp: Engine.time.now(),
      },
      previousState: {
        playerId,
        position: defaultPosition,
        rotation: { x: 0, y: 0, z: 0 },
        timestamp: Engine.time.now(),
      },
      interpolationFactor: 0,
    });

    if (this.enableLogging) {
      console.log(`[NetworkManager] Created remote player: ${playerId}`);
    }
    gameBus.emit('networkLifecycle', {
      source: 'NetworkManager',
      state: 'remote_player_created',
      detail: playerId,
      playerId,
    });
  }

  /**
   * Update remote player positions with interpolation
   */
  private updateRemotePlayersInterpolation(deltaTime: number): void {
    for (const [playerId, remoteData] of this.remotePlayersMap.entries()) {
      if (!remoteData) continue;

      // Increase interpolation factor
      remoteData.interpolationFactor += deltaTime / this.maxInterpolationDelay;

      // Clamp to [0, 1]
      if (remoteData.interpolationFactor > 1.0) {
        remoteData.interpolationFactor = 1.0;
      }

      const t = remoteData.interpolationFactor;
      const prev = remoteData.previousState;
      const curr = remoteData.currentState;

      // Interpolate position
      const position = {
        x: prev.position.x + (curr.position.x - prev.position.x) * t,
        y: prev.position.y + (curr.position.y - prev.position.y) * t,
        z: prev.position.z + (curr.position.z - prev.position.z) * t,
      };

      // Interpolate rotation
      const rotation = {
        x: prev.rotation.x + (curr.rotation.x - prev.rotation.x) * t,
        y: prev.rotation.y + (curr.rotation.y - prev.rotation.y) * t,
        z: prev.rotation.z + (curr.rotation.z - prev.rotation.z) * t,
      };

      // Update entity transform (only if entity exists - PlayerModelSystem handles entity from authoritative snapshots)
      if (remoteData.entity) {
        remoteData.entity.setTransform({ position, rotation });
      }
    }
  }

  /**
   * Find the local player entity
   */
  private findLocalPlayerEntity(): Entity | undefined {
    // Look for entity with 'localPlayer' component
    const allEntities = this.entityManager.getEntities();
    return allEntities.find((entity) => entity.hasComponent('localPlayer'));
  }

  /**
   * Remove a remote player
   */
  removeRemotePlayer(playerId: string): void {
    const remoteData = this.remotePlayersMap.get(playerId);
    if (remoteData) {
      if (remoteData.entity) {
        this.entityManager.destroyEntity(remoteData.entity);
      }
      this.remotePlayersMap.delete(playerId);

      if (this.enableLogging) {
        console.log(`[NetworkManager] Removed remote player: ${playerId}`);
      }
      gameBus.emit('networkLifecycle', {
        source: 'NetworkManager',
        state: 'remote_player_removed',
        detail: playerId,
        playerId,
      });
    }
  }

  /**
   * Get all remote player IDs
   */
  getRemotePlayerIds(): string[] {
    return Array.from(this.remotePlayersMap.keys());
  }

  /**
   * Get remote player entity
   */
  getRemotePlayer(playerId: string): Entity | undefined {
    const data = this.remotePlayersMap.get(playerId);
    return data?.entity ?? undefined;
  }

  /**
   * Get local player ID
   */
  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  setLocalPlayerId(playerId: string): void {
    if (!playerId || playerId === this.localPlayerId) {
      return;
    }
    this.localPlayerId = playerId;
    if (this.enableLogging) {
      console.log(`[NetworkManager] Local player ID updated to ${playerId}`);
    }
  }

  /**
   * Get network transport
   */
  getNetworkTransport(): INetworkTransport {
    return this.networkTransport;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Remove all remote players
    for (const playerId of this.remotePlayersMap.keys()) {
      this.removeRemotePlayer(playerId);
    }

    this.networkTransport.disconnect();

    gameBus.emit('networkLifecycle', {
      source: 'NetworkManager',
      state: 'destroyed',
      playerId: this.localPlayerId,
    });

    if (this.enableLogging) {
      console.log('[NetworkManager] Destroyed');
    }
  }
}
