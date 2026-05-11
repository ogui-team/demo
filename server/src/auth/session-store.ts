import { randomUUID } from 'node:crypto';
import type { SessionRepository } from './repositories/SessionRepository';
import type { IdentitySnapshot } from './types';

export interface SessionRecord {
  sessionId: string;
  userId: string;
  permissions: string[];
  provider: IdentitySnapshot['provider'];
  isGuest: boolean;
  createdAt: number;
  expiresAt: number;
}

export class InMemorySessionStore implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();

  create(input: {
    userId: string;
    permissions: string[];
    provider: IdentitySnapshot['provider'];
    isGuest: boolean;
    ttlMs: number;
  }): SessionRecord {
    const now = Date.now();
    const sessionId = `sess_${randomUUID().replace(/-/g, '')}`;
    const record: SessionRecord = {
      sessionId,
      userId: input.userId,
      permissions: [...input.permissions],
      provider: input.provider,
      isGuest: input.isGuest,
      createdAt: now,
      expiresAt: now + Math.max(60_000, input.ttlMs),
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  findById(sessionId: string): SessionRecord | null {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return null;
    }
    if (record.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return record;
  }

  get(sessionId: string): SessionRecord | null {
    return this.findById(sessionId);
  }

  save(entity: SessionRecord): SessionRecord {
    this.sessions.set(entity.sessionId, entity);
    return entity;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  refresh(sessionId: string, ttlMs: number): SessionRecord | null {
    const record = this.get(sessionId);
    if (!record) {
      return null;
    }
    const updated: SessionRecord = {
      ...record,
      expiresAt: Date.now() + Math.max(60_000, ttlMs),
    };
    return this.save(updated);
  }
}

export const sessionStore = new InMemorySessionStore();
