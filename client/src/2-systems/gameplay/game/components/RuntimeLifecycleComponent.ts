export type RuntimeLifecycleState = 'loaded' | 'dormant' | 'streamingOut' | 'unloaded';

export interface RuntimeLifecycleComponent {
  readonly type: 'runtimeLifecycle';
  state: RuntimeLifecycleState;
  chunkId?: string | null;
  updatedAtMs: number;
}

export function createRuntimeLifecycleComponent(
  state: RuntimeLifecycleState = 'loaded',
  chunkId: string | null = null,
): RuntimeLifecycleComponent {
  return {
    type: 'runtimeLifecycle',
    state,
    chunkId,
    updatedAtMs: Engine.time.now(),
  };
}