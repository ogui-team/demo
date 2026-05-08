/**
 * EnemyAI
 * Finite-State Machine for enemy agents: Idle → Patrol → Chase → Attack → Dead
 *
 * Integrates with:
 *   - PhysicsSystem  — movement via moveToward + collision bodies
 *   - HealthSystem   — death transitions, damage application
 *   - SceneGraph     — optional (pass in for spatial hierarchy queries)
 *   - TransformSystem / EntityManager — read/write positions
 *
 * Usage:
 *   import { EnemyAISystem } from './systems/EnemyAI';
 *
 *   const ai = new EnemyAISystem(physicsSystem, healthSystem);
 *   ai.registerAgent('zombie_01', {
 *     waypoints: [{x:0,y:0,z:5}, {x:5,y:0,z:5}, {x:5,y:0,z:0}],
 *     detectionRange: 10,
 *     attackRange: 1.5,
 *     attackDamage: 20,
 *     attackCooldown: 1.2,
 *     moveSpeed: 3,
 *   });
 *   ai.setPlayerPosition(() => camera.position);  // supply player pos getter
 *   onUpdate((dt) => ai.update(dt, entityPositionMap));
 */

/**
 * Legacy note:
 * The active client bootstrap uses DummyEnemySystem + PathfindingSystem for live
 * enemy runtime updates. EnemyAISystem is retained for compatibility but is not
 * part of the current bootstrap path.
 */

import { Vector3 } from '@engine/1-kernel/core/public-api';
import { PhysicsSystem } from './PhysicsSystem';
import { HealthSystem } from './HealthSystem';

// ─── FSM States ───────────────────────────────────────────────────────────────

export type AIState = 'idle' | 'patrol' | 'chase' | 'attack' | 'investigate' | 'dead';

// ─── Agent config ─────────────────────────────────────────────────────────────

export interface AIAgentConfig {
  /** World-space waypoints for patrol loop. */
  waypoints?: Vector3[];
  /** How close the agent must get to a waypoint before moving to the next. */
  waypointTolerance?: number;
  /** Detection radius (switch to Chase). */
  detectionRange?: number;
  /** Attack reach (switch to Attack). */
  attackRange?: number;
  /** Damage per attack hit. */
  attackDamage?: number;
  /** Seconds between attacks. */
  attackCooldown?: number;
  /** World units per second while patrolling. */
  moveSpeed?: number;
  /** Multiplier applied to moveSpeed while chasing. */
  chaseSpeedMultiplier?: number;
  /** If the player leaves this radius the agent returns to Patrol. */
  loseTargetRange?: number;
  /** How long the AI investigates the last known position before giving up. */
  investigateTime?: number;
  /** Physics layer for the enemy body. */
  physicsLayer?: string;
}

// ─── Agent runtime ────────────────────────────────────────────────────────────

export interface AIAgent {
  entityId: string;
  state: AIState;
  waypoints: Vector3[];
  waypointIndex: number;
  waypointTolerance: number;
  detectionRange: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  attackTimer: number;
  moveSpeed: number;
  chaseSpeedMultiplier: number;
  loseTargetRange: number;
  investigateTime: number;
  investigateTimer: number;
  lastKnownPlayerPos: Vector3 | null;
  /** Current world position (updated by caller each frame). */
  position: Vector3;
}

