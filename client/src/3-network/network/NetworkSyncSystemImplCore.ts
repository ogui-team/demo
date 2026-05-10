import type { SystemCapabilities, SystemContext } from '../../1-kernel/core/types';
import { Entity, Vector3 } from '../../1-kernel/core/Entity';
import {
  NetworkAbilityRequest,
  NetworkAbilityValidation,
  NetworkHitValidationRequest,
  NetworkHitValidationResult,
  NetworkInputCommand,
  NetworkReplicatedEntityState,
  NetworkSnapshot,
} from './NetworkRuntimeContracts';
import type { StatusMovementModifier } from './MovementModifierContracts';
import {
  DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG,
  createResolvedMovementTuningConfig,
  hasMovementFeelDebugOverride,
  sanitizeMovementFeelDebugConfig,
  type MovementFeelDebugConfig,
  type MovementTuningConfig,
  type ResolvedMovementTuningConfig,
} from './MovementTuningConfig';
import {
  applyInput,
  applyRotation,
  buildBaseMovementTuning,
  createMovementRuntimeState,
  parseStatusMovementModifier,
  resolveMovementTuning,
  resolveStatusMovementModifier,
  toStatusMovementModifier,
  normalizePlanarIntentDirection,
  MovementRuntimeState,
  MovementCollisionContext,
  angleDelta,
} from './NetworkMovementPrediction';
import {
  applyAuthoritativeSnapshot as applyAuthoritativeSnapshotImpl,
} from './NetworkSyncReconciliation';
import {
  processAuthoritativeInputs as processAuthoritativeInputsImpl,
  applyLiveLocalInput as applyLiveLocalInputImpl,
  broadcastSnapshot as broadcastSnapshotImpl,
  captureHistoryFrame as captureHistoryFrameImpl,
  validateHitscan as validateHitscanImpl,
  validateAbilityRequest as validateAbilityRequestImpl,
  handleAbilityValidation as handleAbilityValidationImpl,
  resolveLastProcessedInputSequence,
  resolveLastProcessedInputTick,
  pruneAcknowledgedInputs,
} from './NetworkSyncRuntime';
import { applyPositionErrorDecay as applyPositionErrorDecayImpl } from './NetworkSyncVisualCorrection';
import {
  resetRuntimeState,
  setStatusMovementModifier as setStatusMovementModifierImpl,
  setDerivedStatusMovementModifier as setDerivedStatusMovementModifierImpl,
  setDebugStatusMovementModifier as setDebugStatusMovementModifierImpl,
  setMovementFeelDebugConfig as setMovementFeelDebugConfigImpl,
  getMovementTuningDebugState as getMovementTuningDebugStateImpl,
  getMovementAuthorityDebugState as getMovementAuthorityDebugStateImpl,
  getAllMovementAuthorityDebugStates as getAllMovementAuthorityDebugStatesImpl,
} from './NetworkSyncDebug';
import {
  registerPlayer as registerPlayerImpl,
  bindLocalPlayer as bindLocalPlayerImpl,
  setAbilityValidator as setAbilityValidatorImpl,
  queueLocalInput as queueLocalInputImpl,
  stepLocalInput as stepLocalInputImpl,
  setLiveLocalInput as setLiveLocalInputImpl,
  clearLiveLocalInput as clearLiveLocalInputImpl,
  requestAbilityActivation as requestAbilityActivationImpl,
  requestHitscanValidation as requestHitscanValidationImpl,
  forceLocalState as forceLocalStateImpl,
  clearPendingInputs as clearPendingInputsImpl,
} from './NetworkSyncSystemBindings';
import {
  isSnapshotDataComplete as isSnapshotDataCompleteImpl,
  queuePendingAuthorityBinding as queuePendingAuthorityBindingImpl,
  processPendingAuthorityBindings as processPendingAuthorityBindingsImpl,
} from './NetworkSyncSystemAwaitReady';
import { getDiagnostics as getDiagnosticsImpl } from './NetworkSyncDiagnostics';
import { applyAuthoritativeMovementState as applyAuthoritativeMovementStateImpl } from './NetworkSyncMovementState';
import { initializeNetworkSyncSystem, initNetworkSyncSystem } from './NetworkSyncSystemLifecycle';
import { updateNetworkSyncSystem } from './NetworkSyncSystemRuntime';
import {
  ensureLocalPlayerBinding,
  tryRegisterNetworkEntityMapping,
  flushPendingNetworkMappings,
  getVelocity as getVelocityImpl,
  getLocalPlayerTransform as getLocalPlayerTransformImpl,
  getLocalResolvedMovementState as getLocalResolvedMovementStateImpl,
  getLocalBindingStatus as getLocalBindingStatusImpl,
  dropNetworkEntityCache as dropNetworkEntityCacheImpl,
} from './NetworkSyncSystemLocalBinding';
import {
  enforceLocalIdentityRebind as enforceLocalIdentityRebindImpl,
  hasConfirmedNetworkHandle as hasConfirmedNetworkHandleImpl,
} from './NetworkSyncSystemAuthority';
import type {
  NetworkManagerAdapter,
  NetworkSyncEntityManagerAdapter,
  ReplicationSystemAdapter,
  SpatialPartitionAdapter,
  NetworkEntityIdRegistrar,
  NetworkSyncBinding,
  NetworkMovementIntent,
  MovementAuthorityDebugState,
  MovementTuningDebugState,
  NetworkSyncConfig,
  NetworkAuthorityMode,
  RemotePredictionMode,
  HistoryFrame,
  PendingAuthorityBinding,
  ResolvedStatusMovementModifier,
} from './NetworkSyncSystemTypes';

