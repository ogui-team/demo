import * as Engine from '../../0-foundation/foundation/Engine';
import { gameBus } from '../../1-kernel/core/EventBus';
import type { PrefabSystem } from '../../2-systems/gameplay/systems/PrefabSystem';
import type { SpawnSystem } from '../../2-systems/gameplay/systems/SpawnSystem';
import type { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import type { UndoRedoSystem } from '@engine/1-kernel/core/public-api';
import type { SaveLoadManager } from '@engine/1-kernel/core/public-api';
import type { WorldObjectAuthorityService } from '../../2-systems/gameplay/game/WorldObjectAuthorityService';
import type { ClientWorldRuntimeCoordinator } from './coordinators/ClientWorldRuntimeCoordinator';

interface EditorMenuAdapter {
  setSpawnLibrary(entries: Array<{
    id: string;
    label: string;
    category: string;
    glyph: string;
    accentColor: string;
    description: string;
    spawn: (position: { x: number; y: number; z: number }) => any;
    buildSpawnRequest?: (position: { x: number; y: number; z: number }) => {
      entityType: string;
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      renderData: {
        meshType: string;
        color: number;
        geometry: Record<string, unknown>;
      };
    } | null;
  }>): void;
  refreshSelectedEntity(): void;
  setOnEntityRemoveRequest(handler: (entity: { id: string; type: string; hasComponent(name: string): boolean }) => boolean): void;
  setOnSpawnRequested(handler: (data: {
    entityType: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    renderData: {
      meshType: string;
      color: number;
      geometry: Record<string, unknown>;
    };
  }) => boolean): void;
  setOnEntityPlaced(handler: (data: {
    id: string;
    entityType: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    renderData?: Record<string, unknown>;
  }) => void): void;
  setOnEntityRemoved(handler: (id: string) => void): void;
  setOnTransformApplied(handler: (data: {
    id: string;
    before: unknown;
    after: unknown;
  }) => void): void;
}

interface GizmoSystemAdapter {
  setOnEntityTransformCommitted(handler: (data: {
    id: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    previousPosition: { x: number; y: number; z: number };
    previousRotation: { x: number; y: number; z: number };
    previousScale: { x: number; y: number; z: number };
  }) => void): void;
}

interface EditorAuthorityCoordinatorConfig {
  prefabSystem: PrefabSystem;
  spawnSystem: SpawnSystem;
  mpClient: MultiplayerClient;
  undoRedoSystem: UndoRedoSystem;
  saveLoadManager: SaveLoadManager | null;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  worldRuntime: ClientWorldRuntimeCoordinator;
  editorMenu: EditorMenuAdapter | null;
  gizmoSystem: GizmoSystemAdapter | null;
}

export class EditorAuthorityCoordinator {
  private readonly prefabSystem: PrefabSystem;
  private readonly spawnSystem: SpawnSystem;
  private readonly mpClient: MultiplayerClient;
  private readonly undoRedoSystem: UndoRedoSystem;
  private readonly saveLoadManager: SaveLoadManager | null;
  private readonly worldObjectAuthorityService: WorldObjectAuthorityService;
  private readonly worldRuntime: ClientWorldRuntimeCoordinator;
  private readonly editorMenu: EditorMenuAdapter | null;
  private readonly gizmoSystem: GizmoSystemAdapter | null;
  private lastEditorSnapshot: unknown = null;

  constructor(config: EditorAuthorityCoordinatorConfig) {
    this.prefabSystem = config.prefabSystem;
    this.spawnSystem = config.spawnSystem;
    this.mpClient = config.mpClient;
    this.undoRedoSystem = config.undoRedoSystem;
    this.saveLoadManager = config.saveLoadManager;
    this.worldObjectAuthorityService = config.worldObjectAuthorityService;
    this.worldRuntime = config.worldRuntime;
    this.editorMenu = config.editorMenu;
    this.gizmoSystem = config.gizmoSystem;
    this.lastEditorSnapshot = this.saveLoadManager?.serializeWorld() ?? null;
  }

  getLastEditorSnapshot(): unknown {
    return this.lastEditorSnapshot;
  }

  setLastEditorSnapshot(snapshot: unknown): void {
    this.lastEditorSnapshot = snapshot ?? this.lastEditorSnapshot;
    this.syncEditorPrefabLibrary();
  }

  syncEditorPrefabLibrary(): void {
    if (!this.editorMenu) return;

    this.editorMenu.setSpawnLibrary(
      this.prefabSystem.listPrefabs().map((prefabName) => {
        const prefab = this.prefabSystem.getPrefab(prefabName);
        const presentation = this.getPrefabSpawnPresentation(prefabName, prefab);
        return {
          id: prefabName,
          label: prefabName
            .split(/[_\s]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' '),
          category: presentation.category,
          glyph: presentation.glyph,
          accentColor: presentation.accentColor,
          description: presentation.description,
          spawn: (position) => this.spawnSystem.spawnPrefab(prefabName, {
            position,
            clearance: Math.max(1.5, prefab?.minSpacing ?? 1.5),
            tag: 'prefab',
          }),
          buildSpawnRequest: (position) => ({
            entityType: prefab?.entityType ?? prefabName,
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            renderData: {
              meshType: prefab?.assetKey ? 'custom' : 'box',
              color: prefab?.color ?? 0xffffff,
              geometry: prefab?.assetKey
                ? { assetKey: prefab.assetKey }
                : { width: 1, height: 1, depth: 1 },
            },
          }),
        };
      }),
    );
  }

  wire(): void {
    if (this.gizmoSystem) {
      this.gizmoSystem.setOnEntityTransformCommitted((data) => {
        const entity = Engine.getEntityManager()?.getEntity(data.id);
        if (!entity || !this.worldRuntime.isEditorEditableEntity(entity)) return;

        this.undoRedoSystem.pushCompletedAction({
          label: `Transform ${entity.type}`,
          undo: () => {
            entity.setPosition({ ...data.previousPosition });
            entity.setRotation({ ...data.previousRotation });
            entity.setScale({ ...data.previousScale });
            Engine.getEntityRenderer()?.syncEntity(entity);
            this.editorMenu?.refreshSelectedEntity();
          },
          redo: () => {
            entity.setPosition({ ...data.position });
            entity.setRotation({ ...data.rotation });
            entity.setScale({ ...data.scale });
            Engine.getEntityRenderer()?.syncEntity(entity);
            this.editorMenu?.refreshSelectedEntity();
          },
        });

        const renderData = entity.getComponent('render')?.data;
        if (!renderData) return;

        this.editorMenu?.refreshSelectedEntity();
        if (!this.mpClient.connected) return;

        this.mpClient.sendWorldObjectUpdate({
          id: data.id,
          entityType: entity.type,
          position: data.position,
          rotation: data.rotation,
          renderData: renderData as { meshType: string; color: number; geometry: Record<string, unknown> },
        });
      });
    }

    if (!this.editorMenu) return;

    this.editorMenu.setOnSpawnRequested((data) => {
      const prefabName = this.prefabSystem.findPrefabNameByEntityType(data.entityType)
        ?? (this.prefabSystem.getPrefab(data.entityType) ? data.entityType : null);
      if (prefabName) {
        gameBus.emit('EDITOR_SPAWN_PREFAB', {
          prefabId: prefabName,
          position: data.position,
          rotation: data.rotation,
          source: 'ui',
          timestamp: Date.now(),
        });
        return true;
      }

      if (!this.mpClient.connected) return false;
      this.mpClient.sendWorldObjectPlace({
        id: `world_object_request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        entityType: data.entityType,
        position: data.position,
        rotation: data.rotation,
        renderData: data.renderData,
      });
      return true;
    });

    this.editorMenu.setOnEntityRemoveRequest((entity) => {
      if (entity.hasComponent('prefab')) {
        this.prefabSystem.remove(entity.id);
        return true;
      }
      return Engine.getEntityManager()?.destroyEntity(entity as never) ?? false;
    });

    this.editorMenu.setOnEntityPlaced((data) => {
      const entity = Engine.getEntityManager()?.getEntity(data.id);
      if (entity) {
        this.worldObjectAuthorityService.sendPlacedEntity(entity, data.entityType);
      } else {
        this.worldObjectAuthorityService.trackLocalPlacement(data.id);
        if (this.mpClient.connected && data.renderData) {
          this.mpClient.sendWorldObjectPlace({
            id: data.id,
            entityType: data.entityType,
            position: data.position,
            rotation: data.rotation,
            renderData: data.renderData as { meshType: string; color: number; geometry: Record<string, unknown> },
          });
        }
      }
      const after = this.saveLoadManager?.serializeWorld() ?? null;
      if (this.lastEditorSnapshot && after) {
        this.undoRedoSystem.pushCompletedAction(this.createSnapshotAction(`Create ${data.entityType}`, this.lastEditorSnapshot, after));
        this.lastEditorSnapshot = after;
      }
    });

    this.editorMenu.setOnEntityRemoved((id) => {
      this.worldObjectAuthorityService.sendRemovedAuthority(id);
      const after = this.saveLoadManager?.serializeWorld() ?? null;
      if (this.lastEditorSnapshot && after) {
        this.undoRedoSystem.pushCompletedAction(this.createSnapshotAction(`Delete ${id}`, this.lastEditorSnapshot, after));
        this.lastEditorSnapshot = after;
      }
    });

    this.editorMenu.setOnTransformApplied((data) => {
      const entity = Engine.getEntityManager()?.getEntity(data.id);
      if (!entity) return;
      this.worldObjectAuthorityService.syncAuthorityTransformForEntity(data.id);
      this.undoRedoSystem.pushCompletedAction({
        label: `Edit ${entity.type}`,
        undo: () => {
          entity.setTransform(data.before as never);
          Engine.getEntityRenderer()?.syncEntity(entity);
          this.editorMenu?.refreshSelectedEntity();
        },
        redo: () => {
          entity.setTransform(data.after as never);
          Engine.getEntityRenderer()?.syncEntity(entity);
          this.editorMenu?.refreshSelectedEntity();
        },
      });
      this.lastEditorSnapshot = this.saveLoadManager?.serializeWorld() ?? this.lastEditorSnapshot;
    });
  }

  private createSnapshotAction(label: string, before: unknown, after: unknown) {
    return {
      label,
      undo: () => {
        if (before && this.saveLoadManager) {
          this.saveLoadManager.deserializeWorld(before as never);
          this.worldRuntime.restoreRuntimeSnapshot(before, () => this.syncEditorPrefabLibrary());
        }
      },
      redo: () => {
        if (after && this.saveLoadManager) {
          this.saveLoadManager.deserializeWorld(after as never);
          this.worldRuntime.restoreRuntimeSnapshot(after, () => this.syncEditorPrefabLibrary());
        }
      },
    };
  }

  private getPrefabSpawnPresentation(prefabName: string, prefab: ReturnType<PrefabSystem['getPrefab']>): {
    category: string;
    glyph: string;
    accentColor: string;
    description: string;
  } {
    const tags = new Set(prefab?.tags ?? []);
    const name = prefabName.toLowerCase();
    const type = (prefab?.entityType ?? '').toLowerCase();

    if (name.includes('pickup') || tags.has('pickup') || type.includes('pickup')) {
      if (name.includes('ammo')) {
        return { category: 'Pickups', glyph: '◫', accentColor: '#d0a25e', description: 'Ammo pickup for combat and HUD validation.' };
      }
      if (name.includes('med')) {
        return { category: 'Pickups', glyph: '+', accentColor: '#d96d6d', description: 'Health pickup for recovery and inventory testing.' };
      }
      if (name.includes('shotgun')) {
        return { category: 'Pickups', glyph: '⌁', accentColor: '#d8b06d', description: 'Weapon pickup for loadout and toolbar validation.' };
      }
      return { category: 'Pickups', glyph: '◇', accentColor: '#c7a766', description: 'Gameplay pickup for interaction and inventory loops.' };
    }

    if (name.includes('light')) {
      return { category: 'Lighting', glyph: '✦', accentColor: '#e7d37e', description: 'Lighting prop for mood, readability, and VFX checks.' };
    }

    if (name.includes('tree') || name.includes('rock')) {
      return { category: 'Environment', glyph: '△', accentColor: '#6fb082', description: 'Environment dressing for scale, silhouette, and scene readability.' };
    }

    if (name.includes('enemy') || type.includes('enemy')) {
      return { category: 'Actors', glyph: '◎', accentColor: '#d96d6d', description: 'Actor prefab for combat encounter and AI path testing.' };
    }

    if (name.includes('crate') || name.includes('barrel') || name.includes('locker') || tags.has('prop')) {
      return { category: 'Props', glyph: '▣', accentColor: '#8ea2c7', description: 'Physical scene prop for interaction, collision, and composition.' };
    }

    return {
      category: 'Prefabs',
      glyph: '◼',
      accentColor: '#8a8a8a',
      description: prefab?.tags?.length ? prefab.tags.join(' · ') : (prefab?.entityType ?? 'Registered prefab'),
    };
  }
}