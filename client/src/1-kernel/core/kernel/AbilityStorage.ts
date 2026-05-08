export class AbilityStorage {
  private readonly capacity: number;
  private readonly primaryAbilityIds: Uint32Array;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('AbilityStorage capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.primaryAbilityIds = new Uint32Array(capacity);
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  getPrimaryAbilityBuffer(): Uint32Array {
    return this.primaryAbilityIds;
  }

  setPrimaryAbility(denseIndex: number, abilityId: number): void {
    this.primaryAbilityIds[denseIndex] = abilityId;
  }

  getPrimaryAbility(denseIndex: number): number {
    return this.primaryAbilityIds[denseIndex];
  }

  clear(activeCount: number): void {
    this.primaryAbilityIds.fill(0, 0, activeCount);
  }
}