interface MovementDebugState {
  localPlayerId: string | null;
  localEntityId: string | null;
  localNetworkEntityId: string | null;
  bindingIsBound: boolean;
  lastQueuedInputCommand: NetworkInputCommand | null;
  pendingInputCount: number;
  lastLiveInput: Record<string, unknown> | null;
  lastLiveInputDt: number | null;
  lastProcessedAuthoritativeInput: NetworkInputCommand | null;
  lastMovementIntent: NetworkMovementIntent | null;
  lastInputSource: string | null;
  lastMovementIntentSource: string | null;
  lastBindingResetAt: number | null;
  lastBindingResetDetails: {
    playerId: string;
    entityId: string | null;
    networkEntityId: string | null;
  } | null;
  tick: number;
  timestamp: number;
}

function createMovementDebugState(): MovementDebugState {
  return {
    localPlayerId: null,
    localEntityId: null,
    localNetworkEntityId: null,
    bindingIsBound: false,
    lastQueuedInputCommand: null,
    pendingInputCount: 0,
    lastLiveInput: null,
    lastLiveInputDt: null,
    lastProcessedAuthoritativeInput: null,
    lastMovementIntent: null,
    lastInputSource: null,
    lastMovementIntentSource: null,
    lastBindingResetAt: null,
    lastBindingResetDetails: null,
    tick: 0,
    timestamp: 0,
  };
}

export type {
  NetworkSyncConfig,
  NetworkAuthorityMode,
  RemotePredictionMode,
  NetworkSyncBinding,
  NetworkMovementIntent,
  MovementAuthorityDebugState,
  MovementTuningDebugState,
} from './NetworkSyncSystemTypes';

export class NetworkSyncSystem {
  private readonly networkManager!: NetworkManagerAdapter;
  private entityManager!: NetworkSyncEntityManagerAdapter;
  private replicationSystem!: ReplicationSystemAdapter;
  private spatialPartition!: SpatialPartitionAdapter;
  private readonly tickRate!: number;
  private readonly fixedStep!: number;
  private readonly localInputFixedStep!: number;
  private readonly historySeconds!: number;
  private readonly relevanceRadius!: number;
  private readonly simulateAuthority!: boolean;

  private readonly bindings = new Map<string, NetworkSyncBinding>();
  private readonly networkEntityIdsByPlayer = new Map<string, string>();
  private readonly pendingInputs = new Map<string, NetworkInputCommand[]>();
  private readonly liveInputs = new Map<string, Record<string, unknown>>();
  private readonly authoritativeInputQueue: NetworkInputCommand[] = [];
  private readonly historyBuffer: HistoryFrame[] = [];
  private readonly lastProcessedInputSeq = new Map<string, number>();
  private readonly movementState = new Map<string, MovementRuntimeState>();
  private readonly pendingMovementIntent = new Map<string, NetworkMovementIntent>();
  private readonly statusMovementModifiers = new Map<string, StatusMovementModifier>();
  private readonly derivedStatusMovementModifiers = new Map<string, StatusMovementModifier>();
  private readonly debugStatusMovementModifiers = new Map<string, StatusMovementModifier>();
  private readonly movementFeelDebugConfigs = new Map<string, MovementFeelDebugConfig>();
  private readonly pendingNetworkMappings = new Map<string, string>();
  private readonly movementDebugState = createMovementDebugState();

