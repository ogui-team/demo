/**
 * EnemyAIExpansion  —  Tier 2
 * Advanced enemy behaviors extending the base EnemyAI FSM.
 *
 * New additions over EnemyAI.ts:
 *   - A* pathfinding via PathfindingSystem (replaces straight-line movement)
 *   - Stealth detection (sound radius + light exposure)
 *   - Ambush behavior (EnemyType.AMBUSHER)
 *   - Group behavior (alert nearby agents, coordinate flanking)
 *   - Multi-type enemies: ZOMBIE | CRAWLER | GHOST | SHOOTER | AMBUSHER
 *   - AudioEngine integration (footsteps, growls, scream on death)
 *
 * Usage:
 *   import { AdvancedEnemyAI } from './EnemyAIExpansion';
 *
 *   const ai = new AdvancedEnemyAI({ physics, health, pathfinding, audio });
 *   ai.registerAgent('zombie_01', { type: EnemyType.ZOMBIE, waypoints: [...] });
 *   ai.setPlayerGetters([() => playerPos]);
 *   ai.setLightLevel(pos => 0.8); // 0 = dark, 1 = bright
 *   onUpdate(dt => ai.update(dt, entityPositions));
 */

/**
 * Legacy note:
 * AdvancedEnemyAI is not part of the current runtime bootstrap. Live enemy
 * behavior is routed through DummyEnemySystem + PathfindingSystem.
 */

import { Vector3 } from '@engine/1-kernel/core/public-api';
import { PhysicsSystem } from './PhysicsSystem';
import { HealthSystem } from './HealthSystem';
import { PathfindingSystem } from './PathfindingSystem';
import { AudioEngine } from './AudioEngine';
import { AnalyticsService } from './AnalyticsService';

// ─── Enemy types ──────────────────────────────────────────────────────────────

export enum EnemyType {
  ZOMBIE    = 'zombie',    // slow, direct, high HP
  CRAWLER   = 'crawler',   // fast, low to ground, flanks via pathfinding
  GHOST     = 'ghost',     // ignores walls, teleport lunge, silent
  SHOOTER   = 'shooter',   // ranged, keeps distance, seeks cover
  AMBUSHER  = 'ambusher',  // stationary until very close, then burst-sprint
}

// ─── FSM states (extended from base) ─────────────────────────────────────────

export type AdvancedAIState =
  | 'idle'
  | 'patrol'
  | 'chase'
  | 'attack'
  | 'investigate'
  | 'ambush'       // waiting in ambush position
  | 'alerted'      // heard something, turning to look
  | 'flanking'     // taking a path that avoids direct line of sight
  | 'retreating'   // shooter backing away to preferred range
  | 'dead';

// ─── Agent config ─────────────────────────────────────────────────────────────

export interface AdvancedAgentConfig {
  type:               EnemyType;
  waypoints?:         Vector3[];
  waypointTolerance?: number;
  detectionRange?:    number;
  /** For stealth: range at which footsteps/sounds alert this agent. */
  soundDetectRange?:  number;
  /** For stealth: light level threshold (0..1) above which agent can see. */
  lightThreshold?:    number;
  attackRange?:       number;
  attackDamage?:      number;
  attackCooldown?:    number;
  moveSpeed?:         number;
  chaseSpeedMultiplier?: number;
  loseTargetRange?:   number;
  investigateTime?:   number;
  /** Group ID — agents with the same group alert each other. */
  groupId?:           string;
  /** Shooter-type: preferred engagement distance. */
  preferredRange?:    number;
  /** Sounds this agent emits (keys into AudioEngine). */
  sounds?: {
    idle?:   string;
    chase?:  string;
    attack?: string;
    death?:  string;
    alert?:  string;
  };
}

// ─── Runtime agent ────────────────────────────────────────────────────────────

interface AdvancedAgent {
  entityId:      string;
  config:        Required<AdvancedAgentConfig>;
  state:         AdvancedAIState;
  prevState:     AdvancedAIState;

  // Patrol
  waypointIndex:  number;

  // Combat timers
  attackTimer:    number;
  stateTimer:     number;   // generic timer for current state

  // Navigation
  currentPath:    Vector3[];
  pathIndex:      { value: number };
  pathRefreshTimer: number;

  // Target tracking
  lastKnownPlayerPos: Vector3 | null;
  targetPlayerId:     string | null;

