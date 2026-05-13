/**
 * core/types.ts
 *
 * Shared primitive types and interfaces used across the entire engine.
 * Import from here rather than defining ad-hoc types in individual systems.
 *
 * ─── Entities ────────────────────────────────────────────────────────────────
 * EntityID is a stable, unique string assigned by EntityManager on creation.
 * It is safe to use as a Map key or compare with ===.
 *
 * ─── Systems ─────────────────────────────────────────────────────────────────
 * All systems that tick should implement System. EngineController calls
 * update(dt) once per frame via the auxiliarySystems registry.
 *
 * ─── Components ──────────────────────────────────────────────────────────────
 * The Component shape matches what Entity.addComponent() expects.
 *
 * ─── Events ──────────────────────────────────────────────────────────────────
 * GameEvents maps every engine-wide event name to its payload type.
 * The typed EventBus in EventBus.ts uses this to enforce correctness at all
 * call sites.
 */

import type { WorldProductionSyncPayload } from '@shared/contracts';

// ─── Entity ID ────────────────────────────────────────────────────────────────

/** Stable, globally-unique identifier for a live entity. */
export type EntityID = string;

export type EditorTool = 'SELECT' | 'PAINT' | 'WHITEBOX';

export type EditorComponentPathSegment = string | number;

export interface EditorEntityTransformSnapshot {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export interface EditorComponentSnapshot {
  name: string;
  data: unknown;
}

export interface EditorEntitySelectionPayload {
  entityId: EntityID;
  entityType: string;
  transform: EditorEntityTransformSnapshot;
  components: EditorComponentSnapshot[];
  selectedAt: number;
}

// ─── System ───────────────────────────────────────────────────────────────────

/**
 * Minimal interface every tickable system must satisfy.
 * Systems that need fixed-timestep simulation may optionally implement
 * fixedUpdate; the engine will call it at a constant 60 Hz if present
 * (once that feature is added to EngineController).
 */
export interface System {
  update(dt: number): void;
  fixedUpdate?(dt: number): void;
  enable?(): void;
  disable?(): void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Shape of a component as stored on an Entity. */
export interface Component {
  name: string;
  data: Record<string, unknown>;
}

// ─── Game Events ──────────────────────────────────────────────────────────────

/**
 * Typed map of every engine-level event name → payload.
 * Extend this interface when adding new global events.
 * Do NOT put system-internal events here — keep those as method calls.
 *
 * Usage:
 *   import { gameBus } from './EventBus';
 *   gameBus.on('itemPicked', ({ entityId, itemId }) => { ... });
 *   gameBus.emit('itemPicked', { entityId: 'e_42', itemId: 'health_small', quantity: 1 });
 */
export interface GameEvents {
  /** Request a change of the active editor tool. */
  EDITOR_TOOL_CHANGE_REQUESTED: {
    tool: EditorTool;
    reason?: string;
    source?: 'ui' | 'hotkey' | 'system';
    timestamp: number;
  };

  /** Active editor tool changed. */
  EDITOR_TOOL_CHANGED: {
    tool: EditorTool;
    previousTool: EditorTool;
    reason?: string;
    source?: 'ui' | 'hotkey' | 'system';
    timestamp: number;
  };

  /** Editor tool transient interaction state changed. */
  EDITOR_TOOL_STATE_CHANGED: {
    activeTool: EditorTool;
    isGizmoDragging: boolean;
    isPainting: boolean;
    isWhiteboxing: boolean;
    busyOwner: 'none' | 'gizmo' | 'paint' | 'whitebox';
    reason?: string;
    timestamp: number;
  };

  /** Inspector-facing payload for the currently selected entity. */
  EDITOR_ENTITY_SELECTED: EditorEntitySelectionPayload;

  /** Selection cleared in the editor. */
  EDITOR_ENTITY_DESELECTED: {
    entityId: EntityID | null;
    timestamp: number;
  };

  /** Request to update component data from editor UI. */
  EDITOR_UPDATE_COMPONENT: {
    entityId: EntityID;
    componentName: string;
    path: EditorComponentPathSegment[] | string;
    value: unknown;
    source?: 'ui' | 'editor_inspector' | 'system';
    timestamp: number;
  };

