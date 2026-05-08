/**
 * DRIFT BOMB CONTROLLER
 * Manages moving bomb mechanics, pathing, and tether mechanics
 * Authority owned via EngineController
 */

export interface BombWaypoint {
  position: { x: number; y: number; z: number };
  order: number;
  epoch: number;
}

export interface BombDriftState {
  isMoving: boolean;
  currentWaypointIndex: number;
  progressToNextWaypoint: number; // 0-1
  velocity: { x: number; y: number; z: number };
  driftStartFrame: number;
  determinismEpoch: number;
}

export interface DefuseTether {
  defuserEntityId: string;
  maxDistance: number;
  isActive: boolean;
  distanceBroken: boolean;
  losRequired: boolean;
}

export class DriftBombBombController {
  private waypoints: BombWaypoint[] = [];
  private driftState: BombDriftState;
  private defuseTether: DefuseTether | null = null;

  constructor() {
    this.driftState = {
      isMoving: false,
      currentWaypointIndex: 0,
      progressToNextWaypoint: 0,
      velocity: { x: 0, y: 0, z: 0 },
      driftStartFrame: 0,
      determinismEpoch: 0,
    };
  }

  /**
   * Initialize bomb drift path
   * Must be deterministic and match across replays
   */
  initializeDriftPath(waypoints: BombWaypoint[]): void {
    if (waypoints.length < 2) {
      throw new Error('DriftPath requires at least 2 waypoints');
    }

    // Sort by order for determinism
    this.waypoints = waypoints.sort((a, b) => a.order - b.order);
    this.driftState.determinismEpoch += 1;
  }

  /**
   * Start bomb moving along path
   */
  startDrift(frameIndex: number): void {
    if (this.waypoints.length < 2) {
      throw new Error('Cannot start drift without initialized path');
    }

    this.driftState.isMoving = true;
    this.driftState.driftStartFrame = frameIndex;
    this.driftState.currentWaypointIndex = 0;
    this.driftState.progressToNextWaypoint = 0;
    this.driftState.determinismEpoch += 1;
  }

  /**
   * Update bomb position along path
   * Called each frame with deterministic dt
   */
  updateDriftPosition(frameIndex: number, dtSeconds: number): { x: number; y: number; z: number } {
    if (!this.driftState.isMoving || this.waypoints.length < 2) {
      return this.waypoints[0]?.position ?? { x: 0, y: 0, z: 0 };
    }

    // Advance progress along current segment
    const speedPerSecond = 10; // units/sec
    this.driftState.progressToNextWaypoint += (dtSeconds * speedPerSecond) / this.getSegmentLength();

    // Move to next waypoint if segment complete
    if (this.driftState.progressToNextWaypoint >= 1.0) {
      this.driftState.currentWaypointIndex += 1;
      this.driftState.progressToNextWaypoint = 0;

      // Loop or end drift
      if (this.driftState.currentWaypointIndex >= this.waypoints.length) {
        this.driftState.isMoving = false;
        this.driftState.currentWaypointIndex = this.waypoints.length - 1;
      }
    }

    // Interpolate current position
    const position = this.interpolatePosition();

    return position;
  }

  /**
   * Defuser attempts to establish tether
   * Must stay within radius and maintain LOS
   */
  activateDefuseTether(defuserEntityId: string, maxDistance: number, requireLOS: boolean): void {
    this.defuseTether = {
      defuserEntityId,
      maxDistance,
      isActive: true,
      distanceBroken: false,
      losRequired: requireLOS,
    };
  }

  /**
   * Check if tether is still valid
   */
  validateTether(defuserPosition: { x: number; y: number; z: number }): boolean {
    if (!this.defuseTether || !this.defuseTether.isActive) {
      return false;
    }

    const bombPos = this.interpolatePosition();
    const distance = Math.sqrt(
      Math.pow(defuserPosition.x - bombPos.x, 2) +
        Math.pow(defuserPosition.y - bombPos.y, 2) +
        Math.pow(defuserPosition.z - bombPos.z, 2),
    );

    const valid = distance <= this.defuseTether.maxDistance;

    if (!valid && !this.defuseTether.distanceBroken) {
      this.defuseTether.distanceBroken = true;
    }

    return valid;
  }

  getDriftState(): Readonly<BombDriftState> {
    return { ...this.driftState };
  }

  getWaypoints(): readonly BombWaypoint[] {
    return [...this.waypoints];
  }

  getTetherState(): DefuseTether | null {
    return this.defuseTether ? { ...this.defuseTether } : null;
  }

  private getSegmentLength(): number {
    if (this.driftState.currentWaypointIndex >= this.waypoints.length - 1) {
      return 1;
    }

    const from = this.waypoints[this.driftState.currentWaypointIndex].position;
    const to = this.waypoints[this.driftState.currentWaypointIndex + 1].position;

    return Math.sqrt(
      Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2) + Math.pow(to.z - from.z, 2),
    );
  }

  private interpolatePosition(): { x: number; y: number; z: number } {
    if (this.driftState.currentWaypointIndex >= this.waypoints.length - 1) {
      return this.waypoints[this.waypoints.length - 1].position;
    }

    const from = this.waypoints[this.driftState.currentWaypointIndex].position;
    const to = this.waypoints[this.driftState.currentWaypointIndex + 1].position;
    const t = this.driftState.progressToNextWaypoint;

    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    };
  }
}
