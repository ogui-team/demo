/**
 * AssetLoader
 * Central registry for all game assets: GLTF models, textures, and manually
 * registered Object3D / BufferGeometry instances.
 *
 * Usage:
 *   import * as AssetLoader from './systems/AssetLoader';
 *
 *   const gltf  = await AssetLoader.loadGLTF('enemy', 'assets/enemy.glb');
 *   const tex   = await AssetLoader.loadTexture('wall', 'assets/wall.png');
 *   const mesh  = AssetLoader.get<THREE.Group>('enemy')?.scene;   // typed retrieval
 *   AssetLoader.dispose('enemy');                                  // cleanup
 */

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { GLTF };

type AssetEntry =
  | { kind: 'gltf';    data: GLTF }
  | { kind: 'texture'; data: THREE.Texture }
  | { kind: 'object3d'; data: THREE.Object3D };

export type AssetKind = AssetEntry['kind'];

export interface AssetInfo {
  name: string;
  kind: AssetKind;
}

// ─── Internal state ───────────────────────────────────────────────────────────

const _registry = new Map<string, AssetEntry>();
const _pending   = new Map<string, Promise<unknown>>();

const _textureLoader = new THREE.TextureLoader();
let _baseUrl = '';
let _gltfLoaderPromise: Promise<{
  load: (
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (event: unknown) => void,
  ) => void;
  setPath: (base: string) => unknown;
}> | null = null;

function describeLoaderError(event: unknown): string {
  if (event instanceof Error) return event.message;
  if (typeof event === 'object' && event !== null && 'message' in event) {
    const message = (event as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(event);
}

async function getGLTFLoader(): Promise<{
  load: (
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (event: unknown) => void,
  ) => void;
  setPath: (base: string) => unknown;
}> {
  if (!_gltfLoaderPromise) {
    _gltfLoaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const loader = new GLTFLoader();
      if (_baseUrl) {
        loader.setPath(_baseUrl);
      }
      return loader;
    });
  }

  return _gltfLoaderPromise;
}

// ─── GLTF ─────────────────────────────────────────────────────────────────────

/**
 * Load (and cache) a GLTF/GLB file.
 *
 * @param name  Registry key. If `url` is omitted, `name` is also used as URL.
 * @param url   Optional explicit URL to fetch from.
 */
export async function loadGLTF(name: string, url?: string): Promise<GLTF> {
  const cached = _registry.get(name);
  if (cached) {
    if (cached.kind !== 'gltf') {
      throw new Error(`[AssetLoader] '${name}' is already registered as '${cached.kind}', not 'gltf'.`);
    }
    return cached.data;
  }

  if (_pending.has(name)) return _pending.get(name) as Promise<GLTF>;

  const src = url ?? name;
  const promise = getGLTFLoader().then((loader) => new Promise<GLTF>((resolve, reject) => {
    loader.load(
      src,
      resolve,
      undefined,
      (event) => reject(new Error(`[AssetLoader] Failed to load GLTF '${src}': ${describeLoaderError(event)}`)),
    );
  })).then((gltf) => {
    _registry.set(name, { kind: 'gltf', data: gltf });
    _pending.delete(name);
    return gltf;
  }).catch((err: unknown) => {
    _pending.delete(name);
    throw err;
  });

  _pending.set(name, promise);
  return promise;
}

// ─── Texture ──────────────────────────────────────────────────────────────────

/**
 * Load (and cache) a texture.
 * Applies `NearestFilter` by default for PS1-style pixelated look.
 *
 * @param name  Registry key. If `url` is omitted, `name` is also used as URL.
 * @param url   Optional explicit URL to fetch from.
 * @param nearestFilter  Use NearestFilter (default true for PS1 look).
 */