  /** Component data was updated through editor tooling. */
  EDITOR_COMPONENT_UPDATED: {
    entityId: EntityID;
    componentName: string;
    path: EditorComponentPathSegment[];
    previousValue: unknown;
    value: unknown;
    source?: 'ui' | 'editor_inspector' | 'system';
    timestamp: number;
  };

  /** Component update was rejected or failed validation. */
  EDITOR_COMPONENT_UPDATE_FAILED: {
    entityId: EntityID;
    componentName: string;
    path: EditorComponentPathSegment[];
    reason: string;
    source?: 'ui' | 'editor_inspector' | 'system';
    timestamp: number;
  };

  /** Request prefab placement from editor tooling. */
  EDITOR_SPAWN_PREFAB: {
    prefabId: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    source?: 'ui' | 'paint' | 'system';
    timestamp: number;
  };

  /** Prefab placement succeeded. */
  EDITOR_PREFAB_PLACED: {
    prefabId: string;
    entityId: EntityID;
    authority: 'local' | 'replicated';
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    timestamp: number;
  };

  /** Request to snap the selected entity to the floor. */
  EDITOR_SNAP_TO_FLOOR_REQUESTED: {
    entityId: EntityID;
    maxDistance?: number;
    epsilon?: number;
    source?: 'shortcut' | 'ui' | 'system';
    timestamp: number;
  };

  /** Request to delete the selected editor entity. */
  EDITOR_DELETE_ENTITY_REQUESTED: {
    entityId: EntityID;
    timestamp: number;
  };

  /** Entity position snapped to a floor hit. */
  EDITOR_ENTITY_SNAPPED_TO_FLOOR: {
    entityId: EntityID;
    previousPosition: { x: number; y: number; z: number };
    position: { x: number; y: number; z: number };
    hitPoint: { x: number; y: number; z: number };
    timestamp: number;
  };

  /** Painter tool parameters changed. */
  EDITOR_PAINTER_CONFIG_CHANGED: {
    selectedPrefabId: string | null;
    spacing: number;
    randomRotation: number;
    randomScaleMin: number;
    randomScaleMax: number;
    timestamp: number;
  };

  /** Trigger volume whitebox entity created. */
  EDITOR_TRIGGER_VOLUME_CREATED: {
    entityId: EntityID;
    center: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
    timestamp: number;
  };

  menuPreviewChanged: {
    active: boolean;
  };

  /** A generic state mutation occurred inside the central state layer. */
  stateMutation: {
    source: string;
    path?: string;
    paths?: string[];
    changedCount: number;
  };

  /** Persistence lifecycle event emitted by save/load/export/import operations. */
  persistenceLifecycle: {
    action: 'serialize' | 'deserialize' | 'save' | 'load' | 'export' | 'import' | 'delete';
    name?: string;
    success?: boolean;
    entitiesCreated?: number;
    settingsApplied?: number;
  };     

  /** A streamed world chunk was loaded into the runtime. */
  CHUNK_LOADED: {
    worldId: string;
    chunkId: string;
    cellId: string;
    entityIds: EntityID[];
    recreated: number;
    timestamp: number;
  };

  /** A streamed world chunk was unloaded from the runtime. */
  CHUNK_UNLOADED: {
    worldId: string;
    chunkId: string;
    cellId: string;
    entityCount: number;
    timestamp: number;
  };

  /** Runtime director changed budget/cadence for the active simulation slice. */
  RUNTIME_SIMULATION_BUDGET: {
    mode: 'foreground' | 'balanced' | 'throttled';
    loadedChunks: number;
    visibleLoadedChunks: number;
    backgroundQueueSize: number;
    streamingPressure: number;
    asyncJobs: number;
    timestamp: number;
  };

  /** The player focus moved into a different streamed/runtime zone. */
  PLAYER_ENTERED_ZONE: {
    cellId: string;
    position: { x: number; y: number; z: number };
    timestamp: number;
  };

  /** Generic network transport/runtime lifecycle event. */
  networkLifecycle: {
    source: string;
    state: string;
    detail?: string;
    playerId?: string | null;
    roomId?: string | null;
    closeCode?: number;
    closeReason?: string;
    wasClean?: boolean;
  };

  /** Generic replication pipeline lifecycle event. */
  replicationLifecycle: {
    action: 'binding_registered' | 'binding_unregistered' | 'snapshot_captured' | 'snapshot_applied';
    entityId?: string;
    count?: number;
    tick?: number;
  };

