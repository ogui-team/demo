import { randomUUID } from 'node:crypto';
import type { UserIdentityRepository } from './repositories/UserIdentityRepository';
import type { AuthProvider } from './types';

export interface UserIdentityRecord {
  userId: string;
  provider: Exclude<AuthProvider, 'guest'>;
  providerUserId: string;
  email: string;
  displayName?: string;
  permissions: string[];
  createdAt: number;
  updatedAt: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeProviderUserId(value: string): string {
  return value.trim();
}

function buildProviderKey(provider: Exclude<AuthProvider, 'guest'>, providerUserId: string): string {
  return `${provider}:${providerUserId}`;
}

export class InMemoryUserIdentityStore implements UserIdentityRepository {
  private readonly byProvider = new Map<string, UserIdentityRecord>();
  private readonly byUserId = new Map<string, UserIdentityRecord[]>();

  findById(userId: string): UserIdentityRecord | null {
    return (this.byUserId.get(userId) ?? [])[0] ?? null;
  }

  save(entity: UserIdentityRecord): UserIdentityRecord {
    const key = buildProviderKey(entity.provider, normalizeProviderUserId(entity.providerUserId));
    this.byProvider.set(key, entity);

    const bucket = this.byUserId.get(entity.userId) ?? [];
    const index = bucket.findIndex((entry) => entry.provider === entity.provider && entry.providerUserId === entity.providerUserId);
    if (index >= 0) {
      bucket[index] = entity;
    } else {
      bucket.push(entity);
    }
    this.byUserId.set(entity.userId, bucket);
    return entity;
  }

  delete(userId: string): void {
    const bucket = this.byUserId.get(userId) ?? [];
    for (const record of bucket) {
      const key = buildProviderKey(record.provider, normalizeProviderUserId(record.providerUserId));
      this.byProvider.delete(key);
    }
    this.byUserId.delete(userId);
  }

  findByProviderIdentity(provider: Exclude<AuthProvider, 'guest'>, providerUserId: string): UserIdentityRecord | null {
    const key = buildProviderKey(provider, normalizeProviderUserId(providerUserId));
    return this.byProvider.get(key) ?? null;
  }

  upsertFromOAuth(input: {
    provider: Exclude<AuthProvider, 'guest'>;
    providerUserId: string;
    email: string;
    displayName?: string;
  }): { record: UserIdentityRecord; created: boolean } {
    const providerUserId = normalizeProviderUserId(input.providerUserId);
    const email = normalizeEmail(input.email);
    const key = buildProviderKey(input.provider, providerUserId);
    const now = Date.now();

    const existing = this.byProvider.get(key);
    if (existing) {
      const updated: UserIdentityRecord = {
        ...existing,
        email,
        displayName: input.displayName?.trim() || existing.displayName,
        updatedAt: now,
      };
      this.save(updated);
      return { record: updated, created: false };
    }

    const userIdPrefix = process.env.AUTH_USER_ID_PREFIX ?? 'usr';
    const userId = `${userIdPrefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const permissions = ['play'];

    const createdRecord: UserIdentityRecord = {
      userId,
      provider: input.provider,
      providerUserId,
      email,
      displayName: input.displayName?.trim() || undefined,
      permissions,
      createdAt: now,
      updatedAt: now,
    };

    this.save(createdRecord);
    return { record: createdRecord, created: true };
  }
}

// SQL alignment note:
// This store mirrors a future `user_identities` table shape for provider lookup.
// Replace with PostgreSQL implementation in the next persistence slice.
export const userIdentityStore = new InMemoryUserIdentityStore();
