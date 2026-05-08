export interface NetworkInputCommand {
  playerId: string;
  seq: number;
  tick: number;
  timestamp: number;
  input: Record<string, unknown>;
}

export interface NetworkReplicatedEntityState {
  entityId: string;
  tick: number;
  transform?: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
  };
  velocity?: { x: number; y: number; z: number };
  replicated?: Record<string, unknown>;
}

export interface NetworkSnapshot {
  tick: number;
  timestamp: number;
  ackInputSeq: number;
  lastProcessedInput?: number;
  lastProcessedInputTick?: number;
  entities: NetworkReplicatedEntityState[];
  positionHash?: string; // MILESTONE 4: Determinism hash for collision validation
}

export interface NetworkHitValidationRequest {
  shooterId: string;
  shotId: string;
  timestamp: number;
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  range: number;
  ignoreEntityIds?: string[];
}

export interface NetworkHitValidationResult {
  shooterId: string;
  shotId: string;
  timestamp: number;
  hitEntityId: string | null;
  rewindTick?: number;
}

export interface NetworkAbilityRequest {
  playerId: string;
  abilityId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface NetworkAbilityValidation {
  playerId: string;
  abilityId: string;
  accepted: boolean;
  reason?: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface PlayerNetworkState {
  playerId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  timestamp: number;
}

export interface INetworkTransport {
  sendState(state: PlayerNetworkState): void;
  onStateReceived(callback: (state: PlayerNetworkState) => void): void;
  sendInput?(command: NetworkInputCommand): void;
  onInputReceived?(callback: (command: NetworkInputCommand) => void): void;
  sendSnapshot?(snapshot: NetworkSnapshot): void;
  onSnapshotReceived?(callback: (snapshot: NetworkSnapshot) => void): void;
  sendHitValidationRequest?(request: NetworkHitValidationRequest): void;
  onHitValidationRequestReceived?(callback: (request: NetworkHitValidationRequest) => void): void;
  sendHitValidationResult?(result: NetworkHitValidationResult): void;
  onHitValidationResultReceived?(callback: (result: NetworkHitValidationResult) => void): void;
  sendAbilityRequest?(request: NetworkAbilityRequest): void;
  onAbilityRequestReceived?(callback: (request: NetworkAbilityRequest) => void): void;
  sendAbilityValidation?(validation: NetworkAbilityValidation): void;
  onAbilityValidationReceived?(callback: (validation: NetworkAbilityValidation) => void): void;
  disconnect(): void;
}