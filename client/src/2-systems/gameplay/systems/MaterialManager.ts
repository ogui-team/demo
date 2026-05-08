import * as THREE from 'three';
import { createPS1Material } from '../../../0-foundation/foundation/Utils';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

export interface ShaderReference {
  id: string;
  label: string;
  stage: 'vertex' | 'fragment' | 'combined';
  description: string;
  source: string;
}

export interface MaterialProfile {
  id: string;
  label: string;
  color: number;
  emissive?: number;
  roughness?: number;
  metalness?: number;
}

export interface TerrainSplatLayer {
  texture?: THREE.Texture;
  fallbackColor?: number;
  uvScale?: number;
}

export interface TerrainSplatConfig {
  blendMap?: THREE.Texture;
  layers?: TerrainSplatLayer[];
  tint?: number;
}

const DEFAULT_SPLAT_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DEFAULT_SPLAT_FRAG = /* glsl */`
  precision mediump float;

  varying vec2 vUv;
  varying vec3 vNormal;

  uniform sampler2D uBlendMap;
  uniform sampler2D uLayer0;
  uniform sampler2D uLayer1;
  uniform sampler2D uLayer2;
  uniform sampler2D uLayer3;
  uniform float uScale0;
  uniform float uScale1;
  uniform float uScale2;
  uniform float uScale3;
  uniform vec3 uTint;

  vec3 sampleLayer(sampler2D tex, vec2 uv, float scale) {
    return texture2D(tex, uv * scale).rgb;
  }

  void main() {
    vec4 weights = texture2D(uBlendMap, vUv);
    float total = weights.r + weights.g + weights.b + weights.a;
    if (total < 0.001) {
      weights = vec4(1.0, 0.0, 0.0, 0.0);
      total = 1.0;
    }
    weights /= total;

    vec3 c0 = sampleLayer(uLayer0, vUv, uScale0);
    vec3 c1 = sampleLayer(uLayer1, vUv, uScale1);
    vec3 c2 = sampleLayer(uLayer2, vUv, uScale2);
    vec3 c3 = sampleLayer(uLayer3, vUv, uScale3);

    vec3 color = c0 * weights.r + c1 * weights.g + c2 * weights.b + c3 * weights.a;
    vec3 lightDir = normalize(vec3(0.35, 1.0, 0.45));
    float diffuse = max(dot(normalize(vNormal), lightDir), 0.0) * 0.55 + 0.45;

    gl_FragColor = vec4(color * uTint * diffuse, 1.0);
  }
`;

export const MATERIAL_SHADER_REFERENCES: ShaderReference[] = [
  {
    id: 'terrain-splat',
    label: 'Terrain Splat Shader',
    stage: 'combined',
    description: 'Four-way splat blending for bunker floors, dirt, moss, and worn paths.',
    source: `${DEFAULT_SPLAT_VERT}\n\n${DEFAULT_SPLAT_FRAG}`,
  },
  {
    id: 'ps1-jitter',
    label: 'PS1 Vertex Jitter',
    stage: 'vertex',
    description: 'Reference existing PS1ShaderSystem.makeJitterMaterial for low-precision wobble.',
    source: 'See engine/systems/PS1ShaderSystem.ts :: makeJitterMaterial()',
  },
];

export const MATERIAL_PROFILES: Record<string, MaterialProfile> = {
  bunkerFloor: { id: 'bunkerFloor', label: 'Bunker Floor', color: 0x4a4438, roughness: 0.95, metalness: 0.05 },
  corrodedSteel: { id: 'corrodedSteel', label: 'Corroded Steel', color: 0x746554, emissive: 0x110d08, roughness: 0.8, metalness: 0.35 },
  toxicAccent: { id: 'toxicAccent', label: 'Toxic Accent', color: 0x8cbf2f, emissive: 0x203b08, roughness: 0.7, metalness: 0.05 },
  pineNeedle: { id: 'pineNeedle', label: 'Pine Needle', color: 0x365a2b, roughness: 1.0, metalness: 0.0 },
};