  // Stealth
  noiseAlerted:   boolean;   // became aware via sound (not sight)
  alertCooldown:  number;

  // Group coordination
  hasSentAlert:   boolean;
}

// ─── AdvancedEnemyAI ──────────────────────────────────────────────────────────

export class AdvancedEnemyAI {
  private agents:    Map<string, AdvancedAgent>     = new Map();
  private physics?:  PhysicsSystem;
  private health?:   HealthSystem;
  private pathfind?: PathfindingSystem;
  private audio?:    AudioEngine;

  /** Getters for all player positions: [() => pos, ...] */
  private playerGetters: Array<() => { id: string; pos: Vector3 }> = [];

  /** Per-entity light level getter. 0 = dark, 1 = fully lit. */
  private getLightLevel?: (pos: Vector3) => number;

  // Indexed by groupId → list of agent IDs
  private groups: Map<string, string[]> = new Map();

  private static readonly DEFAULTS: Required<AdvancedAgentConfig> = {
    type:               EnemyType.ZOMBIE,
    waypoints:          [],
    waypointTolerance:  0.5,
    detectionRange:     10,
    soundDetectRange:   8,
    lightThreshold:     0.3,
    attackRange:        1.8,
    attackDamage:       15,
    attackCooldown:     1.5,
    moveSpeed:          2.5,
    chaseSpeedMultiplier: 1.6,
    loseTargetRange:    20,
    investigateTime:    6,
    groupId:            '',
    preferredRange:     8,
    sounds:             {},
  };

  constructor(deps: {
    physics?:   PhysicsSystem;
    health?:    HealthSystem;
    pathfind?:  PathfindingSystem;
    audio?:     AudioEngine;
  } = {}) {
    this.physics   = deps.physics;
    this.health    = deps.health;
    this.pathfind  = deps.pathfind;
    this.audio     = deps.audio;
  }

  // ─── Registration ───────────────────────────────────────────────────────

  registerAgent(entityId: string, cfg: AdvancedAgentConfig): void {
    const config = { ...AdvancedEnemyAI.DEFAULTS, ...cfg, sounds: { ...AdvancedEnemyAI.DEFAULTS.sounds, ...(cfg.sounds ?? {}) } };

    const initState: AdvancedAIState =
      config.type === EnemyType.AMBUSHER ? 'ambush' : 'idle';

    this.agents.set(entityId, {
      entityId, config, state: initState, prevState: initState,
      waypointIndex: 0,
      attackTimer: 0, stateTimer: 0,
      currentPath: [], pathIndex: { value: 0 }, pathRefreshTimer: 0,
      lastKnownPlayerPos: null, targetPlayerId: null,
      noiseAlerted: false, alertCooldown: 0,
      hasSentAlert: false,
    });

    if (config.groupId) {
      const group = this.groups.get(config.groupId) ?? [];
      group.push(entityId);
      this.groups.set(config.groupId, group);
    }

    if (this.physics) {
      this.physics.addBody(entityId, {
        shape: 'sphere', radius: 0.5,
        layer: 'enemy', isStatic: false,
      });
    }
    if (this.health) {
      const maxHp = this._typeHP(config.type);
      this.health.register(entityId, { maxHp });
    }

    AnalyticsService.track('enemy_spawned', { entityId, type: config.type });
  }

  removeAgent(entityId: string): void {
    const agent = this.agents.get(entityId);
    if (!agent) return;
    if (agent.config.groupId) {
      const group = this.groups.get(agent.config.groupId) ?? [];
      this.groups.set(agent.config.groupId, group.filter((id) => id !== entityId));
    }
    this.agents.delete(entityId);
    this.physics?.removeBody(entityId);
  }

  // ─── Config ─────────────────────────────────────────────────────────────

  setPlayerGetters(getters: Array<() => { id: string; pos: Vector3 }>): void {
    this.playerGetters = getters;
  }

  setLightLevelGetter(fn: (pos: Vector3) => number): void {
    this.getLightLevel = fn;
  }

  // ─── Alert (group coordination) ─────────────────────────────────────────

  alertGroup(groupId: string, alerterPos: Vector3, targetId: string): void {
    const group = this.groups.get(groupId) ?? [];
    for (const id of group) {
      const agent = this.agents.get(id);
      if (!agent || agent.state === 'dead') continue;
      if (agent.state !== 'chase' && agent.state !== 'attack') {
        agent.state             = 'investigate';
        agent.lastKnownPlayerPos = { ...alerterPos };
        agent.targetPlayerId    = targetId;
        agent.stateTimer        = agent.config.investigateTime;
        agent.noiseAlerted      = true;
        this._playSound(agent, 'alert', alerterPos);
        AnalyticsService.track('enemy_alerted', { entityId: id, groupId, by: 'group' });
      }
    }
  }

