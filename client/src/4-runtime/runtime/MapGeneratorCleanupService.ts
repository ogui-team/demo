import type { Entity } from '../../1-kernel/core/Entity';

export type MapGeneratorCleanupLayer = 'static-world-bounds' | 'generated-collision-hull';

export const MAP_GENERATOR_CLEANUP_COMPONENT = 'mapGeneratorCleanup';

interface EntityManagerAdapter {
  getEntities(): Entity[];
  destroyEntity(idOrEntity: string | Entity): boolean;
}

interface WorldObjectAuthorityCleanupAdapter {
  removeByCleanupLayer(layers: MapGeneratorCleanupLayer[]): string[];
  countByCleanupLayer(layers: MapGeneratorCleanupLayer[]): number;
}

interface MapGeneratorCleanupServiceConfig {
  getEntityManager: () => EntityManagerAdapter | null;
  worldObjectAuthorityService: WorldObjectAuthorityCleanupAdapter;
}

export class MapGeneratorCleanupService {
  private readonly getEntityManager: () => EntityManagerAdapter | null;
  private readonly worldObjectAuthorityService: WorldObjectAuthorityCleanupAdapter;

  constructor(config: MapGeneratorCleanupServiceConfig) {
    this.getEntityManager = config.getEntityManager;
    this.worldObjectAuthorityService = config.worldObjectAuthorityService;
  }

  tagEntity(entity: Entity, layer: MapGeneratorCleanupLayer): void {
    entity.addComponent({
      name: MAP_GENERATOR_CLEANUP_COMPONENT,
      data: {
        layer,
        generated: true,
      },
    });
  }

  cleanupRuntimeArtifacts(reason = 'runtime_reset'): {
    removedEntities: number;
    removedWorldObjects: number;
    orphanedRemaining: number;
  } {
    const layers: MapGeneratorCleanupLayer[] = ['static-world-bounds', 'generated-collision-hull'];
    const entityManager = this.getEntityManager();
    let removedEntities = 0;

    if (entityManager) {
      const entities = [...entityManager.getEntities()];
      for (const entity of entities) {
        const cleanupLayer = entity.getComponent(MAP_GENERATOR_CLEANUP_COMPONENT)?.data?.layer;
        if (cleanupLayer !== 'static-world-bounds' && cleanupLayer !== 'generated-collision-hull') {
          continue;
        }
        if (entityManager.destroyEntity(entity.id)) {
          removedEntities += 1;
        }
      }
    }

    const removedWorldObjects = this.worldObjectAuthorityService.removeByCleanupLayer(layers).length;
    const orphanedRemaining = this.countOrphanedArtifacts(layers);

    console.log('[MapGeneratorCleanupService] Cleanup completed', {
      reason,
      removedEntities,
      removedWorldObjects,
      orphanedRemaining,
    });

    return {
      removedEntities,
      removedWorldObjects,
      orphanedRemaining,
    };
  }

  countOrphanedArtifacts(layers: MapGeneratorCleanupLayer[] = ['static-world-bounds', 'generated-collision-hull']): number {
    const entityManager = this.getEntityManager();
    let taggedEntities = 0;

    if (entityManager) {
      for (const entity of entityManager.getEntities()) {
        const cleanupLayer = entity.getComponent(MAP_GENERATOR_CLEANUP_COMPONENT)?.data?.layer;
        if (layers.includes(cleanupLayer)) {
          taggedEntities += 1;
        }
      }
    }

    return taggedEntities + this.worldObjectAuthorityService.countByCleanupLayer(layers);
  }
}