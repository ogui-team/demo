import type { PlayerProfileRecord, PlayerProfileRepository } from './repositories/PlayerProfileRepository';

export class InMemoryPlayerProfileStore implements PlayerProfileRepository {
  private readonly profiles = new Map<string, PlayerProfileRecord>();

  findById(userId: string): PlayerProfileRecord | null {
    return this.profiles.get(userId) ?? null;
  }

  save(entity: PlayerProfileRecord): PlayerProfileRecord {
    const nextEntity: PlayerProfileRecord = {
      ...entity,
      updatedAt: entity.updatedAt || Date.now(),
    };
    this.profiles.set(nextEntity.userId, nextEntity);
    return nextEntity;
  }

  delete(userId: string): void {
    this.profiles.delete(userId);
  }
}

export const playerProfileStore = new InMemoryPlayerProfileStore();