  // ─── Main update ─────────────────────────────────────────────────────────

  update(dt: number, entityPositions: Map<string, Vector3>): void {
    const players = this.playerGetters.map((g) => g());

    for (const agent of this.agents.values()) {
      if (agent.state === 'dead') continue;

      const pos = entityPositions.get(agent.entityId);
      if (!pos) continue;

      // Tick timers
      agent.attackTimer    = Math.max(0, agent.attackTimer - dt);
      agent.stateTimer     = Math.max(0, agent.stateTimer  - dt);
      agent.alertCooldown  = Math.max(0, agent.alertCooldown - dt);
      agent.pathRefreshTimer = Math.max(0, agent.pathRefreshTimer - dt);

      // Check if dead
      if (this.health && !this.health.isAlive(agent.entityId)) {
        this._transitionTo(agent, 'dead', pos);
        continue;
      }

      // Stealth: check if alerted by sound
      if (!agent.noiseAlerted && agent.alertCooldown <= 0) {
        for (const { id: pid, pos: ppos } of players) {
          const d = this._dist(pos, ppos);
          if (d < agent.config.soundDetectRange) {
            // Ghost ignores stealth checks — always sees players
            if (agent.config.type !== EnemyType.GHOST) {
              agent.noiseAlerted   = true;
              agent.lastKnownPlayerPos = { ...ppos };
              agent.targetPlayerId = pid;
              agent.alertCooldown  = 10;
              this._transitionTo(agent, 'investigate', pos);
              AnalyticsService.track('enemy_alerted', { entityId: agent.entityId, by: 'sound' });
            }
          }
        }
      }

      // FSM dispatch
      switch (agent.state) {
        case 'idle':       this._stateIdle(agent, dt, pos, players, entityPositions);       break;
        case 'patrol':     this._statePatrol(agent, dt, pos, players, entityPositions);     break;
        case 'investigate':this._stateInvestigate(agent, dt, pos, players, entityPositions);break;
        case 'chase':      this._stateChase(agent, dt, pos, players, entityPositions);      break;
        case 'attack':     this._stateAttack(agent, dt, pos, players, entityPositions);     break;
        case 'ambush':     this._stateAmbush(agent, dt, pos, players, entityPositions);     break;
        case 'alerted':    this._stateAlerted(agent, dt, pos, players, entityPositions);    break;
        case 'retreating': this._stateRetreating(agent, dt, pos, players, entityPositions); break;
        case 'flanking':   this._stateFlanking(agent, dt, pos, players, entityPositions);   break;
      }
    }
  }

  // ─── FSM states ───────────────────────────────────────────────────────────

  private _stateIdle(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    _ep: Map<string, Vector3>
  ): void {
    a.stateTimer -= dt;
    if (a.stateTimer <= 0) {
      a.stateTimer = 2 + Math.random() * 3;
      if (a.config.waypoints.length > 0) this._transitionTo(a, 'patrol', pos);
    }
    const target = this._detectPlayer(a, pos, players);
    if (target) this._beginChase(a, pos, target);
  }

  private _statePatrol(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    const target = this._detectPlayer(a, pos, players);
    if (target) { this._beginChase(a, pos, target); return; }

    const wp = a.config.waypoints;
    if (wp.length === 0) { this._transitionTo(a, 'idle', pos); return; }

    this._moveAlongPath(a, pos, wp[a.waypointIndex], a.config.moveSpeed, dt, ep);

    const wayptPos = wp[a.waypointIndex];
    if (this._dist(pos, wayptPos) < a.config.waypointTolerance) {
      a.waypointIndex = (a.waypointIndex + 1) % wp.length;
    }
  }

  private _stateInvestigate(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    const target = this._detectPlayer(a, pos, players);
    if (target) { this._beginChase(a, pos, target); return; }
    if (!a.lastKnownPlayerPos || a.stateTimer <= 0) {
      a.noiseAlerted = false;
      this._transitionTo(a, 'patrol', pos); return;
    }
    this._moveAlongPath(a, pos, a.lastKnownPlayerPos, a.config.moveSpeed, dt, ep);
    if (this._dist(pos, a.lastKnownPlayerPos) < 1.0) {
      a.stateTimer = Math.max(0, a.stateTimer - dt * 3); // faster drain when reached
    }
  }

