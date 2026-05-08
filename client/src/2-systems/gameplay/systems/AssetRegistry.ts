import * as THREE from 'three';
import * as AssetLoader from './AssetLoader';

export interface RegisteredAssetInfo {
  key: string;
  source: 'template' | 'loader';
  variants?: number;
}

export type RuntimeAssetType = 'model' | 'texture' | 'material' | 'audio' | 'prefab' | 'world' | 'chunk';

export interface RuntimeAssetRegistration {
  id: string;
  type: RuntimeAssetType;
  path?: string;
  data?: unknown;
  loader?: () => Promise<unknown>;
  metadata?: Record<string, unknown>;
}

export interface RuntimeAssetRecord {
  id: string;
  type: RuntimeAssetType;
  path: string | null;
  loaded: boolean;
  metadata: Record<string, unknown>;
}

type TemplateFactory = () => THREE.Object3D;

export interface AssetTemplateOptions {
  lods?: Array<{ distance: number; factory: TemplateFactory }>;
  drawDistance?: number;
  ps1Style?: boolean;
}

interface TemplateEntry {
  key: string;
  factory: TemplateFactory;
  template?: THREE.Object3D;
  options?: AssetTemplateOptions;
}

interface RuntimeAssetEntry {
  id: string;
  type: RuntimeAssetType;
  path: string | null;
  data?: unknown;
  loader?: () => Promise<unknown>;
  pending?: Promise<unknown>;
  metadata: Record<string, unknown>;
}

const templates = new Map<string, TemplateEntry>();
const runtimeAssets = new Map<string, RuntimeAssetEntry>();

function getDefaultAssetPath(key: string, type: RuntimeAssetType): string {
  switch (type) {
    case 'model':
      return `/assets/models/${key}`;
    case 'texture':
      return `/assets/textures/${key}`;
    case 'material':
      return `/assets/materials/${key}`;
    case 'audio':
      return `/assets/audio/${key}`;
    case 'prefab':
      return `/assets/prefabs/${key}.prefab`;
    case 'world':
      return `/assets/worlds/${key}.titanworld`;
    case 'chunk':
      return `/assets/worlds/${key}.titanchunk`;
    default:
      return `/${type}/${key}`;
  }
}

function ensureRuntimeAssetEntry(registration: RuntimeAssetRegistration): RuntimeAssetEntry {
  const existing = runtimeAssets.get(registration.id);
  if (existing) {
    if (existing.type !== registration.type) {
      throw new Error(`Asset '${registration.id}' is already registered as '${existing.type}'.`);
    }
    if (registration.path && existing.path && existing.path !== registration.path) {
      throw new Error(`Asset '${registration.id}' is already registered for '${existing.path}'.`);
    }
    existing.path = registration.path ?? existing.path;
    if (registration.data !== undefined) {
      existing.data = registration.data;
    }
    if (registration.loader) {
      existing.loader = registration.loader;
    }
    if (registration.metadata) {
      existing.metadata = { ...existing.metadata, ...registration.metadata };
    }
    return existing;
  }

  const created: RuntimeAssetEntry = {
    id: registration.id,
    type: registration.type,
    path: registration.path ?? getDefaultAssetPath(registration.id, registration.type),
    data: registration.data,
    loader: registration.loader,
    metadata: { ...(registration.metadata ?? {}) },
  };
  runtimeAssets.set(created.id, created);
  return created;
}