export type AIStateChangeCallback = (entityId: string, from: AIState, to: AIState) => void;
export type AIAttackCallback      = (entityId: string, targetId: string, damage: number) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function v3dist(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function v3dist2d(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function v3copy(v: Vector3): Vector3 {
  return { x: v.x, y: v.y, z: v.z };
}

// ─── EnemyAISystem ────────────────────────────────────────────────────────────

export class EnemyAISystem {
  private agents: Map<string, AIAgent> = new Map();
  private physics: PhysicsSystem;
  private health: HealthSystem;

  private stateChangeCallbacks: AIStateChangeCallback[] = [];
  private attackCallbacks: AIAttackCallback[] = [];

  /** Getter supplied by the game to return the current player world position. */
  private getPlayerPosition: (() => Vector3) | null = null;
  /** Player entity ID for HealthSystem damage application. */
  private playerId: string = 'player';

  constructor(physicsSystem: PhysicsSystem, healthSystem: HealthSystem) {
    this.physics = physicsSystem;
    this.health  = healthSystem;
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────

  /** Provide a function returning the player's current world position. */
  setPlayerPosition(getter: () => Vector3): void {
    this.getPlayerPosition = getter;
  }

  setPlayerId(id: string): void {
    this.playerId = id;
  }

  // ─── Agent management ──────────────────────────────────────────────────────

  registerAgent(entityId: string, cfg: AIAgentConfig = {}): AIAgent {
    const agent: AIAgent = {
      entityId,
      state: cfg.waypoints && cfg.waypoints.length > 0 ? 'patrol' : 'idle',
      waypoints: cfg.waypoints ?? [],
      waypointIndex: 0,
      waypointTolerance: cfg.waypointTolerance ?? 0.8,
      detectionRange: cfg.detectionRange ?? 12,
      attackRange: cfg.attackRange ?? 1.8,
      attackDamage: cfg.attackDamage ?? 15,
      attackCooldown: cfg.attackCooldown ?? 1.5,
      attackTimer: 0,
      moveSpeed: cfg.moveSpeed ?? 3,
      chaseSpeedMultiplier: cfg.chaseSpeedMultiplier ?? 1.6,
      loseTargetRange: cfg.loseTargetRange ?? (cfg.detectionRange ? cfg.detectionRange * 1.5 : 18),
      investigateTime: cfg.investigateTime ?? 4,
      investigateTimer: 0,
      lastKnownPlayerPos: null,
      position: { x: 0, y: 0, z: 0 },
    };

    this.agents.set(entityId, agent);
    return agent;
  }

  unregisterAgent(entityId: string): void {
    this.agents.delete(entityId);
  }

  getAgent(entityId: string): AIAgent | undefined {
    return this.agents.get(entityId);
  }

  // ─── Per-frame update ──────────────────────────────────────────────────────

  /**
   * Call once per frame.
   * @param deltaTime       Seconds since last frame.
   * @param entityPositions Current world positions — the AI reads and writes through this map.
   *                        Caller is responsible for applying returned positions to the real entities.
   */
  update(deltaTime: number, entityPositions: Map<string, Vector3>): void {
    const dt = Math.min(deltaTime, 0.1);
    const playerPos = this.getPlayerPosition?.() ?? null;

    this.agents.forEach((agent) => {
      // Sync position from world
      const worldPos = entityPositions.get(agent.entityId);
      if (worldPos) agent.position = { ...worldPos };

      // Skip if dead
      if (agent.state === 'dead') {
        if (!this.health.isAlive(agent.entityId)) return; // still dead
        // If revived externally, fall back to patrol/idle
        this._transition(agent, agent.waypoints.length > 0 ? 'patrol' : 'idle');
        return;
      }

      // Check for HealthSystem-triggered death
      if (!this.health.isAlive(agent.entityId)) {
        this._transition(agent, 'dead');
        return;
      }

      // Attack cooldown
      if (agent.attackTimer > 0) agent.attackTimer -= dt;

      // ── State machine ────────────────────────────────────────────────────
      switch (agent.state) {
        case 'idle':
          this._tickIdle(agent, dt, playerPos);
          break;
        case 'patrol':
          this._tickPatrol(agent, dt, playerPos);
          break;
        case 'chase':
          this._tickChase(agent, dt, playerPos);
          break;
        case 'attack':
          this._tickAttack(agent, dt, playerPos);
          break;
        case 'investigate':
          this._tickInvestigate(agent, dt, playerPos);
          break;
      }

      // Write position back so PhysicsSystem and EntityManager pick it up
      entityPositions.set(agent.entityId, { ...agent.position });
    });
  }

  // ─── State ticks ───────────────────────────────────────────────────────────

  private _tickIdle(agent: AIAgent, _dt: number, playerPos: Vector3 | null): void {
    if (playerPos && v3dist2d(agent.position, playerPos) <= agent.detectionRange) {
      agent.lastKnownPlayerPos = v3copy(playerPos);
      this._transition(agent, 'chase');
    }
  }

  private _tickPatrol(agent: AIAgent, dt: number, playerPos: Vector3 | null): void {
    // Detection check
    if (playerPos && v3dist2d(agent.position, playerPos) <= agent.detectionRange) {
      agent.lastKnownPlayerPos = v3copy(playerPos);
      this._transition(agent, 'chase');
      return;
    }

    if (agent.waypoints.length === 0) {
      this._transition(agent, 'idle');
      return;
    }

    const target = agent.waypoints[agent.waypointIndex];
    this._moveTo(agent, target, agent.moveSpeed, dt);

    if (v3dist2d(agent.position, target) < agent.waypointTolerance) {
      agent.waypointIndex = (agent.waypointIndex + 1) % agent.waypoints.length;
    }
  }

  private _tickChase(agent: AIAgent, dt: number, playerPos: Vector3 | null): void {
    if (!playerPos) {
      this._startInvestigate(agent);
      return;
    }

    const distToPlayer = v3dist2d(agent.position, playerPos);
    agent.lastKnownPlayerPos = v3copy(playerPos);

    // Lost the player
    if (distToPlayer > agent.loseTargetRange) {
      this._startInvestigate(agent);
      return;
    }

    // Within attack range
    if (distToPlayer <= agent.attackRange) {
      this._transition(agent, 'attack');
      return;
    }

    // Move toward player
    const chaseSpeed = agent.moveSpeed * agent.chaseSpeedMultiplier;
    this._moveTo(agent, playerPos, chaseSpeed, dt);
  }

  private _tickAttack(agent: AIAgent, dt: number, playerPos: Vector3 | null): void {
    if (!playerPos) {
      this._startInvestigate(agent);
      return;
    }

    const distToPlayer = v3dist2d(agent.position, playerPos);

    // Player escaped
    if (distToPlayer > agent.attackRange * 1.5) {
      this._transition(agent, 'chase');
      return;
    }

    // Execute attack when cooldown ready
    if (agent.attackTimer <= 0) {
      this._doAttack(agent);
      agent.attackTimer = agent.attackCooldown;
    }

    // Slowly creep toward player even while attacking
    const creepSpeed = agent.moveSpeed * 0.4;
    this._moveTo(agent, playerPos, creepSpeed, dt);
  }

  private _tickInvestigate(agent: AIAgent, dt: number, playerPos: Vector3 | null): void {
    // Re-detect player
    if (playerPos && v3dist2d(agent.position, playerPos) <= agent.detectionRange) {
      agent.lastKnownPlayerPos = v3copy(playerPos);
      this._transition(agent, 'chase');
      return;
    }

    agent.investigateTimer -= dt;

    if (agent.lastKnownPlayerPos) {
      this._moveTo(agent, agent.lastKnownPlayerPos, agent.moveSpeed, dt);

      if (v3dist(agent.position, agent.lastKnownPlayerPos) < agent.waypointTolerance) {
        agent.lastKnownPlayerPos = null;
      }
    }

    if (agent.investigateTimer <= 0) {
      this._transition(agent, agent.waypoints.length > 0 ? 'patrol' : 'idle');
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  private _doAttack(agent: AIAgent): void {
    const dmg = this.health.applyDamage(this.playerId, {
      amount:   agent.attackDamage,
      type:     'melee',
      sourceId: agent.entityId,
    });
    this.attackCallbacks.forEach((cb) => cb(agent.entityId, this.playerId, dmg));
  }

  private _moveTo(agent: AIAgent, target: Vector3, speed: number, dt: number): void {
    // Move via PhysicsSystem if body exists, otherwise update position directly
    if (this.physics.hasBody(agent.entityId)) {
      this.physics.moveToward(agent.entityId, target, speed, dt);
      const body = this.physics.getBody(agent.entityId);
      if (body) agent.position = { ...body.position };
    } else {
      // Direct delta movement (no physics body)
      const dx = target.x - agent.position.x;
      const dz = target.z - agent.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.01) {
        const step = Math.min(speed * dt, dist);
        agent.position.x += (dx / dist) * step;
        agent.position.z += (dz / dist) * step;
      }
    }
  }

  private _startInvestigate(agent: AIAgent): void {
    agent.investigateTimer = agent.investigateTime;
    this._transition(agent, 'investigate');
  }

  private _transition(agent: AIAgent, to: AIState): void {
    if (agent.state === to) return;
    const from = agent.state;
    agent.state = to;
    this.stateChangeCallbacks.forEach((cb) => cb(agent.entityId, from, to));
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  onStateChange(cb: AIStateChangeCallback): () => void {
    this.stateChangeCallbacks.push(cb);
    return () => { this.stateChangeCallbacks = this.stateChangeCallbacks.filter((c) => c !== cb); };
  }

  onAttack(cb: AIAttackCallback): () => void {
    this.attackCallbacks.push(cb);
    return () => { this.attackCallbacks = this.attackCallbacks.filter((c) => c !== cb); };
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  getState(entityId: string): AIState | undefined {
    return this.agents.get(entityId)?.state;
  }

  isAgentAlive(entityId: string): boolean {
    const agent = this.agents.get(entityId);
    return agent != null && agent.state !== 'dead';
  }

  getAllAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /** Force an agent into a specific state (useful for scripted sequences). */
  forceState(entityId: string, state: AIState): void {
    const agent = this.agents.get(entityId);
    if (agent) this._transition(agent, state);
  }

  /** Add or replace waypoints for an agent at runtime. */
  setWaypoints(entityId: string, waypoints: Vector3[]): void {
    const agent = this.agents.get(entityId);
    if (!agent) return;
    agent.waypoints = waypoints.map(v3copy);
    agent.waypointIndex = 0;
    if (agent.state === 'idle' && waypoints.length > 0) {
      this._transition(agent, 'patrol');
    }
  }
}