  /** ─ AWAIT-READY HANDSHAKE: Entities waiting for complete authoritativeSnapshot before bind ─ */
  private readonly pendingAuthorityBindings = new Map<string, PendingAuthorityBinding>();

  /** Kernel bridge — registered by bootstrap to keep DOD buffers in sync with network bindings. */
  private networkEntityIdRegistrar: NetworkEntityIdRegistrar | null = null;
  /** Emitted once per session when the first snapshot containing the local player is applied. */
  private hasEmittedFullSyncData = false;

  private authorityMode: NetworkAuthorityMode = 'local';
  private remotePredictionMode: RemotePredictionMode = 'full';
  private predictionEnabled = true;
  private localReconciliationEnabled = false;
  private visualCorrectionEnabled = false;
  private reconciliationOverrideEnabled = false;
  private reconciliationThreshold = 0.05;
  private softReconciliationThreshold = 1.1;
  private localPlayerId: string | null = null;
  private lastAppliedSnapshotTick: number | null = null;
  private lastLocalSnapshotTick: number | null = null;
  private lastServerTick: number = 0; // MILESTONE 1: Track server tick for Tick-Ack protocol
  private fixedAccumulator = 0;
  private localStepAccumulator = 0;
  private tick = 0;
  private abilityValidator: ((request: NetworkAbilityRequest) => boolean | string) | null = null;
  private commandSink: ((command: NetworkInputCommand) => void) | null = null;
  /** Set to true only when all four PlayerInitPhase entries are marked ready. */
  private playerInitReady = false;
  private collisionResolver: ((context: MovementCollisionContext) => Vector3) | null = null;
  private systemContext: SystemContext | null = null;
  private readonly resolvedMovementTuningScratch = createResolvedMovementTuningConfig();

  constructor(config: NetworkSyncConfig) {
    initializeNetworkSyncSystem(this, config);
  }

