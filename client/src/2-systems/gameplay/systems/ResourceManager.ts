import * as AssetLoader from './AssetLoader';
import type { Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';

export type ResourceKind = 'model' | 'texture' | 'sound';
export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ResourceDescriptor {
  id: string;
  kind: ResourceKind;
  url: string;
  unloadDelayMs?: number;
}

export interface StreamingSource {
  id: string;
  position: Vector3;
  radius: number;
  resourceIds: string[];
  visibilityTag?: string;
}

interface ResourceRecord {
  descriptor: ResourceDescriptor;
  status: ResourceStatus;
  refCount: number;
  asset?: unknown;
  lastUsedTime: number;
  error?: string;
}

interface StreamingSourceRecord extends StreamingSource {
  active: boolean;
}

function distanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export class ResourceManager {
  private readonly resources = new Map<string, ResourceRecord>();
  private readonly pendingLoads = new Map<string, Promise<unknown>>();
  private readonly streamingSources = new Map<string, StreamingSourceRecord>();
  private readonly soundCache = new Map<string, ArrayBuffer>();
  private streamingEnabled = true;
  private lastFocusPosition: Vector3 | null = null;
  private gcAccumulator = 0;
  private readonly gcInterval = 0.5;

  registerResource(descriptor: ResourceDescriptor): void {
    if (this.resources.has(descriptor.id)) return;
    this.resources.set(descriptor.id, {
      descriptor,
      status: 'idle',
      refCount: 0,
      lastUsedTime: Engine.time.now(),
    });
    this.emitMutation(`resources.${descriptor.id}`);
  }

  registerModel(id: string, url: string, unloadDelayMs: number = 10_000): void {
    this.registerResource({ id, url, kind: 'model', unloadDelayMs });
  }

  registerTexture(id: string, url: string, unloadDelayMs: number = 10_000): void {
    this.registerResource({ id, url, kind: 'texture', unloadDelayMs });
  }

  registerSound(id: string, url: string, unloadDelayMs: number = 15_000): void {
    this.registerResource({ id, url, kind: 'sound', unloadDelayMs });
  }

  async acquire(id: string): Promise<unknown | undefined> {
    const resource = this.resources.get(id);
    if (!resource) return undefined;

    resource.refCount += 1;
    resource.lastUsedTime = Engine.time.now();
    if (resource.status === 'ready') {
      return resource.asset;
    }

    if (this.pendingLoads.has(id)) {
      return this.pendingLoads.get(id);
    }

    resource.status = 'loading';
    this.emitMutation(`resources.${id}.status`);
    const loadPromise = this.loadResource(resource)
      .then((asset) => {
        resource.asset = asset;
        resource.status = 'ready';
        resource.error = undefined;
        resource.lastUsedTime = Engine.time.now();
        this.pendingLoads.delete(id);
        this.emitMutation(`resources.${id}.status`);
        return asset;
      })
      .catch((error: unknown) => {
        resource.status = 'error';
        resource.error = error instanceof Error ? error.message : String(error);
        this.pendingLoads.delete(id);
        this.emitMutation(`resources.${id}.status`);
        throw error;
      });
    this.pendingLoads.set(id, loadPromise);
    return loadPromise;
  }

  release(id: string): void {
    const resource = this.resources.get(id);
    if (!resource) return;
    resource.refCount = Math.max(0, resource.refCount - 1);
    resource.lastUsedTime = Engine.time.now();
  }

  addStreamingSource(source: StreamingSource): void {
    this.streamingSources.set(source.id, { ...source, active: false });
    this.emitMutation(`resources.streaming.${source.id}`);
  }

  updateStreamingSource(id: string, position: Vector3): void {
    const source = this.streamingSources.get(id);
    if (!source) return;
    source.position = { ...position };
  }

  removeStreamingSource(id: string): void {
    const source = this.streamingSources.get(id);
    if (!source) return;
    if (source.active) {
      for (const resourceId of source.resourceIds) {
        this.release(resourceId);
      }
    }
    this.streamingSources.delete(id);
    this.emitMutation(`resources.streaming.${id}`);
  }

  async updateStreaming(focusPosition: Vector3, visibleTags: Set<string> = new Set()): Promise<void> {
    this.lastFocusPosition = { ...focusPosition };
    if (!this.streamingEnabled) {
      for (const source of this.streamingSources.values()) {
        if (!source.active) continue;
        source.active = false;
        for (const resourceId of source.resourceIds) {
          this.release(resourceId);
        }
      }
      return;
    }
    for (const source of this.streamingSources.values()) {
      const near = distanceSquared(source.position, focusPosition) <= source.radius * source.radius;
      const visible = !source.visibilityTag || visibleTags.has(source.visibilityTag);
      const shouldBeActive = near && visible;
      if (shouldBeActive === source.active) continue;

      source.active = shouldBeActive;
      this.emitMutation(`resources.streaming.${source.id}.active`);
      if (shouldBeActive) {
        for (const resourceId of source.resourceIds) {
          void this.acquire(resourceId);
        }
      } else {
        for (const resourceId of source.resourceIds) {
          this.release(resourceId);
        }
      }
    }
  }

  async update(dt: number): Promise<void> {
    this.gcAccumulator += dt;
    if (this.gcAccumulator < this.gcInterval) return;
    this.gcAccumulator = 0;
    this.garbageCollect(2);
  }

  garbageCollect(maxReleasesPerPass: number = 2): void {
    const now = Engine.time.now();
    let releases = 0;

    for (const [id, resource] of this.resources.entries()) {
      if (releases >= maxReleasesPerPass) break;
      if (resource.refCount > 0 || resource.status !== 'ready') continue;
      const delay = resource.descriptor.unloadDelayMs ?? 10_000;
      if (now - resource.lastUsedTime < delay) continue;
      this.unloadResource(id, resource);
      releases += 1;
    }
  }

  getDiagnostics(): Record<string, unknown> {
    const resources = [...this.resources.values()];
    return {
      streamingEnabled: this.streamingEnabled,
      focusPosition: this.lastFocusPosition,
      loadedAssetsCount: resources.filter((resource) => resource.status === 'ready').length,
      resources: resources.map((resource) => ({
        id: resource.descriptor.id,
        kind: resource.descriptor.kind,
        status: resource.status,
        refCount: resource.refCount,
        lastUsedTime: resource.lastUsedTime,
        error: resource.error,
      })),
      streamingSources: [...this.streamingSources.values()].map((source) => ({
        id: source.id,
        active: source.active,
        radius: source.radius,
        resourceIds: [...source.resourceIds],
      })),
    };
  }

  setStreamingEnabled(enabled: boolean): void {
    this.streamingEnabled = enabled;
    this.emitMutation('resources.streaming.enabled');
  }

  isStreamingEnabled(): boolean {
    return this.streamingEnabled;
  }

  private async loadResource(resource: ResourceRecord): Promise<unknown> {
    switch (resource.descriptor.kind) {
      case 'model':
        return AssetLoader.loadGLTF(resource.descriptor.id, resource.descriptor.url);
      case 'texture':
        return AssetLoader.loadTexture(resource.descriptor.id, resource.descriptor.url);
      case 'sound': {
        const response = await fetch(resource.descriptor.url);
        const arrayBuffer = await response.arrayBuffer();
        this.soundCache.set(resource.descriptor.id, arrayBuffer);
        return arrayBuffer;
      }
      default:
        return undefined;
    }
  }

  private unloadResource(id: string, resource: ResourceRecord): void {
    switch (resource.descriptor.kind) {
      case 'model':
      case 'texture':
        AssetLoader.dispose(id);
        break;
      case 'sound':
        this.soundCache.delete(id);
        break;
      default:
        break;
    }
    resource.asset = undefined;
    resource.status = 'idle';
    this.emitMutation(`resources.${id}.status`);
  }

  private emitMutation(path: string): void {
    gameBus.emit('stateMutation', {
      source: 'resourceManager',
      path,
      changedCount: 1,
    });
  }

  dispose(): void {
    // Clear all pending loads
    this.pendingLoads.clear();
    // Release all resources
    for (const id of this.resources.keys()) {
      const resource = this.resources.get(id);
      if (resource) {
        resource.refCount = 0;
        resource.asset = undefined;
      }
    }
    // Clear sound cache
    this.soundCache.clear();
    // Clear streaming sources
    this.streamingSources.clear();
    // Reset state
    this.lastFocusPosition = null;
    this.gcAccumulator = 0;
  }
}