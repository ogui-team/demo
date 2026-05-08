import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { VFXMaker, VFX_PRESETS } from '../systems/VFXMaker';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface ScriptedLevelPrefabAdapter {
  create(prefabName: string, position: LevelVec3, options?: { rotation?: LevelVec3; scale?: LevelVec3 }): { id: string };
  remove(entityId: string): void;
}

interface ScriptedLevelMaterialAdapter {
  createTerrainSplatMaterial(config: Record<string, unknown>): THREE.Material;
  createSurfaceMaterial(profile: string): THREE.Material;
}

interface ScriptedLevelAudioAdapter {
  playMusic(trackId: string): void;
}

export interface LevelVec3 {
  x: number;
  y: number;
  z: number;
}

export interface LevelPrimitive {
  id: string;
  kind: 'plane' | 'box' | 'cylinder';
  position: LevelVec3;
  rotation?: LevelVec3;
  size: {
    width?: number;
    height?: number;
    depth?: number;
    radiusTop?: number;
    radiusBottom?: number;
  };
  materialProfile?: string;
  useTerrainSplat?: boolean;
}

export interface LevelPrefabPlacement {
  id: string;
  prefab: string;
  position: LevelVec3;
  rotation?: LevelVec3;
  scale?: LevelVec3;
}

export interface LevelAmbientVfx {
  id: string;
  preset: keyof typeof VFX_PRESETS;
  position: LevelVec3;
}

export interface LevelScriptAction {
  type: 'playMusic' | 'triggerBurst' | 'setFog';
  trackId?: string;
  preset?: keyof typeof VFX_PRESETS;
  position?: LevelVec3;
  density?: number;
  color?: number;
}

export interface LevelDefinition {
  id: string;
  name: string;
  description: string;
  playerSpawn: LevelVec3;
  spawnPoints?: LevelVec3[];
  environment?: {
    fogDensity?: number;
    fogColor?: number;
    pipelineColorBits?: number;
  };
  primitives: LevelPrimitive[];
  prefabs: LevelPrefabPlacement[];
  ambientVfx?: LevelAmbientVfx[];
  scripts?: LevelScriptAction[];
}

export interface LevelSummary {
  id: string;
  label: string;
  description: string;
  playerSpawn: LevelVec3;
  spawnPoints: LevelVec3[];
}

export class ScriptedLevelSystem {
  private readonly scene: THREE.Scene;
  private prefabSystem: ScriptedLevelPrefabAdapter;
  private materialManager: ScriptedLevelMaterialAdapter;
  private readonly vfxMaker: VFXMaker;
  private audioManager: ScriptedLevelAudioAdapter;

  private levels = new Map<string, LevelDefinition>();
  private currentRoot: THREE.Group | null = null;
  private currentPrefabIds: string[] = [];
  private currentEmitterIds: string[] = [];
  private currentLevelId: string | null = null;
  private systemContext: SystemContext | null = null;

  constructor(config: {
    scene: THREE.Scene;
    prefabSystem: ScriptedLevelPrefabAdapter;
    materialManager: ScriptedLevelMaterialAdapter;
    vfxMaker: VFXMaker;
    audioManager: ScriptedLevelAudioAdapter;
  }) {
    this.scene = config.scene;
    this.prefabSystem = config.prefabSystem;
    this.materialManager = config.materialManager;
    this.vfxMaker = config.vfxMaker;
    this.audioManager = config.audioManager;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    const prefabSystem = ctx.systems.prefabSystem as ScriptedLevelPrefabAdapter | null | undefined;
    if (prefabSystem) {
      this.prefabSystem = prefabSystem;
    }
    const materialManager = ctx.systems.materialManager as ScriptedLevelMaterialAdapter | null | undefined;
    if (materialManager) {
      this.materialManager = materialManager;
    }
    const audioManager = (ctx.systems.gameAudioManager as ScriptedLevelAudioAdapter | null | undefined)
      ?? (ctx.systems.audioManager as ScriptedLevelAudioAdapter | null | undefined);
    if (audioManager) {
      this.audioManager = audioManager;
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
      usesSystemContext: true,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.currentLevelId ? 'active' : 'idle',
      active: this.currentLevelId !== null,
      metrics: {
        levelCount: this.levels.size,
        currentLevelId: this.currentLevelId,
        prefabCount: this.currentPrefabIds.length,
        emitterCount: this.currentEmitterIds.length,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  registerLevel(level: LevelDefinition): void {
    this.levels.set(level.id, level);
    gameBus.emit('stateMutation', {
      source: 'scriptedLevelSystem',
      path: `scriptedLevels.${level.id}`,
      changedCount: 1,
    });
  }

  registerLevels(levels: LevelDefinition[]): void {
    for (const level of levels) this.registerLevel(level);
  }

  listLevels(): LevelSummary[] {
    return [...this.levels.values()].map((level) => ({
      id: level.id,
      label: level.name,
      description: level.description,
      playerSpawn: level.playerSpawn,
      spawnPoints: level.spawnPoints ?? [level.playerSpawn],
    }));
  }

  getLevel(id: string): LevelDefinition | null {
    return this.levels.get(id) ?? null;
  }

  buildLevel(id: string): THREE.Group {
    const level = this.levels.get(id);
    if (!level) {
      throw new Error(`Unknown scripted level: ${id}`);
    }

    this.unloadCurrent();

    const root = new THREE.Group();
    root.name = `scripted_level_${id}`;
    root.userData.isLevelGeometry = true;

    for (const primitive of level.primitives) {
      root.add(this._buildPrimitive(primitive));
    }

    this.scene.add(root);
    this.currentRoot = root;
    this.currentLevelId = id;

    for (const placement of level.prefabs) {
      const entity = this.prefabSystem.create(placement.prefab, placement.position, {
        rotation: placement.rotation,
        scale: placement.scale,
      });
      this.currentPrefabIds.push(entity.id);
    }

    for (const cue of level.ambientVfx ?? []) {
      const emitterId = `${id}_${cue.id}`;
      this.vfxMaker.triggerPreset(emitterId, cue.preset, cue.position);
      this.currentEmitterIds.push(emitterId);
    }

    this._applyEnvironment(level);
    this._runScripts(level);
    gameBus.emit('stateMutation', {
      source: 'scriptedLevelSystem',
      path: 'scriptedLevels.currentLevelId',
      changedCount: 1,
    });
    return root;
  }

  unloadCurrent(): void {
    const hadLevel = this.currentLevelId !== null;
    if (this.currentRoot) {
      this.scene.remove(this.currentRoot);
      this.currentRoot.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((material) => material.dispose());
        } else {
          obj.material.dispose();
        }
      });
      this.currentRoot = null;
    }

    for (const entityId of this.currentPrefabIds) {
      this.prefabSystem.remove(entityId);
    }
    this.currentPrefabIds = [];

    for (const emitterId of this.currentEmitterIds) {
      this.vfxMaker.removeEmitter(emitterId);
    }
    this.currentEmitterIds = [];
    this.currentLevelId = null;
    if (hadLevel) {
      gameBus.emit('stateMutation', {
        source: 'scriptedLevelSystem',
        path: 'scriptedLevels.currentLevelId',
        changedCount: 1,
      });
    }
  }