export async function loadTexture(
  name: string,
  url?: string,
  nearestFilter: boolean = true,
): Promise<THREE.Texture> {
  const cached = _registry.get(name);
  if (cached) {
    if (cached.kind !== 'texture') {
      throw new Error(`[AssetLoader] '${name}' is already registered as '${cached.kind}', not 'texture'.`);
    }
    return cached.data;
  }

  if (_pending.has(name)) return _pending.get(name) as Promise<THREE.Texture>;

  const src = url ?? name;
  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    _textureLoader.load(
      src,
      resolve,
      undefined,
      (event) => reject(new Error(`[AssetLoader] Failed to load texture '${src}': ${(event as ErrorEvent).message ?? String(event)}`)),
    );
  }).then((tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    if (nearestFilter) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestMipmapLinearFilter;
    }
    _registry.set(name, { kind: 'texture', data: tex });
    _pending.delete(name);
    return tex;
  }).catch((err: unknown) => {
    _pending.delete(name);
    throw err;
  });

  _pending.set(name, promise);
  return promise;
}

// ─── Manual registration ──────────────────────────────────────────────────────

/**
 * Register a programmatically created asset.
 * Silently skips if `name` is already registered.
 */
export function register(name: string, asset: THREE.Object3D | THREE.Texture | GLTF): void {
  if (_registry.has(name)) {
    console.warn(`[AssetLoader] '${name}' is already in the registry — skipping register().`);
    return;
  }

  if (asset instanceof THREE.Texture) {
    _registry.set(name, { kind: 'texture', data: asset });
  } else if (asset instanceof THREE.Object3D) {
    _registry.set(name, { kind: 'object3d', data: asset });
  } else {
    // Treat as GLTF (has .scene, .animations, etc.)
    _registry.set(name, { kind: 'gltf', data: asset as GLTF });
  }
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Retrieve a cached asset by name with an optional type parameter.
 *
 * @example
 * const gltf = AssetLoader.get<GLTF>('enemy');
 * const tex  = AssetLoader.get<THREE.Texture>('wall');
 */
export function get<T = unknown>(name: string): T | undefined {
  const entry = _registry.get(name);
  if (!entry) return undefined;
  return entry.data as unknown as T;
}

/** Returns true if the asset is in the registry **or** currently loading. */
export function has(name: string): boolean {
  return _registry.has(name) || _pending.has(name);
}

/** Returns true only if the asset has finished loading and is in the registry. */
export function isReady(name: string): boolean {
  return _registry.has(name);
}

// ─── Disposal ─────────────────────────────────────────────────────────────────

function _disposeGLTF(gltf: GLTF): void {
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      // Dispose any textures stored on the material
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      mat.dispose();
    }
  });
}

/**
 * Dispose and remove an asset (or all assets if no name is given).
 * Frees GPU memory for textures and GLTF geometries/materials.
 */
export function dispose(name?: string): void {
  if (name !== undefined) {
    const entry = _registry.get(name);
    if (!entry) return;
    if (entry.kind === 'gltf')    _disposeGLTF(entry.data);
    if (entry.kind === 'texture') entry.data.dispose();
    // object3d — caller owns the geometry/material lifecycle
    _registry.delete(name);
    return;
  }
  // Dispose ALL
  _registry.forEach((_, key) => dispose(key));
}

// ─── Inspection ───────────────────────────────────────────────────────────────

/** Names of all loaded (ready) assets. */
export function getNames(): string[] {
  return Array.from(_registry.keys());
}

/** Number of loaded assets currently in the registry. */
export function getSize(): number {
  return _registry.size;
}

/** Summary of all registered assets. */
export function listAssets(): AssetInfo[] {
  const out: AssetInfo[] = [];
  _registry.forEach((entry, name) => out.push({ name, kind: entry.kind }));
  return out;
}

// ─── Loader configuration ─────────────────────────────────────────────────────

/**
 * Set a base path for all subsequent GLTF and texture loads.
 * @example AssetLoader.setBaseUrl('/assets/');
 */
export function setBaseUrl(base: string): void {
  _baseUrl = base;
  if (_gltfLoaderPromise) {
    void _gltfLoaderPromise.then((loader) => {
      loader.setPath(base);
    });
  }
  _textureLoader.setPath(base);
}

/**
 * Preload a list of assets concurrently and resolve when all are ready.
 */
export async function preloadGLTF(entries: Array<{ name: string; url: string }>): Promise<void> {
  await Promise.all(entries.map(({ name, url }) => loadGLTF(name, url)));
}

export async function preloadTextures(entries: Array<{ name: string; url: string }>): Promise<void> {
  await Promise.all(entries.map(({ name, url }) => loadTexture(name, url)));
}