  /** World-object authority bookkeeping changed. */
  worldObjectAuthority: {
    action: string;
    authorityId?: string;
    entityId?: string;
    entityType?: string;
    mappedWorldObjects?: number;
  };

  /** A stale snapshot entity was dropped because no prefab exists on client. */
  STALE_SNAPSHOT_ENTITY_DROPPED: {
    entityType: string;
    netId: string | null;
    timestamp: number;
  };

  /** Kernel registry confirmed a networkEntityId -> handle mapping. */
  NETWORK_ENTITY_HANDLE_MAPPED: {
    playerId: string;
    networkEntityId: string | number;
    handle: number;
    timestamp: number;
  };

  /** Generic local character runtime update signal for AI/actor debugging. */
  characterActorRuntime: {
    action: 'updated';
    trackedActors: number;
    updatedActors: number;
    movedActors: number;
    spatialCandidates: number;
    spatialQueries: number;
  };

  /** A player input command was queued for prediction/authority processing. */
  playerInput: {
    playerId: EntityID;
    seq: number;
    tick: number;
    timestamp: number;
    input: Record<string, unknown>;
  };

  /** Normalized movement/net debug event for local input buffering. */
  INPUT_BUFFERED: {
    playerId: EntityID;
    seq: number;
    tick: number;
    timestamp: number;
    input: Record<string, unknown>;
  };

  /** Normalized movement/net debug event for outbound movement commands. */
  COMMAND_SENT: {
    playerId: EntityID;
    seq: number;
    tick: number;
    timestamp: number;
    input: Record<string, unknown>;
  };

  /** Normalized movement/net debug event for snapshot ingestion. */
  SNAPSHOT_RECEIVED: {
    tick: number;
    ackInputSeq: number;
    lastProcessedInput?: number;
    timestamp: number;
    entityIds: EntityID[];
  };

  /** ─ AWAIT-READY HANDSHAKE: Snapshot verification complete with full data ─ */
  SYNC_VERIFIED: {
    playerId: EntityID | null;
    tick: number;
    networkEntityId: string | number;
    timestamp: number;
    reason: string;
  };

  /** ─ AWAIT-READY HANDSHAKE: DOD buffer hydration complete after SYNC_VERIFIED ─ */
  FORCE_BUFFER_HYDRATION: {
    playerId: EntityID | null;
    tick: number;
    networkEntityId: string | number;
    reason: string;
    timestamp: number;
  };

  /** Reconciliation lock begins; kernel movement writes should pause. */
  RECONCILIATION_BEGIN: {
    playerId: EntityID;
    tick: number;
    timestamp: number;
  };

  /** Reconciliation lock ends; kernel movement writes can resume. */
  RECONCILIATION_END: {
    playerId: EntityID;
    tick: number;
    replayedInputCount: number;
    timestamp: number;
  };

  /** ─ PERMANENT-BINDING-GUARD: Mesh rebind when kernel handle changes during reconciliation ─ */
  ENTITY_REBOUND: {
    entityId: EntityID;
    oldHandle: number;
    newHandle: number;
    meshName: string;
    timestamp: number;
    reason?: string;
  };

  /** Normalized movement/net debug event for local reconciliation. */
  ENTITY_RECONCILED: {
    playerId: EntityID;
    entityId: EntityID;
    tick: number;
    correctionDistance: number;
    authoritativePosition: { x: number; y: number; z: number };
  };

  /** Soft-reconciliation sample used for movement smoothness validation. */
  SMOOTHNESS_SAMPLE: {
    source: string;
    tick: number;
    correctionDistance: number;
    lerpFactor: number;
    threshold: number;
    playerId?: EntityID;
    entityId?: EntityID | number;
  };

  /** An entity was collected from the world into a player's inventory. */
  itemPicked: {
    entityId: EntityID;
    itemId:   string;
    quantity: number;
  };

  /** A player entity received damage. */
  playerHit: {
    entityId: EntityID;
    damage:   number;
    sourceId: EntityID;
  };

  /** A lag-compensated authoritative hit was validated. */
  entityHit: {
    shooterId: EntityID;
    targetId: EntityID | null;
    shotId: string;
    timestamp: number;
  };

