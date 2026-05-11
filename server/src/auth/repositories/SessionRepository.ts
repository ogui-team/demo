import type { BaseRepository } from './BaseRepository';
import type { SessionRecord } from '../session-store';

export interface SessionRepository extends BaseRepository<SessionRecord, string> {
  create(input: {
    userId: string;
    permissions: string[];
    provider: SessionRecord['provider'];
    isGuest: boolean;
    ttlMs: number;
  }): SessionRecord;
  refresh(sessionId: string, ttlMs: number): SessionRecord | null;
}
