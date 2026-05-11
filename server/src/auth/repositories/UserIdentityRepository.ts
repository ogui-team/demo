import type { BaseRepository } from './BaseRepository';
import type { UserIdentityRecord } from '../user-identity-store';

export interface UserIdentityRepository extends BaseRepository<UserIdentityRecord, string> {
  findByProviderIdentity(
    provider: UserIdentityRecord['provider'],
    providerUserId: string,
  ): UserIdentityRecord | null;
  upsertFromOAuth(input: {
    provider: UserIdentityRecord['provider'];
    providerUserId: string;
    email: string;
    displayName?: string;
  }): { record: UserIdentityRecord; created: boolean };
}