  /** A player entity's health dropped to 0. */
  playerKilled: {
    entityId: EntityID;
    killerId: EntityID;
  };

  /** EngineController or ModeManager changed application state. */
  stateChanged: {
    from: string;
    to:   string;
  };

  /** A hard runtime reset flushed stale entity/UI/input bindings. */
  ENGINE_RESET: {
    reason: string;
    phase: 'soft' | 'full';
    lifecycleState: string;
    roundNumber: number;
    playerId: EntityID | null;
  };

  /** A multiplayer round or lobby lifecycle transition occurred. */
  ROUND_TRANSITION: {
    from: string;
    to: string;
    reason: string;
    roundNumber: number;
  };

  /** Input-dependent systems must rebind to the current live entity. */
  FORCE_REBIND_INPUT: {
    playerId: EntityID | null;
    entityId: EntityID | null;
    cause: string;
  };

  /** The local player is fully actualized and gameplay input can activate. */
  LOCAL_PLAYER_ACTUALIZED: {
    playerId: EntityID | null;
    entityId: EntityID | null;
    tick: number | null;
    forced: boolean;
    latencyMs: number | null;
    source: string;
  };

  /** ─ AUTHORITY-BASED BINDING: Server confirmed authority mapping for local player */
  SPAWN_AUTHORITY_VALIDATED: {
    playerId: string;
    entityId: string;
    authority: string;
  };

  /** A weapon was fired by an entity. */
  weaponFired: {
    entityId: EntityID;
    weaponId: string;
  };

  /** A player's loaded-ammo count changed (reload, fire, pickup). */
  ammoChanged: {
    entityId: EntityID;
    weaponId: string;
    current:  number;
    reserve:  number;
    max:      number;
    isReloading: boolean;
  };

  /** Uppercase variant: A player's loaded-ammo count changed */
  AMMO_CHANGED: {
    entityId: EntityID;
    weaponId: string;
    current:  number;
    reserve:  number;
    max:      number;
    isReloading: boolean;
  };

  /** Manual reload key pressed for currently selected toolbar item. */
  manual_reload_requested: {
    playerId: EntityID;
    itemId: string;
    instanceId?: string | null;
  };

  /** Hitscan weapon fired and hit a target */
  HITSCAN_HIT: {
    shooterId: EntityID;
    targetId: EntityID | null;
    position: { x: number; y: number; z: number };
    damage: number;
    timestamp: number;
  };

  /** A player's HP value changed (damage, healing). */
  healthChanged: {
    entityId: EntityID;
    hp:      number;
    maxHp:   number;
  };

  /** A player's shield value changed (absorb gain/loss/regen). */
  shieldChanged: {
    entityId:  EntityID;
    shield:    number;
    maxShield: number;
  };

  ENTITY_HIT: {
    targetId: EntityID;
    sourceId?: EntityID;
    abilityId?: string;
    amount: number;
    position: { x: number; y: number; z: number };
    remainingHp?: number | null;
    maxHp?: number | null;
    killed?: boolean;
  };

  ENTITY_KILLED: {
    targetId: EntityID;
    killedBy?: EntityID;
    abilityId?: string;
    entityHandle?: number;
    position?: { x: number; y: number; z: number };
  };

  /** A gameplay ability was activated by an entity. */
  abilityCast: {
    entityId:  EntityID;
    abilityId: string;
  };

  /** A gameplay ability activation was requested for server validation. */
  abilityActivationRequested: {
    entityId: EntityID;
    abilityId: string;
    payload?: Record<string, unknown>;
  };

  ABILITY_PROJECTILE_SPAWNED: {
    abilityId: string;
    casterId: string;
    projectileId: string;
    entityId: string;
    position: { x: number; y: number; z: number };
  };

  ABILITY_PROJECTILE_IMPACT: {
    abilityId: string;
    casterId: string;
    targetId: string;
    position: { x: number; y: number; z: number };
  };

  /** Cooldown timer started for an ability on an entity. */
  cooldownStarted: {
    entityId:  EntityID;
    abilityId: string;
    duration:  number;
  };

  /** A GameMode plugin became the active mode. */
  gameModeStarted: {
    modeName: string;
  };