function createSolidTexture(hex: number): THREE.DataTexture {
  const color = new THREE.Color(hex);
  const data = new Uint8Array([
    Math.round(color.r * 255),
    Math.round(color.g * 255),
    Math.round(color.b * 255),
    255,
  ]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function createBlendFallback(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export class MaterialManager {
  private textures = new Map<string, THREE.Texture>();
  private terrainMaterials = new Map<string, THREE.ShaderMaterial>();
  private systemContext: SystemContext | null = null;

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
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
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        textureCount: this.textures.size,
        cachedTerrainMaterialCount: this.terrainMaterials.size,
        shaderReferenceCount: MATERIAL_SHADER_REFERENCES.length,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  registerTexture(id: string, texture: THREE.Texture): void {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.textures.set(id, texture);
    gameBus.emit('stateMutation', {
      source: 'materialManager',
      path: `materials.textures.${id}`,
      changedCount: 1,
    });
  }

  getShaderReferences(): ShaderReference[] {
    return [...MATERIAL_SHADER_REFERENCES];
  }

  createSurfaceMaterial(profileId: keyof typeof MATERIAL_PROFILES | string, overrides: Partial<MaterialProfile> = {}): THREE.MeshStandardMaterial {
    const base = MATERIAL_PROFILES[profileId] ?? MATERIAL_PROFILES.bunkerFloor;
    const profile = { ...base, ...overrides };
    const material = createPS1Material(profile.color, {
      roughness: profile.roughness ?? 0.9,
      metalness: profile.metalness ?? 0.05,
      flatShading: true,
    });
    if (profile.emissive !== undefined) {
      material.emissive = new THREE.Color(profile.emissive);
    }
    return material;
  }

  createTerrainSplatMaterial(config: TerrainSplatConfig = {}): THREE.ShaderMaterial {
    const key = JSON.stringify({
      tint: config.tint ?? 0xffffff,
      layers: (config.layers ?? []).map((layer) => ({
        color: layer.fallbackColor ?? 0xffffff,
        uvScale: layer.uvScale ?? 1,
      })),
    });

    const cached = this.terrainMaterials.get(key);
    if (cached) return cached.clone();

    const layers = [0, 1, 2, 3].map((index) => config.layers?.[index]);
    const tint = new THREE.Color(config.tint ?? 0xffffff);

    const material = new THREE.ShaderMaterial({
      vertexShader: DEFAULT_SPLAT_VERT,
      fragmentShader: DEFAULT_SPLAT_FRAG,
      uniforms: {
        uBlendMap: { value: config.blendMap ?? createBlendFallback() },
        uLayer0: { value: layers[0]?.texture ?? createSolidTexture(layers[0]?.fallbackColor ?? 0x5c503e) },
        uLayer1: { value: layers[1]?.texture ?? createSolidTexture(layers[1]?.fallbackColor ?? 0x7f6d49) },
        uLayer2: { value: layers[2]?.texture ?? createSolidTexture(layers[2]?.fallbackColor ?? 0x3a5226) },
        uLayer3: { value: layers[3]?.texture ?? createSolidTexture(layers[3]?.fallbackColor ?? 0x252525) },
        uScale0: { value: layers[0]?.uvScale ?? 4 },
        uScale1: { value: layers[1]?.uvScale ?? 6 },
        uScale2: { value: layers[2]?.uvScale ?? 8 },
        uScale3: { value: layers[3]?.uvScale ?? 10 },
        uTint: { value: tint },
      },
      lights: false,
    });

    this.terrainMaterials.set(key, material);
    return material.clone();
  }

  applyProfile(target: THREE.Object3D, profileId: keyof typeof MATERIAL_PROFILES | string): void {
    const profile = MATERIAL_PROFILES[profileId] ?? MATERIAL_PROFILES.bunkerFloor;
    target.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const next = this.createSurfaceMaterial(profile.id, profile);
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(() => next.clone());
      } else {
        obj.material = next;
      }
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    gameBus.emit('stateMutation', {
      source: 'materialManager',
      path: `materials.profiles.${profileId}`,
      changedCount: 1,
    });
  }

  buildExampleUsage(): { terrain: THREE.ShaderMaterial; prop: THREE.MeshStandardMaterial } {
    return {
      terrain: this.createTerrainSplatMaterial({
        tint: 0xd6ccb0,
        layers: [
          { fallbackColor: 0x605647, uvScale: 3 },
          { fallbackColor: 0x7b6f4d, uvScale: 5 },
          { fallbackColor: 0x42592e, uvScale: 7 },
          { fallbackColor: 0x232323, uvScale: 11 },
        ],
      }),
      prop: this.createSurfaceMaterial('corrodedSteel'),
    };
  }

  dispose(): void {
    for (const material of this.terrainMaterials.values()) {
      material.dispose();
    }
    this.terrainMaterials.clear();
    this.textures.clear();
  }
}