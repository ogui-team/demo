import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { PHYSICS_CONSTANTS } from '../../../PhysicsConstants';
import { setInvisible } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { LocalPlayerAuthorityCoordinator } from '../../../2-systems/gameplay/game/LocalPlayerAuthorityCoordinator';
import {
  LocalPlayerBootstrapCoordinator,
  type AuthoritativeSnapshotSummary,
  type AuthoritativeSnapshotSummaryPayload,
} from '../../../2-systems/gameplay/game/LocalPlayerBootstrapCoordinator';
import { WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import { getGeneratedItemTexture } from '../../ui/GeneratedItemTextures';
import { CollisionAuthoritySystem } from '../../../3-network/network/CollisionAuthoritySystem';
import { createInteractableComponent } from '../../../2-systems/gameplay/systems/components/InteractableComponent';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { NetworkSyncSystem } from '../../../3-network/network/NetworkSyncSystem';
import type { PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import type { CharacterActorSystem } from '../../../2-systems/gameplay/game/CharacterActorSystem';
import type { PrefabSystem } from '../../../2-systems/gameplay/systems/PrefabSystem';
import type { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import type { SpawnSystem } from '../../../2-systems/gameplay/systems/SpawnSystem';
import type { ScriptedLevelSystem } from '../../../2-systems/gameplay/game/ScriptedLevelSystem';
import type { Camera2DSystem } from '../../../2-systems/gameplay/systems/2d/Camera2DSystem';
import type { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { InventorySystem } from '../../../2-systems/gameplay/systems/InventorySystem';
import type { GASBridge } from '../../../2-systems/gameplay/systems/gas/GASBridge';
import type { AbilitySystem } from '../../../2-systems/gameplay/systems/gas/AbilitySystem';
import type { AdaptiveRuntimeLayer } from '../../../2-systems/gameplay/systems/AdaptiveRuntimeLayer';
import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import type { StateManager } from '../../../0-foundation/foundation/state/StateManager';
import type { SaveLoadManager } from '@engine/1-kernel/core/public-api';
import { createAudioListenerComponent } from '../../../2-systems/gameplay/game/components/AudioListenerComponent';
import type { DummyEnemySystem } from '../../../2-systems/gameplay/systems/DummyEnemySystem';
import type { PathfindingSystem } from '../../../2-systems/gameplay/systems/PathfindingSystem';
import type { VFXMaker } from '../../../2-systems/gameplay/systems/VFXMaker';
import type { MeshBindingTable } from '../../../2-systems/render/MeshBindingTable';
import { getCameraStateAdapter } from '../../../2-systems/camera/CameraStateAdapter';
import { getTropicalHorrorArchetype } from '@engine/2-systems/ArchetypeDefinitions';
import { SCHEMA_PATHS } from '../../../0-foundation/foundation/state/hydrateStateManager';

interface KernelBridgeAdapter {
  getPlayerHandle(playerId: string): number | null;
  syncPlayerVitals(playerId: string, vitals: { hp?: number; maxHp?: number }): boolean;
  bindEntityMesh(entityId: string, handle: number, mesh: THREE.Mesh): void;
  getMeshBindingTable(): MeshBindingTable;
}

interface ClientWorldRuntimeCoordinatorConfig {
  stateManager: StateManager;
  engineController: { is(state: string): boolean };
  networkSyncSystem: NetworkSyncSystem;
  collisionAuthoritySystem: CollisionAuthoritySystem;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  mpClient: MultiplayerClient;
  playerModelSystem: PlayerModelSystem;
  characterActorSystem: CharacterActorSystem;
  prefabSystem: PrefabSystem;
  gameHUD: HUDSystem;
  spawnSystem: SpawnSystem;
  scriptedLevelSystem: ScriptedLevelSystem | null;
  camera2DSystem: Camera2DSystem;
  healthSystem: HealthSystem;
  weaponSystem: WeaponSystem;
  inventorySystem: InventorySystem;
  gasBridge: GASBridge;
  abilitySystem: AbilitySystem;
  adaptiveRuntime: AdaptiveRuntimeLayer;
  engineGameModes: GameModeSystem;
  gameModeManager: GameModeManager;
  saveLoadManager: SaveLoadManager | null;
  vfxMaker: VFXMaker;
  kernelBridge: KernelBridgeAdapter | null;
  dummyEnemySystem: DummyEnemySystem;
  pathfindingSystem: PathfindingSystem;
}

export class ClientWorldRuntimeCoordinator {
  static readonly LOCAL_FREEPLAY_PLAYER_ID = 'local_freeplay_player';
  // ─ CAMERA HEIGHT OFFSETS ─
  // CRITICAL FIX: Calculate from physics constants instead of hardcoding
  // Entity position is at center of collision sphere
  // Eye offset = eye height - collision radius to get eye position above entity center
  private static readonly LOCAL_STAND_CAMERA_OFFSET = 
    PHYSICS_CONSTANTS.PLAYER_EYE_HEIGHT - PHYSICS_CONSTANTS.PLAYER_COLLISION_RADIUS; // 1.65 - 0.8 = 0.85
  // Crouch eye position is near top of crouch capsule (half-height)
  // Reduce by small amount to position eye slightly below top to prevent clipping through ceiling
  private static readonly LOCAL_CROUCH_CAMERA_OFFSET = 
    PHYSICS_CONSTANTS.PLAYER_CROUCH_HALF_HEIGHT - 0.15; // ~0.75 - realistic eye position in crouch

  private static findExistingLocalPlayerEntity() {
    return Engine.getEntityManager()?.getEntities().find((entity) => entity.hasComponent('localPlayer')) ?? null;
  }

  private readonly stateManager: StateManager;
  private readonly engineController: { is(state: string): boolean };
  private readonly networkSyncSystem: NetworkSyncSystem;
  private readonly collisionAuthoritySystem: CollisionAuthoritySystem;
  private readonly worldObjectAuthorityService: WorldObjectAuthorityService;
  private readonly mpClient: MultiplayerClient;
  private readonly playerModelSystem: PlayerModelSystem;
  private readonly characterActorSystem: CharacterActorSystem;
  private readonly prefabSystem: PrefabSystem;
  private readonly gameHUD: HUDSystem;
  private readonly spawnSystem: SpawnSystem;
  private scriptedLevelSystem: ScriptedLevelSystem | null;
  private readonly camera2DSystem: Camera2DSystem;
  private readonly healthSystem: HealthSystem;
  private readonly weaponSystem: WeaponSystem;
  private readonly inventorySystem: InventorySystem;
  private readonly gasBridge: GASBridge;
  private readonly abilitySystem: AbilitySystem;
  private readonly adaptiveRuntime: AdaptiveRuntimeLayer;
  private readonly engineGameModes: GameModeSystem;
  private readonly gameModeManager: GameModeManager;
  private readonly saveLoadManager: SaveLoadManager | null;
  private readonly vfxMaker: VFXMaker;
  private readonly kernelBridge: KernelBridgeAdapter | null;
  private readonly dummyEnemySystem: DummyEnemySystem;
  private readonly pathfindingSystem: PathfindingSystem;

  private activeLevelGroup: THREE.Group | null = null;
  private hordeStartReady = false;
  private hordeStarted = false;
  private pendingMultiplayerHordeAutostart = false;
  private multiplayerHordeAutostartAccumulator = 0;
  private corridor2DTestSceneBootstrapped = false;
  private localPlayerAuthorityCoordinator: LocalPlayerAuthorityCoordinator;
  private localPlayerBootstrapCoordinator: LocalPlayerBootstrapCoordinator;
  private stopInputSending: () => void = () => {};
  private debugConsoleOverlay: HTMLElement | null = null;
  private debugConsoleStatus: HTMLElement | null = null;
  private debugReconciliationButton: HTMLButtonElement | null = null;
  private debugCorrectionButton: HTMLButtonElement | null = null;
  private debugOverrideButton: HTMLButtonElement | null = null;
  private debugWeaponEntityId: string | null = null;
  private lastPrefabRecoveryRequestAt = 0;
  private debugLocalReconciliationEnabled = false;
  private debugVisualCorrectionEnabled = false;
  private debugReconciliationOverrideEnabled = false;
  private readonly spawnDiagnosticLogTimes = new Map<string, number>();

  constructor(config: ClientWorldRuntimeCoordinatorConfig) {
    this.stateManager = config.stateManager;
    this.engineController = config.engineController;
    this.networkSyncSystem = config.networkSyncSystem;
    this.collisionAuthoritySystem = config.collisionAuthoritySystem;
    this.worldObjectAuthorityService = config.worldObjectAuthorityService;
    this.mpClient = config.mpClient;
    this.playerModelSystem = config.playerModelSystem;
    this.characterActorSystem = config.characterActorSystem;
    this.prefabSystem = config.prefabSystem;
    this.gameHUD = config.gameHUD;
    this.spawnSystem = config.spawnSystem;
    this.scriptedLevelSystem = config.scriptedLevelSystem;
    this.camera2DSystem = config.camera2DSystem;
    this.healthSystem = config.healthSystem;
    this.weaponSystem = config.weaponSystem;
    this.inventorySystem = config.inventorySystem;
    this.gasBridge = config.gasBridge;
    this.abilitySystem = config.abilitySystem;
    this.adaptiveRuntime = config.adaptiveRuntime;
    this.engineGameModes = config.engineGameModes;
    this.gameModeManager = config.gameModeManager;
    this.saveLoadManager = config.saveLoadManager;
    this.vfxMaker = config.vfxMaker;
    this.kernelBridge = config.kernelBridge;
    this.dummyEnemySystem = config.dummyEnemySystem;
    this.pathfindingSystem = config.pathfindingSystem;

    this.localPlayerAuthorityCoordinator = new LocalPlayerAuthorityCoordinator({
      getLocalPlayerEntity: () => ClientWorldRuntimeCoordinator.findExistingLocalPlayerEntity(),
      createLocalPlayerEntity: (playerId, color) => {
        const existing = ClientWorldRuntimeCoordinator.findExistingLocalPlayerEntity();
        if (existing) {
          return existing;
        }
        const entity = this.spawnSystem.spawnPlayer(playerId, 'player_v1', {
          localControlled: true,
          networkEntityId: playerId,
        });
        if (!entity.hasComponent('render')) {
          Engine.createLocalPlayerEntity(color);
          return ClientWorldRuntimeCoordinator.findExistingLocalPlayerEntity();
        }
        Engine.getEntityRenderer()?.syncEntity(entity);
        return entity;
      },
      networkSyncSystem: this.networkSyncSystem,
      collisionAuthority: this.collisionAuthoritySystem,
      sendMovementCommand: (command) => this.mpClient.sendMovementCommand(command),
      bindPlayController: (entityId) => Engine.getPlayController()?.bind(entityId),
      emitForceRebind: ({ playerId, entityId, cause }) => {
        gameBus.emit('FORCE_REBIND_INPUT', { playerId, entityId, cause });
      },
      setCameraFollowEntity: (entityId) => this.camera2DSystem.setFollowEntity(entityId),
      bindLocalPlayerModel: (playerId, entity) => {
        this.playerModelSystem.setLocalPlayerId(playerId);
        this.playerModelSystem.bindLocalPlayerEntity(entity);
      },
      ensure2DScene: () => this.ensureCorridor2DTestScene(),
      setLocalPlayerDebugVisualVisible: (visible, reason) => this.setLocalPlayerDebugVisualVisible(visible, reason),
      resolveKernelHandleByPlayerId: (playerId) => this.kernelBridge?.getPlayerHandle(playerId) ?? null,
      ensureMeshBindingForHandle: (entityId, handle) => {
        const mesh = this.resolveEntityMesh(entityId);
        if (!mesh || !this.kernelBridge) {
          return false;
        }
        this.kernelBridge.bindEntityMesh(entityId, handle, mesh);
        return true;
      },
      hasMeshBindingForHandle: (handle) => this.kernelBridge?.getMeshBindingTable().hasMeshForHandle(handle) ?? false,
      canEnableInputForPlayer: (playerId) => {
        const localHandle = this.kernelBridge?.getPlayerHandle(playerId);
        if (localHandle == null) {
          return false;
        }
        return this.kernelBridge?.getMeshBindingTable().hasMeshForHandle(localHandle) ?? false;
      },
      onEntityCreated: (localPlayerEntity) => {
        this.logSpawnDiagnostic('ENTITY CREATED', {
          source: 'local_player_placeholder',
          entityId: localPlayerEntity.id,
          entityType: localPlayerEntity.type,
        });
      },
    });

    this.localPlayerBootstrapCoordinator = new LocalPlayerBootstrapCoordinator({
      authorityCoordinator: this.localPlayerAuthorityCoordinator,
      getMultiplayerState: () => ({
        connected: this.mpClient.connected,
        playerId: this.mpClient.playerId,
        lastSnapshot: this.mpClient.getLastAuthoritativeSnapshot() as AuthoritativeSnapshotSummaryPayload | null,
      }),
      getActiveRuntimePlayerId: () => this.getActiveRuntimePlayerId(),
      getLocalPlayerEntity: () => this.getLocalPlayerEntity(),
      getLocalBindingStatus: () => this.networkSyncSystem.getLocalBindingStatus(),
      getLocalTransform: () => this.networkSyncSystem.getLocalPlayerTransform(),
      getLastLocalSnapshotTick: () => this.networkSyncSystem.getLastLocalSnapshotTick(),
      getLastAppliedSnapshotTick: () => this.networkSyncSystem.getLastAppliedSnapshotTick(),
      resetPlayController: () => Engine.getPlayController()?.reset(),
      stopInputSending: () => this.stopInputSending(),
      logDiagnostic: (message, details = {}) => this.logSpawnDiagnostic(message, details),
      emitActualized: (payload) => {
        gameBus.emit('LOCAL_PLAYER_ACTUALIZED', payload);
      },
    });

    gameBus.on('STALE_SNAPSHOT_ENTITY_DROPPED', ({ netId, entityType, timestamp }) => {
      if (!this.mpClient.connected) {
        return;
      }

      const now = Date.now();
      if (now - this.lastPrefabRecoveryRequestAt < 750) {
        return;
      }

      this.lastPrefabRecoveryRequestAt = now;
      console.warn('[Recovery] REQ_FULL_STATE after stale snapshot entity drop', {
        netId,
        entityType,
        droppedAt: timestamp,
        requestedAt: now,
      });
      this.mpClient.requestFullSync();
    });

    this.networkSyncSystem.setLocalReconciliationEnabled(this.debugLocalReconciliationEnabled);
    this.networkSyncSystem.setVisualCorrectionEnabled(this.debugVisualCorrectionEnabled);
    this.networkSyncSystem.setReconciliationOverrideEnabled(this.debugReconciliationOverrideEnabled);
    this.bindDebugFireballHotkey();
    this.bindDebugBootHotkey();
    this.bindDebugConsoleHotkey();
    this.bindHordeStartHotkey();

    gameBus.on('gameModeStarted', (payload: any) => {
      if (payload?.modeName === 'horde') {
        this.hordeStartReady = true;
        this.hordeStarted = false;
        if (this.mpClient.connected) {
          // Multiplayer horde should start from the frame-driven runtime path,
          // not from a wall-clock timer.
          this.pendingMultiplayerHordeAutostart = true;
          this.multiplayerHordeAutostartAccumulator = 0;
        }
      }
    });

    gameBus.on('gameModeEnded', (payload: any) => {
      if (payload?.modeName === 'horde') {
        this.hordeStartReady = false;
        this.hordeStarted = false;
        this.pendingMultiplayerHordeAutostart = false;
        this.multiplayerHordeAutostartAccumulator = 0;
      }
    });
  }

  update(dt: number): void {
    if (!this.pendingMultiplayerHordeAutostart) {
      return;
    }

    this.multiplayerHordeAutostartAccumulator += Math.max(0, dt);
    if (this.multiplayerHordeAutostartAccumulator <= 0) {
      return;
    }

    this.pendingMultiplayerHordeAutostart = false;
    this.multiplayerHordeAutostartAccumulator = 0;
    this.tryStartHordeEncounter();
  }

  setScriptedLevelSystem(scriptedLevelSystem: ScriptedLevelSystem | null): void {
    this.scriptedLevelSystem = scriptedLevelSystem;
  }

  setStopInputSending(handler: () => void): void {
    this.stopInputSending = handler;
  }

  attachCollisionResolver(): void {
    this.networkSyncSystem.setCollisionResolver((context) => this.resolveLocalMovement(context));
  }

  getLocalPlayerAuthorityCoordinator(): LocalPlayerAuthorityCoordinator {
    return this.localPlayerAuthorityCoordinator;
  }

  getLocalPlayerBootstrapCoordinator(): LocalPlayerBootstrapCoordinator {
    return this.localPlayerBootstrapCoordinator;
  }

  private bindDebugFireballHotkey(): void {
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const playerEntity = this.getLocalPlayerEntity();
      if (!playerEntity) {
        console.warn('[ClientWorldRuntimeCoordinator] F pressed but local player entity is not ready');
        return;
      }

      const playerPosition = playerEntity.getComponent('position')?.data as { x: number; y: number; z: number } | undefined;
      const camera = Engine.getEngineCamera();
      const worldOrigin = camera ? camera.getWorldPosition(new THREE.Vector3()) : null;
      const origin = worldOrigin
        ? { x: worldOrigin.x, y: worldOrigin.y, z: worldOrigin.z }
        : {
          x: playerPosition?.x ?? 0,
          y: playerPosition?.y ?? 0,
          z: playerPosition?.z ?? 0,
        };

      const direction = new THREE.Vector3();
      if (camera) {
        camera.getWorldDirection(direction);
      } else {
        direction.set(0, 0, -1);
      }

      const playerId = this.getActiveRuntimePlayerId();
      if (!playerId) {
        console.warn('[ClientWorldRuntimeCoordinator] F pressed but no active runtime player ID exists');
        return;
      }

      console.log('[ClientWorldRuntimeCoordinator] F key pressed - casting Fireball');
      this.abilitySystem.activateAbility(
        playerId,
        'ability_fireball',
        origin,
        { x: direction.x, y: direction.y, z: direction.z },
      );
      event.preventDefault();
    });
  }

  private bindDebugBootHotkey(): void {
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'l' || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      this.runDebugBootSequence();
      event.preventDefault();
    });
  }

  private bindDebugConsoleHotkey(): void {
    // ^ key is now handled by GameConsole (Console.ts) directly.
    // The old debug overlay panel is still accessible via toggleDebugConsoleOverlay() if needed.
  }

  private bindHordeStartHotkey(): void {
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z' || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (!this.engineController.is('in_game')) return;
      if (!this.tryStartHordeEncounter()) return;
      event.preventDefault();
    });
  }

  private tryStartHordeEncounter(): boolean {
    if (!this.hordeStartReady || this.hordeStarted) return false;
    if (this.getControllerGameMode() !== 'horde') return false;

    console.log('[ClientWorldRuntimeCoordinator] Starting Horde wave sequence');
    this.hordeStarted = true;
    this.pendingMultiplayerHordeAutostart = false;
    this.multiplayerHordeAutostartAccumulator = 0;
    (gameBus as any).emit('hordeStartRequested');
    this.gameHUD.showNotification('Zombie Horde started!', 5);
    return true;
  }

  private toggleDebugConsoleOverlay(): void {
    if (this.debugConsoleOverlay) {
      this.destroyDebugConsoleOverlay();
      return;
    }
    const overlay = this.createDebugConsoleOverlay();
    document.body.appendChild(overlay);
    this.debugConsoleOverlay = overlay;
  }

  private destroyDebugConsoleOverlay(): void {
    if (!this.debugConsoleOverlay) return;
    this.debugConsoleOverlay.remove();
    this.debugConsoleOverlay = null;
    this.debugConsoleStatus = null;
  }

  private ensureLocalPlayerAudioListener(): void {
    const localPlayerEntity = this.getLocalPlayerEntity();
    if (!localPlayerEntity || localPlayerEntity.getComponent('audioListener')) {
      return;
    }

    localPlayerEntity.addComponent({
      name: 'audioListener',
      data: createAudioListenerComponent(),
    });
  }

  private updateDebugConsoleStatus(message: string): void {
    if (this.debugConsoleStatus) {
      this.debugConsoleStatus.textContent = message;
    }
  }

  private equipDebugFireball(): void {
    const playerId = this.getActiveRuntimePlayerId();
    if (!playerId) {
      this.updateDebugConsoleStatus('No active player available.');
      return;
    }
    const tags = new Set(this.abilitySystem.getConditionTags(playerId));
    tags.add('HasFireball');
    this.abilitySystem.setConditionTags(playerId, [...tags]);
    this.updateDebugConsoleStatus('Fireball equipped. Press F to cast.');
  }

  private dropDebugFireball(): void {
    const playerId = this.getActiveRuntimePlayerId();
    if (!playerId) {
      this.updateDebugConsoleStatus('No active player available.');
      return;
    }
    this.abilitySystem.removeConditionTag(playerId, 'HasFireball');
    this.updateDebugConsoleStatus('Fireball dropped.');
  }

  private toggleServerReconciliation(): void {
    this.debugLocalReconciliationEnabled = !this.debugLocalReconciliationEnabled;
    this.networkSyncSystem.setLocalReconciliationEnabled(this.debugLocalReconciliationEnabled);
    this.updateDebugConsoleStatus(`Server reconciliation ${this.debugLocalReconciliationEnabled ? 'enabled' : 'disabled'}.`);
    this.renderDebugButtonStates();
  }

  private toggleVisualCorrection(): void {
    this.debugVisualCorrectionEnabled = !this.debugVisualCorrectionEnabled;
    this.networkSyncSystem.setVisualCorrectionEnabled(this.debugVisualCorrectionEnabled);
    this.updateDebugConsoleStatus(`Correction smoothing ${this.debugVisualCorrectionEnabled ? 'enabled' : 'disabled'}.`);
    this.renderDebugButtonStates();
  }

  private toggleReconciliationOverride(): void {
    this.debugReconciliationOverrideEnabled = !this.debugReconciliationOverrideEnabled;
    this.networkSyncSystem.setReconciliationOverrideEnabled(this.debugReconciliationOverrideEnabled);
    this.updateDebugConsoleStatus(`Reconciliation override ${this.debugReconciliationOverrideEnabled ? 'enabled' : 'disabled'}.`);
    this.renderDebugButtonStates();
  }

  private renderDebugButtonStates(): void {
    if (this.debugReconciliationButton) {
      this.debugReconciliationButton.textContent = this.debugLocalReconciliationEnabled
        ? 'Disable Server Reconciliation'
        : 'Enable Server Reconciliation';
    }
    if (this.debugCorrectionButton) {
      this.debugCorrectionButton.textContent = this.debugVisualCorrectionEnabled
        ? 'Disable Correction Smoothing'
        : 'Enable Correction Smoothing';
    }
    if (this.debugOverrideButton) {
      this.debugOverrideButton.textContent = this.debugReconciliationOverrideEnabled
        ? 'Disable Reconciliation Override'
        : 'Enable Reconciliation Override';
    }
  }

  public grantFireball(playerId: string | null): void {
    if (!playerId) return;
    const tags = new Set(this.abilitySystem.getConditionTags(playerId));
    tags.add('HasFireball');
    this.abilitySystem.setConditionTags(playerId, [...tags]);
  }

  private runDebugBootSequence(): void {
    const playerEntity = this.getLocalPlayerEntity();
    const playerId = this.getActiveRuntimePlayerId();
    if (!playerEntity || !playerId) {
      this.updateDebugConsoleStatus('Debug boot failed: local player is not ready.');
      return;
    }

    this.ensureLocalPlayerAudioListener();
    this.grantFireball(playerId);
    this.pathfindingSystem.rebuildNavMesh();

    const playerPosition = playerEntity.getPosition();
    const spawnOrigin = this.findDebugDummySpawnOrigin(playerPosition, 2.75);

    this.dummyEnemySystem.setIdleBobActive(false);
    const maskSpacing = 2.75;
    const handles = [
      this.spawnSystem.spawnEnemy({ enemyType: 'flyingMask', position: { x: spawnOrigin.x, y: spawnOrigin.y + 1.2, z: spawnOrigin.z } }),
      this.spawnSystem.spawnEnemy({ enemyType: 'flyingMask', position: { x: spawnOrigin.x + maskSpacing, y: spawnOrigin.y + 1.2, z: spawnOrigin.z } }),
      this.spawnSystem.spawnEnemy({ enemyType: 'flyingMask', position: { x: spawnOrigin.x, y: spawnOrigin.y + 1.2, z: spawnOrigin.z + maskSpacing } }),
    ].filter((handle): handle is NonNullable<typeof handle> => handle !== null);

    console.log('[ClientWorldRuntimeCoordinator] Debug boot complete', {
      playerId,
      spawnedMasks: handles.length,
      spawnOrigin,
    });
    this.updateDebugConsoleStatus(`Debug boot ready: Fireball granted, ${handles.length} masks spawned. Press F to cast. Press L again to respawn them.`);
  }

  private findDebugDummySpawnOrigin(
    playerPosition: { x: number; y: number; z: number },
    spacing: number,
  ): { x: number; y: number; z: number } {
    const candidateOffsets = [
      { x: 8, z: 0 },
      { x: -8, z: 0 },
      { x: 0, z: 8 },
      { x: 0, z: -8 },
      { x: 8, z: 8 },
      { x: -8, z: 8 },
      { x: 8, z: -8 },
      { x: -8, z: -8 },
      { x: 12, z: 0 },
      { x: 0, z: 12 },
    ];

    const candidateSteps = [
      { x: 0, z: 0 },
      { x: spacing, z: 0 },
      { x: 0, z: spacing },
    ];

    for (const offset of candidateOffsets) {
      const origin = {
        x: playerPosition.x + offset.x,
        y: Math.max(1, playerPosition.y),
        z: playerPosition.z + offset.z,
      };

      const allWalkable = candidateSteps.every((step) => this.pathfindingSystem.isWalkableWorld({
        x: origin.x + step.x,
        y: origin.y,
        z: origin.z + step.z,
      }));

      if (allWalkable) {
        return origin;
      }
    }

    return {
      x: playerPosition.x + 8,
      y: Math.max(1, playerPosition.y),
      z: playerPosition.z,
    };
  }

  private spawnDebugFireballWeapon(): void {
    const playerEntity = this.getLocalPlayerEntity();
    if (!playerEntity) {
      this.updateDebugConsoleStatus('Local player entity is not ready.');
      return;
    }

    const camera = Engine.getEngineCamera();
    const direction = new THREE.Vector3();
    if (camera) {
      camera.getWorldDirection(direction);
    } else {
      direction.set(0, 0, -1);
    }

    const playerPos = playerEntity.getPosition();
    const spawnPos = {
      x: playerPos.x + direction.x * 1.5,
      y: playerPos.y + 1.2,
      z: playerPos.z + direction.z * 1.5,
    };

    const entity = Engine.getEntityManager()?.createEntity('DebugFireballWeapon', {
      position: spawnPos,
      rotation: { x: 0, y: 0, z: 0 },
    });
    if (!entity) {
      this.updateDebugConsoleStatus('Failed to spawn Fireball Weapon entity.');
      return;
    }

    entity.addComponent({
      name: 'render',
      data: {
        meshType: 'sphere',
        color: 0xff8800,
        emissive: 0xff4400,
        emissiveIntensity: 2.0,
        flatShading: true,
        geometry: { radius: 0.24, segments: 12 },
      },
    });
    entity.addComponent({
      name: 'interactable',
      data: createInteractableComponent({
        interactionType: 'item',
        pickupable: true,
        highlightable: true,
        itemId: 'debug_fireball',
        prompt: 'Fireball Tome',
        quantity: 1,
        highlightColor: 0xff8800,
      }),
    });
    Engine.getEntityRenderer()?.syncEntity(entity);
    if (this.debugWeaponEntityId) {
      this.destroyDebugWeaponEntity();
    }
    this.debugWeaponEntityId = entity.id;
    this.updateDebugConsoleStatus(`Spawned fireball weapon: ${entity.id}`);
  }

  private destroyDebugWeaponEntity(): void {
    if (!this.debugWeaponEntityId) return;
    Engine.getEntityManager()?.destroyEntity(this.debugWeaponEntityId);
    this.debugWeaponEntityId = null;
  }

  private createDebugConsoleOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.right = '16px';
    overlay.style.top = '16px';
    overlay.style.width = '320px';
    overlay.style.background = 'rgba(16, 16, 24, 0.92)';
    overlay.style.color = '#f0f0f0';
    overlay.style.border = '1px solid #666';
    overlay.style.borderRadius = '10px';
    overlay.style.padding = '12px';
    overlay.style.zIndex = '9999';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.fontSize = '13px';
    overlay.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.textContent = 'Client Debug Console';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';
    overlay.appendChild(title);

    const buttons = document.createElement('div');
    buttons.style.display = 'grid';
    buttons.style.gap = '6px';

    const reconciliationButton = document.createElement('button');
    reconciliationButton.onclick = () => this.toggleServerReconciliation();
    buttons.appendChild(reconciliationButton);
    this.debugReconciliationButton = reconciliationButton;

    const correctionButton = document.createElement('button');
    correctionButton.onclick = () => this.toggleVisualCorrection();
    buttons.appendChild(correctionButton);
    this.debugCorrectionButton = correctionButton;

    const overrideButton = document.createElement('button');
    overrideButton.onclick = () => this.toggleReconciliationOverride();
    buttons.appendChild(overrideButton);
    this.debugOverrideButton = overrideButton;

    const equipButton = document.createElement('button');
    equipButton.textContent = 'Equip Fireball';
    equipButton.onclick = () => this.equipDebugFireball();
    buttons.appendChild(equipButton);

    const dropButton = document.createElement('button');
    dropButton.textContent = 'Drop Fireball';
    dropButton.onclick = () => this.dropDebugFireball();
    buttons.appendChild(dropButton);

    const spawnButton = document.createElement('button');
    spawnButton.textContent = 'Spawn Fireball Weapon';
    spawnButton.onclick = () => this.spawnDebugFireballWeapon();
    buttons.appendChild(spawnButton);

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close Console';
    closeButton.onclick = () => this.destroyDebugConsoleOverlay();
    buttons.appendChild(closeButton);

    this.renderDebugButtonStates();

    overlay.appendChild(buttons);

    const status = document.createElement('div');
    status.style.marginTop = '10px';
    status.style.minHeight = '1.2em';
    status.style.color = '#c8c8c8';
    this.debugConsoleStatus = status;
    overlay.appendChild(status);

    this.updateDebugConsoleStatus('Press F to cast once equipped.');
    return overlay;
  }

  getLocalFreeplayPlayerId(): string {
    return ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID;
  }

  getActiveRuntimePlayerId(): string | null {
    if (this.mpClient.connected && this.mpClient.playerId) {
      return this.mpClient.playerId;
    }
    return this.engineController.is('in_game')
      ? ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID
      : null;
  }

  getActiveLevelGroup(): THREE.Group | null {
    return this.activeLevelGroup;
  }

  setActiveLevelGroup(group: THREE.Group | null): void {
    this.activeLevelGroup = group;
  }

  setActiveMapCollisionLayout(mapId: string, sessionId: string): void {
    this.collisionAuthoritySystem.setStaticLayout(mapId, sessionId);
  }

  syncCollisionAuthorityDynamicCollider(authorityId: string, localEntityId: string): void {
    this.worldObjectAuthorityService.syncDynamicCollider(authorityId, localEntityId);
  }

  getWorldObjectAuthorityService(): WorldObjectAuthorityService {
    return this.worldObjectAuthorityService;
  }

  getCollisionAuthoritySystem(): CollisionAuthoritySystem {
    return this.collisionAuthoritySystem;
  }

  getWorldObjectAuthorityDiagnostics(): Record<string, unknown> {
    return this.worldObjectAuthorityService.getDiagnostics() as Record<string, unknown>;
  }

  clearActiveLevel(): void {
    if (this.scriptedLevelSystem?.getCurrentLevelId()) {
      this.scriptedLevelSystem.unloadCurrent();
      this.activeLevelGroup = null;
      this.collisionAuthoritySystem.clearDynamicColliders();
      return;
    }

    if (this.activeLevelGroup) {
      this.unregisterStaticLevelGeometryFromCulling(this.activeLevelGroup);
      Engine.getEngineScene()?.remove(this.activeLevelGroup);
      this.activeLevelGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose?.();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose?.());
          } else {
            material?.dispose?.();
          }
        }
      });
      this.activeLevelGroup = null;
    }

    this.collisionAuthoritySystem.clearDynamicColliders();
  }

  resetGameplayWorld(): void {
    this.clearActiveLevel();
    this.spawnSystem.clearSpawnPoints();
    this.corridor2DTestSceneBootstrapped = false;
  }

  hardResetRuntimeState(reason: string, options?: { allowInGame?: boolean }): void {
    const allowInGame = options?.allowInGame === true;
    const lifecyclePhase = typeof window !== 'undefined'
      ? (window as any).lifecycleOrchestrator?.getPhase?.() ?? null
      : null;
    
    // ─ RESET-GUARD: Engine im PLAY_ACTIVE Zustand darf nicht resetet werden
    if (!allowInGame && (lifecyclePhase === 'PLAY_ACTIVE' || this.engineController.is('in_game'))) {
      this.warnSpawnDiagnostic('Reset blocked: Active Play Session', {
        reason,
        lifecyclePhase,
        engineState: this.engineController.is('in_game') ? 'in_game' : 'inactive',
        caller: new Error().stack?.split('\n')[2]?.trim() ?? 'unknown',
      });
      return;
    }

    this.logSpawnDiagnostic('RUNTIME RESET', { reason, allowInGame });
    this.stopInputSending();
    this.localPlayerBootstrapCoordinator.reset();
    this.playerModelSystem.setLocalPlayerId('');
    this.playerModelSystem.bindLocalPlayerEntity(null);
    this.clearActiveLevel();
    this.vfxMaker.clear();
    this.worldObjectAuthorityService.clear();
    this.playerModelSystem.clearAll();
    this.characterActorSystem.clearRuntimeState();
    this.abilitySystem.clearRuntimeState();
    this.dummyEnemySystem.clearAll();
    this.weaponSystem.clearAll();
    this.inventorySystem.clearAll();
    this.healthSystem.clearAll();
    Engine.getGasEffectSystem()?.clearAll();
    Engine.getGasItemSystem()?.clearAll();
    Engine.getGasAttributeStore()?.clearAll();
    this.gameModeManager.resetSessionState(reason);
    Engine.getPlayController()?.reset();
    Engine.getPlayController()?.bind(null);
    Engine.setRuntimePlayerId(null);
    Engine.getEntityManager()?.clear();
    this.prefabSystem.rebuildFromEntityManager();
    this.networkSyncSystem.resetRuntimeState();
    this.collisionAuthoritySystem.clearDynamicColliders();
    this.spawnSystem.clearSpawnPoints();
    this.activeLevelGroup = null;
    this.corridor2DTestSceneBootstrapped = false;
  }

  registerStaticLevelGeometryForCulling(group: THREE.Group): void {
    const culling = Engine.getCullingSystem();
    if (!culling) return;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const registrationId = `static_level:${group.uuid}:${object.uuid}`;
      object.userData.cullingRegistrationId = registrationId;
      culling.registerForCulling(object, registrationId);
    });
  }

  unregisterStaticLevelGeometryFromCulling(group: THREE.Group): void {
    const culling = Engine.getCullingSystem();
    if (!culling) return;
    group.traverse((object) => {
      const registrationId = typeof object.userData.cullingRegistrationId === 'string'
        ? object.userData.cullingRegistrationId
        : null;
      if (!registrationId) return;
      culling.unregisterForCulling(registrationId);
      delete object.userData.cullingRegistrationId;
    });
  }

  resolveLocalMovement(context: {
    currentPosition: { x: number; y: number; z: number };
    desiredMovement: { x: number; y: number; z: number };
    radius: number;
    height?: number;
  }): { x: number; y: number; z: number } {
    return this.collisionAuthoritySystem.resolveMovement(
      context.currentPosition,
      context.desiredMovement,
      context.radius,
      { height: context.height },
    );
  }

  getLocalPlayerEntity() {
    return ClientWorldRuntimeCoordinator.findExistingLocalPlayerEntity();
  }

  ensureLocalPlayerEntity() {
    const playerId = this.mpClient.playerId || ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID;
    return this.localPlayerAuthorityCoordinator.ensureLocalPlayerEntity(playerId);
  }

  bindNetworkSyncLocalPlayer(playerId: string, authorityMode: 'local' | 'remote'): void {
    this.assertSpawnSystemsReady('bindNetworkSyncLocalPlayer', { strict: true });
    this.logSpawnDiagnostic('PLAYER SPAWN REQUEST', {
      source: 'bind_network_sync_local_player',
      playerId,
      authorityMode,
      entityId: this.getLocalPlayerEntity()?.id ?? null,
    });
    this.localPlayerAuthorityCoordinator.bind(playerId, authorityMode);
  }

  injectAuthoritativeSnapshotBinding(
    localPlayerId: string | null,
    entities: Array<{ id: string; isPlayerControlled?: boolean }>,
  ): void {
    this.localPlayerAuthorityCoordinator.injectAuthoritativeSnapshotBinding(localPlayerId, entities);
  }

  isLocalPlayerInputMeshReady(playerId: string): boolean {
    return this.localPlayerAuthorityCoordinator.isInputReady(playerId);
  }

  syncCameraToLocalPlayerEntity(): void {
    this.ensureLocalPlayerAudioListener();
    if (Engine.getEngineMode() !== 'play' || !this.engineController.is('in_game')) {
      return;
    }
    const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
    const cameraAdapter = getCameraStateAdapter();
    if (!cameraAdapter || !localTransform) return;
    const playViewRotation = Engine.getPlayController()?.getViewRotation();
    const viewRotation = playViewRotation ?? localTransform.rotation;
    const isCrouching = this.networkSyncSystem.getLocalResolvedMovementState()?.isCrouching ?? false;
    const cameraHeightOffset = isCrouching
      ? ClientWorldRuntimeCoordinator.LOCAL_CROUCH_CAMERA_OFFSET
      : ClientWorldRuntimeCoordinator.LOCAL_STAND_CAMERA_OFFSET;

    cameraAdapter.applySnapshot({
      position: {
        x: localTransform.position.x,
        y: localTransform.position.y + cameraHeightOffset,
        z: localTransform.position.z,
      },
      rotation: viewRotation,
    }, 'game');
  }

  syncPlayControllerToLocalRotation(): void {
    const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
    if (!localTransform) return;
    Engine.getPlayController()?.setViewRotation(localTransform.rotation);
  }

  findLocalAuthoritativeSnapshotEntity(
    entities: AuthoritativeSnapshotSummaryPayload['entities'],
    playerId: string | null = this.mpClient.playerId,
  ): AuthoritativeSnapshotSummaryPayload['entities'][number] | null {
    return this.localPlayerBootstrapCoordinator.findLocalAuthoritativeSnapshotEntity(entities, playerId);
  }

  summarizeAuthoritativeSnapshot(payload: AuthoritativeSnapshotSummaryPayload): AuthoritativeSnapshotSummary {
    return this.localPlayerBootstrapCoordinator.summarizeAuthoritativeSnapshot(payload);
  }

  updateAuthoritativeSnapshotTracking(payload: AuthoritativeSnapshotSummaryPayload): void {
    this.localPlayerBootstrapCoordinator.updateAuthoritativeSnapshotTracking(payload);
  }

  syncLocalPlayerToAuthoritativeSpawn(
    position: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number },
    options: { source?: string; tick?: number | null; forced?: boolean } = {},
  ): void {
    this.localPlayerBootstrapCoordinator.syncLocalPlayerToAuthoritativeSpawn(position, rotation, options);
  }

  requestAuthoritativeSpawnSync(): void {
    this.localPlayerBootstrapCoordinator.requestAuthoritativeSpawnSync();
  }

  ensureCorridor2DTestScene(): void {
    if (this.mpClient.connected) return;

    const entityManager = Engine.getEntityManager();
    if (!entityManager) return;
    const localPlayerEntity = this.getLocalPlayerEntity();
    if (!localPlayerEntity) return;

    this.camera2DSystem.setFollowEntity(localPlayerEntity.id);
    if (this.corridor2DTestSceneBootstrapped) return;

    const hasTilemap = entityManager.getEntities().some((entity) => entity.hasComponent('tilemap'));
    const hasUi = entityManager.getEntities().some((entity) => entity.hasComponent('ui2d'));
    const anchor = localPlayerEntity.getPosition();
    const hasTilemapPrefab = this.prefabSystem.getPrefab('corridor_2d_test_tilemap') !== undefined;
    const hasUiPrefab = this.prefabSystem.getPrefab('corridor_2d_test_ui') !== undefined;

    if (!hasTilemap) {
      if (!hasTilemapPrefab) {
        console.warn('[ClientWorldRuntimeCoordinator] Optional prefab missing: corridor_2d_test_tilemap');
      } else {
        this.prefabSystem.tryCreate('corridor_2d_test_tilemap', {
          x: anchor.x - 18,
          y: 0,
          z: anchor.z - 10,
        }, { networked: false });
      }
    }

    if (!hasUi) {
      if (!hasUiPrefab) {
        console.warn('[ClientWorldRuntimeCoordinator] Optional prefab missing: corridor_2d_test_ui');
      } else {
        this.prefabSystem.tryCreate('corridor_2d_test_ui', { x: 0, y: 0, z: 0 }, { networked: false });
      }
    }

    this.corridor2DTestSceneBootstrapped = true;
  }

  logSpawnDiagnostic(message: string, details: Record<string, unknown> = {}): void {
    if (!this.shouldEmitSpawnDiagnostic('info', message, details)) {
      return;
    }
    console.log(`[SpawnDiagnostics] ${message}`, details);
  }

  warnSpawnDiagnostic(message: string, details: Record<string, unknown> = {}): void {
    if (!this.shouldEmitSpawnDiagnostic('warn', message, details)) {
      return;
    }
    console.warn(`[SpawnDiagnostics] ${message}`, details);
  }

  private shouldEmitSpawnDiagnostic(
    level: 'info' | 'warn',
    message: string,
    details: Record<string, unknown>,
  ): boolean {
    const detailTokens = [
      typeof details.source === 'string' ? details.source : '',
      typeof details.playerId === 'string' ? details.playerId : '',
      typeof details.entityId === 'string' ? details.entityId : '',
      typeof details.reason === 'string' ? details.reason : '',
    ];
    const key = `${level}:${message}:${detailTokens.join(':')}`;
    const now = Date.now();
    const throttleMs = message === 'PLAYER SPAWN REQUEST' || message === 'LOCAL PLAYER VISUAL STATE'
      ? 1500
      : 400;
    const lastLoggedAt = this.spawnDiagnosticLogTimes.get(key) ?? 0;
    if (now - lastLoggedAt < throttleMs) {
      return false;
    }

    this.spawnDiagnosticLogTimes.set(key, now);
    if (this.spawnDiagnosticLogTimes.size > 256) {
      const cutoff = now - Math.max(throttleMs * 8, 8000);
      for (const [entryKey, entryTime] of this.spawnDiagnosticLogTimes.entries()) {
        if (entryTime < cutoff) {
          this.spawnDiagnosticLogTimes.delete(entryKey);
        }
      }
    }

    return true;
  }

  assertSpawnSystemsReady(source: string, options: { strict?: boolean } = {}): boolean {
    const missing: string[] = [];
    if (!this.networkSyncSystem || typeof this.networkSyncSystem.applyAuthoritativeSnapshot !== 'function') missing.push('NetworkSyncSystem');
    if (!this.prefabSystem || typeof this.prefabSystem.createByEntityType !== 'function') missing.push('PrefabSystem');
    if (!this.playerModelSystem || typeof this.playerModelSystem.syncFromPayload !== 'function') missing.push('PlayerModelSystem');
    if (missing.length === 0) return true;

    const detail = { source, missing };
    if (options.strict) {
      throw new Error(`[SpawnDiagnostics] Spawn pipeline not ready at ${source}: ${missing.join(', ')}`);
    }
    this.warnSpawnDiagnostic('spawn pipeline not ready', detail);
    return false;
  }

  setLocalPlayerDebugVisualVisible(visible: boolean, reason: string): void {
    const localPlayerEntity = this.getLocalPlayerEntity();
    this.playerModelSystem.setLocalAvatarVisible(visible);
    if (!localPlayerEntity) return;
    setInvisible(localPlayerEntity, this.stateManager, !visible);
    this.logSpawnDiagnostic('LOCAL PLAYER VISUAL STATE', {
      entityId: localPlayerEntity.id,
      visible,
      reason,
    });
  }

  ensurePlayerRuntimeState(playerId: string): void {
    // ─ DEATH-SPIRAL-RESILIENCE: Check if spawn already in progress
    // Prevent duplicate spawns while initialization is underway
    const currentPhase = (typeof window !== 'undefined' && (window as any).lifecycleOrchestrator?.getPhase?.()) ?? null;
    if (currentPhase === 'PLAY_ACTIVE') {
      // Player already active - don't re-initialize to avoid spawn loops
      const logEntry = `[ClientWorldRuntimeCoordinator] Skipped duplicate ensurePlayerRuntimeState call for already-active player ${playerId}`;
      console.info(logEntry, { timestamp: Date.now(), phase: currentPhase });
      return;
    }
    
    // Register the init contract FIRST so phase marks issued below are captured.
    // Idempotent: safe to call on reconnect / respawn.
    Engine.getEntityManager()?.registerPlayerInit(playerId);

    this.gameHUD.setPlayerId(playerId);
    this.inventorySystem.initPlayer(playerId);
    this.weaponSystem.ensurePlayer(playerId);
    this.gasBridge.initPlayer(playerId);

    const loadout = this.engineGameModes.getSpawnLoadout(playerId);
    const archetype = getTropicalHorrorArchetype(loadout.archetypeId);
    this.abilitySystem.setConditionTags(playerId, [...(loadout.conditionTags ?? [])]);
    this.abilitySystem.addConditionTag(playerId, 'HasFireball');
    const spawnMaxHealth = loadout.maxHealth ?? 100;
    const spawnMaxShield = loadout.maxShield ?? 0;
    const spawnMaxMana = loadout.maxMana ?? 100;
    const spawnArmor = loadout.armor ?? archetype.stats.armor;

    this.gameModeManager.setPlayerArchetype(playerId, archetype.id);
    this.adaptiveRuntime.applyPlayerArchetype(playerId, archetype.id);

    const localPlayerId = this.getActiveRuntimePlayerId() ?? this.mpClient.playerId ?? ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID;
    const isLocalRuntimePlayer = !this.mpClient.connected
      ? playerId === ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID || playerId === localPlayerId
      : playerId === localPlayerId;

    if (isLocalRuntimePlayer) {
      this.stateManager.set(SCHEMA_PATHS.PLAYER_LOCAL_ARCHETYPE, archetype.id);
      this.stateManager.set(SCHEMA_PATHS.PLAYERS_LOCAL_ARCHETYPE, archetype.id);
      this.stateManager.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_ARCHETYPE, archetype.id);

      if (loadout.appearance) {
        this.stateManager.set(SCHEMA_PATHS.PLAYER_LOCAL_APPEARANCE, { ...loadout.appearance });
        this.stateManager.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_APPEARANCE, { ...loadout.appearance });
      }
    }

    const gasAttrs = Engine.getGasAttributeStore()?.ensure(playerId, {
      Health: spawnMaxHealth,
      MaxHealth: spawnMaxHealth,
      Mana: spawnMaxMana,
      MaxMana: spawnMaxMana,
      Shield: spawnMaxShield,
      MaxShield: spawnMaxShield,
    });

    if (gasAttrs) {
      gasAttrs.setBase('MaxHealth', spawnMaxHealth);
      gasAttrs.setBase('Health', spawnMaxHealth);
      gasAttrs.setBase('MaxMana', spawnMaxMana);
      gasAttrs.setBase('Mana', spawnMaxMana);
      gasAttrs.setBase('MaxShield', spawnMaxShield);
      gasAttrs.setBase('Shield', spawnMaxShield);
    }

    if (!this.healthSystem.get(playerId)) {
      this.healthSystem.register(playerId, {
        maxHp: spawnMaxHealth,
        armor: spawnArmor,
        revivable: true,
        maxShield: spawnMaxShield,
        shield: spawnMaxShield,
        shieldRegenRate: 4,
        shieldRegenDelay: 4,
      });
    }

    this.healthSystem.syncVitals(playerId, {
      hp: spawnMaxHealth,
      maxHp: spawnMaxHealth,
      shield: spawnMaxShield,
      maxShield: spawnMaxShield,
      armor: spawnArmor,
    });

    const spawnWeapons = loadout.weapons.length > 0 ? loadout.weapons : ['pistol'];
    for (const weaponId of spawnWeapons) {
      const reserveAmmo = loadout.startAmmo?.[weaponId]?.reserve ?? (weaponId === 'pistol' ? 48 : 24);
      if (!this.weaponSystem.getInventoryEntry(playerId, weaponId)) {
        this.weaponSystem.giveWeapon(playerId, weaponId, reserveAmmo);
      }
    }

    this.weaponSystem.equip(playerId, spawnWeapons[0]);
    this.syncHealthChannelsFromGAS(playerId);
    
    // Force HUD UI binding to receive live inventory updates from pickups
    this.gameHUD.setPlayerId(playerId);

    // Mark synchronous phases complete.  'inventory' is marked later via
    // the INVENTORY_READY gameBus event once the async grid fetch resolves.
    // 'avatar' is marked in bindLocalPlayerEntity() after the model rebuilds.
    Engine.getEntityManager()?.markPlayerPhaseReady(playerId, 'entity');
    Engine.getEntityManager()?.markPlayerPhaseReady(playerId, 'abilities');
  }

  syncHealthChannelsFromGAS(playerId: string): void {
    const attrs = Engine.getGasAttributeStore()?.get(playerId)?.snapshot();
    if (!attrs) return;

    if (!this.healthSystem.get(playerId)) {
      this.healthSystem.register(playerId, {
        maxHp: attrs.MaxHealth,
        revivable: true,
        maxShield: attrs.MaxShield,
        shield: attrs.Shield,
        shieldRegenRate: 4,
        shieldRegenDelay: 4,
      });
    }

    this.healthSystem.syncVitals(playerId, {
      hp: attrs.Health,
      maxHp: attrs.MaxHealth,
      shield: attrs.Shield,
      maxShield: attrs.MaxShield,
    });

    this.syncKernelHealthChannels(playerId, {
      health: attrs.Health,
      maxHealth: attrs.MaxHealth,
    });
  }

  syncGasVitalsFromHealth(playerId: string): void {
    const attrs = Engine.getGasAttributeStore()?.get(playerId);
    const health = this.healthSystem.get(playerId);
    if (!attrs || !health) return;

    attrs.setBase('MaxHealth', health.maxHp);
    attrs.setBase('Health', health.hp);
    attrs.setBase('MaxShield', health.maxShield);
    attrs.setBase('Shield', health.shield);

    this.syncKernelHealthChannels(playerId, {
      health: health.hp,
      maxHealth: health.maxHp,
    });
  }

  syncKernelHealthChannels(
    playerId: string,
    vitals: { health?: number; maxHealth?: number },
  ): void {
    if (!this.kernelBridge) {
      return;
    }

    const runtimePlayerId = this.getActiveRuntimePlayerId() ?? this.mpClient.playerId;
    if (!runtimePlayerId || playerId !== runtimePlayerId) {
      return;
    }

    this.kernelBridge.syncPlayerVitals(playerId, {
      hp: vitals.health,
      maxHp: vitals.maxHealth,
    });
  }

  syncActiveHealthChannels(): void {
    const playerId = this.getActiveRuntimePlayerId() ?? this.mpClient.playerId;
    if (!playerId) return;
    this.syncHealthChannelsFromGAS(playerId);
  }

  getHealthChannelHpSummary(): string {
    const playerId = this.getActiveRuntimePlayerId() ?? this.mpClient.playerId;
    if (!playerId) return '—';
    return `${Math.round(this.healthSystem.getHp(playerId))}/${Math.round(this.healthSystem.getMaxHp(playerId))}`;
  }

  getHealthChannelShieldSummary(): string {
    const playerId = this.getActiveRuntimePlayerId() ?? this.mpClient.playerId;
    if (!playerId) return '—';
    return `${Math.round(this.healthSystem.getShield(playerId))}/${Math.round(this.healthSystem.getMaxShield(playerId))}`;
  }

  getHealthChannelGasSummary(): string {
    const playerId = this.getActiveRuntimePlayerId() ?? this.mpClient.playerId;
    if (!playerId) return '—';
    const attrs = Engine.getGasAttributeStore()?.get(playerId)?.snapshot();
    if (!attrs) return '—';
    return `HP ${Math.round(attrs.Health)}/${Math.round(attrs.MaxHealth)} | SH ${Math.round(attrs.Shield)}/${Math.round(attrs.MaxShield)}`;
  }

  private resolveEntityMesh(entityId: string): THREE.Mesh | null {
    const renderObject = Engine.getEntityRenderer()?.getMeshForEntity(entityId);
    if (!renderObject) {
      const localBinding = this.playerModelSystem.getLocalBindingSummary();
      if (localBinding.entityId === entityId) {
        return this.playerModelSystem.getLocalAvatarMesh();
      }
      return null;
    }
    if (renderObject instanceof THREE.Mesh) {
      return renderObject;
    }
    let nestedMesh: THREE.Mesh | null = null;
    renderObject.traverse((child) => {
      if (!nestedMesh && child instanceof THREE.Mesh) {
        nestedMesh = child;
      }
    });
    return nestedMesh;
  }

  syncAdaptiveRuntime(): void {
    const runtimePlayerId = this.getActiveRuntimePlayerId();
    if (!runtimePlayerId) return;
    this.adaptiveRuntime.syncRuntimeState({
      playerId: runtimePlayerId,
      health: this.healthSystem.getHp(runtimePlayerId),
      maxHealth: this.healthSystem.getMaxHp(runtimePlayerId),
      shield: this.healthSystem.getShield(runtimePlayerId),
      activeGameMode: this.getControllerGameMode() ?? 'freeplay',
      displayName: runtimePlayerId === ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID ? 'Freeplay' : runtimePlayerId,
    });
  }

  registerArenaSpawnPoints(kind: 'test' | 'default' | 'forest'): void {
    this.spawnSystem.clearSpawnPoints();
    const radius = kind === 'test' ? 7 : kind === 'default' ? 16 : 24;
    const count = kind === 'test' ? 6 : 8;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      this.spawnSystem.registerSpawnPoint({
        id: `${kind}_spawn_${index}`,
        position: { x: Math.cos(angle) * radius, y: 1, z: Math.sin(angle) * radius },
        weight: 1,
        radius: 1.6,
        tags: ['player'],
      });
    }
    this.spawnSystem.registerSpawnPoint({
      id: `${kind}_center`,
      position: { x: 0, y: 1, z: 0 },
      weight: 0.4,
      radius: 1.4,
      tags: ['player', 'prefab'],
    });
  }

  private getControllerGameMode(): string | null {
    const mode = Engine.getStateManagerInstance()?.getRaw('game.mode');
    return typeof mode === 'string' && mode.length > 0 ? mode : null;
  }

  registerScriptedSpawnPoints(levelId: string): { x: number; y: number; z: number } {
    this.spawnSystem.clearSpawnPoints();
    const level = this.scriptedLevelSystem?.getLevel(levelId);
    const spawnPoints = level?.spawnPoints?.length ? level.spawnPoints : level ? [level.playerSpawn] : [{ x: 0, y: 1.6, z: 0 }];
    spawnPoints.forEach((spawn, index) => {
      this.spawnSystem.registerSpawnPoint({
        id: `${levelId}_spawn_${index}`,
        position: { x: spawn.x, y: spawn.y, z: spawn.z },
        weight: 1,
        radius: 1.8,
        tags: ['player'],
      });
    });
    return level?.playerSpawn ?? spawnPoints[0];
  }

  restoreRuntimeSnapshot(snapshot: unknown, syncEditorPrefabLibrary: () => void): void {
    if (!snapshot || typeof snapshot !== 'object') return;
    const saved = snapshot as { systemData?: Record<string, unknown> };
    this.weaponSystem.importState(saved.systemData?.weapons as never);
    this.inventorySystem.importState(saved.systemData?.inventories as never);
    this.prefabSystem.importState(saved.systemData?.prefabs as never);
    this.spawnSystem.importState(saved.systemData?.spawns as never);
    syncEditorPrefabLibrary();
  }

  isEditorEditableEntity(entity: { type: string; hasComponent(name: string): boolean }): boolean {
    return entity.type.startsWith('EditorObject_') || entity.type.startsWith('Prefab_') || entity.hasComponent('prefab');
  }

  buildMatchLevel(sessionId: string, map = 'forest_arena'): THREE.Group {
    this.setActiveMapCollisionLayout(map, sessionId);
    if (map !== 'forest_arena') return this.buildFlatTestMap(sessionId);
    return this.buildForestArena(sessionId);
  }

  buildMinimalTestArena(sessionId: string): THREE.Group {
    const scene = Engine.getEngineScene();
    if (!scene) throw new Error('Scene not available');

    const group = new THREE.Group();
    group.name = `test_arena_${sessionId}`;
    const material = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), material(0x45413a));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    for (const [x, z, width, depth] of [
      [0, 14, 28, 1],
      [0, -14, 28, 1],
      [14, 0, 1, 28],
      [-14, 0, 1, 28],
    ] as Array<[number, number, number, number]>) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 3.5, depth), material(0x26211d));
      wall.position.set(x, 1.75, z);
      group.add(wall);
    }

    for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as Array<[number, number]>) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.75, 1.75), material(0x675239));
      crate.position.set(x, 0.875, z);
      group.add(crate);
    }

    const lightPole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), material(0x77716a));
    lightPole.position.set(0, 2, 0);
    group.add(lightPole);

    (scene as THREE.Scene & { fog?: THREE.Fog }).fog = new THREE.Fog(0x201c18, 18, 48);
    scene.add(group);
    this.registerStaticLevelGeometryForCulling(group);
    return group;
  }

  buildFlatTestMap(sessionId: string): THREE.Group {
    const scene = Engine.getEngineScene();
    if (!scene) throw new Error('Scene not available');

    const group = new THREE.Group();
    group.name = `flat_test_map_${sessionId}`;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x6b705f, flatShading: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    const skybox = new THREE.Mesh(
      new THREE.BoxGeometry(520, 220, 520),
      [
        new THREE.MeshBasicMaterial({ color: 0x8eb6d8, side: THREE.BackSide }),
        new THREE.MeshBasicMaterial({ color: 0x8eb6d8, side: THREE.BackSide }),
        new THREE.MeshBasicMaterial({ color: 0xc7dff2, side: THREE.BackSide }),
        new THREE.MeshBasicMaterial({ color: 0x5c6670, side: THREE.BackSide }),
        new THREE.MeshBasicMaterial({ color: 0x9bbfdc, side: THREE.BackSide }),
        new THREE.MeshBasicMaterial({ color: 0x9bbfdc, side: THREE.BackSide }),
      ],
    );
    skybox.position.set(0, 70, 0);
    group.add(skybox);

    const spawnMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.08, 18),
      new THREE.MeshLambertMaterial({ color: 0xc8913f, flatShading: true }),
    );
    spawnMarker.position.set(0, 0.04, 0);
    spawnMarker.visible = false; // Hidden for freeplay testing with spawned entities
    group.add(spawnMarker);

    const sampleCrate = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.2, 2.2),
      [
        new THREE.MeshLambertMaterial({ map: getGeneratedItemTexture('weapon_shotgun'), color: 0xffffff, flatShading: true }),
        new THREE.MeshLambertMaterial({ map: getGeneratedItemTexture('ammo_shells'), color: 0xffffff, flatShading: true }),
        new THREE.MeshLambertMaterial({ map: getGeneratedItemTexture('weapon_pistol'), color: 0xffffff, flatShading: true }),
        new THREE.MeshLambertMaterial({ map: getGeneratedItemTexture('health_small'), color: 0xffffff, flatShading: true }),
        new THREE.MeshLambertMaterial({ map: getGeneratedItemTexture('physgun_tool'), color: 0xffffff, flatShading: true }),
        new THREE.MeshLambertMaterial({ map: getGeneratedItemTexture('ammo_9mm'), color: 0xffffff, flatShading: true }),
      ],
    );
    sampleCrate.position.set(4, 1.1, -4);
    sampleCrate.castShadow = true;
    sampleCrate.visible = false; // Hidden for freeplay testing with spawned entities
    group.add(sampleCrate);

    scene.background = new THREE.Color(0xa7cbe7);
    (scene as THREE.Scene & { fog?: THREE.Fog }).fog = new THREE.Fog(0xa7cbe7, 90, 220);
    scene.add(group);
    this.registerStaticLevelGeometryForCulling(group);
    return group;
  }

  buildHordeArena(sessionId: string): THREE.Group {
    const scene = Engine.getEngineScene();
    if (!scene) throw new Error('Scene not available');

    const group = new THREE.Group();
    group.name = `horde_arena_${sessionId}`;

    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2e2c28, flatShading: true });
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x1c1a18, flatShading: true });
    const hazardMat = new THREE.MeshLambertMaterial({ color: 0x7c1f1f, flatShading: true });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    const walls = [
      [0, 2.2, -24, 48, 4, 1],
      [0, 2.2, 24, 48, 4, 1],
      [-24, 2.2, 0, 1, 4, 48],
      [24, 2.2, 0, 1, 4, 48],
    ] as Array<[number, number, number, number, number, number]>;
    for (const [x, y, z, width, height, depth] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMat);
      wall.position.set(x, y, z);
      wall.receiveShadow = true;
      wall.castShadow = true;
      group.add(wall);
    }

    const obstacles = [
      [-10, 1, -6, 4, 2, 4],
      [10, 1, -6, 4, 2, 4],
      [-10, 1, 6, 4, 2, 4],
      [10, 1, 6, 4, 2, 4],
    ] as Array<[number, number, number, number, number, number]>;
    for (const [x, y, z, width, height, depth] of obstacles) {
      const obstacle = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMat);
      obstacle.position.set(x, y, z);
      obstacle.receiveShadow = true;
      obstacle.castShadow = true;
      group.add(obstacle);
    }

    const hazard = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.1, 24), hazardMat);
    hazard.position.set(0, 0.05, 0);
    hazard.rotation.x = -Math.PI / 2;
    group.add(hazard);

    const ambientLight = new THREE.AmbientLight(0x554433, 0.45);
    group.add(ambientLight);

    const campfireLight = new THREE.PointLight(0xff8844, 2.0, 20, 2.0);
    campfireLight.position.set(6, 1.2, 6);
    campfireLight.castShadow = true;
    group.add(campfireLight);

    const campfireGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xffab52, emissive: 0xff5f1a, emissiveIntensity: 3.0, transparent: true, opacity: 0.85 }),
    );
    campfireGlow.position.set(6, 0.6, 6);
    group.add(campfireGlow);

    const campfireStones = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.18, 10, 24),
      new THREE.MeshLambertMaterial({ color: 0x4b3527, flatShading: true }),
    );
    campfireStones.rotation.x = Math.PI / 2;
    campfireStones.position.set(6, 0.12, 6);
    group.add(campfireStones);

    // Second campfire
    const campfireLight2 = new THREE.PointLight(0xff8844, 1.6, 16, 2.0);
    campfireLight2.position.set(-7, 1.2, -7);
    group.add(campfireLight2);
    const campfireGlow2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xffab52, emissive: 0xff5f1a, emissiveIntensity: 2.5, transparent: true, opacity: 0.8 }),
    );
    campfireGlow2.position.set(-7, 0.6, -7);
    group.add(campfireGlow2);
    const campfireStones2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.16, 10, 24),
      new THREE.MeshLambertMaterial({ color: 0x4b3527, flatShading: true }),
    );
    campfireStones2.rotation.x = Math.PI / 2;
    campfireStones2.position.set(-7, 0.12, -7);
    group.add(campfireStones2);

    scene.background = new THREE.Color(0x251814);
    (scene as THREE.Scene & { fog?: THREE.Fog }).fog = new THREE.Fog(0x251814, 12, 60);
    scene.add(group);
    this.registerStaticLevelGeometryForCulling(group);

    // Register walls + obstacles as navmesh-blocking entities so
    // PathfindingSystem.rebuildFromStaticColliders() marks them as blocked.
    const em = Engine.getEntityManager();
    if (em) {
      // [x, y, z, halfW, halfH, halfD]
      const navBlockers: Array<[number, number, number, number, number, number]> = [
        [0,   2.2, -24, 24,  2, 0.6],  // north wall
        [0,   2.2,  24, 24,  2, 0.6],  // south wall
        [-24, 2.2,   0, 0.6, 2, 24],   // west wall
        [ 24, 2.2,   0, 0.6, 2, 24],   // east wall
        [-10, 1,    -6, 2,   1, 2],    // obstacle NW
        [ 10, 1,    -6, 2,   1, 2],    // obstacle NE
        [-10, 1,     6, 2,   1, 2],    // obstacle SW
        [ 10, 1,     6, 2,   1, 2],    // obstacle SE
      ];
      for (const [x, y, z, hw, hh, hd] of navBlockers) {
        const blocker = em.createEntity('NavBlocker', {
          position: { x, y, z },
          rotation: { x: 0, y: 0, z: 0 },
        });
        blocker.addComponent({
          name: 'collider',
          data: {
            shape: 'box',
            size: { width: hw * 2, height: hh * 2, depth: hd * 2 },
            isTrigger: false,
          },
        });
      }
      console.log('[buildHordeArena] Registered', navBlockers.length, 'nav-blocker entities');
    }

    return group;
  }

  private buildForestArena(sessionId: string): THREE.Group {
    const scene = Engine.getEngineScene();
    if (!scene) throw new Error('Scene not available');

    const seed = this.hashSeed(sessionId);
    const group = new THREE.Group();
    let randomSeed = seed;
    const rng = (): number => { randomSeed = (randomSeed * 1664525 + 1013904223) & 0xffffffff; return (randomSeed >>> 0) / 0xffffffff; };
    const rngRange = (min: number, max: number) => min + rng() * (max - min);
    const createMaterial = (hex: number) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });

    const groundGeo = new THREE.PlaneGeometry(120, 120, 8, 8);
    const ground = new THREE.Mesh(groundGeo, createMaterial(0x2a4a1e));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    group.add(ground);

    for (let index = 0; index < 20; index += 1) {
      const width = rngRange(2, 7);
      const depth = rngRange(2, 6);
      const patch = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), createMaterial(0x3a2e18));
      patch.position.set(rngRange(-50, 50), 0.01, rngRange(-50, 50));
      patch.rotation.y = rng() * Math.PI;
      group.add(patch);
    }

    const trunkMat = createMaterial(0x4a3018);
    const canopyMat = createMaterial(0x1a4a18);
    const darkCanopyMat = createMaterial(0x0e321a);
    for (let index = 0; index < 60; index += 1) {
      let tx: number;
      let tz: number;
      do { tx = rngRange(-55, 55); tz = rngRange(-55, 55); } while (tx * tx + tz * tz < 100);
      const treeH = rngRange(4, 10);
      const trunkR = rngRange(0.2, 0.5);
      const canopyR = rngRange(1.5, 3.5);
      const canopyH = rngRange(3, 6);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.6, trunkR, treeH, 6), trunkMat);
      trunk.position.set(tx, treeH / 2, tz);
      group.add(trunk);

      const canopy = new THREE.Mesh(new THREE.ConeGeometry(canopyR, canopyH, 7), rng() > 0.3 ? canopyMat : darkCanopyMat);
      canopy.position.set(tx, treeH + canopyH * 0.35, tz);
      group.add(canopy);

      if (rng() > 0.5) {
        const upperCanopy = new THREE.Mesh(new THREE.ConeGeometry(canopyR * 0.65, canopyH * 0.8, 6), canopyMat);
        upperCanopy.position.set(tx, treeH + canopyH * 0.85, tz);
        group.add(upperCanopy);
      }
    }

    const rockMat = createMaterial(0x4a4a40);
    const darkRockMat = createMaterial(0x303028);
    for (let index = 0; index < 30; index += 1) {
      const radius = rngRange(0.3, 1.8);
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), rng() > 0.5 ? rockMat : darkRockMat);
      rock.position.set(rngRange(-55, 55), radius * 0.4, rngRange(-55, 55));
      rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      group.add(rock);
    }

    const barrierMat = createMaterial(0x5a3a18);
    const perimeterR = 58;
    const postCount = 32;
    for (let index = 0; index < postCount; index += 1) {
      const angle = (index / postCount) * Math.PI * 2;
      const bx = Math.cos(angle) * perimeterR;
      const bz = Math.sin(angle) * perimeterR;
      const height = rngRange(0.8, 2.2);
      const barrier = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, height, 5), barrierMat);
      barrier.position.set(bx, height / 2, bz);
      barrier.rotation.y = rng() * 0.4;
      group.add(barrier);
    }

    const createFirepit = (x: number, z: number) => {
      const firepit = new THREE.Group();
      const pitMat = createMaterial(0x4b3320);
      const emberMat = new THREE.MeshBasicMaterial({ color: 0xff8b3d, transparent: true, opacity: 0.85 });
      const logMat = createMaterial(0x5e452d);

      const pit = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 12), pitMat);
      pit.position.set(x, 0.15, z);
      firepit.add(pit);

      const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 12), emberMat);
      ember.position.set(x, 0.25, z);
      ember.rotation.x = -Math.PI / 2;
      firepit.add(ember);

      const logCount = 4;
      for (let logIndex = 0; logIndex < logCount; logIndex += 1) {
        const angle = (logIndex / logCount) * Math.PI * 2 + rng() * 0.4;
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6), logMat);
        log.position.set(x + Math.cos(angle) * 0.5, 0.2, z + Math.sin(angle) * 0.5);
        log.rotation.z = angle + Math.PI / 2;
        firepit.add(log);
      }

      const light = new THREE.PointLight(0xffb56a, 1.2, 18, 2);
      light.position.set(x, 0.5, z);
      firepit.add(light);
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.3, 16),
        new THREE.MeshBasicMaterial({ color: 0xffa350, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, 0.05, z);
      firepit.add(glow);

      group.add(firepit);
    };

    const spawnMat = createMaterial(0x3a5a2a);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.5), spawnMat);
      stone.position.set(Math.cos(angle) * 3, 0.15, Math.sin(angle) * 3);
      stone.rotation.y = angle;
      group.add(stone);
    }

    const firepitPositions: Array<[number, number]> = [
      [8, 5],
      [-10, -7],
      [12, -12],
      [-14, 14],
    ];
    for (const [x, z] of firepitPositions) {
      createFirepit(x, z);
    }

    const mistGeo = new THREE.CircleGeometry(60, 32);
    const mistMat = new THREE.MeshBasicMaterial({ color: 0x3a6040, transparent: true, opacity: 0.08, depthWrite: false });
    const mist = new THREE.Mesh(mistGeo, mistMat);
    mist.rotation.x = -Math.PI / 2;
    mist.position.y = 0.5;
    group.add(mist);

    const engineScene = Engine.getEngineScene();
    if (engineScene) {
      engineScene.background = new THREE.Color(0x0f1b0e);
      (engineScene as THREE.Scene & { fog?: THREE.FogExp2 }).fog = new THREE.FogExp2(0x1a2e14, 0.018);
    }

    scene.add(group);
    this.registerStaticLevelGeometryForCulling(group);
    return group;
  }

  private buildDefaultArena(sessionId: string): THREE.Group {
    const scene = Engine.getEngineScene();
    if (!scene) throw new Error('Scene not available');
    const seed = this.hashSeed(sessionId);
    let randomSeed = seed;
    const rng = (): number => { randomSeed = (randomSeed * 1664525 + 1013904223) & 0xffffffff; return (randomSeed >>> 0) / 0xffffffff; };
    const rngRange = (min: number, max: number) => min + rng() * (max - min);

    const group = new THREE.Group();
    const createMaterial = (hex: number) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), createMaterial(0x3a3530));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    group.add(ground);

    const wallMat = createMaterial(0x2a2520);
    const wallH = 4;
    const halfWall = 40;
    const wallDefs = [
      [0, 0, halfWall, 0, wallH, 1],
      [0, 0, -halfWall, 0, wallH, 1],
      [halfWall, 0, 0, 1, wallH, 0],
      [-halfWall, 0, 0, 1, wallH, 0],
    ] as [number, number, number, number, number, number][];
    for (const [x, , z, rx, , rz] of wallDefs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(rx ? 1 : 80, wallH, rz ? 1 : 80), wallMat);
      wall.position.set(x, wallH / 2, z);
      group.add(wall);
    }

    const crateMat = createMaterial(0x5a4a30);
    const darkCrateMat = createMaterial(0x3a3020);
    for (let index = 0; index < 18; index += 1) {
      let cx: number;
      let cz: number;
      do { cx = rngRange(-34, 34); cz = rngRange(-34, 34); } while (cx * cx + cz * cz < 25);
      const stackH = Math.floor(rng() * 3) + 1;
      for (let height = 0; height < stackH; height += 1) {
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 1.8, 1.8),
          rng() > 0.4 ? crateMat : darkCrateMat,
        );
        crate.position.set(cx, 0.9 + height * 1.8, cz);
        crate.rotation.y = rng() * 0.25;
        group.add(crate);
      }
    }

    const spawnMat = createMaterial(0x6a5a40);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.4), spawnMat);
      stone.position.set(Math.cos(angle) * 3, 0.075, Math.sin(angle) * 3);
      stone.rotation.y = angle;
      group.add(stone);
    }

    const engineScene = Engine.getEngineScene();
    if (engineScene) {
      (engineScene as THREE.Scene & { fog?: THREE.Fog }).fog = new THREE.Fog(0x1a1715, 40, 120);
    }

    scene.add(group);
    this.registerStaticLevelGeometryForCulling(group);
    return group;
  }

  private readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private getHalfExtentsFromRenderData(renderData: Record<string, unknown> | undefined): { x: number; y: number; z: number } {
    const meshType = typeof renderData?.meshType === 'string' ? renderData.meshType : 'box';
    const geometry = (renderData?.geometry ?? {}) as Record<string, unknown>;

    switch (meshType) {
      case 'sphere': {
        const radius = this.readNumber(geometry.radius, 0.5);
        return { x: radius, y: radius, z: radius };
      }
      case 'capsule': {
        const radius = this.readNumber(geometry.radius, 0.4);
        const height = this.readNumber(geometry.height, 1);
        return { x: radius, y: radius + (height * 0.5), z: radius };
      }
      case 'cylinder': {
        const radius = Math.max(this.readNumber(geometry.radiusTop, 0.5), this.readNumber(geometry.radiusBottom, 0.5));
        const height = this.readNumber(geometry.height, 1);
        return { x: radius, y: height * 0.5, z: radius };
      }
      case 'plane': {
        return {
          x: this.readNumber(geometry.width, 1) * 0.5,
          y: 0.1,
          z: this.readNumber(geometry.height, 1) * 0.5,
        };
      }
      default:
        return {
          x: this.readNumber(geometry.width, 1) * 0.5,
          y: this.readNumber(geometry.height, 1) * 0.5,
          z: this.readNumber(geometry.depth, 1) * 0.5,
        };
    }
  }

  private hashSeed(str: string): number {
    let hash = 5381;
    for (let index = 0; index < str.length; index += 1) hash = ((hash << 5) + hash) ^ str.charCodeAt(index);
    return hash >>> 0;
  }
}