  /** Horde wave state changed. */
  hordeWaveState: {
    wave: number;
    status: 'waiting_to_start' | 'waiting' | 'active' | 'stopped' | 'initiated' | 'victory';
    enemyCount?: number;
    kills?: number;
    points?: number;
    streak?: number;
    maxStreak?: number;
    lastAward?: number;
    nextWaveIn?: number;
  };

  /** A horde encounter transitioned into active runtime simulation. */
  HORDE_STARTED: {
    wave: number;
    kills: number;
    timestamp: number;
  };

  /** A runtime encounter finished and released its active budget slot. */
  ENCOUNTER_FINISHED: {
    encounterType: 'horde';
    status: 'stopped' | 'victory';
    wave: number;
    kills: number;
    timestamp: number;
  };

  /** The active GameMode ended (kill limit, time limit, etc.). */
  gameModeEnded: {
    modeName:  string;
    winnerId:  string | null;
    reason:    string;
  };

  /** A player entity was (re)spawned into the world. */
  playerSpawned: {
    entityId: EntityID;
    position: { x: number; y: number; z: number };
    isRespawn: boolean;
  };

  /** A remote player model was instantiated for rendering / hit detection. */
  playerModelSpawned: {
    playerId: EntityID;
    entityId: EntityID;
    position: { x: number; y: number; z: number };
  };

  /** A remote player model was removed from the scene. */
  playerModelRemoved: {
    playerId: EntityID;
    entityId: EntityID | null;
  };

  /** A prefab-backed world object was created. */
  prefabCreated: {
    prefabName: string;
    entityId: EntityID;
    objectId: string;
  };

  /** A prefab-backed world object was removed. */
  prefabRemoved: {
    prefabName: string;
    entityId: EntityID;
    objectId: string;
  };

  /** Remove stale placeholder visuals when the real prefab becomes available. */
  CLEANUP_PLACEHOLDER: {
    entityId: EntityID;
    networkEntityId: string;
    prefabName: string;
    timestamp: number;
  };

  /** A replication snapshot was applied to one or more entities. */
  replicationSnapshotApplied: {
    tick: number;
    entityIds: EntityID[];
  };

  /** A player's scoreboard entry changed (kill, death, assist). */
  scoreUpdated: {
    entityId: EntityID;
    score:    number;
    kills:    number;
    deaths:   number;
  };

  // ── Player Initialization Contract events ──────────────────────────────

  /**
   * Emitted by InventoryGridManager after a successful init() fetch.
   * Subscribers (bootstrapClientRuntime) use this to call weaponSystem.equip()
   * and mark the 'inventory' phase ready on EntityManager.
   */
  INVENTORY_READY: {
    playerId:       string;
    equippedWeapon: string | null;
    equippedArmor:  string | null;
    /** Full list of grid items fetched from the server inventory endpoint. */
    items:          import('../../2-systems/gameplay/systems/InventoryGridManager').GridItem[];
  };

  /**
   * Emitted by EntityManager.markPlayerPhaseReady() once all four phases
   * (entity, inventory, abilities, avatar) are confirmed.
   * NetworkSyncSystem subscribes to this to open the commandSink gate.
   */
  PLAYER_INIT_COMPLETE: {
    playerId: string;
  };

  /**
   * Emitted by PlayerModelSystem.setLocalAppearance() and
   * _onLocalAppearanceStateChange() whenever the local player's avatar
   * appearance changes.
   * MultiplayerRuntimeCoordinator subscribes and calls mpClient.sendAppearance()
   * to broadcast the update to all peers in the room.
   */
  PLAYER_APPEARANCE_CHANGED: {
    playerId: string;
    appearance: {
      modelVariant?: string;
      textureStyle?: string;
      bodyColor?: number;
      accentColor?: number;
      skinColor?: number;
      legColor?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      heightScale?: number;
      widthScale?: number;
    };
  };

  // ── Network/Domain Bridge Events (Fix for Network/State Silos) ──────────

  /**
   * Emitted when MultiplayerClient receives INVENTORY_SYNC from server.
   * Published to gameBus to reach all domains (InventorySystem, UI, etc).
   * This bridges the gap between the network domain and gameplay domain.
   * 
   * CRITICAL: MultiplayerClient must bridge its internal emit() to gameBus.emit()
   * so that systems in other domains can listen to network events.
   */
  networkInventorySyncReceived: {
    inventory: Record<string, unknown>;
    timestamp: number;
  };

