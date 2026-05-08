/**
 * AnimationEffectStorage - DOD Buffer for Death Animation State
 * 
 * CONSTRAINT: Zero-Object-Creation
 * - Death state is a Uint8 bit-flag (0=alive, 1=dead, 2=respawning)
 * - Death timer is Float32 countdown (0.0-5.0 seconds)
 * - No Three.js objects, no timers, no callbacks
 * - Pure buffer mutations in PHASE_RESOLVE
 * 
 * Memory Layout (Per Entity Dense Index):
 * - deathStateBuffer:   Uint32Array[capacity] @ byte offset 358,432
 *   ├─ Bits [0-7]:    deathState (0=alive, 1=dead, 2=respawning)
 *   ├─ Bits [8-31]:   reserved for future flags
 * - deathTimerBuffer:   Float32Array[capacity] @ byte offset 366,624
 *   └─ Range [0.0, 5.0]: seconds until respawn
 * 
 * Total: 16,384 bytes per 2,048 entity capacity
 */

export enum DeathState {
  ALIVE = 0,
  DEAD = 1,
  RESPAWNING = 2,
}

export class AnimationEffectStorage {
  private readonly capacity: number;
  private readonly deathStateBuffer: Uint32Array;
  private readonly deathTimerBuffer: Float32Array;

  private readonly DEATH_STATE_MASK = 0xFF;
  private readonly DEATH_STATE_SHIFT = 0;
  private readonly MAX_DEATH_TIMER = 5.0; // 5 second respawn window

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('AnimationEffectStorage capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.deathStateBuffer = new Uint32Array(capacity);
    this.deathTimerBuffer = new Float32Array(capacity);
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  /**
   * Get death state buffer for CRC32 hashing
   * @returns Uint32Array - packed state flags
   */
  getDeathStateBuffer(): Uint32Array {
    return this.deathStateBuffer;
  }

  /**
   * Get death timer buffer for CRC32 hashing
   * @returns Float32Array - timer countdown values
   */
  getDeathTimerBuffer(): Float32Array {
    return this.deathTimerBuffer;
  }

  /**
   * Set entity death state (bit-flag pack)
   * @param denseIndex - entity's dense index in registry
   * @param state - DeathState enum (ALIVE=0, DEAD=1, RESPAWNING=2)
   */
  setDeathState(denseIndex: number, state: DeathState): void {
    const packed = this.deathStateBuffer[denseIndex];
    const newPacked = (packed & ~(this.DEATH_STATE_MASK << this.DEATH_STATE_SHIFT)) |
                      ((state & this.DEATH_STATE_MASK) << this.DEATH_STATE_SHIFT);
    this.deathStateBuffer[denseIndex] = newPacked;
  }

  /**
   * Get entity death state (bit-flag unpack)
   * @param denseIndex - entity's dense index
   * @returns DeathState enum value
   */
  getDeathState(denseIndex: number): DeathState {
    const packed = this.deathStateBuffer[denseIndex];
    return (packed >> this.DEATH_STATE_SHIFT) & this.DEATH_STATE_MASK;
  }

  /**
   * Check if entity is currently dead
   * @param denseIndex - entity's dense index
   * @returns true if state is DEAD or RESPAWNING
   */
  isDead(denseIndex: number): boolean {
    const state = this.getDeathState(denseIndex);
    return state === DeathState.DEAD || state === DeathState.RESPAWNING;
  }

  /**
   * Set death timer countdown (seconds until respawn)
   * @param denseIndex - entity's dense index
   * @param timer - seconds (0.0 to 5.0)
   */
  setDeathTimer(denseIndex: number, timer: number): void {
    this.deathTimerBuffer[denseIndex] = Math.max(0, Math.min(timer, this.MAX_DEATH_TIMER));
  }

  /**
   * Get current death timer value
   * @param denseIndex - entity's dense index
   * @returns timer in seconds
   */
  getDeathTimer(denseIndex: number): number {
    return this.deathTimerBuffer[denseIndex];
  }

  /**
   * Decrement death timer (called in PHASE_RESOLVE)
   * @param denseIndex - entity's dense index
   * @param deltaTime - time elapsed (seconds)
   * @returns true if timer expired (timer <= 0 after decrement)
   */
  decrementDeathTimer(denseIndex: number, deltaTime: number): boolean {
    const current = this.deathTimerBuffer[denseIndex];
    const updated = current - deltaTime;
    this.deathTimerBuffer[denseIndex] = Math.max(0, updated);
    return updated <= 0;
  }

  /**
   * Reset entity to alive state (on respawn)
   * @param denseIndex - entity's dense index
   */
  resetToAlive(denseIndex: number): void {
    this.deathStateBuffer[denseIndex] = DeathState.ALIVE;
    this.deathTimerBuffer[denseIndex] = 0;
  }

  /**
   * Mark entity as dead and start timer
   * @param denseIndex - entity's dense index
   * @param respawnDelay - seconds until respawn (default 5.0)
   */
  markDead(denseIndex: number, respawnDelay: number = this.MAX_DEATH_TIMER): void {
    this.setDeathState(denseIndex, DeathState.DEAD);
    this.setDeathTimer(denseIndex, respawnDelay);
  }

  /**
   * Clear all animation state for entity range
   * @param activeCount - number of active entities to clear
   */
  clear(activeCount: number): void {
    this.deathStateBuffer.fill(DeathState.ALIVE, 0, activeCount);
    this.deathTimerBuffer.fill(0, 0, activeCount);
  }
}
