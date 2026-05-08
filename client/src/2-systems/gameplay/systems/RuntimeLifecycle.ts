import { gameBus } from '@engine/1-kernel/core/public-api';
import { createDormantComponent, type DormantComponent } from '../game/components/DormantComponent';
import {
  createRuntimeLifecycleComponent,
  type RuntimeLifecycleComponent,
  type RuntimeLifecycleState,
} from '../game/components/RuntimeLifecycleComponent';

interface EntityComponentLike {
  data: Record<string, any>;
}

interface RuntimeEntityLike {
  id: string;
  isActive: boolean;
  getComponent(name: string): EntityComponentLike | undefined;
  addComponent(component: { name: string; data: Record<string, any> }): void;
}

interface LifecycleStateOptions {
  chunkId?: string | null;
  reason?: string;
}

export function getRuntimeLifecycleState(entity: RuntimeEntityLike): RuntimeLifecycleState {
  const lifecycle = entity.getComponent('runtimeLifecycle')?.data as RuntimeLifecycleComponent | undefined;
  if (lifecycle?.state) {
    return lifecycle.state;
  }
  return entity.isActive ? 'loaded' : 'dormant';
}

export function isEntityDormant(entity: RuntimeEntityLike): boolean {
  const dormant = entity.getComponent('dormant')?.data as DormantComponent | undefined;
  return Boolean(dormant?.active) || getRuntimeLifecycleState(entity) === 'dormant';
}

export function isEntityStreamLoaded(entity: RuntimeEntityLike): boolean {
  const state = getRuntimeLifecycleState(entity);
  return state === 'loaded' || state === 'dormant';
}

export function isEntitySimulationActive(entity: RuntimeEntityLike): boolean {
  return entity.isActive && getRuntimeLifecycleState(entity) === 'loaded' && !isEntityDormant(entity);
}

export function setEntityRuntimeLifecycleState(
  entity: RuntimeEntityLike,
  state: RuntimeLifecycleState,
  options: LifecycleStateOptions = {},
): void {
  const now = Date.now();
  const lifecycle = ensureRuntimeLifecycleComponent(entity);
  const nextChunkId = options.chunkId !== undefined ? options.chunkId : (lifecycle.chunkId ?? null);
  const shouldBeDormant = state === 'dormant';
  const dormant = entity.getComponent('dormant')?.data as DormantComponent | undefined;

  if (
    lifecycle.state === state
    && lifecycle.chunkId === nextChunkId
    && (dormant?.active ?? false) === shouldBeDormant
    && entity.isActive === (state === 'loaded')
  ) {
    return;
  }

  lifecycle.state = state;
  lifecycle.chunkId = nextChunkId;
  lifecycle.updatedAtMs = now;

  const dormantComponent = ensureDormantComponent(entity, shouldBeDormant, options.reason);
  if (dormantComponent) {
    dormantComponent.active = shouldBeDormant;
    dormantComponent.sinceMs = now;
    dormantComponent.reason = options.reason;
  }

  entity.isActive = state === 'loaded';

  gameBus.emit('stateMutation', {
    source: 'runtimeLifecycle',
    path: `entities.${entity.id}.lifecycle`,
    changedCount: 1,
  });
}

function ensureRuntimeLifecycleComponent(entity: RuntimeEntityLike): RuntimeLifecycleComponent {
  const existing = entity.getComponent('runtimeLifecycle')?.data as RuntimeLifecycleComponent | undefined;
  if (existing) {
    return existing;
  }

  const created = createRuntimeLifecycleComponent(entity.isActive ? 'loaded' : 'dormant');
  entity.addComponent({
    name: 'runtimeLifecycle',
    data: created as unknown as Record<string, any>,
  });
  return created;
}

function ensureDormantComponent(
  entity: RuntimeEntityLike,
  shouldCreate: boolean,
  reason: string | undefined,
): DormantComponent | null {
  const existing = entity.getComponent('dormant')?.data as DormantComponent | undefined;
  if (existing) {
    return existing;
  }
  if (!shouldCreate) {
    return null;
  }

  const created = createDormantComponent(false, reason);
  entity.addComponent({
    name: 'dormant',
    data: created as unknown as Record<string, any>,
  });
  return created;
}