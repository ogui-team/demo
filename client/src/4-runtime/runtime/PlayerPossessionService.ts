import * as THREE from 'three';
import * as Engine from '../../0-foundation/foundation/Engine';
import type { Entity, Vector3 } from '../../1-kernel/core/Entity';
import type { NetworkSyncSystem } from '../../3-network/network/NetworkSyncSystem';
import type { PhysicsSystem } from '../../2-systems/gameplay/systems/PhysicsSystem';

interface PlayerPossessionServiceConfig {
  networkSyncSystem: NetworkSyncSystem;
  getMapRootNode?: () => THREE.Object3D | null;
}

interface PossessionResult {
  success: boolean;
  entityId?: string;
  reason?: string;
}

interface PendingEditorMarkerState {
  position: Vector3;
  rotation: Vector3;
}

interface PhysicsBodyLike {
  position: Vector3;
  velocity: Vector3;
  gravityScale: number;
  grounded: boolean;
  isStatic: boolean;
}

const DEFAULT_POSSESSION_OFFSET: Vector3 = { x: 0, y: 0, z: 0 };
const ZERO_VECTOR: Vector3 = { x: 0, y: 0, z: 0 };
const GRAVITY_RESTORE_DELAY_MS = 100;

export class PlayerPossessionService {
  private readonly networkSyncSystem: NetworkSyncSystem;
  private readonly getMapRootNode: (() => THREE.Object3D | null) | null;
  private gravityRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPossessedEntityId: string | null = null;
  private pendingEditorMarker: PendingEditorMarkerState | null = null;

  constructor(config: PlayerPossessionServiceConfig) {
    this.networkSyncSystem = config.networkSyncSystem;
    this.getMapRootNode = config.getMapRootNode ?? null;
  }

  dispose(): void {
    this.clearGravityRestoreTimer();
  }

  findReusablePlayerEntity(): Entity | null {
    const entityManager = Engine.getEntityManager();
    if (!entityManager) {
      return null;
    }

    const entities = entityManager.getEntities();

    const byPlayerComponent = entities.find((entity) => entity.hasComponent('PlayerComponent'));
    if (byPlayerComponent) {
      return byPlayerComponent;
    }

    const byLocalPlayer = entities.find((entity) => entity.hasComponent('localPlayer'));
    if (byLocalPlayer) {
      return byLocalPlayer;
    }

    const byAvatar = entities.find((entity) => {
      if (!entity.hasComponent('dodPlayerAvatar')) {
        return false;
      }
      const typeLower = (entity.type ?? '').toLowerCase();
      return typeLower.includes('local');
    });

    return byAvatar ?? null;
  }

  possessFromEditorCamera(offset: Vector3 = DEFAULT_POSSESSION_OFFSET): PossessionResult {
    this.clearEditorPlayerMarkers();

    const player = this.findReusablePlayerEntity();
    if (!player) {
      return { success: false, reason: 'no_player_entity' };
    }

    const camera = Engine.getEngineCamera();
    if (camera) {
      if (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) {
        const camWorldPos = new THREE.Vector3();
        camera.getWorldPosition(camWorldPos);
        const customWorldPos = new THREE.Vector3(
          camWorldPos.x + offset.x,
          camWorldPos.y + offset.y,
          camWorldPos.z + offset.z,
        );
        this.applyPlayerWorldSpawn(player, customWorldPos, 0.5);
      } else {
        this.forcePlayerToCamera(player, camera);
      }
    } else {
      const currentPosition = player.getPosition();
      const currentRotation = player.getRotation();
      player.setPosition(currentPosition);
      player.setRotation(currentRotation);
      this.networkSyncSystem.forceLocalState(currentPosition, currentRotation, ZERO_VECTOR, {
        clearPendingInputs: true,
      });
      this.stabilizePhysicsAfterPossession(player.id, currentPosition);
      this.lastPossessedEntityId = player.id;
    }

    return {
      success: true,
      entityId: player.id,
    };
  }

  forcePlayerToCamera(player: Entity, camera: THREE.Camera): void {
    const camWorldPos = new THREE.Vector3();
    camera.getWorldPosition(camWorldPos);
    this.applyPlayerWorldSpawn(player, camWorldPos, 0.5);
  }

