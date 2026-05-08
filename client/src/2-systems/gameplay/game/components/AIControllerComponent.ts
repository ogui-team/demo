import type { Vector3 } from '@engine/1-kernel/core/public-api';

export type AIControllerTargetState = 'position' | 'entity' | 'dormant' | 'lost';

export interface AIControllerComponent {
  readonly type: 'aiController';
  targetPosition?: Vector3 | null;
  targetEntityId?: string | null;
  speed: number;
  repathIntervalMs: number;
  repathTimerMs?: number;
  currentPath?: Vector3[];
  currentPathIndex?: number;
  lastTargetPosition?: Vector3;
  pathRequestId?: number;
  targetState?: AIControllerTargetState;
  lastResolvedAtMs?: number;
}

function isFiniteVector3(value: unknown): value is Vector3 {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Vector3>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z);
}

export function normalizeAIControllerRuntimeState(controller: AIControllerComponent): void {
  const sanitizedPath = Array.isArray(controller.currentPath)
    ? controller.currentPath.filter(isFiniteVector3).map((waypoint) => ({ ...waypoint }))
    : [];

  controller.currentPath = sanitizedPath;
  controller.currentPathIndex = Math.max(0, Math.min(controller.currentPathIndex ?? 0, sanitizedPath.length));
  controller.repathTimerMs = Number.isFinite(controller.repathTimerMs) ? Math.max(0, controller.repathTimerMs ?? 0) : 0;
  controller.pathRequestId = Number.isFinite(controller.pathRequestId) ? controller.pathRequestId : 0;
  controller.lastTargetPosition = isFiniteVector3(controller.lastTargetPosition)
    ? { ...controller.lastTargetPosition }
    : undefined;
  controller.lastResolvedAtMs = Number.isFinite(controller.lastResolvedAtMs)
    ? controller.lastResolvedAtMs
    : undefined;

  if (!isFiniteVector3(controller.targetPosition)) {
    controller.targetPosition = null;
  } else {
    controller.targetPosition = { ...controller.targetPosition };
  }

  if (!controller.targetEntityId) {
    controller.targetEntityId = null;
  }

  if (controller.targetState !== 'position' && controller.targetState !== 'entity' && controller.targetState !== 'dormant' && controller.targetState !== 'lost') {
    controller.targetState = controller.targetEntityId ? 'entity' : (controller.targetPosition ? 'position' : 'lost');
  }
}

export function stripTransientAIControllerState(controller: AIControllerComponent): Record<string, unknown> {
  const {
    currentPath: _currentPath,
    currentPathIndex: _currentPathIndex,
    repathTimerMs: _repathTimerMs,
    pathRequestId: _pathRequestId,
    lastTargetPosition: _lastTargetPosition,
    lastResolvedAtMs: _lastResolvedAtMs,
    ...persisted
  } = controller;

  return {
    ...persisted,
    targetState: persisted.targetEntityId ? 'entity' : (persisted.targetPosition ? 'position' : 'lost'),
  };
}

export function createAIControllerComponent(
  targetPosition: Vector3,
  overrides: Partial<Omit<AIControllerComponent, 'type' | 'targetPosition'>> = {},
): AIControllerComponent {
  const component: AIControllerComponent = {
    type: 'aiController',
    targetPosition: { ...targetPosition },
    targetEntityId: overrides.targetEntityId ?? null,
    speed: overrides.speed ?? 3,
    repathIntervalMs: overrides.repathIntervalMs ?? 250,
    repathTimerMs: overrides.repathTimerMs ?? 0,
    currentPath: overrides.currentPath?.map((waypoint) => ({ ...waypoint })) ?? [],
    currentPathIndex: overrides.currentPathIndex ?? 0,
    lastTargetPosition: overrides.lastTargetPosition ? { ...overrides.lastTargetPosition } : undefined,
    pathRequestId: overrides.pathRequestId ?? 0,
    targetState: overrides.targetState ?? (overrides.targetEntityId ? 'entity' : 'position'),
    lastResolvedAtMs: overrides.lastResolvedAtMs,
  };

  normalizeAIControllerRuntimeState(component);
  return component;
}

export function cancelAIControllerPath(
  controller: AIControllerComponent,
  targetState: AIControllerTargetState = controller.targetState ?? 'position',
): void {
  controller.currentPath = [];
  controller.currentPathIndex = 0;
  controller.repathTimerMs = 0;
  controller.pathRequestId = (controller.pathRequestId ?? 0) + 1;
  controller.targetState = targetState;
}

export function clearAIControllerTarget(
  controller: AIControllerComponent,
  targetState: AIControllerTargetState = 'lost',
): void {
  cancelAIControllerPath(controller, targetState);
  controller.targetEntityId = null;
  controller.targetPosition = null;
  controller.lastTargetPosition = undefined;
  controller.lastResolvedAtMs = Date.now();
}