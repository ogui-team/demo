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