  releaseToEditorMode(): PossessionResult {
    const entityManager = Engine.getEntityManager();
    const runtimePlayers = this.collectRuntimePlayerEntities();
    const player = this.resolvePossessedPlayer() ?? runtimePlayers[0] ?? null;
    if (!player || !entityManager) {
      return { success: false, reason: 'no_player_entity' };
    }

    // Get fresh editor camera position for spectator freeze
    const camera = Engine.getEngineCamera();
    const freshEditorPosition = camera
      ? new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
      : player.getPosition();

    const releasePos = {
      x: freshEditorPosition.x,
      y: freshEditorPosition.y,
      z: freshEditorPosition.z,
    };

    const rotation = player.getRotation();
    this.networkSyncSystem.forceLocalState(releasePos, rotation, ZERO_VECTOR, {
      clearPendingInputs: true,
    });

    const playerIdsToDestroy = new Set(runtimePlayers.map((entity) => entity.id));
    playerIdsToDestroy.add(player.id);

    for (const entityId of playerIdsToDestroy) {
      const body = this.getBody(entityId);
      if (body) {
        body.isStatic = true;
        body.gravityScale = 0;
        body.grounded = true;
        body.position = { ...releasePos };
      }
      this.getPhysicsSystem()?.setVelocity(entityId, ZERO_VECTOR);
      entityManager.destroyEntity(entityId);
    }

    this.lastPossessedEntityId = null;
    this.pendingEditorMarker = {
      position: { ...releasePos },
      rotation: { ...rotation },
    };

    console.log('[Physics] Released player to editor and removed runtime player entities', {
      releasePos,
      removedPlayers: [...playerIdsToDestroy],
    });

    return {
      success: true,
      entityId: player.id,
    };
  }

  materializeEditorMarker(): string | null {
    const pendingMarker = this.pendingEditorMarker;
    if (!pendingMarker) {
      return null;
    }

    const entityManager = Engine.getEntityManager();
    const entityRenderer = Engine.getEntityRenderer();
    if (!entityManager || !entityRenderer) {
      return null;
    }

    this.clearEditorPlayerMarkers();

    const marker = entityManager.createEntity('EditorPlayerMarker', {
      position: { ...pendingMarker.position },
      rotation: { ...pendingMarker.rotation },
    });
    marker.addComponent({
      name: 'editorPlayerMarker',
      data: { frozen: true },
    });
    marker.addComponent({
      name: 'render',
      data: {
        meshType: 'custom',
        color: 0xffffff,
        geometry: { assetKey: 'model_player_avatar' },
      },
    });
    marker.addComponent({
      name: 'editorPlacement',
      data: {
        serialize: false,
        kind: 'entity',
        entityType: 'EditorPlayerMarker',
        authority: 'local',
        label: 'Player',
      },
    });
    entityRenderer.syncEntity(marker);
    this.pendingEditorMarker = null;
    return marker.id;
  }

  private clearEditorPlayerMarkers(): void {
    const entityManager = Engine.getEntityManager();
    if (!entityManager) {
      return;
    }

    for (const entity of entityManager.getEntities()) {
      const typeLower = (entity.type ?? '').toLowerCase();
      if (entity.hasComponent('editorPlayerMarker') || typeLower === 'editorplayermarker') {
        entityManager.destroyEntity(entity.id);
      }
    }
  }

  private resolvePossessedPlayer(): Entity | null {
    const entityManager = Engine.getEntityManager();
    if (!entityManager) {
      return null;
    }

    if (this.lastPossessedEntityId) {
      const remembered = entityManager.getEntity(this.lastPossessedEntityId);
      if (remembered) {
        return remembered;
      }
    }

    return this.findReusablePlayerEntity();
  }

  private collectRuntimePlayerEntities(): Entity[] {
    const entityManager = Engine.getEntityManager();
    if (!entityManager) {
      return [];
    }

    return entityManager.getEntities().filter((entity) => this.isRuntimePlayerEntity(entity));
  }

