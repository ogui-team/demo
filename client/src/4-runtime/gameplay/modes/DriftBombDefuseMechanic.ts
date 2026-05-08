/**
 * DRIFT BOMB DEFUSE MECHANIC
 * Tether validation, defuse progress tracking, interruption detection
 */

export interface DefuseSession {
  defuserId: string;
  bombEntityId: string;
  startFrame: number;
  progress: number; // 0-1
  tetherDistance: number;
  tetherBroken: boolean;
  interrupted: boolean;
  interruptedFrame: number | null;
  interruptReason: 'distance' | 'damage' | 'movement' | 'manual' | null;
}

export interface DefuseConfig {
  defuseTimeSec: number;
  tetherRadiusMeters: number;
  losRequired: boolean;
  damageInterruptThreshold: number; // health loss that breaks defuse
}

export class DriftBombDefuseMechanic {
  private session: DefuseSession | null = null;
  private config: DefuseConfig;
  private defuserLastHealth: number = 100;
  private defuserLastPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  constructor(
    defuseTimeSec: number = 40,
    tetherRadiusMeters: number = 15,
    losRequired: boolean = true,
    damageInterruptThreshold: number = 10,
  ) {
    this.config = {
      defuseTimeSec,
      tetherRadiusMeters,
      losRequired,
      damageInterruptThreshold,
    };
  }

  /**
   * Start defuse attempt
   */
  startDefuse(defuserId: string, bombEntityId: string, frameIndex: number): void {
    this.session = {
      defuserId,
      bombEntityId,
      startFrame: frameIndex,
      progress: 0,
      tetherDistance: 0,
      tetherBroken: false,
      interrupted: false,
      interruptedFrame: null,
      interruptReason: null,
    };
  }

  /**
   * Update defuse progress each frame
   * Returns true if defuse is still active, false if completed/interrupted
   */
  updateDefuse(
    frameIndex: number,
    dtSeconds: number,
    defuserPos: { x: number; y: number; z: number },
    bombPos: { x: number; y: number; z: number },
    defuserHealth: number,
    defuserAlive: boolean,
  ): boolean {
    if (!this.session) {
      return false;
    }

    // Check if defuser is dead
    if (!defuserAlive) {
      this.interruptDefuse(frameIndex, 'manual');
      return false;
    }

    // Check tether distance
    const distance = this.calculateDistance(defuserPos, bombPos);
    this.session.tetherDistance = distance;

    if (distance > this.config.tetherRadiusMeters) {
      this.interruptDefuse(frameIndex, 'distance');
      this.session.tetherBroken = true;
      return false;
    }

    // Check damage interruption
    const healthLoss = this.defuserLastHealth - defuserHealth;
    if (healthLoss >= this.config.damageInterruptThreshold) {
      this.interruptDefuse(frameIndex, 'damage');
      return false;
    }

    // Check excessive movement (moving away from bomb)
    const movementDist = this.calculateDistance(this.defuserLastPosition, defuserPos);
    if (movementDist > 2) {
      // More than 2 units moved per frame indicates active evasion
      this.interruptDefuse(frameIndex, 'movement');
      return false;
    }

    // Progress defuse
    const elapsedSeconds = (frameIndex - this.session.startFrame) * (1 / 60); // Assume 60fps
    const defuseProgress = elapsedSeconds / this.config.defuseTimeSec;
    this.session.progress = Math.min(1, defuseProgress);

    // Store for next frame
    this.defuserLastHealth = defuserHealth;
    this.defuserLastPosition = { ...defuserPos };

    return this.session.progress < 1;
  }

  /**
   * Check if defuse is complete
   */
  isDefuseComplete(): boolean {
    if (!this.session) return false;
    return this.session.progress >= 1 && !this.session.interrupted;
  }

  /**
   * Interrupt defuse attempt
   */
  interruptDefuse(frameIndex: number, reason: DefuseSession['interruptReason']): void {
    if (!this.session) return;

    this.session.interrupted = true;
    this.session.interruptedFrame = frameIndex;
    this.session.interruptReason = reason;
  }

  /**
   * Get current session state
   */
  getSession(): Readonly<DefuseSession | null> {
    return this.session ? { ...this.session } : null;
  }

  /**
   * Get config
   */
  getConfig(): Readonly<DefuseConfig> {
    return { ...this.config };
  }

  /**
   * End defuse session (success or cancel)
   */
  endDefuse(): DefuseSession | null {
    const result = this.session;
    this.session = null;
    return result;
  }

  /**
   * Get defuse progress percentage
   */
  getProgressPercent(): number {
    if (!this.session) return 0;
    return Math.round(this.session.progress * 100);
  }

  /**
   * Get tether status (distance and violation)
   */
  getTetherStatus(): {
    distance: number;
    maxDistance: number;
    valid: boolean;
    percentOfMax: number;
  } {
    const distance = this.session?.tetherDistance ?? 0;
    return {
      distance,
      maxDistance: this.config.tetherRadiusMeters,
      valid: distance <= this.config.tetherRadiusMeters,
      percentOfMax: (distance / this.config.tetherRadiusMeters) * 100,
    };
  }

  /**
   * Get violation reason if defuse was interrupted
   */
  getInterruptionReason(): string {
    if (!this.session || !this.session.interrupted) {
      return '';
    }

    switch (this.session.interruptReason) {
      case 'distance':
        return 'Tether broken (moved too far)';
      case 'damage':
        return 'Interrupted (took damage)';
      case 'movement':
        return 'Interrupted (excessive movement)';
      case 'manual':
        return 'Defuser eliminated';
      default:
        return 'Defuse interrupted';
    }
  }

  private calculateDistance(
    pos1: { x: number; y: number; z: number },
    pos2: { x: number; y: number; z: number },
  ): number {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
