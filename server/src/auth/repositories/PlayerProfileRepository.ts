import type { BaseRepository } from './BaseRepository';

export interface PlayerProfileRecord {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  progressionBlob?: Record<string, unknown>;
  updatedAt: number;
}

export interface PlayerProfileRepository extends BaseRepository<PlayerProfileRecord, string> {}