function cloneWithMarkers(root: THREE.Object3D, key: string): THREE.Object3D {
  const instance = root.clone(true);
  instance.userData.assetRegistryKey = key;
  instance.userData.sharedAssetInstance = true;

  instance.traverse((obj) => {
    obj.userData.assetRegistryKey = key;
    obj.userData.sharedAssetInstance = true;
    if (obj instanceof THREE.Mesh) {
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map((material) => material.clone());
      } else {
        obj.material = obj.material.clone();
      }
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return instance;
}

function resolveTemplate(key: string): THREE.Object3D | undefined {
  const templateEntry = templates.get(key);
  if (templateEntry) {
    if (!templateEntry.template) {
      templateEntry.template = templateEntry.options?.lods?.length
        ? createLODTemplate(templateEntry)
        : templateEntry.factory();
      templateEntry.template.userData.assetRegistryKey = key;
      templateEntry.template.userData.sharedAssetTemplate = true;
      templateEntry.template.userData.drawDistance = templateEntry.options?.drawDistance ?? null;
      templateEntry.template.userData.ps1Style = templateEntry.options?.ps1Style ?? true;
    }
    return templateEntry.template;
  }

  const loaded = AssetLoader.get<any>(key);
  if (!loaded) return undefined;
  if (loaded instanceof THREE.Object3D) return loaded;
  if (loaded.scene instanceof THREE.Object3D) return loaded.scene as THREE.Object3D;
  return undefined;
}

function createLODTemplate(entry: TemplateEntry): THREE.Object3D {
  const lod = new THREE.LOD();
  lod.addLevel(entry.factory(), 0);
  for (const level of entry.options?.lods ?? []) {
    lod.addLevel(level.factory(), level.distance);
  }
  return lod;
}

export function registerModelTemplate(key: string, factory: TemplateFactory, options?: AssetTemplateOptions): void {
  if (templates.has(key) || AssetLoader.has(key)) return;
  templates.set(key, { key, factory, options });
  ensureRuntimeAssetEntry({
    id: key,
    type: 'model',
    metadata: {
      variants: 1 + (options?.lods?.length ?? 0),
      drawDistance: options?.drawDistance ?? null,
      ps1Style: options?.ps1Style ?? true,
    },
  });
}

export function registerObject3D(key: string, object: THREE.Object3D): void {
  if (templates.has(key) || AssetLoader.has(key)) return;
  AssetLoader.register(key, object);
  ensureRuntimeAssetEntry({
    id: key,
    type: 'model',
    data: object,
    metadata: {
      source: 'object3d',
    },
  });
}

export function registerAsset(registration: RuntimeAssetRegistration): RuntimeAssetRecord {
  const entry = ensureRuntimeAssetEntry(registration);
  return {
    id: entry.id,
    type: entry.type,
    path: entry.path,
    loaded: entry.data !== undefined,
    metadata: { ...entry.metadata },
  };
}

export async function loadAsset<T = unknown>(id: string): Promise<T | null> {
  const entry = runtimeAssets.get(id);
  if (entry?.data !== undefined) {
    return entry.data as T;
  }
  if (entry?.pending) {
    return entry.pending as Promise<T>;
  }

  const fallback = AssetLoader.get<T>(id) ?? createInstance(id) as T | null;
  if (fallback !== null) {
    ensureRuntimeAssetEntry({ id, type: entry?.type ?? 'model', data: fallback, metadata: entry?.metadata });
    return fallback;
  }

  if (!entry?.loader) {
    return null;
  }

  const pending = entry.loader().then((loaded) => {
    entry.pending = undefined;
    entry.data = loaded;
    return loaded;
  }).catch((error) => {
    entry.pending = undefined;
    throw error;
  });
  entry.pending = pending;
  return pending as Promise<T>;
}

export function getAsset<T = unknown>(id: string): T | null {
  const entry = runtimeAssets.get(id);
  if (entry?.data !== undefined) {
    return entry.data as T;
  }
  return AssetLoader.get<T>(id) ?? null;
}

export function getAssetRecord(id: string): RuntimeAssetRecord | null {
  const entry = runtimeAssets.get(id);
  if (!entry) return null;
  return {
    id: entry.id,
    type: entry.type,
    path: entry.path,
    loaded: entry.data !== undefined,
    metadata: { ...entry.metadata },
  };
}

export function isLoaded(id: string): boolean {
  const entry = runtimeAssets.get(id);
  if (entry?.data !== undefined) {
    return true;
  }
  return AssetLoader.has(id);
}

export function listRuntimeAssets(type?: RuntimeAssetType): RuntimeAssetRecord[] {
  const assets = [...runtimeAssets.values()]
    .filter((entry) => !type || entry.type === type)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      path: entry.path,
      loaded: entry.data !== undefined,
      metadata: { ...entry.metadata },
    }));
  assets.sort((left, right) => left.id.localeCompare(right.id));
  return assets;
}

export function clearRuntimeAssets(predicate?: (record: RuntimeAssetRecord) => boolean): void {
  for (const [id, entry] of runtimeAssets.entries()) {
    const record: RuntimeAssetRecord = {
      id: entry.id,
      type: entry.type,
      path: entry.path,
      loaded: entry.data !== undefined,
      metadata: { ...entry.metadata },
    };
    if (predicate && !predicate(record)) {
      continue;
    }
    runtimeAssets.delete(id);
  }
}

export function hasAsset(key: string): boolean {
  return templates.has(key) || AssetLoader.has(key);
}

export function createInstance(key: string): THREE.Object3D | null {
  const template = resolveTemplate(key);
  if (!template) return null;
  return cloneWithMarkers(template, key);
}

export function invalidateAsset(key: string): void {
  const template = templates.get(key);
  if (!template) return;
  template.template = undefined;
}

export function getAssetOptions(key: string): AssetTemplateOptions | null {
  return templates.get(key)?.options ?? null;
}

export function listRegisteredAssets(): RegisteredAssetInfo[] {
  const result: RegisteredAssetInfo[] = [];
  for (const [key, entry] of templates.entries()) {
    result.push({ key, source: 'template', variants: 1 + (entry.options?.lods?.length ?? 0) });
  }
  for (const item of AssetLoader.listAssets()) {
    result.push({ key: item.name, source: 'loader' });
  }
  result.sort((a, b) => a.key.localeCompare(b.key));
  return result;
}

export function clearRegistry(): void {
  templates.clear();
  runtimeAssets.clear();
}