  init(ctx: SystemContext): void {
    initNetworkSyncSystem(this, ctx);
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      reconciliationEnabled: this.localReconciliationEnabled,
      visualCorrectionEnabled: this.visualCorrectionEnabled,
      overrideCorrectionEnabled: this.reconciliationOverrideEnabled,
      metrics: this.getDiagnostics(),
    };
  }

  setLocalReconciliationEnabled(enabled: boolean): void {
    this.localReconciliationEnabled = enabled;
  }

  isLocalReconciliationEnabled(): boolean {
    return this.localReconciliationEnabled;
  }

  setVisualCorrectionEnabled(enabled: boolean): void {
    this.visualCorrectionEnabled = enabled;
  }

  isVisualCorrectionEnabled(): boolean {
    return this.visualCorrectionEnabled;
  }

  setReconciliationOverrideEnabled(enabled: boolean): void {
    this.reconciliationOverrideEnabled = enabled;
  }

  isReconciliationOverrideEnabled(): boolean {
    return this.reconciliationOverrideEnabled;
  }

  setAuthorityMode(mode: NetworkAuthorityMode): void {
    this.authorityMode = mode;
    if (mode === 'remote') {
      this.authoritativeInputQueue.length = 0;
    }
  }

  setCommandSink(sink: ((command: NetworkInputCommand) => void) | null): void {
    this.commandSink = sink;
  }

  /**
   * Flip the init-ready gate.  Call with `true` from the PLAYER_INIT_COMPLETE
   * handler so the first outbound input command is not sent before the server
   * has a fully-initialized player entity on the other side.
   * Movement prediction (stepLocalInput) is intentionally NOT gated here.
   */
  setPlayerInitReady(ready: boolean): void {
    this.playerInitReady = ready;
  }

  isPlayerInitReady(): boolean {
    return this.playerInitReady;
  }

  /** Wire the DOD kernel so it receives networkEntityId → handle mappings on every player registration. */
  setNetworkEntityIdRegistrar(registrar: NetworkEntityIdRegistrar | null): void {
    this.networkEntityIdRegistrar = registrar;
  }

  getNetworkEntityIdRegistrar(): NetworkEntityIdRegistrar | null {
    return this.networkEntityIdRegistrar;
  }

  setRemotePredictionMode(mode: RemotePredictionMode): void {
    this.remotePredictionMode = mode;
    this.predictionEnabled = mode === 'full';
  }

  setPredictionEnabled(enabled: boolean): void {
    this.predictionEnabled = enabled;
    this.remotePredictionMode = enabled ? 'full' : 'rotation-only';
  }

  isPredictionEnabled(): boolean {
    return this.predictionEnabled;
  }

  setReconciliationThreshold(value: number): void {
    this.reconciliationThreshold = Math.max(0, value);
  }

  getReconciliationThreshold(): number {
    return this.reconciliationThreshold;
  }

  setSoftReconciliationThreshold(value: number): void {
    this.softReconciliationThreshold = Math.max(this.reconciliationThreshold, value);
  }

  getSoftReconciliationThreshold(): number {
    return this.softReconciliationThreshold;
  }

  getBufferedInputCount(): number {
    return [...this.pendingInputs.values()].reduce((total, queue) => total + queue.length, 0);
  }

  setCollisionResolver(resolver: ((context: MovementCollisionContext) => Vector3) | null): void {
    this.collisionResolver = resolver;
  }

  registerPlayer(binding: NetworkSyncBinding, options: { local?: boolean } = {}): void {
    registerPlayerImpl(this, binding, options);
  }

  bindLocalPlayer(playerId: string, entity: Entity, options: Omit<NetworkSyncBinding, 'playerId' | 'entity'> = {}): void {
    bindLocalPlayerImpl(this, playerId, entity, options);
  }

  setAbilityValidator(validator: (request: NetworkAbilityRequest) => boolean | string): void {
    setAbilityValidatorImpl(this, validator);
  }

  queueLocalInput(input: Record<string, unknown>): NetworkInputCommand | null {
    return queueLocalInputImpl(this, input);
  }

  stepLocalInput(input: Record<string, unknown>, dt: number): void {
    stepLocalInputImpl(this, input, dt);
  }

  setLiveLocalInput(input: Record<string, unknown>): void {
    setLiveLocalInputImpl(this, input);
  }

  clearLiveLocalInput(): void {
    clearLiveLocalInputImpl(this);
  }

  requestAbilityActivation(abilityId: string, payload?: Record<string, unknown>): boolean {
    return requestAbilityActivationImpl(this, abilityId, payload);
  }

  requestHitscanValidation(request: Omit<NetworkHitValidationRequest, 'shooterId' | 'timestamp'>): boolean {
    return requestHitscanValidationImpl(this, request);
  }

  forceLocalState(
    position: Vector3,
    rotation: Vector3,
    velocity?: Vector3,
    options: { clearPendingInputs?: boolean } = {},
  ): void {
    forceLocalStateImpl(this, position, rotation, velocity, options);
  }

  clearPendingInputs(playerId?: string): void {
    clearPendingInputsImpl(this, playerId);
  }

  // ─ AWAIT-READY HANDSHAKE HELPERS ─
  
  /** Check if entity snapshot contains required data for successful binding */
  private isSnapshotDataComplete(entitySnapshot: NetworkReplicatedEntityState): boolean {
    return isSnapshotDataCompleteImpl(this, entitySnapshot);
  }

  private queuePendingAuthorityBinding(playerId: string, networkEntityId: string): void {
    queuePendingAuthorityBindingImpl(this, playerId, networkEntityId);
  }

  private processPendingAuthorityBindings(snapshot: NetworkSnapshot): void {
    processPendingAuthorityBindingsImpl(this, snapshot);
  }

  resetRuntimeState(): void {
    resetRuntimeState(this);
  }

  setStatusMovementModifier(playerId: string, modifier: StatusMovementModifier | null): void {
    setStatusMovementModifierImpl(this, playerId, modifier);
  }

  setDerivedStatusMovementModifier(playerId: string, modifier: StatusMovementModifier | null): void {
    setDerivedStatusMovementModifierImpl(this, playerId, modifier);
  }

  setDebugStatusMovementModifier(playerId: string, modifier: StatusMovementModifier | null): void {
    setDebugStatusMovementModifierImpl(this, playerId, modifier);
  }

  setMovementFeelDebugConfig(playerId: string, config: MovementFeelDebugConfig | null): void {
    setMovementFeelDebugConfigImpl(this, playerId, config);
  }

  getMovementTuningDebugState(playerId?: string): MovementTuningDebugState {
    return getMovementTuningDebugStateImpl(this, playerId);
  }

  getMovementAuthorityDebugState(playerId?: string): MovementAuthorityDebugState {
    return getMovementAuthorityDebugStateImpl(this, playerId);
  }

  getAllMovementAuthorityDebugStates(): MovementAuthorityDebugState[] {
    return getAllMovementAuthorityDebugStatesImpl(this);
  }

  queueMovementIntent(playerId: string, intent: NetworkMovementIntent): void {
    const normalized = this.normalizePlanarIntentDirection(intent.direction);
    const queuedIntent = {
      horizontalImpulse: Math.max(0, intent.horizontalImpulse),
      direction: normalized,
      jump: intent.jump === true,
      crouch: intent.crouch === true,
      verticalImpulse: typeof intent.verticalImpulse === 'number' ? intent.verticalImpulse : undefined,
    };
    this.pendingMovementIntent.set(playerId, queuedIntent);
    this.movementDebugState.lastMovementIntent = queuedIntent;
    this.movementDebugState.lastMovementIntentSource = 'queueMovementIntent';
    this.movementDebugState.lastInputSource = 'movement_intent';
    this.movementDebugState.timestamp = Engine.time.now();
  }

  update(dt: number): void {
    updateNetworkSyncSystem(this, dt);
  }

  applyAuthoritativeSnapshot(snapshot: NetworkSnapshot): void {
    applyAuthoritativeSnapshotImpl(this, snapshot);
  }

  private enforceLocalIdentityRebind(source: string, tick: number): void {
    enforceLocalIdentityRebindImpl(this, source, tick);
  }

  hasConfirmedNetworkHandle(playerId: string): boolean {
    return hasConfirmedNetworkHandleImpl(this, playerId);
  }

  private tryRegisterNetworkEntityMapping(playerId: string, networkEntityId: string): boolean {
    return tryRegisterNetworkEntityMapping(this, playerId, networkEntityId);
  }

  private flushPendingNetworkMappings(): void {
    flushPendingNetworkMappings(this);
  }

  getVelocity(playerId: string): Vector3 {
    return getVelocityImpl(this, playerId);
  }

  getLocalPlayerTransform(): { position: Vector3; rotation: Vector3; velocity: Vector3 } | null {
    return getLocalPlayerTransformImpl(this);
  }

  getLocalResolvedMovementState(): { isCrouching: boolean; isAirborne: boolean; groundHeight: number; velocity: Vector3 } | null {
    return getLocalResolvedMovementStateImpl(this);
  }

  getLocalBindingStatus(): {
    playerId: string | null;
    entityId: string | null;
    networkEntityId: string | null;
    isBound: boolean;
  } {
    return getLocalBindingStatusImpl(this);
  }

  getMovementDebugState(): MovementDebugState {
    const binding = this.localPlayerId ? this.bindings.get(this.localPlayerId) : undefined;
    return {
      ...this.movementDebugState,
      localPlayerId: this.localPlayerId,
      localEntityId: binding?.entity.id ?? null,
      localNetworkEntityId: this.localPlayerId ? (this.networkEntityIdsByPlayer.get(this.localPlayerId) ?? this.localPlayerId) : null,
      bindingIsBound: !!(this.localPlayerId && binding),
      tick: this.tick,
      timestamp: Engine.time.now(),
    };
  }

  getLastAppliedSnapshotTick(): number | null {
    return this.lastAppliedSnapshotTick;
  }

  getLastLocalSnapshotTick(): number | null {
    return this.lastLocalSnapshotTick;
  }

  dropNetworkEntityCache(networkEntityId: string, reason = 'unspecified'): void {
    dropNetworkEntityCacheImpl(this, networkEntityId, reason);
  }

  getDiagnostics(): Record<string, unknown> {
    return getDiagnosticsImpl(this);
  }

  private ensureLocalPlayerBinding(): string | null {
    return ensureLocalPlayerBinding(this);
  }

  private processAuthoritativeInputs(): void {
    processAuthoritativeInputsImpl(this);
  }

  private applyLiveLocalInput(dt: number): void {
    applyLiveLocalInputImpl(this, dt);
  }

  private applyAuthoritativeMovementState(
    runtime: MovementRuntimeState,
    authoritative: NetworkReplicatedEntityState,
    currentPosition: Vector3,
  ): void {
    applyAuthoritativeMovementStateImpl(runtime, authoritative, currentPosition);
  }

  private broadcastSnapshot(): void {
    broadcastSnapshotImpl(this);
  }

  /**
   * Snapshot sequence ack resolver.
   * Priority:
   * 1) `lastProcessedInput` (explicit sequence ack)
   * 2) `ackInputSeq` (legacy sequence ack)
   * 3) undefined
   */
  private resolveLastProcessedInputSequence(snapshot: NetworkSnapshot): number | undefined {
    return resolveLastProcessedInputSequence(snapshot);
  }

  private resolveLastProcessedInputTick(snapshot: NetworkSnapshot): number | undefined {
    return resolveLastProcessedInputTick(snapshot);
  }

  /**
   * In-place prune of acknowledged inputs from pending history.
   * Keeps command objects and array storage stable for replay loops.
   */
  private pruneAcknowledgedInputs(
    playerId: string,
    lastProcessedSequence: number | undefined,
    lastProcessedTick: number | undefined,
  ): NetworkInputCommand[] {
    return pruneAcknowledgedInputs(this, playerId, lastProcessedSequence, lastProcessedTick);
  }

  private captureHistoryFrame(): void {
    captureHistoryFrameImpl(this);
  }

  private validateHitscan(request: NetworkHitValidationRequest): void {
    validateHitscanImpl(this, request);
  }

  private validateAbilityRequest(request: NetworkAbilityRequest): void {
    validateAbilityRequestImpl(this, request);
  }

  private handleAbilityValidation(validation: NetworkAbilityValidation): void {
    handleAbilityValidationImpl(this, validation);
  }

  private applyInput(binding: NetworkSyncBinding, input: Record<string, unknown>, dt: number): void {
    applyInput({
      binding,
      input,
      dt,
      currentTick: this.tick,
      movementState: this.movementState,
      collisionResolver: this.collisionResolver,
      movementFeelDebugConfigs: this.movementFeelDebugConfigs,
      resolvedMovementTuningScratch: this.resolvedMovementTuningScratch,
      pendingMovementIntent: this.pendingMovementIntent,
      resolveStatusMovementModifier: (playerId) => resolveStatusMovementModifier(
        playerId,
        this.statusMovementModifiers,
        this.derivedStatusMovementModifiers,
        this.debugStatusMovementModifiers,
      ),
      localPlayerId: this.localPlayerId,
      spatialPartition: this.spatialPartition,
    });
  }

  private applyRotation(binding: NetworkSyncBinding, input: Record<string, unknown>): void {
    applyRotation({
      binding,
      input,
      movementState: this.movementState,
      currentTick: this.tick,
    });
  }

  private parseStatusMovementModifier(raw: unknown): StatusMovementModifier | null {
    return parseStatusMovementModifier(raw);
  }

  private resolveStatusMovementModifier(playerId: string): ResolvedStatusMovementModifier {
    return resolveStatusMovementModifier(
      playerId,
      this.statusMovementModifiers,
      this.derivedStatusMovementModifiers,
      this.debugStatusMovementModifiers,
    );
  }

  private toStatusMovementModifier(resolved: ResolvedStatusMovementModifier): StatusMovementModifier | null {
    return toStatusMovementModifier(resolved);
  }

  private normalizePlanarIntentDirection(direction: Vector3): Vector3 {
    return normalizePlanarIntentDirection(direction);
  }

  private createMovementRuntimeState(): MovementRuntimeState {
    return createMovementRuntimeState(this.tick);
  }

  private buildBaseMovementTuning(binding: NetworkSyncBinding | undefined): MovementTuningConfig {
    return buildBaseMovementTuning(binding);
  }

  private resolveMovementTuning(binding: NetworkSyncBinding | undefined): ResolvedMovementTuningConfig {
    return resolveMovementTuning(binding, this.movementFeelDebugConfigs, this.resolvedMovementTuningScratch);
  }

  // ─ POSITION ERROR DECAY: Gradual visual correction ─
  // Apply position error blending each frame to prevent snap-back jerk
  // Error decays over 100ms window instead of snapping immediately
  private applyPositionErrorDecay(dt: number): void {
    applyPositionErrorDecayImpl(this, dt);
  }
}