  private _stateChase(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    const tgt = this._getTargetPos(a, players);
    if (!tgt) { this._transitionTo(a, 'patrol', pos); return; }

    const dist = this._dist(pos, tgt.pos);
    a.lastKnownPlayerPos = { ...tgt.pos };

    if (dist > a.config.loseTargetRange) {
      this._transitionTo(a, 'investigate', pos); return;
    }

    // Shooter: flank / retreat if at bad distance
    if (a.config.type === EnemyType.SHOOTER) {
      if (dist < a.config.preferredRange * 0.6) { this._transitionTo(a, 'retreating', pos); return; }
      if (dist > a.config.preferredRange * 1.4) { this._transitionTo(a, 'flanking',   pos); return; }
    }

    if (dist <= a.config.attackRange) {
      this._transitionTo(a, 'attack', pos); return;
    }

    // Group: alert on first detection
    if (!a.hasSentAlert && a.config.groupId) {
      this.alertGroup(a.config.groupId, pos, tgt.id);
      a.hasSentAlert = true;
    }

    const speed = a.config.moveSpeed * a.config.chaseSpeedMultiplier;
    this._moveAlongPath(a, pos, tgt.pos, speed, dt, ep);
  }

  private _stateAttack(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    _ep: Map<string, Vector3>
  ): void {
    const tgt = this._getTargetPos(a, players);
    if (!tgt) { this._transitionTo(a, 'patrol', pos); return; }

    const dist = this._dist(pos, tgt.pos);
    if (dist > a.config.attackRange * 1.3) {
      this._transitionTo(a, 'chase', pos); return;
    }

    if (a.attackTimer <= 0) {
      this.health?.applyDamage(tgt.id, {
        amount:   a.config.attackDamage,
        type:     'melee',
        sourceId: a.entityId,
      });
      a.attackTimer = a.config.attackCooldown;
      this._playSound(a, 'attack', pos);
    }
  }

  private _stateAmbush(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    // Stay still until player is within 1/3 of detection range
    const trigger = a.config.detectionRange * 0.33;
    for (const p of players) {
      if (this._dist(pos, p.pos) < trigger) {
        a.config.chaseSpeedMultiplier = 2.5; // burst speed
        this._transitionTo(a, 'chase', pos);
        this._playSound(a, 'alert', pos);
        return;
      }
    }
  }

  private _stateAlerted(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    // Spin in place briefly then investigate
    a.stateTimer -= dt;
    if (a.stateTimer <= 0) this._transitionTo(a, 'investigate', pos);
    const target = this._detectPlayer(a, pos, players);
    if (target) this._beginChase(a, pos, target);
  }

  private _stateRetreating(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    const tgt = this._getTargetPos(a, players);
    if (!tgt) { this._transitionTo(a, 'patrol', pos); return; }
    const dist = this._dist(pos, tgt.pos);
    if (dist >= a.config.preferredRange) {
      this._transitionTo(a, 'chase', pos); return;
    }
    // Move away from player
    const away: Vector3 = {
      x: pos.x + (pos.x - tgt.pos.x),
      y: pos.y,
      z: pos.z + (pos.z - tgt.pos.z),
    };
    this._moveAlongPath(a, pos, away, a.config.moveSpeed, dt, ep);

    // Attack if in range while retreating
    if (dist <= a.config.attackRange && a.attackTimer <= 0) {
      this.health?.applyDamage(tgt.id, { amount: a.config.attackDamage, type: 'bullet', sourceId: a.entityId });
      a.attackTimer = a.config.attackCooldown;
    }
  }

