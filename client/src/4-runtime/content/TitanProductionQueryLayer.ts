import type { Vector3 } from '@engine/1-kernel/core/public-api';
import type {
  BiomeRegionDefinition,
  MaterialLayerDefinition,
  ProductionLifecyclePhase,
  WorldBounds2D,
  WorldEventGraphRuntimeState,
  WorldProductionBundle,
  WorldProductionGeneratedState,
  WorldProductionReplayJournal,
  WorldProductionTransientState,
} from '@shared/contracts';

interface TitanProductionQuerySnapshot {
  authoredBundles: WorldProductionBundle[];
  generatedState: WorldProductionGeneratedState;
  runtimeState: WorldProductionTransientState;
  biomeIndex: Map<string, BiomeRegionDefinition>;
}

export interface TitanWorldProductionQueries {
  resolveBiomeAtPosition(position: Vector3 | null): BiomeRegionDefinition | null;
  getGraphState(graphId: string): WorldEventGraphRuntimeState | null;
  getChunkOwner(cellId: string): string | null;
  getLifecyclePhase(scopeId: string): ProductionLifecyclePhase | null;
  getMaterialLayers(activeBiomeId?: string | null): MaterialLayerDefinition[];
  listBundleIds(): string[];
  getReplayJournal(): WorldProductionReplayJournal;
}

export class TitanProductionQueryLayer implements TitanWorldProductionQueries {
  constructor(private readonly readSnapshot: () => TitanProductionQuerySnapshot) {}

  resolveBiomeAtPosition(position: Vector3 | null): BiomeRegionDefinition | null {
    const snapshot = this.readSnapshot();
    if (!position) {
      const activeBiomeId = snapshot.runtimeState.activeBiomeId;
      return activeBiomeId ? clonePlain(snapshot.biomeIndex.get(activeBiomeId) ?? null) : null;
    }

    for (const biome of snapshot.biomeIndex.values()) {
      if (biome.bounds && pointInBounds(position, biome.bounds)) {
        return clonePlain(biome);
      }
    }

    for (const bundle of snapshot.authoredBundles) {
      const defaultBiomeId = bundle.proceduralWorld?.defaultBiomeId;
      if (defaultBiomeId && snapshot.biomeIndex.has(defaultBiomeId)) {
        return clonePlain(snapshot.biomeIndex.get(defaultBiomeId) ?? null);
      }
    }

    return null;
  }

  getGraphState(graphId: string): WorldEventGraphRuntimeState | null {
    return clonePlain(this.readSnapshot().generatedState.graphStates[graphId] ?? null);
  }

  getChunkOwner(cellId: string): string | null {
    return this.readSnapshot().generatedState.chunkOwnership[cellId] ?? null;
  }

  getLifecyclePhase(scopeId: string): ProductionLifecyclePhase | null {
    return this.readSnapshot().runtimeState.lifecyclePhases?.[scopeId] ?? null;
  }

  getMaterialLayers(activeBiomeId?: string | null): MaterialLayerDefinition[] {
    const snapshot = this.readSnapshot();
    const resolvedBiomeId = activeBiomeId ?? snapshot.runtimeState.activeBiomeId;
    const layers: MaterialLayerDefinition[] = [];
    for (const bundle of snapshot.authoredBundles) {
      for (const layer of bundle.materialLayers ?? []) {
        if (!layer.biomeIds || !resolvedBiomeId || layer.biomeIds.includes(resolvedBiomeId)) {
          layers.push(clonePlain(layer));
        }
      }
      const biome = resolvedBiomeId ? (bundle.biomeRegions ?? []).find((entry) => entry.id === resolvedBiomeId) : undefined;
      const profileId = biome?.atmosphere?.materialProfileId;
      if (profileId && resolvedBiomeId) {
        layers.push({ id: `${resolvedBiomeId}:atmosphere`, profileId });
      }
    }
    return layers;
  }

  listBundleIds(): string[] {
    return [...this.readSnapshot().generatedState.loadedBundleIds].sort();
  }

  getReplayJournal(): WorldProductionReplayJournal {
    return clonePlain(this.readSnapshot().generatedState.replayJournal);
  }
}

function pointInBounds(position: Vector3, bounds: WorldBounds2D): boolean {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

function clonePlain<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}