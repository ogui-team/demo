/**
 * ScriptComponent
 * Attaches custom per-tick behaviour to an EngineObject.
 *
 * Keep all logic pure (no DOM / renderer access).  Scripts receive a
 * lightweight context with read/write access to the owning object's
 * component data via the StateManager key.
 *
 * Scripts are serialised by name (scriptId) only — the actual function
 * is resolved at runtime from the ScriptRegistry.
 */

export interface ScriptContext {
  /** The network/state ID of the owning EngineObject */
  objectId: string;
  /** Elapsed time since object spawn in seconds */
  elapsed: number;
  /** Frame delta time in seconds */
  dt: number;
  /** Read a state value for this object */
  get(key: string): unknown;
  /** Write a state value for this object */
  set(key: string, value: unknown): void;
  /** Destroy the owning object */
  destroy(): void;
}

export type ScriptFn = (ctx: ScriptContext) => void;

export interface ScriptComponent {
  readonly type: 'script';
  /** Identifier used to look up the function in ScriptRegistry */
  scriptId: string;
  /** Arbitrary config data passed to the script */
  params?: Record<string, unknown>;
  /** Internal: elapsed time accumulator */
  elapsed?: number;
}

export function createScriptComponent(
  scriptId: string,
  params?: Record<string, unknown>,
): ScriptComponent {
  return { type: 'script', scriptId, params: params ?? {}, elapsed: 0 };
}

// ─── Script Registry ─────────────────────────────────────────────────────────
// Maps scriptId → ScriptFn. Populated at application startup. Not serialised.

const _registry = new Map<string, ScriptFn>();

export const ScriptRegistry = {
  register(scriptId: string, fn: ScriptFn): void {
    _registry.set(scriptId, fn);
  },
  resolve(scriptId: string): ScriptFn | undefined {
    return _registry.get(scriptId);
  },
  has(scriptId: string): boolean {
    return _registry.has(scriptId);
  },
};