  private _stateFlanking(
    a: AdvancedAgent, dt: number, pos: Vector3,
    players: Array<{id:string;pos:Vector3}>,
    ep: Map<string, Vector3>
  ): void {
    const tgt = this._getTargetPos(a, players);
    if (!tgt) { this._transitionTo(a, 'patrol', pos); return; }
    const dist = this._dist(pos, tgt.pos);
    if (dist <= a.config.preferredRange * 1.1) {
      this._transitionTo(a, 'chase', pos); return;
    }
    // Offset target by 90° for flanking feel
    const dx = tgt.pos.x - pos.x; const dz = tgt.pos.z - pos.z;
    const flankTarget: Vector3 = { x: pos.x + dz, y: pos.y, z: pos.z - dx };
    this._moveAlongPath(a, pos, flankTarget, a.config.moveSpeed * a.config.chaseSpeedMultiplier, dt, ep);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _detectPlayer(
    a: AdvancedAgent, pos: Vector3, players: Array<{id:string;pos:Vector3}>
  ): {id:string;pos:Vector3} | null {
    for (const p of players) {
      const dist = this._dist(pos, p.pos);
      if (dist > a.config.detectionRange) continue;

      // Ghost always detects
      if (a.config.type === EnemyType.GHOST) return p;

      // Check light level for stealth
      const light = this.getLightLevel?.(p.pos) ?? 1;
      if (light < a.config.lightThreshold && dist > a.config.detectionRange * 0.4) continue;

      return p;
    }
    return null;
  }

  private _beginChase(a: AdvancedAgent, pos: Vector3, target: {id:string;pos:Vector3}): void {
    a.targetPlayerId    = target.id;
    a.lastKnownPlayerPos = { ...target.pos };
    a.hasSentAlert      = false;
    this._transitionTo(a, 'chase', pos);
    this._playSound(a, 'chase', pos);
  }

  private _getTargetPos(
    a: AdvancedAgent, players: Array<{id:string;pos:Vector3}>
  ): {id:string;pos:Vector3} | null {
    if (!a.targetPlayerId) return players[0] ?? null;
    return players.find((p) => p.id === a.targetPlayerId) ?? players[0] ?? null;
  }

  private _moveAlongPath(
    a: AdvancedAgent, from: Vector3, to: Vector3, speed: number, dt: number,
    ep: Map<string, Vector3>
  ): void {
    if (!this.pathfind) {
      // Direct movement fallback (Ghost ignores walls too)
      if (this.physics) {
        this.physics.moveToward(a.entityId, to, speed, dt);
        const body = this.physics.getBody(a.entityId);
        if (body) ep.set(a.entityId, { ...body.position });
      }
      return;
    }

    if (a.pathRefreshTimer <= 0 || a.currentPath.length === 0) {
      a.currentPath = this.pathfind.findPath(from, to);
      a.pathIndex   = { value: 0 };
      // Ghost teleports periodically instead of pathing
      if (a.config.type === EnemyType.GHOST && Math.random() < 0.05) {
        ep.set(a.entityId, { ...to, y: from.y }); // short teleport
        return;
      }
      a.pathRefreshTimer = 0.5;
    }

    const dir = this.pathfind.steer(from, a.currentPath, a.pathIndex);
    if (dir) {
      const next: Vector3 = {
        x: from.x + dir.x * speed * dt,
        y: from.y,
        z: from.z + dir.z * speed * dt,
      };
      ep.set(a.entityId, next);
    }
  }

  private _transitionTo(a: AdvancedAgent, state: AdvancedAIState, pos: Vector3): void {
    if (a.state === state) return;
    a.prevState = a.state;
    a.state     = state;

    if (state === 'dead') {
      this._playSound(a, 'death', pos);
      AnalyticsService.track('enemy_killed', { entityId: a.entityId, type: a.config.type });
    }
    if (state === 'idle' || state === 'patrol') {
      a.hasSentAlert    = false;
      a.targetPlayerId  = null;
    }
  }

  private _playSound(a: AdvancedAgent, key: keyof Required<AdvancedAgentConfig>['sounds'], pos: Vector3): void {
    const soundKey = a.config.sounds[key];
    if (this.audio && soundKey) {
      this.audio.playAt(soundKey, pos, { category: 'enemy', entityId: a.entityId });
    }
  }

  private _dist(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x; const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private _typeHP(type: EnemyType): number {
    const hpMap: Record<EnemyType, number> = {
      [EnemyType.ZOMBIE]:   100,
      [EnemyType.CRAWLER]:  50,
      [EnemyType.GHOST]:    75,
      [EnemyType.SHOOTER]:  60,
      [EnemyType.AMBUSHER]: 80,
    };
    return hpMap[type] ?? 100;
  }

  getAgent(entityId: string): AdvancedAgent | undefined {
    return this.agents.get(entityId);
  }

  getAgentState(entityId: string): AdvancedAIState | undefined {
    return this.agents.get(entityId)?.state;
  }
}