  getCurrentLevelId(): string | null {
    return this.currentLevelId;
  }

  private _applyEnvironment(level: LevelDefinition): void {
    if (level.environment?.fogDensity !== undefined) {
      Engine.setEngineFogDensity(level.environment.fogDensity);
    }
    if (level.environment?.fogColor !== undefined) {
      Engine.setEngineFogColor(level.environment.fogColor);
    }
    if (level.environment?.pipelineColorBits !== undefined) {
      Engine.setEnginePipelineColorBits(level.environment.pipelineColorBits);
    }
  }

  private _runScripts(level: LevelDefinition): void {
    for (const action of level.scripts ?? []) {
      if (action.type === 'playMusic' && action.trackId) {
        this.audioManager.playMusic(action.trackId);
      }
      if (action.type === 'triggerBurst' && action.preset && action.position) {
        this.vfxMaker.triggerPreset(`${level.id}_script_${action.preset}_${Math.random().toString(36).slice(2, 7)}`, action.preset, action.position);
      }
      if (action.type === 'setFog') {
        if (action.density !== undefined) Engine.setEngineFogDensity(action.density);
        if (action.color !== undefined) Engine.setEngineFogColor(action.color);
      }
    }
  }

  private _buildPrimitive(primitive: LevelPrimitive): THREE.Mesh {
    const geometry = this._createGeometry(primitive);
    const material = primitive.useTerrainSplat
      ? this.materialManager.createTerrainSplatMaterial({
          layers: [
            { fallbackColor: 0x5f5747, uvScale: 4 },
            { fallbackColor: 0x7c724d, uvScale: 6 },
            { fallbackColor: 0x3c5128, uvScale: 8 },
            { fallbackColor: 0x242424, uvScale: 10 },
          ],
        })
      : this.materialManager.createSurfaceMaterial(primitive.materialProfile ?? 'bunkerFloor');

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
    mesh.rotation.set(primitive.rotation?.x ?? 0, primitive.rotation?.y ?? 0, primitive.rotation?.z ?? 0);
    mesh.receiveShadow = true;
    mesh.castShadow = primitive.kind !== 'plane';
    mesh.userData.isLevelGeometry = true;
    return mesh;
  }

  private _createGeometry(primitive: LevelPrimitive): THREE.BufferGeometry {
    if (primitive.kind === 'plane') {
      return new THREE.PlaneGeometry(primitive.size.width ?? 24, primitive.size.depth ?? 24, 4, 4);
    }
    if (primitive.kind === 'cylinder') {
      return new THREE.CylinderGeometry(
        primitive.size.radiusTop ?? 0.6,
        primitive.size.radiusBottom ?? primitive.size.radiusTop ?? 0.6,
        primitive.size.height ?? 2,
        12,
      );
    }
    return new THREE.BoxGeometry(
      primitive.size.width ?? 1,
      primitive.size.height ?? 1,
      primitive.size.depth ?? 1,
    );
  }
}