import type { EventBus } from '@engine/1-kernel/core/public-api';
import type { GameEvents, SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type {
  AnimationComponentData,
  DEFAULT_2D_ATLAS_ID,
  Input2DComponentData,
  Physics2DBodyData,
  SpriteComponentData,
  TilemapComponentData,
  UIPrefabData,
  SpritePrefabData,
  TilemapPrefabData,
} from '../../../../4-runtime/ui/2d/TwoDTypes';

interface TwoDPrefabDefinition {
  name: string;
  entityType: string;
  networked?: boolean;
  sprite2d?: SpritePrefabData;
  animation2d?: AnimationComponentData;
  tilemap2d?: TilemapPrefabData;
  ui2d?: UIPrefabData;
  physics2d?: Partial<Physics2DBodyData>;
  input2d?: Partial<Input2DComponentData>;
}

type PrefabSystemAdapter = {
  registerPrefab(name: string, definition: Record<string, unknown>): void;
};

type AtlasLookup = {
  getAtlas(id: string): { frames: Record<string, unknown> } | null;
};

export class SpritePrefabExtension {
  private systemContext: SystemContext | null = null;
  private builtinsRegistered = false;

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.builtinsRegistered) {
      this.registerBuiltinPrefabs();
      this.builtinsRegistered = true;
    }
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
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        builtinsRegistered: this.builtinsRegistered,
      },
    };
  }

  validatePrefab(prefab: TwoDPrefabDefinition): string[] {
    const issues: string[] = [];
    const atlasLookup = this.systemContext?.systems.spriteAtlasSystem as AtlasLookup | undefined;
    if (prefab.sprite2d) {
      if (!atlasLookup?.getAtlas(prefab.sprite2d.atlasId)) {
        issues.push(`Missing 2D atlas: ${prefab.sprite2d.atlasId}`);
      }
      if (!prefab.sprite2d.frame) {
        issues.push('sprite2d.frame is required');
      }
    }
    if (prefab.entityType === 'tilemap' && (!prefab.tilemap2d || prefab.tilemap2d.layers.length === 0)) {
      issues.push('tilemap prefab requires tilemap2d layers');
    }
    if (prefab.entityType === 'ui' && !prefab.ui2d) {
      issues.push('ui prefab requires ui2d definition');
    }
    return issues;
  }

  build2DComponents(prefab: TwoDPrefabDefinition): { components: Array<{ name: string; data: Record<string, unknown> }>; skipDefaultRender: boolean } {
    const components: Array<{ name: string; data: Record<string, unknown> }> = [];
    if (prefab.sprite2d) {
      components.push({ name: 'sprite', data: { layer: 'entities2D', width: 1.6, height: 1.6, tint: 0xffffff, ...prefab.sprite2d } });
    }
    if (prefab.animation2d) {
      components.push({ name: 'animation2d', data: { ...prefab.animation2d } });
    }
    if (prefab.tilemap2d) {
      components.push({ name: 'tilemap', data: { visible: true, ...prefab.tilemap2d } as Record<string, unknown> });
    }
    if (prefab.ui2d) {
      components.push({ name: 'ui2d', data: { ...prefab.ui2d } });
    }
    if (prefab.physics2d) {
      components.push({ name: 'physics2d', data: { dynamic: true, solid: true, width: 1, height: 1, ...prefab.physics2d } as Record<string, unknown> });
    }
    if (prefab.input2d) {
      components.push({ name: 'input2d', data: { enabled: true, ...prefab.input2d } as Record<string, unknown> });
    }
    return { components, skipDefaultRender: true };
  }

  private registerBuiltinPrefabs(): void {
    const prefabSystem = this.systemContext?.systems.prefabSystem as PrefabSystemAdapter | undefined;
    if (!prefabSystem) return;
    const eventBus: EventBus<GameEvents> | undefined = this.systemContext?.eventBus;

    prefabSystem.registerPrefab('corridor_2d_test_tilemap', {
      name: 'corridor_2d_test_tilemap',
      entityType: 'tilemap',
      networked: false,
      tilemap2d: {
        layers: [
          {
            id: 'ground',
            atlasId: 'corridor_2d_demo',
            width: 24,
            height: 14,
            tileSize: 1.5,
            renderLayer: 'background',
            solidFrames: ['tile_stone'],
            tiles: Array.from({ length: 24 * 14 }, (_value, index) => {
              const x = index % 24;
              const y = Math.floor(index / 24);
              if (y === 0 || y === 13 || x === 0 || x === 23) return 'tile_stone';
              if (y > 9 && x > 10 && x < 16) return 'tile_water';
              return 'tile_grass';
            }),
          },
        ],
      },
    });

    prefabSystem.registerPrefab('corridor_2d_test_ui', {
      name: 'corridor_2d_test_ui',
      entityType: 'ui',
      networked: false,
      ui2d: {
        kind: 'label',
        text: '2D Corridor Test Layer',
        x: 18,
        y: 78,
        color: '#ffffff',
      },
    });

    eventBus?.emit('stateMutation', {
      source: 'SpritePrefabExtension',
      paths: ['prefab:corridor_2d_test_tilemap', 'prefab:corridor_2d_test_ui'],
      changedCount: 2,
    });
  }
}