  private isRuntimePlayerEntity(entity: Entity): boolean {
    const typeLower = (entity.type ?? '').toLowerCase();
    if (entity.hasComponent('localPlayer') || typeLower === 'remoteplayer' || typeLower === 'localplayer') {
      return true;
    }

    const prefabData = entity.getComponent('prefab')?.data as { tags?: unknown } | undefined;
    const prefabTags = Array.isArray(prefabData?.tags)
      ? prefabData.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLowerCase())
      : [];

    return prefabTags.includes('runtime') && prefabTags.includes('player');
  }

  private stabilizePhysicsAfterPossession(entityId: string, targetPosition: Vector3): void {
    this.clearGravityRestoreTimer();

    const physicsSystem = this.getPhysicsSystem();
    const body = physicsSystem?.getBody(entityId) as PhysicsBodyLike | undefined;
    if (!physicsSystem || !body) {
      return;
    }

    const previousGravityScale = body.gravityScale;
    // Physics-Force-Wakeup: Force dynamic state
    body.isStatic = false;
    body.gravityScale = 1.0;  // Force gravity immediately
    body.grounded = true;
    body.position = { ...targetPosition };
    physicsSystem.setVelocity(entityId, ZERO_VECTOR);

    // Force physics engine to recalculate collisions (wake up body)
    if ((physicsSystem as any).wakeUp) {
      (physicsSystem as any).wakeUp(entityId);
    }

    console.log(`[Physics] Stabilized player after possession: forced dynamic, gravity=1.0, position=`, targetPosition);

    this.gravityRestoreTimer = setTimeout(() => {
      const restoredBody = this.getBody(entityId);
      if (!restoredBody) {
        return;
      }
      restoredBody.isStatic = false;
      restoredBody.gravityScale = previousGravityScale;
      restoredBody.grounded = true;
      this.gravityRestoreTimer = null;
    }, GRAVITY_RESTORE_DELAY_MS);
  }

  private applyPlayerWorldSpawn(player: Entity, cameraWorldPos: THREE.Vector3, yOffset: number): void {
    const mapRoot = this.getMapRootNode?.() ?? null;
    if (mapRoot) {
      mapRoot.updateWorldMatrix(true, true);
    }
    const localSpawnVector = mapRoot
      ? mapRoot.worldToLocal(cameraWorldPos.clone())
      : cameraWorldPos.clone();
    localSpawnVector.y += yOffset;

    const spawnPos: Vector3 = {
      x: localSpawnVector.x,
      y: localSpawnVector.y,
      z: localSpawnVector.z,
    };

    const rotation = player.getRotation();
    player.setPosition(spawnPos);
    player.setRotation(rotation);

    this.networkSyncSystem.forceLocalState(spawnPos, rotation, ZERO_VECTOR, {
      clearPendingInputs: true,
    });

    this.stabilizePhysicsAfterPossession(player.id, spawnPos);
    this.lastPossessedEntityId = player.id;

    const spawnWorldVector = mapRoot
      ? mapRoot.localToWorld(localSpawnVector.clone())
      : localSpawnVector.clone();
    this.drawDebugLine(
      { x: cameraWorldPos.x, y: cameraWorldPos.y, z: cameraWorldPos.z },
      { x: spawnWorldVector.x, y: spawnWorldVector.y, z: spawnWorldVector.z },
    );
  }

  private drawDebugLine(from: Vector3, to: Vector3): void {
    const scene = Engine.getEngineScene();
    if (!scene) {
      return;
    }

    const points = [
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.name = '__debugSpawnLine__';
    scene.add(line);

    setTimeout(() => {
      scene.remove(line);
      geometry.dispose();
      material.dispose();
    }, 1000);
  }

  private getPhysicsSystem(): PhysicsSystem | null {
    return (Engine.getSystemRegistry()?.getSystem('physicsSystem') as PhysicsSystem | undefined) ?? null;
  }

  private getBody(entityId: string): PhysicsBodyLike | undefined {
    return this.getPhysicsSystem()?.getBody(entityId) as PhysicsBodyLike | undefined;
  }

  private clearGravityRestoreTimer(): void {
    if (this.gravityRestoreTimer) {
      clearTimeout(this.gravityRestoreTimer);
      this.gravityRestoreTimer = null;
    }
  }
}