  networkInventoryError: {
    reason: string;
    timestamp: number;
  };

  /**
   * Emitted when local movement input is ready for network broadcast.
   * Bridges PlayController (foundation/controller) → gameBus → NetworkSyncSystem (network/sync).
   * Without this, movement input is isolated in the PlayController and never reaches NetworkSyncSystem.
   * 
   * CRITICAL: PlayController must emit this every frame so NetworkSyncSystem can
   * capture and broadcast movement to the server.
   */
  playerMovementInputCaptured: {
    entityId: string | null;
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    sprint: boolean;
    crouch: boolean;
    movementIntent: {
      jump: boolean;
      crouch: boolean;
    };
    yaw: number;
    pitch: number;
    reconciliationActive?: boolean;
    reconciliationPositionOverride?: { x: number; y: number; z: number };
    timestamp: number;
  };

  /**
   * Emitted when NetworkSyncSystem binds or unbinds local input to/from an entity.
   * Notifies all domains (UI, diagnostics, other systems) of binding state changes.
   * Prevents race conditions where UI or other systems need to know if the local
   * player entity is ready to receive input.
   */
  networkInputBindingChanged: {
    entityId: string | null;
    playerId: string | null;
    authority: 'local' | 'remote';
  };

  /**
   * Emitted when authoritative ammo state is synced from server to WeaponSystem.
   * Bridges WeaponSystem (gameplay/weapons) → gameBus → InventorySystem (gameplay/inventory).
   * Without this, ammo state is siloed in WeaponSystem and InventorySystem has no access.
   * 
   * CRITICAL: WeaponSystem.syncAuthoritativeAmmoState() must emit this to gameBus
   * so InventorySystem can receive and display accurate ammo counts to the player.
   */
  ammoStateSyncBridge: {
    playerId: string;
    weaponId: string;
    currentAmmo: number;
    reserveAmmo: number;
    isReloading: boolean;
  };

  /** Entity migration/replication lifecycle event */
  MIGRATE_COMPLETE: {
    oldEntityId: string;
    newEntityId: string;
    prefabName: string;
    success: boolean;
  };

  /** Lifecycle orchestrator transitioned to PLAY_ACTIVE phase */
  LIFECYCLE_PLAY_ACTIVE: {
    playerId: EntityID | null;
    entityId: EntityID | null;
    timestamp: number;
  };

  /** Full network synchronization data received from server */
  FULL_SYNC_DATA: {
    playerId: EntityID | null;
    tick: number;
    entityCount: number;
    timestamp: number;
    localPlayerId?: EntityID | null;
    entities?: Array<{
      id: EntityID;
      networkEntityId?: EntityID;
      isPlayerControlled?: boolean;
      IS_PLAYER_CONTROLLED?: boolean;
    }>;
  };

  INITIAL_MAP_SYNC: {
    mapData: {
      version: string;
      entityCount: number;
      entities: Array<Record<string, unknown>>;
      productionSync?: WorldProductionSyncPayload | null;
    };
    timestamp: number;
  };

  /** An entity was spawned into the world */
  ENTITY_SPAWNED: {
    entityId: EntityID;
    playerId: EntityID | null;
    entityType?: string;
    position?: { x: number; y: number; z: number };
    isPlayerControlled?: boolean;
    source?: string;
    profileId?: string;
    networked?: boolean;
    timestamp: number;
  };

  /** PlayController was bound to an entity for input handling */
  CONTROLLER_BOUND: {
    playerId: EntityID | null;
    entityId: EntityID | null;
    timestamp: number;
  };

  /** Request to set AI behavior state (will be validated/applied) */
  AI_BEHAVIOR_STATE_SET_REQUESTED: {
    entityId: EntityID;
    state: string; // e.g., 'patrol', 'chase', 'attack', 'idle'
    source?: 'editor_inspector' | 'runtime_debug' | 'system';
  };

  /** AI behavior state was changed on an entity */
  AI_BEHAVIOR_STATE_CHANGED: {
    entityId: EntityID;
    previousState: string;
    state: string;
    source?: 'editor_inspector' | 'runtime_debug' | 'system' | 'component_sync';
  };

