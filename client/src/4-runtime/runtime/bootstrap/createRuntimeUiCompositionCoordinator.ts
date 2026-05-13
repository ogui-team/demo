import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { Entity, FeatureManager, FeatureKey, FEATURE_META } from '@engine/1-kernel/core/public-api';
import { gameBus, logEvent } from '@engine/1-kernel/core/public-api';
import { getSavedLevelNames, loadLevelFromStorage, runWithLoading } from '../../ui/LevelPersistence';
import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { GameLaunchCoordinator } from '../../../2-systems/gameplay/game/GameLaunchCoordinator';
import type { ScriptedLevelSystem } from '../../../2-systems/gameplay/game/ScriptedLevelSystem';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { GameAudioManager } from '../../../2-systems/gameplay/systems/GameAudioManager';
import type { MenuIdentitySystem } from '../../ui/MenuIdentitySystem';
import type { UICompositionCoordinator } from '../../ui/UICompositionCoordinator';
import type { ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import type { MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';
import { EditorDockLayout } from '../../ui/docking/EditorDockLayout';
import { AuthAvatarBadge } from '../../ui/docking/AuthAvatarBadge';
import { CommandPalette } from '../../ui/docking/CommandPalette';
import { EditorSelectionStore } from '../../ui/docking/EditorSelectionStore';
import { HierarchyPanel } from '../../ui/docking/HierarchyPanel';
import { InspectorPanel } from '../../ui/docking/InspectorPanel';
import { SystemsPanel } from '../../ui/docking/SystemsPanel';
import { ThemeManager } from '../../ui/docking/ThemeManager';
import { TopActionBar } from '../../ui/docking/TopActionBar';
import type { LifecycleOrchestrator } from '../../debug/LifecycleOrchestrator';
import { RendererRebindService } from '../RendererRebindService';
import type { WorldBuildService } from '../WorldBuildService';
import { EditorSyncBackListener } from '../EditorSyncBackListener';
import type { UndoRedoSystem } from '../../../1-kernel/core/UndoRedoSystem';

interface CreateRuntimeUiCompositionCoordinatorOptions {
  modeManager: ReturnType<typeof Engine.getModeManger> | null;
  engineController: NonNullable<ReturnType<typeof Engine.getEngineController>>;
  mpClient: MultiplayerClient;
  gameLaunchCoordinator: GameLaunchCoordinator;
  audioManager: GameAudioManager;
  worldRuntime: ClientWorldRuntimeCoordinator;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  scriptedLevelSystem: ScriptedLevelSystem | null;
  engineGameModes: GameModeSystem;
  menuIdentitySystem: MenuIdentitySystem;
  debugManager: { enable: () => void };
  lifecycleOrchestrator: LifecycleOrchestrator;
  worldBuildService: WorldBuildService | null;
  rendererRebindService: RendererRebindService | null;
  undoRedoSystem: UndoRedoSystem;
}

export async function createRuntimeUiCompositionCoordinator(
  options: CreateRuntimeUiCompositionCoordinatorOptions,
): Promise<UICompositionCoordinator> {
  const editorSyncBackListener = new EditorSyncBackListener(options.modeManager as any, options.gameLaunchCoordinator);
  const { UICompositionCoordinator } = await import('../../ui/UICompositionCoordinator');
  const themeManager = new ThemeManager();
  themeManager.applySlateTheme();

  const dockLayout = new EditorDockLayout();
  const selectionStore = new EditorSelectionStore();
  const cleanupFns: Array<() => void> = [];
  const applyEditorUndo = (): void => {
    options.undoRedoSystem.undo();
  };
  const applyEditorRedo = (): void => {
    options.undoRedoSystem.redo();
  };
  const defaultMapName = (): string => `editor-map-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
  let persistenceActionInFlight = false;
  const buildWorld = async (reason: string): Promise<boolean> => {
    const result = await (options.worldBuildService?.buildActiveWorldBuffer(reason) ?? Promise.resolve({ success: false, reason: 'WorldBuildService unavailable.' }));
    if (!result.success) {
      window.alert(result.reason ?? 'Build World failed.');
      return false;
    }
    return true;
  };
  const RECOVERY_STORAGE_KEY = 'editor-auto-recovery-v2';
  const RECOVERY_STATUS_KEY = 'editor-auto-recovery-v2:ready';
  const MAX_RECOVERY_PAYLOAD_CHARS = 2 * 1024 * 1024;
  const RECOVERY_AUTOSAVE_DELAY_MS = 1200;
  let isDirty = false;
  let recoveryAvailable = false;
  let recoverySnapshotTimer: number | null = null;
  let isWritingRecoverySnapshot = false;
  const statusBadge = document.createElement('div');
  statusBadge.style.cssText = 'font-size:11px;color:var(--suite-fg-1);padding:4px 8px;border:1px solid var(--suite-border);border-radius:4px;background:var(--suite-bg-1);';
  const recoveryButton = document.createElement('button');
  recoveryButton.type = 'button';
  recoveryButton.textContent = 'Restore Recovery';
  recoveryButton.style.cssText = 'height:26px;padding:0 10px;border:1px solid var(--suite-border);background:var(--suite-bg-2);color:var(--suite-fg-0);cursor:pointer;display:none;';
  recoveryButton.addEventListener('click', async () => {
    if (!recoveryAvailable) return;
    const recoveryJson = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!recoveryJson) return;
    const result = Engine.importMap(recoveryJson, 'editor-auto-recovery');
    if (!result.success) {
      window.alert(`Recovery failed: ${result.entitiesCreated} entities restored, ${result.settingsApplied} settings applied.`);
      return;
    }
    isDirty = true;
    updateStatusBadge();
    window.alert('Editor recovery loaded. Save the map to commit the restored work.');
  });

  const updateStatusBadge = (): void => {
    const dirtyText = isDirty ? 'Unsaved changes' : 'Clean';
    const snapText = placementSnapEnabled ? 'Snap On' : 'Snap Off';
    const recoveryText = recoveryAvailable ? ' · Recovery available' : '';
    statusBadge.textContent = `${dirtyText} · ${snapText}${recoveryText}`;
    recoveryButton.style.display = recoveryAvailable ? 'inline-flex' : 'none';
  };

  const clearRecoverySnapshotTimer = (): void => {
    if (recoverySnapshotTimer === null) {
      return;
    }
    window.clearTimeout(recoverySnapshotTimer);
    recoverySnapshotTimer = null;
  };

  const saveRecoverySnapshot = (): void => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
    if (isWritingRecoverySnapshot) return;
    try {
      isWritingRecoverySnapshot = true;
      const exported = Engine.exportMap('editor-auto-recovery');
      if (exported.length > MAX_RECOVERY_PAYLOAD_CHARS) {
        window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
        window.localStorage.removeItem(RECOVERY_STATUS_KEY);
        recoveryAvailable = false;
        updateStatusBadge();
        console.warn('[EditorRecovery] Skipping recovery snapshot because the payload is too large.', {
          length: exported.length,
          maxLength: MAX_RECOVERY_PAYLOAD_CHARS,
        });
        return;
      }
      window.localStorage.setItem(RECOVERY_STORAGE_KEY, exported);
      window.localStorage.setItem(RECOVERY_STATUS_KEY, String(Date.now()));
      recoveryAvailable = true;
      updateStatusBadge();
    } catch (error) {
      console.warn('[EditorRecovery] Unable to serialize recovery snapshot.', error);
    } finally {
      isWritingRecoverySnapshot = false;
    }
  };

  const scheduleRecoverySnapshot = (): void => {
    if (typeof window === 'undefined') return;
    clearRecoverySnapshotTimer();
    recoverySnapshotTimer = window.setTimeout(() => {
      recoverySnapshotTimer = null;
      saveRecoverySnapshot();
    }, RECOVERY_AUTOSAVE_DELAY_MS);
  };

  const shouldTrackDirtyMutation = (payload: { path?: string; paths?: string[] }): boolean => {
    if (isWritingRecoverySnapshot || options.engineController.getRuntimeMode() !== 'editor') {
      return false;
    }

    const paths = [payload.path, ...(payload.paths ?? [])]
      .filter((path): path is string => typeof path === 'string' && path.length > 0);
    if (paths.length === 0) {
      return true;
    }

    return paths.some((path) => {
      if (path.startsWith('editorController.')) return false;
      if (path.startsWith('camera.')) return false;
      if (path.startsWith('runtime.')) return false;
      if (path.startsWith('menu.')) return false;
      if (path.startsWith('playController.')) return false;
      return true;
    });
  };

  const markDirty = (): void => {
    if (!isDirty) {
      isDirty = true;
      updateStatusBadge();
    }
    scheduleRecoverySnapshot();
  };

  const markClean = (): void => {
    clearRecoverySnapshotTimer();
    if (!isDirty) return;
    isDirty = false;
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
      window.localStorage.removeItem(RECOVERY_STATUS_KEY);
      recoveryAvailable = false;
    }
    updateStatusBadge();
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = 'You have unsaved editor changes. Leave without saving?';
  };

  const loadRecoveryState = (): void => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
    const recoveryMarker = window.localStorage.getItem(RECOVERY_STATUS_KEY);
    if (!recoveryMarker) return;
    recoveryAvailable = true;
    updateStatusBadge();
  };

  const promptForMapName = (action: 'Save' | 'Export' | 'Import', fallbackNameOverride?: string): string | null => {
    const fallbackName = fallbackNameOverride ?? defaultMapName();
    let name: string | null = fallbackName;
    try {
      if (typeof window.prompt === 'function') {
        name = window.prompt(`${action} map as:`, fallbackName);
      }
    } catch (error) {
      console.warn(`[RuntimeUIBootstrap] ${action} prompt unavailable, using default name`, error);
      name = fallbackName;
    }
    if (name === null) {
      return null;
    }
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : fallbackName;
  };
  const saveCurrentMap = async (): Promise<void> => {
    if (persistenceActionInFlight) return;
    persistenceActionInFlight = true;
    try {
    if (!await buildWorld('save')) return;
    const name = promptForMapName('Save');
    if (!name) return;
    const saved = Engine.saveMap(name);
    if (!saved) {
      window.alert(`Unable to save map "${name}".`);
      return;
    }
    markClean();
    } finally {
      persistenceActionInFlight = false;
    }
  };
  const exportCurrentMap = async (): Promise<void> => {
    if (persistenceActionInFlight) return;
    persistenceActionInFlight = true;
    try {
    if (!await buildWorld('export')) return;
    const name = promptForMapName('Export');
    if (!name) return;
    let exported = '';
    try {
      exported = Engine.exportMap(name);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Export failed.');
      return;
    }
    const validation = options.worldBuildService?.validateExportPayload(exported) ?? { success: !!exported, reason: 'Export validation unavailable.' };
    if (!exported || !validation.success) {
      window.alert(`Unable to export map "${name}".`);
      return;
    }

    const blob = new Blob([exported], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    } finally {
      persistenceActionInFlight = false;
    }
  };
  const importMapFromJson = async (): Promise<void> => {
    if (persistenceActionInFlight) return;
    persistenceActionInFlight = true;
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => {
          const selected = input.files && input.files.length > 0 ? input.files[0] : null;
          resolve(selected);
        };
        input.click();
      });
      if (!file) return;

      const json = await file.text();
      const validation = options.worldBuildService?.validateExportPayload(json) ?? { success: !!json, reason: 'Import validation unavailable.' };
      if (!validation.success) {
        window.alert(`Invalid map JSON: ${validation.reason ?? 'Unknown format.'}`);
        return;
      }

      const fallbackName = file.name.replace(/\.json$/i, '').trim() || 'imported_map';
      const mapName = promptForMapName('Import', fallbackName) ?? fallbackName;
      const result = Engine.importMap(json, mapName);
      if (!result.success) {
        window.alert(`Import failed for "${mapName}".`);
        return;
      }

      markDirty();
      selectionStore.clear();
      hierarchyPanel.renderRows();
      window.dispatchEvent(new CustomEvent('editor:spawn-library-updated'));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      persistenceActionInFlight = false;
    }
  };
  window.addEventListener('editor:save-shortcut', (() => { void saveCurrentMap(); }) as EventListener);
  const selectionSystem = Engine.getSelectionSystem();
  const getEntityLabel = (entity: Entity | null | undefined): string => {
    if (!entity) return 'Unknown Entity';
    const placement = entity.getComponent('editorPlacement')?.data as { label?: string } | undefined;
    return typeof placement?.label === 'string' && placement.label.trim() !== ''
      ? placement.label.trim()
      : entity.type;
  };

  if (selectionSystem) {
    let syncingFromRuntimeSelection = false;

    const syncSelectionStoreFromRuntime = (): void => {
      const selectedIds = selectionSystem.getSelectedIds();
      if (selectedIds.length === 0) {
        selectionStore.clear();
        return;
      }

      const labels = selectedIds.map((entityId) => {
        const entity = Engine.getEntityManager()?.getEntity(entityId);
        return getEntityLabel(entity);
      });

      if (selectedIds.length === 1) {
        selectionStore.selectEntity(selectedIds[0], labels[0]);
        return;
      }

      selectionStore.selectEntities(selectedIds, `${selectedIds.length} selected`);
    };

    const sameSelectionIds = (left: string[], right: string[]): boolean => {
      if (left.length !== right.length) return false;
      return left.every((id, index) => id === right[index]);
    };

    selectionSystem.onSelect(() => {
      syncingFromRuntimeSelection = true;
      try {
        syncSelectionStoreFromRuntime();
      } finally {
        syncingFromRuntimeSelection = false;
      }
    });
    selectionSystem.onDeselect(() => {
      syncingFromRuntimeSelection = true;
      try {
        syncSelectionStoreFromRuntime();
      } finally {
        syncingFromRuntimeSelection = false;
      }
    });

    selectionStore.subscribe((state) => {
      if (syncingFromRuntimeSelection) {
        return;
      }

      if (state.type !== 'none' && state.type !== 'entity' && state.type !== 'entities') {
        return;
      }

      const nextIds = state.selectedIds ?? (state.nodeId ? [state.nodeId] : []);
      const runtimeIds = selectionSystem.getSelectedIds();
      if (sameSelectionIds(nextIds, runtimeIds)) {
        return;
      }

      selectionSystem.setSelectedIds(nextIds);
    });

    syncSelectionStoreFromRuntime();
  }
  const entityManager = Engine.getEntityManager();
  cleanupFns.push(gameBus.on('stateMutation', (payload) => {
    if (!shouldTrackDirtyMutation(payload)) {
      return;
    }
    markDirty();
  }));
  cleanupFns.push(gameBus.on('EDITOR_PREFAB_PLACED', ({ entityId }) => {
    if (placementSnapEnabled) {
      Engine.getPrefabPlacementSystem()?.snapEntityToFloor(entityId);
    }
    markDirty();
  }));
  if (entityManager) {
    cleanupFns.push(entityManager.onEntityDestroyed((entity) => {
      const state = selectionStore.getState();
      const selectedIds = state.selectedIds ?? (state.nodeId ? [state.nodeId] : []);
      if (selectedIds.includes(entity.id)) {
        selectionStore.clear();
      }
    }));
  }
  // Shared predicate so all hierarchy adapters use the same rule.
  // NOTE: 'editorPlacement' must be checked at hierarchy-render time, not in onEntityCreated,
  // because components are attached after the entity-created event fires during deserialization.
  const isHierarchyEntity = (entity: { hasComponent: (k: string) => boolean; type: string }) =>
    entity.hasComponent('editorPlacement') || entity.type === 'LocalPlayer';

  const hierarchyPanel = new HierarchyPanel({
    selectionStore,
    entityManager: {
      // Surface editor-placed entities AND the local player entity (if present).
      // The LocalPlayer type is the runtime avatar — show it so the user can see
      // where the player is in the scene after returning from play mode.
      getEntities: () => Array.from(entityManager?.getEntities() ?? [])
        .filter(isHierarchyEntity)
        .map((entity) => ({
          id: entity.id,
          type: entity.type,
          label: entity.type === 'LocalPlayer' ? 'Player' : getEntityLabel(entity),
        })),
      onEntityCreated: (callback) => entityManager?.onEntityCreated((entity) => {
        if (!isHierarchyEntity(entity)) return;
        callback({ id: entity.id, type: entity.type, label: entity.type === 'LocalPlayer' ? 'Player' : getEntityLabel(entity) });
      }) ?? (() => {}),
      onEntityUpdated: (callback) => entityManager?.onEntityUpdated((entity) => {
        if (!isHierarchyEntity(entity)) return;
        callback({ id: entity.id, type: entity.type, label: entity.type === 'LocalPlayer' ? 'Player' : getEntityLabel(entity) });
      }) ?? (() => {}),
      onEntityDestroyed: (callback) => entityManager?.onEntityDestroyed(callback) ?? (() => {}),
    },
  });
  const topActionBar = new TopActionBar({
    selectionStore,
    onSelectTool: (tool) => {
      gameBus.emit('EDITOR_TOOL_CHANGE_REQUESTED', {
        tool,
        reason: 'dock_toolbar',
        source: 'ui',
        timestamp: Engine.time.now(),
      });
    },
    onUndo: () => {
      applyEditorUndo();
    },
    onRedo: () => {
      applyEditorRedo();
    },
    onSetGizmoMode: (mode) => {
      Engine.getGizmoSystem()?.setMode(mode);
    },
    onToggleGizmoOrientation: () => {
      Engine.getGizmoSystem()?.toggleOrientationMode();
    },
    onToggleGizmoSnap: () => {
      const gizmoSystem = Engine.getGizmoSystem();
      if (!gizmoSystem) return;
      const snapSettings = gizmoSystem.getSnapSettings();
      gizmoSystem.setSnapSettings({ enabled: !snapSettings.enabled });
    },
    getGizmoState: () => {
      const gizmoSystem = Engine.getGizmoSystem();
      return {
        mode: gizmoSystem?.getMode() ?? 'translate',
        orientation: gizmoSystem?.getOrientationMode() ?? 'world',
        snapEnabled: gizmoSystem?.getSnapSettings().enabled ?? false,
      };
    },
    onBuildWorld: () => {
      void buildWorld('toolbar');
    },
    onSave: () => { void saveCurrentMap(); },
    onExport: () => { void exportCurrentMap(); },
    onImport: () => { void importMapFromJson(); },
  });

  let placementSnapEnabled = true;
  const placementSnapButton = document.createElement('button');
  placementSnapButton.type = 'button';
  placementSnapButton.textContent = 'Snap On';
  placementSnapButton.style.cssText = 'height:26px;padding:0 10px;border:1px solid var(--suite-border);background:var(--suite-bg-2);color:var(--suite-fg-0);cursor:pointer;';
  placementSnapButton.addEventListener('click', () => {
    placementSnapEnabled = !placementSnapEnabled;
    placementSnapButton.textContent = placementSnapEnabled ? 'Snap On' : 'Snap Off';
    updateStatusBadge();
  });

  const statusContainer = document.createElement('div');
  statusContainer.style.cssText = 'display:flex;align-items:center;gap:10px;';
  statusContainer.append(statusBadge, placementSnapButton, recoveryButton);
  updateStatusBadge();
  topActionBar.mountRight(statusContainer);

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload, true);
    loadRecoveryState();
  }

  const authAvatarBadge = new AuthAvatarBadge();
  const inspectorPanel = new InspectorPanel({
    selectionStore,
    toggleFeature: (feature) => {
      FeatureManager.toggle(feature as FeatureKey);
    },
    requestTool: (tool) => {
      gameBus.emit('EDITOR_TOOL_CHANGE_REQUESTED', {
        tool,
        reason: 'inspector_tool',
        source: 'ui',
        timestamp: Engine.time.now(),
      });
    },
    spawnPrefab: (prefabId) => {
      const fallbackPosition = { x: 0, y: 1, z: 0 };
      gameBus.emit('EDITOR_SPAWN_PREFAB', {
        prefabId,
        position: fallbackPosition,
        source: 'ui',
        timestamp: Engine.time.now(),
      });
    },
  });
  const syncInspectorSpawnLibrary = (entries?: Array<{
    id: string;
    label: string;
    category: string;
    description?: string;
    glyph?: string;
    accentColor?: string;
  }>): void => {
    const sourceEntries = entries ?? Engine.getEditorMenu()?.getSpawnLibraryEntries() ?? [];
    inspectorPanel.setSpawnLibrary(sourceEntries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      category: entry.category,
      description: entry.description,
      glyph: entry.glyph,
      accentColor: entry.accentColor,
    })));
  };
  syncInspectorSpawnLibrary();
  window.addEventListener('editor:spawn-library-updated', ((event: Event) => {
    const detail = (event as CustomEvent<{ entries?: Array<{
      id: string;
      label: string;
      category: string;
      description?: string;
      glyph?: string;
      accentColor?: string;
    }> }>).detail;
    syncInspectorSpawnLibrary(detail?.entries);
  }) as EventListener);

  const renderer = Engine.getEngineRenderer();
  const viewportElement = renderer?.domElement ?? null;

  type PlacementSessionState = 'idle' | 'previewing' | 'committing' | 'cancelled';

  interface PlacementSession {
    state: PlacementSessionState;
    prefabId: string | null;
    position: { x: number; y: number; z: number } | null;
    previewMesh: THREE.Mesh | null;
  }

  const placementSession: PlacementSession = {
    state: 'idle',
    prefabId: null,
    position: null,
    previewMesh: null,
  };

  // Track the dragged prefabId via custom event because dataTransfer.getData()
  // returns empty string during 'dragover' (browser security restriction).
  let activeDragPrefabId: string | null = null;
  window.addEventListener('editor:spawn-library-drag-start', (evt) => {
    activeDragPrefabId = (evt as CustomEvent<{ prefabId: string }>).detail?.prefabId ?? null;
  }, true);
  window.addEventListener('editor:spawn-library-drag-end', () => {
    activeDragPrefabId = null;
  }, true);

  const viewportPreviewRaycaster = new THREE.Raycaster();
  const viewportPreviewMouse = new THREE.Vector2();

  const releasePlacementSession = (): void => {
    placementSession.state = 'idle';
    placementSession.prefabId = null;
    placementSession.position = null;
    placementSession.previewMesh = null;
  };

  const removePlacementPreview = (): void => {
    if (!placementSession.previewMesh) return;
    const scene = Engine.getEngineScene();
    if (scene && scene.children.includes(placementSession.previewMesh)) {
      scene.remove(placementSession.previewMesh);
    }
    placementSession.previewMesh.geometry.dispose();
    if (placementSession.previewMesh.material instanceof THREE.Material) {
      placementSession.previewMesh.material.dispose();
    }
    placementSession.previewMesh = null;
  };

  const createPlacementPreview = (prefabId: string): void => {
    removePlacementPreview();
    const scene = Engine.getEngineScene();
    if (!scene) return;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x44ccff,
      transparent: true,
      opacity: 0.28,
      wireframe: true,
      depthWrite: false,
    });
    const previewMesh = new THREE.Mesh(geometry, material);
    previewMesh.name = 'editor_drag_preview';
    previewMesh.renderOrder = 999;
    previewMesh.visible = true;
    scene.add(previewMesh);

    placementSession.state = 'previewing';
    placementSession.prefabId = prefabId;
    placementSession.position = null;
    placementSession.previewMesh = previewMesh;
  };

  const updatePlacementPreview = (clientX: number, clientY: number): void => {
    if (!placementSession.previewMesh || placementSession.state !== 'previewing') return;
    const camera = Engine.getEngineCamera();
    const activeRenderer = Engine.getEngineRenderer();
    if (!camera || !activeRenderer) {
      return;
    }

    const rect = activeRenderer.domElement.getBoundingClientRect();
    viewportPreviewMouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    viewportPreviewMouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    viewportPreviewRaycaster.setFromCamera(viewportPreviewMouse, camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    const didIntersect = viewportPreviewRaycaster.ray.intersectPlane(groundPlane, hitPoint);
    const material = placementSession.previewMesh.material as THREE.MeshBasicMaterial;
    if (didIntersect) {
      placementSession.previewMesh.position.set(hitPoint.x, 0.1, hitPoint.z);
      material.color.set(0x44ccff);
      material.opacity = 0.28;
      placementSession.position = { x: hitPoint.x, y: 0, z: hitPoint.z };
    } else {
      placementSession.previewMesh.position.set(0, 0.1, 0);
      material.color.set(0xff6644);
      material.opacity = 0.16;
      placementSession.position = null;
    }
  };

  const cancelPlacementSession = (reason: string): void => {
    if (placementSession.state === 'idle') return;
    removePlacementPreview();
    releasePlacementSession();
    console.log('[EditorPlacement] Placement session cancelled:', reason);
  };

  const finishPlacementSession = (clientX: number, clientY: number): void => {
    if (placementSession.state !== 'previewing' || !placementSession.prefabId) {
      releasePlacementSession();
      return;
    }

    placementSession.state = 'committing';
    updatePlacementPreview(clientX, clientY);

    const prefabId = placementSession.prefabId;
    const position = placementSession.position ?? { x: 0, y: 1, z: 0 };
    removePlacementPreview();
    releasePlacementSession();

    // Arm auto-select before the event so it is guaranteed set when EDITOR_PREFAB_PLACED fires.
    autoSelectNextPlacedPrefab = true;

    gameBus.emit('EDITOR_SPAWN_PREFAB', {
      prefabId,
      position,
      source: 'ui',
      timestamp: Engine.time.now(),
    });
  };

  const cleanupPlacementSession = (): void => {
    if (placementSession.state === 'idle') return;
    cancelPlacementSession('cleanup');
  };

  // Viewport drop routing is the single owner for prefab spawn commits.
  // Engine global drop hooks are intentionally not responsible for final placement.
  viewportElement?.addEventListener('dragover', (event) => {
    const types = event.dataTransfer?.types ? Array.from(event.dataTransfer.types) : [];
    if (!types.includes('EDITOR_SPAWN_PREFAB') && !types.includes('application/x-editor-prefab') && !activeDragPrefabId) {
      return;
    }
    // getData() returns '' during dragover (browser security) — use activeDragPrefabId instead.
    const prefabId = activeDragPrefabId
      || event.dataTransfer?.getData('EDITOR_SPAWN_PREFAB')
      || event.dataTransfer?.getData('application/x-editor-prefab');
    if (!prefabId) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (placementSession.state === 'idle' || placementSession.prefabId !== prefabId) {
      createPlacementPreview(prefabId);
    }
    updatePlacementPreview(event.clientX, event.clientY);
  });
  viewportElement?.addEventListener('dragleave', (event) => {
    if (!viewportElement) return;
    if (event.relatedTarget instanceof Node && viewportElement.contains(event.relatedTarget)) {
      return;
    }
    cancelPlacementSession('viewport_leave');
  });
  viewportElement?.addEventListener('drop', (event) => {
    const prefabId = event.dataTransfer?.getData('EDITOR_SPAWN_PREFAB')
      || event.dataTransfer?.getData('application/x-editor-prefab')
      || activeDragPrefabId;
    if (!prefabId) {
      return;
    }
    event.preventDefault();
    finishPlacementSession(event.clientX, event.clientY);
  });
  window.addEventListener('dragend', () => {
    cleanupPlacementSession();
  }, true);

  let autoSelectNextPlacedPrefab = false;

  gameBus.on('EDITOR_SPAWN_PREFAB', ({ source }) => {
    if (source === 'ui') {
      autoSelectNextPlacedPrefab = true;
    }
  });

  gameBus.on('EDITOR_PREFAB_PLACED', ({ entityId }) => {
    const entity = Engine.getEntityManager()?.getEntity(entityId);
    if (entity) {
      hierarchyPanel.updateRow(entityId, getEntityLabel(entity));
    }

    if (!autoSelectNextPlacedPrefab) {
      return;
    }

    autoSelectNextPlacedPrefab = false;
    Engine.getSelectionSystem()?.selectEntity(entityId);
  });

  const placementSessionEscapeHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (placementSession.state !== 'previewing') return;
    event.preventDefault();
    event.stopPropagation();
    cancelPlacementSession('escape');
  };
  window.addEventListener('keydown', placementSessionEscapeHandler, true);
  window.addEventListener('ui:hard-reset-input-stack', () => {
    autoSelectNextPlacedPrefab = false;
    cleanupPlacementSession();
  }, true);
  gameBus.on('ENGINE_RESET', () => {
    autoSelectNextPlacedPrefab = false;
    cleanupPlacementSession();
  });

  options.modeManager?.registerListener({
    onEnterEditor: () => {
      autoSelectNextPlacedPrefab = false;
      cleanupPlacementSession();
    },
    onEnterPlay: () => {
      autoSelectNextPlacedPrefab = false;
      cleanupPlacementSession();
    },
  });
  const systemsPanel = new SystemsPanel();
  const commandPalette = new CommandPalette({
    commands: [
      {
        id: 'save-project',
        label: 'Save Project',
        hint: 'Ctrl+S',
        run: () => { void saveCurrentMap(); },
      },
      {
        id: 'build-world',
        label: 'Build World',
        hint: 'Toolbar',
        run: () => { void buildWorld('command-palette'); },
      },
      {
        id: 'export-project',
        label: 'Export Project',
        hint: 'Build package',
        run: () => { void exportCurrentMap(); },
      },
      {
        id: 'import-project',
        label: 'Import Project JSON',
        hint: 'File picker',
        run: () => { void importMapFromJson(); },
      },
      {
        id: 'toggle-editor-play',
        label: 'Toggle Editor/Play',
        hint: 'P',
        run: () => {
          window.dispatchEvent(new CustomEvent('ui:toggle-editor-play'));
        },
      },
      {
        id: 'undo-action',
        label: 'Undo',
        hint: 'Ctrl+Z',
        run: () => applyEditorUndo(),
      },
      {
        id: 'redo-action',
        label: 'Redo',
        hint: 'Ctrl+Y',
        run: () => applyEditorRedo(),
      },
      {
        id: 'gizmo-translate',
        label: 'Gizmo: Move',
        hint: 'Toolbar',
        run: () => Engine.getGizmoSystem()?.setMode('translate'),
      },
      {
        id: 'gizmo-rotate',
        label: 'Gizmo: Rotate',
        hint: 'Toolbar',
        run: () => Engine.getGizmoSystem()?.setMode('rotate'),
      },
      {
        id: 'gizmo-scale',
        label: 'Gizmo: Scale',
        hint: 'Toolbar',
        run: () => Engine.getGizmoSystem()?.setMode('scale'),
      },
      {
        id: 'gizmo-orientation',
        label: 'Gizmo: Toggle World/Local',
        hint: 'Toolbar',
        run: () => Engine.getGizmoSystem()?.toggleOrientationMode(),
      },
      {
        id: 'gizmo-snap',
        label: 'Gizmo: Toggle Snap',
        hint: 'Toolbar',
        run: () => {
          const gizmoSystem = Engine.getGizmoSystem();
          if (!gizmoSystem) return;
          const snapSettings = gizmoSystem.getSnapSettings();
          gizmoSystem.setSnapSettings({ enabled: !snapSettings.enabled });
        },
      },
    ],
  });
  const menuIdentityPanel = options.menuIdentitySystem.getElement();

  dockLayout.setPanel('left', 'Hierarchy', hierarchyPanel.getElement());
  dockLayout.setPanel('right', 'Inspector', inspectorPanel.getElement());
  dockLayout.setPanel('bottom', 'Systems', systemsPanel.getElement());
  dockLayout.setTopbar(topActionBar.getElement());
  topActionBar.mountRight(authAvatarBadge.getElement());

  const compositeAccessoryPanel = document.createElement('div');
  compositeAccessoryPanel.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:10px',
    'height:100%',
    'min-height:0',
  ].join(';');

  menuIdentityPanel.style.flex = '1 1 auto';
  menuIdentityPanel.style.minHeight = '0';
  compositeAccessoryPanel.appendChild(menuIdentityPanel);

  const uiCoordinator = new UICompositionCoordinator({
    registerModeListener: (listener) => {
      options.modeManager?.registerListener(listener);
    },
    shortcuts: {
      undo: () => applyEditorUndo(),
      redo: () => applyEditorRedo(),
    },
    keyboard: {
      isInGame: () => options.engineController.is('in_game'),
      canSwitchModes: () => !options.engineController.is('in_game')
        && !options.engineController.is('starting')
        && !options.engineController.is('post_game'),
      setEngineMode: (mode) => {
        options.engineController.setRuntimeMode(mode, 'ui-keyboard');
      },
      requestPlayPointerCapture: () => {
        Engine.getPlayController()?.beginPlaySessionPointerCapture();
      },
    },
    inGamePanel: {
      client: options.mpClient,
    },
    rendererRebind: options.rendererRebindService ?? undefined,
    mainMenu: {
      onFreeplay: (fromEditor) => options.gameLaunchCoordinator.startLocalFreeplay(fromEditor ?? false),
      onHorde: () => options.gameLaunchCoordinator.startHorde(),
      onDriftBomb: () => options.gameLaunchCoordinator.startDriftBomb(),
      // QuickStart should remain editor-friendly and predictable.
      onQuickStart: () => options.gameLaunchCoordinator.startLocalFreeplay(),
      onStartLevel: (levelId) => options.gameLaunchCoordinator.startScriptedLevel(levelId),
      onExit: () => {
        options.gameLaunchCoordinator.closeSessionToMainMenu();
        if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
          window.location.reload();
        }
      },
      closeSessionForEditorTransition: () => {
        options.gameLaunchCoordinator.closeSessionForEditorTransition();
      },
      restoreEditorWorldFromBuffer: () => {
        return options.worldBuildService?.restoreEditorWorldFromBuffer()
          .then((result) => {
            if (result.success) {
              // Rebuild hierarchy from scratch after restore; onEntityCreated fires before
              // components are attached during deserialization, so a full re-render is required.
              hierarchyPanel.renderRows();
            }
            return result.success;
          })
          .catch((error) => {
            console.error('[RuntimeUIBootstrap] Failed to restore editor world from active buffer', error);
            return false;
          })
          ?? Promise.resolve(false);
      },
      builtInMaps: ['forest_arena', 'map_default'],
      configureEditorFeatures: () => {
        FeatureManager.configure({ debugTools: true });
      },
      stopMusic: () => {
        options.audioManager.stopMusic();
      },
      getHasActiveLevel: () => !!options.worldRuntime.getActiveLevelGroup(),
      buildEditorPreviewLevel: () => options.worldRuntime.buildFlatTestMap('editor_preview'),
      clearActiveLevel: () => options.worldRuntime.clearActiveLevel(),
      buildBuiltInMap: (mapId) => options.worldRuntime.buildMatchLevel(mapId, mapId),
      setActiveLevelGroup: (group) => {
        options.worldRuntime.setActiveLevelGroup(group);
      },
      loadSavedMap: (name) => {
        if (getSavedLevelNames().includes(name)) {
          void runWithLoading(() => {
            if (!loadLevelFromStorage(name)) {
              console.warn(`[RuntimeUiCompositionCoordinator] Failed to load saved level: ${name}`);
            }
          });
          return;
        }

        void runWithLoading(() => {
          Engine.loadMap(name);
        });
      },
      saveMap: (name) => {
        Engine.saveMap(name);
      },
      setEngineMode: (mode) => {
        options.engineController.setRuntimeMode(mode, 'main-menu');
      },
      enableMultiplayerFeature: () => {
        FeatureManager.enable('multiplayer');
      },
      transitionState: (state, reason) => {
        if (state === 'lobby' && reason === 'open_multiplayer') {
          options.multiplayerRuntime.prepareMultiplayerLobby(reason);
        }
        options.multiplayerRuntime.transitionEngineState(state as 'menu' | 'lobby' | 'starting' | 'in_game' | 'post_game', reason);
      },
      getLevels: () => (options.scriptedLevelSystem?.listLevels() ?? []).map((level) => ({
        id: level.id,
        label: level.label,
        description: level.description,
      })),
      getMaps: () => {
        const engineMaps = Engine.listMaps();
        const savedMaps = getSavedLevelNames();
        return Array.from(new Set([...engineMaps, ...savedMaps]));
      },
      getFeatures: () => {
        return (Object.keys(FEATURE_META) as FeatureKey[]).map((key) => ({
          key,
          label: FEATURE_META[key].label,
          enabled: FeatureManager.isEnabled(key),
        }));
      },
      toggleFeature: (key) => {
        FeatureManager.toggle(key as FeatureKey);
      },
      configureFeatures: (config) => {
        FeatureManager.configure(config as Partial<Record<FeatureKey, boolean>>);
        FeatureManager.save();
      },
      getAudioState: () => options.audioManager.getMixerState(),
      adjustAudio: (channel, delta) => {
        options.audioManager.adjustChannelVolume(channel, delta);
      },
      toggleAudioMute: () => {
        options.audioManager.toggleMute();
      },
      playUiSound: (kind) => {
        options.audioManager.playTrigger(kind === 'confirm' ? 'ui_confirm' : 'pickup_ping');
      },
      openDebug: () => {
        options.debugManager.enable();
      },
      onCustomize: () => {
        options.engineController.setRuntimeMode('editor', 'main-menu:customize');
      },
      onCustomizeExit: () => {
      },
      getCurrentMode: () => Engine.getEngineMode(),
      getCurrentGameMode: () => options.engineController.getGameMode(),
      getGameModes: () => options.engineGameModes.listModes().map((id) => {
        const mode = options.engineGameModes.getMode(id);
        return {
          id,
          label: mode?.displayName ?? id.toUpperCase(),
          description: `Internal id: ${id}`,
        };
      }),
      activateGameMode: (modeId) => {
        if (!options.engineGameModes.getMode(modeId)) return;
        options.engineController.setGameMode(modeId, 'main-menu');
        logEvent('engine', `Gamemode set to ${modeId} (menu)`);
        if (options.mpClient.connected) {
          options.mpClient.sendLobbyAction('GAME_MODE_SET', { mode: modeId });
        }
      },
      getIdentityPanel: () => compositeAccessoryPanel,
      log: (message) => {
        console.log(message);
      },
    },
    serverBrowser: {
      httpUrl: options.multiplayerRuntime.getServerHttpUrl(),
      wsUrl: options.multiplayerRuntime.getServerWsUrl(),
      client: options.mpClient,
      getMaps: () => {
        const builtIn = ['forest_arena', 'map_default'];
        const saved = Engine.listMaps().filter((map) => !builtIn.includes(map));
        return [...builtIn, ...saved];
      },
      onClose: () => {
        options.multiplayerRuntime.transitionEngineState('menu', 'server_browser_close');
      },
      onGameStart: (data) => {
        options.multiplayerRuntime.handleGameStart(data);
      },
      onHostGame: ({ playerName, config }) => {
        options.multiplayerRuntime.hostAutostartMultiplayer({
          playerName,
          roomName: config.name,
          map: config.map,
          mode: config.mode,
          killLimit: config.killLimit,
          roundDurationSec: config.roundDurationSec,
          maxPlayers: config.maxPlayers,
          forceStart: false,
        });
      },
      onJoinGame: ({ playerName, roomId }) => {
        options.multiplayerRuntime.joinAutostartMultiplayer({
          playerName,
          roomId,
          autoReady: false,
        });
      },
    },
    dockLayout: {
      setEditorMode: (active: boolean) => {
        dockLayout.setEditorMode(active);
      },
      toggleCommandPalette: () => {
        commandPalette.toggle();
      },
      getViewportLayer: () => dockLayout.getViewportLayer(),
      getViewportBounds: () => dockLayout.getViewportBounds(),
      getSlot: (slot) => dockLayout.getSlot(slot as any),
      destroy: () => {
        while (cleanupFns.length > 0) {
          cleanupFns.pop()?.();
        }
        clearRecoverySnapshotTimer();
        if (typeof window !== 'undefined') {
          window.removeEventListener('beforeunload', handleBeforeUnload, true);
        }
        themeManager.destroy();
        commandPalette.destroy();
        inspectorPanel.destroy();
        systemsPanel.destroy();
        hierarchyPanel.destroy();
        topActionBar.destroy();
        authAvatarBadge.destroy();
        dockLayout.destroy();
      },
    },
  });

  void editorSyncBackListener;
  return uiCoordinator;
}
