import type { IDisposable } from './plugin-contracts';

export interface IService extends IDisposable {
  readonly id: string;
}

export interface ServiceRegistry extends IDisposable {
  registerService<T extends IService>(id: string, service: T): void;
  unregisterService(id: string): void;
  getService<T extends IService>(id: string): T | undefined;
  hasService(id: string): boolean;
  listServices(): string[];
}

export interface ISettingsService extends IService {
  show(): void;
  hide(): void;
  isVisible(): boolean;
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
}

export interface IAudioService extends IService {
  play(trackId: string, options?: { volume?: number; loop?: boolean }): void;
  stop(trackId: string): void;
  setMasterVolume(volume: number): void;
  getMasterVolume(): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

export interface RuntimeMixerTrackState {
  id: string;
  enabled: boolean;
  isolated: boolean;
}

export interface IRuntimeMixerService extends IService {
  listTracks(): RuntimeMixerTrackState[];
  setTrackEnabled(trackId: string, enabled: boolean): boolean;
  isolateTrack(trackId: string | null): void;
}

export type InspectorFieldKind = 'number' | 'boolean' | 'text';

export interface InspectorFieldDescriptor {
  id: string;
  label: string;
  componentName: string;
  path: string;
  kind: InspectorFieldKind;
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
}

export interface InspectorEntitySnapshot {
  entityId: string;
  entityType: string;
  fields: InspectorFieldDescriptor[];
}

export interface IInspectorService extends IService {
  inspectSelectedEntity(): InspectorEntitySnapshot | null;
  inspectEntity(entityId: string): InspectorEntitySnapshot | null;
  applyFieldValue(entityId: string, componentName: string, path: string, value: unknown): boolean;
}

export interface StateImportResult {
  success: boolean;
  entitiesCreated: number;
  settingsApplied: number;
}

export interface IStatePersistenceService extends IService {
  saveMap(name: string): boolean;
  loadMap(name: string): StateImportResult;
  listMaps(): string[];
  deleteMap(name: string): boolean;
  exportWorld(name?: string): string;
  importWorld(json: string, name?: string): StateImportResult;
}