  /** Lifecycle state of boot orchestrator changed */
  LIFECYCLE_CHANGED: {
    from: string;
    to: string;
    timestamp: number;
  };

  /** HUD ammo display synchronized with weapon system */
  HUD_AMMO_SYNC: {
    playerId: EntityID | null;
    weaponId: string | null;
    current: number;
    reserve: number;
    max: number;
    isReloading: boolean;
    timestamp: number;
  };

  /** Full sync data ready signal for multiplayer coordination */
  FULL_SYNC_READY: {
    tick: number;
    entityCount: number;
    timestamp: number;
  };

  /** Force inventory UI/state refresh once lifecycle reaches active play. */
  FORCE_INVENTORY_REFRESH: {
    phase: string;
    timestamp: number;
  };

  /** Force bridge systems to mirror binary runtime data into JSON state paths. */
  GLOBAL_STATE_REFRESH: {
    source: string;
    playerId?: string | null;
    timestamp: number;
  };

  /** Generic runtime state tick/update pulse for bridge subscribers. */
  STATE_UPDATE: {
    source: string;
    timestamp: number;
  };

  /**
   * Emitted by StateManager.get() when a path is not found at read time.
   * Replaces FATAL_STATE_MISSING — consumers log/monitor this instead of crashing.
   */
  LOG_STATE_MISSING_WARNING: {
    path: string;
    usedSchemaDefault: boolean;
    recoveryValue: unknown;
    timestamp: number;
  };

  /**
   * Emitted by hydrateStateManager() once all schema paths have been
   * pre-filled. LifecycleOrchestrator listens to this to unlock PLAY_ACTIVE.
   */
  STATE_HYDRATION_COMPLETE: {
    source: string;
    pathCount: number;
    filledCount: number;
    timestamp: number;
  };

  /**
   * Emitted by StateHydrationGuard.read() when the UI tries to bind a path
   * that is not yet available. UI layer should enter LOADING state.
   */
  UI_LOADING_STATE: {
    reason: 'STATE_NOT_HYDRATED' | 'STATE_PATH_NOT_IN_SCHEMA';
    path: string;
    timestamp: number;
  };

  /** Force-apply a normalized snapshot into NetworkSyncSystem immediately. */
  FORCE_SNAPSHOT: {
    snapshot: {
      tick: number;
      timestamp: number;
      ackInputSeq: number;
      lastProcessedInputTick?: number;
      entities: Array<{
        entityId: string;
        tick: number;
        transform?: {
          position: { x: number; y: number; z: number };
          rotation: { x: number; y: number; z: number };
          scale?: { x: number; y: number; z: number };
        };
        velocity?: { x: number; y: number; z: number };
        replicated?: Record<string, unknown>;
      }>;
    };
    source: string;
    timestamp: number;
  };

  /** A weapon fire attempt failed (ammo, cooldown, validation) */
  FIRE_FAILED: {
    entityId: EntityID;
    weaponId: string;
    reason: string;
    timestamp: number;
  };

  /** A hitscan weapon fired but missed its target */
  HITSCAN_MISS: {
    shooterId: EntityID;
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    timestamp: number;
  };

  /** HUD display of a fire failure */
  HUD_FIRE_FAILED: {
    playerId: EntityID | null;
    weaponId: string;
    reason: string;
    timestamp: number;
  };

  /** HUD display of a hitscan hit event */
  HUD_HITSCAN_HIT: {
    playerId: EntityID | null;
    targetId: EntityID | null;
    position: { x: number; y: number; z: number };
    damage: number;
    timestamp: number;
  };

  /** An entity died (health dropped to 0 and was removed) */
  ENTITY_DIED: {
    entityId: EntityID;
    killerId: EntityID | null;
    cause?: string;
    timestamp: number;
  };

  /** ─ PERMANENT-BINDING-GUARD: Force full sync to unlock bindings after reconciliation ─ */
  FORCE_FULL_SYNC: Record<string, never>;

  /** ─ PERMANENT-BINDING-GUARD: Runtime reset unlocks all binding locks ─ */
  RUNTIME_RESET: Record<string, never>;
}

export type {
  EngineEvent,
  EngineSystem,
  GameplayCommand,
  NetworkFacade,
  ReplicationFacade,
  SystemCapabilities,
  SystemContext,
} from './SystemHealthCorridor';
