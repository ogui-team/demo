export class HealthStorage {
  private readonly capacity: number;
  private readonly healthValues: Float32Array;
  private readonly maxHealthValues: Float32Array;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('HealthStorage capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.healthValues = new Float32Array(capacity);
    this.maxHealthValues = new Float32Array(capacity);
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  getHealthBuffer(): Float32Array {
    return this.healthValues;
  }

  getMaxHealthBuffer(): Float32Array {
    return this.maxHealthValues;
  }

  setHealth(denseIndex: number, health: number): void {
    this.healthValues[denseIndex] = health;
  }

  setMaxHealth(denseIndex: number, maxHealth: number): void {
    this.maxHealthValues[denseIndex] = maxHealth;
  }

  getHealth(denseIndex: number): number {
    return this.healthValues[denseIndex];
  }

  getMaxHealth(denseIndex: number): number {
    return this.maxHealthValues[denseIndex];
  }

  clear(activeCount: number): void {
    this.healthValues.fill(0, 0, activeCount);
    this.maxHealthValues.fill(0, 0, activeCount);
  }
}