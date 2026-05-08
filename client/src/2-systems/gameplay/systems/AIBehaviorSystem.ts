import { gameBus } from '@engine/1-kernel/core/public-api';
import type { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { isEntitySimulationActive } from './RuntimeLifecycle';

/**
 * Legacy note:
 * The active client runtime currently routes enemy updates through
 * DummyEnemySystem + PathfindingSystem in bootstrapClientRuntime.ts.
 * This system remains available for future migration work but is not bootstrapped.
 */

interface AIEntityManagerAdapter {
  getEntities(): Iterable<Entity>;
  getEntity(entityId: string): Entity | undefined;
}

interface AIEntityRendererAdapter {
  syncEntity(entity: Entity): void;
}

interface AIHealthSystemAdapter {
  get(entityId: string): { hp: number; maxHp: number } | undefined;
  heal(entityId: string, amount: number): number;
}

interface AIWorldObjectAuthorityAdapter {
  isServerReplicatedEntity(entityId: string): boolean;
  syncOwnedEntity(entity: Entity): boolean;
}

export type AIBehaviorState = 'chase' | 'linger' | 'support' | 'flying';

export interface AIBehaviorComponentData {
  type: 'ai_behavior';
  enabled?: boolean;
  behaviorId?: string;
  state: AIBehaviorState;
  defaultState?: AIBehaviorState;
  homePosition?: Vector3;
  detectionRange?: number;
  stopRange?: number;
  moveSpeed?: number;
  chaseSpeedMultiplier?: number;
  lingerRadius?: number;
  lingerSpeed?: number;
  supportRange?: number;
  supportHealAmount?: number;
  supportHealCooldown?: number;
  supportHealThreshold?: number;
  supportHealRange?: number;
  flyingHeight?: number;
  hoverAmplitude?: number;
  syncInterval?: number;
}

interface AIBehaviorRecord {
  homePosition: Vector3;
  lastState: AIBehaviorState;
  phase: number;
  healCooldown: number;
  syncCooldown: number;
}

interface AIBehaviorSystemConfig {
  entityManager: AIEntityManagerAdapter;
  entityRenderer: AIEntityRendererAdapter;
  getPlayerEntity: () => Entity | null;
  isEnabled: () => boolean;
  healthSystem?: AIHealthSystemAdapter | null;
  worldObjectAuthority?: AIWorldObjectAuthorityAdapter | null;
}

const DEFAULTS = {
  detectionRange: 12,
  stopRange: 1.6,
  moveSpeed: 2.2,
  chaseSpeedMultiplier: 1.4,
  lingerRadius: 1.8,
  lingerSpeed: 0.9,
  supportRange: 3.2,
  supportHealAmount: 6,
  supportHealCooldown: 1.2,
  supportHealThreshold: 0.7,
  supportHealRange: 4.5,
  flyingHeight: 1.8,
  hoverAmplitude: 0.35,
  syncInterval: 0.12,
} as const;

export const AI_BEHAVIOR_STATES: AIBehaviorState[] = ['chase', 'linger', 'support', 'flying'];

function distance2D(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeState(value: unknown): AIBehaviorState {
  return AI_BEHAVIOR_STATES.includes(value as AIBehaviorState) ? value as AIBehaviorState : 'linger';
}

function copyVector3(value: Vector3): Vector3 {
  return { x: value.x, y: value.y, z: value.z };
}

export class AIBehaviorSystem {
  private readonly entityManager: AIEntityManagerAdapter;
  private readonly entityRenderer: AIEntityRendererAdapter;
  private readonly getPlayerEntity: () => Entity | null;
  private readonly isEnabled: () => boolean;
  private readonly healthSystem: AIHealthSystemAdapter | null;
  private readonly worldObjectAuthority: AIWorldObjectAuthorityAdapter | null;
  private readonly tracked = new Map<string, AIBehaviorRecord>();
  private readonly lifecycleDisposers: Array<() => void> = [];
  private systemContext: SystemContext | null = null;
  private lastTrackedCount = 0;
  private lastMovedCount = 0;
  private lastTransitionCount = 0;
  private hordeActive = false;

  constructor(config: AIBehaviorSystemConfig) {
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer;
    this.getPlayerEntity = config.getPlayerEntity;
    this.isEnabled = config.isEnabled;
    this.healthSystem = config.healthSystem ?? null;
    this.worldObjectAuthority = config.worldObjectAuthority ?? null;
    this.lifecycleDisposers.push(
      gameBus.on('AI_BEHAVIOR_STATE_SET_REQUESTED', ({ entityId, state, source }) => {
        this.setBehaviorState(entityId, state as any, source as any);
      }),
      gameBus.on('ENGINE_RESET', () => {
        this.hordeActive = false;
        this.clearRuntimeState();
      }),
      gameBus.on('ROUND_TRANSITION', () => {
        this.hordeActive = false;
        this.clearRuntimeState();
      }),
      (gameBus as any).on('HORDE_START_CONFIRMED', () => {
        this.hordeActive = true;
        console.log('[AIBehaviorSystem] Horde mode active — damage authority transferred to server');
      }),
    );
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  destroy(): void {
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
    this.clearRuntimeState();
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    const stateCounts: Record<AIBehaviorState, number> = {
      chase: 0,
      linger: 0,
      support: 0,
      flying: 0,
    };

    for (const entity of this.entityManager.getEntities()) {
      const ai = this.getAIComponent(entity);
      if (!ai || ai.enabled === false) continue;
      if (!isEntitySimulationActive(entity)) continue;
      stateCounts[normalizeState(ai.state)] += 1;
    }

    return {
      status: this.isEnabled() ? 'active' : 'idle',
      active: this.isEnabled(),
      metrics: {
        trackedEntities: this.lastTrackedCount,
        movedEntities: this.lastMovedCount,
        transitions: this.lastTransitionCount,
        stateCounts,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  clearRuntimeState(): void {
    this.tracked.clear();
    this.lastTrackedCount = 0;
    this.lastMovedCount = 0;
    this.lastTransitionCount = 0;
  }

  getBehaviorState(entityId: string): AIBehaviorState | null {
    const entity = this.entityManager.getEntity(entityId);
    const ai = entity ? this.getAIComponent(entity) : null;
    return ai ? normalizeState(ai.state) : null;
  }

  setBehaviorState(
    entityId: string,
    state: AIBehaviorState,
    source: 'editor_inspector' | 'runtime_debug' | 'system' = 'system',
  ): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return false;

    const ai = this.getAIComponent(entity);
    if (!ai) return false;

    const nextState = normalizeState(state);
    const previousState = normalizeState(ai.state ?? ai.defaultState);
    if (previousState === nextState) return true;

    ai.state = nextState;
    const record = this.ensureRecord(entity, ai);
    record.lastState = nextState;
    record.phase = 0;
    record.healCooldown = 0;

    gameBus.emit('AI_BEHAVIOR_STATE_CHANGED', {
      entityId,
      previousState,
      state: nextState,
      source,
    });
    return true;
  }

  update(dt: number): void {
    if (!this.isEnabled()) return;

    const safeDt = clamp(dt, 0, 0.1);
    const playerEntity = this.getPlayerEntity();
    const playerId = playerEntity?.id ?? null;
    const playerPosition = playerEntity?.getPosition() ?? null;
    const activeIds = new Set<string>();
    let trackedCount = 0;
    let movedCount = 0;
    let transitionCount = 0;

    for (const entity of this.entityManager.getEntities()) {
      const ai = this.getAIComponent(entity);
      if (!ai || ai.enabled === false) continue;
      if (!isEntitySimulationActive(entity)) continue;
      if (this.worldObjectAuthority?.isServerReplicatedEntity(entity.id)) continue;

      trackedCount += 1;
      activeIds.add(entity.id);
      const record = this.ensureRecord(entity, ai);
      const currentState = normalizeState(ai.state ?? ai.defaultState);
      if (record.lastState !== currentState) {
        gameBus.emit('AI_BEHAVIOR_STATE_CHANGED', {
          entityId: entity.id,
          previousState: record.lastState,
          state: currentState,
          source: 'component_sync',
        });
        record.lastState = currentState;
        record.phase = 0;
        transitionCount += 1;
      }

      record.phase += safeDt * Math.max(0.1, ai.lingerSpeed ?? DEFAULTS.lingerSpeed);
      record.healCooldown = Math.max(0, record.healCooldown - safeDt);
      record.syncCooldown = Math.max(0, record.syncCooldown - safeDt);

      const currentPosition = entity.getPosition();
      const currentRotation = entity.getRotation();
      const target = this.resolveTargetPosition(ai, record, currentPosition, playerPosition);
      const nextPosition = this.moveToward(currentPosition, target.position, target.speed, safeDt);
      const nextRotation = target.faceTarget
        ? { x: 0, y: this.resolveYaw(currentPosition, target.faceTarget), z: 0 }
        : currentRotation;

      const moved =
        Math.abs(nextPosition.x - currentPosition.x) > 0.001 ||
        Math.abs(nextPosition.y - currentPosition.y) > 0.001 ||
        Math.abs(nextPosition.z - currentPosition.z) > 0.001;
      const rotated = Math.abs(nextRotation.y - currentRotation.y) > 0.01;

      if (currentState === 'support' && playerId) {
        this.trySupportHeal(playerId, playerPosition, nextPosition, ai, record);
      }

      this.syncAnimationState(entity, moved, currentState);

      if (moved) {
        entity.setPosition(nextPosition);
      }
      if (rotated) {
        entity.setRotation(nextRotation);
      }
      if (moved || rotated) {
        this.entityRenderer.syncEntity(entity);
        movedCount += moved ? 1 : 0;
      }
      if (moved && record.syncCooldown <= 0 && this.worldObjectAuthority?.syncOwnedEntity(entity)) {
        record.syncCooldown = ai.syncInterval ?? DEFAULTS.syncInterval;
      }
    }

    for (const entityId of [...this.tracked.keys()]) {
      if (!activeIds.has(entityId)) {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity || !this.getAIComponent(entity)) {
          this.tracked.delete(entityId);
        }
      }
    }

    this.lastTrackedCount = trackedCount;
    this.lastMovedCount = movedCount;
    this.lastTransitionCount = transitionCount;
  }

  private getAIComponent(entity: Entity): AIBehaviorComponentData | null {
    const data = entity.getComponent('ai_behavior')?.data as AIBehaviorComponentData | undefined;
    if (!data) return null;
    data.state = normalizeState(data.state ?? data.defaultState);
    return data;
  }

  private ensureRecord(entity: Entity, ai: AIBehaviorComponentData): AIBehaviorRecord {
    const existing = this.tracked.get(entity.id);
    if (existing) return existing;

    const homePosition = copyVector3(ai.homePosition ?? entity.getPosition());
    ai.homePosition = copyVector3(homePosition);

    const created: AIBehaviorRecord = {
      homePosition,
      lastState: normalizeState(ai.state ?? ai.defaultState),
      phase: 0,
      healCooldown: 0,
      syncCooldown: 0,
    };
    this.tracked.set(entity.id, created);
    return created;
  }

  private resolveTargetPosition(
    ai: AIBehaviorComponentData,
    record: AIBehaviorRecord,
    currentPosition: Vector3,
    playerPosition: Vector3 | null,
  ): { position: Vector3; speed: number; faceTarget: Vector3 | null } {
    const state = normalizeState(ai.state);
    const detectionRange = ai.detectionRange ?? DEFAULTS.detectionRange;
    const moveSpeed = ai.moveSpeed ?? DEFAULTS.moveSpeed;
    const stopRange = ai.stopRange ?? DEFAULTS.stopRange;
    const lingerRadius = ai.lingerRadius ?? DEFAULTS.lingerRadius;
    const lingerSpeed = ai.lingerSpeed ?? DEFAULTS.lingerSpeed;
    const supportRange = ai.supportRange ?? DEFAULTS.supportRange;
    const flyingHeight = ai.flyingHeight ?? DEFAULTS.flyingHeight;
    const hoverAmplitude = ai.hoverAmplitude ?? DEFAULTS.hoverAmplitude;
    const chaseSpeed = moveSpeed * (ai.chaseSpeedMultiplier ?? DEFAULTS.chaseSpeedMultiplier);

    if (state === 'chase') {
      if (playerPosition && distance2D(currentPosition, playerPosition) <= detectionRange) {
        const targetPosition = copyVector3(playerPosition);
        targetPosition.y = record.homePosition.y;
        return {
          position: this.applyStopRange(currentPosition, targetPosition, stopRange),
          speed: chaseSpeed,
          faceTarget: playerPosition,
        };
      }
      return {
        position: copyVector3(record.homePosition),
        speed: moveSpeed,
        faceTarget: record.homePosition,
      };
    }

    if (state === 'support') {
      if (!playerPosition) {
        return {
          position: copyVector3(record.homePosition),
          speed: moveSpeed,
          faceTarget: record.homePosition,
        };
      }

      const angle = record.phase * Math.max(0.4, lingerSpeed);
      const offset = {
        x: Math.cos(angle) * supportRange,
        y: 0,
        z: Math.sin(angle) * supportRange,
      };
      const targetPosition = {
        x: playerPosition.x + offset.x,
        y: record.homePosition.y,
        z: playerPosition.z + offset.z,
      };
      return {
        position: targetPosition,
        speed: moveSpeed,
        faceTarget: playerPosition,
      };
    }

    if (state === 'flying') {
      const anchor = playerPosition && distance2D(currentPosition, playerPosition) <= detectionRange
        ? playerPosition
        : record.homePosition;
      const orbitRadius = Math.max(lingerRadius, stopRange + 0.8);
      const angle = record.phase * Math.max(0.8, lingerSpeed);
      return {
        position: {
          x: anchor.x + Math.cos(angle) * orbitRadius,
          y: anchor.y + flyingHeight + Math.sin(angle * 2) * hoverAmplitude,
          z: anchor.z + Math.sin(angle) * orbitRadius,
        },
        speed: moveSpeed * 1.15,
        faceTarget: anchor,
      };
    }

    const lingerAngle = record.phase * Math.max(0.5, lingerSpeed);
    return {
      position: {
        x: record.homePosition.x + Math.cos(lingerAngle) * lingerRadius,
        y: record.homePosition.y,
        z: record.homePosition.z + Math.sin(lingerAngle) * lingerRadius,
      },
      speed: moveSpeed * 0.75,
      faceTarget: record.homePosition,
    };
  }

  private applyStopRange(currentPosition: Vector3, targetPosition: Vector3, stopRange: number): Vector3 {
    const dx = targetPosition.x - currentPosition.x;
    const dz = targetPosition.z - currentPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= stopRange || distance <= 0.0001) {
      return currentPosition;
    }
    const t = (distance - stopRange) / distance;
    return {
      x: currentPosition.x + dx * t,
      y: targetPosition.y,
      z: currentPosition.z + dz * t,
    };
  }

  private moveToward(currentPosition: Vector3, targetPosition: Vector3, speed: number, dt: number): Vector3 {
    const dx = targetPosition.x - currentPosition.x;
    const dy = targetPosition.y - currentPosition.y;
    const dz = targetPosition.z - currentPosition.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= 0.0001) return currentPosition;

    const step = Math.min(speed * dt, distance);
    return {
      x: currentPosition.x + (dx / distance) * step,
      y: currentPosition.y + (dy / distance) * Math.min(1, dt * 4),
      z: currentPosition.z + (dz / distance) * step,
    };
  }

  private resolveYaw(currentPosition: Vector3, targetPosition: Vector3): number {
    const dx = targetPosition.x - currentPosition.x;
    const dz = targetPosition.z - currentPosition.z;
    if (Math.abs(dx) <= 0.0001 && Math.abs(dz) <= 0.0001) return 0;
    return Math.atan2(-dx, -dz);
  }

  private trySupportHeal(
    playerId: string,
    playerPosition: Vector3 | null,
    currentPosition: Vector3,
    ai: AIBehaviorComponentData,
    record: AIBehaviorRecord,
  ): void {
    if (!playerPosition || !this.healthSystem || record.healCooldown > 0) return;

    const health = this.healthSystem.get(playerId);
    if (!health || health.maxHp <= 0) return;

    const hpFraction = health.hp / health.maxHp;
    const threshold = ai.supportHealThreshold ?? DEFAULTS.supportHealThreshold;
    const healRange = ai.supportHealRange ?? DEFAULTS.supportHealRange;
    if (hpFraction > threshold) return;
    if (distance2D(currentPosition, playerPosition) > healRange) return;

    const healed = this.healthSystem.heal(playerId, ai.supportHealAmount ?? DEFAULTS.supportHealAmount);
    if (healed > 0) {
      record.healCooldown = ai.supportHealCooldown ?? DEFAULTS.supportHealCooldown;
    }
  }

  private syncAnimationState(entity: Entity, moved: boolean, state: AIBehaviorState): void {
    const movement = entity.getComponent('movement')?.data as { isMoving?: boolean } | undefined;
    if (movement) {
      movement.isMoving = moved;
    }

    const animation = entity.getComponent('animation')?.data as { state?: string } | undefined;
    if (animation) {
      animation.state = moved ? state : 'idle';
    }
  }
}
