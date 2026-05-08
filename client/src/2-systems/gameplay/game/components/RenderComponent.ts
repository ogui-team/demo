/**
 * RenderComponent
 * Describes the visual representation of an EngineObject.
 * The renderer reads this to build or update the Three.js mesh.
 */

export type MeshType = 'box' | 'sphere' | 'cylinder' | 'plane' | 'capsule' | 'cone' | 'custom';

export interface RenderGeometry {
  // box
  width?: number;
  height?: number;
  depth?: number;
  // sphere
  radius?: number;
  segments?: number;
  // cylinder / capsule / cone
  radiusTop?: number;
  radiusBottom?: number;
  radialSegments?: number;
  // plane
  widthSegments?: number;
  heightSegments?: number;
  // custom (GLTF url or AssetLoader key)
  assetKey?: string;
}

export interface RenderComponent {
  readonly type: 'render';
  meshType: MeshType;
  color: number;          // 0xRRGGBB
  emissive?: number;
  opacity?: number;
  transparent?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  flatShading?: boolean;
  wireframe?: boolean;
  geometry: RenderGeometry;
}

export function createRenderComponent(
  meshType: MeshType = 'box',
  color = 0xffffff,
  geometry: RenderGeometry = {},
  overrides: Partial<Omit<RenderComponent, 'type' | 'meshType' | 'color' | 'geometry'>> = {},
): RenderComponent {
  return {
    type: 'render',
    meshType,
    color,
    geometry,
    castShadow: true,
    receiveShadow: true,
    flatShading: true,
    ...overrides,
  };
}
