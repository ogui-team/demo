/**
 * ScriptingSystem
 * ===============
 * Event-driven, sandboxed scripting layer for EngineObjects.
 *
 * Each Script is a plain object with optional lifecycle hooks:
 *   onSpawn, onUpdate, onHit, onDestroy
 *
 * Scripts are given a restricted ScriptAPI — they cannot reach the global
 * engine, only the verbs exposed by the ScriptingSystem at registration time.
 *
 * Usage
 * ─────
 * // 1. Create and register the system
 * const scripting = new ScriptingSystem();
 *
 * // 2. Provide the sandbox API (called once after engine init)
 * scripting.setAPI({
 *   spawnObject: (def) => objectCreator.spawn(def),
 *   getTransform: (id)  => objectCreator.get(id)?.transform,
 *   sendEvent:    (e,d) => scripting.dispatch(id, e, d),
 *   playAudio:    (key) => audioEngine.play(key),
 * });
 *
 * // 3. Attach a script to an object
 * const scriptId = scripting.attach(objectId, {
 *   onSpawn() { this.api.spawnObject({ name: 'Bullet', ... }); },
 *   onUpdate(dt) { ... },
 * });
 *
 * // 4. Drive the system from the engine update loop
 * engine.onEngineUpdate((dt) => scripting.update(dt));
 *
 * // 5. Forward game events into scripts
 * scripting.dispatch(targetObjectId, 'onHit', { damage: 10, sourceId: '...' });
 */

// ─── Sandbox API ──────────────────────────────────────────────────────────────

export interface SpawnDef {
  name: string;
  transform?: Partial<{ position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }>;
  components?: unknown[];
}

/** The restricted API provided to every running script. */
export interface ScriptAPI {
  /** Spawn a new EngineObject. Returns the new object's id. */
  spawnObject(def: SpawnDef): string;
  /** Read the transform of any object by id (read-only copy). */
  getTransform(objectId: string): { position: { x: number; y: number; z: number } } | undefined;
  /** Dispatch an event to another object's script (or any topic listener). */
  sendEvent(targetObjectId: string, event: ScriptEventType | string, data?: unknown): void;
  /** Set a numeric / boolean state value scoped to the owning object. */
  setState(key: string, value: unknown): void;
  /** Read back a state value set via setState. */
  getState(key: string): unknown;
  /** Destroy the owning object. */
  destroySelf(): void;
  /** Play an audio cue by key (no-op if audio engine not available). */
  playAudio?(key: string, volume?: number): void;
}

// ─── Script definition ────────────────────────────────────────────────────────

export type ScriptEventType = 'onSpawn' | 'onUpdate' | 'onHit' | 'onDestroy' | 'onDeath' | string;

export interface Script {
  /** Called once when the object is spawned or the script is first attached. */
  onSpawn?(api: ScriptAPI): void;
  /** Called every frame while the object is alive. */
  onUpdate?(api: ScriptAPI, dt: number): void;
  /** Called when the object receives a hit event. */
  onHit?(api: ScriptAPI, data: unknown): void;
  /** Called when the object is about to be destroyed. */
  onDestroy?(api: ScriptAPI): void;
  /** Optional: handle any arbitrary dispatched event. */
  onEvent?(api: ScriptAPI, event: string, data: unknown): void;
  /** Script-level state bag (persists across frames). */
  state?: Record<string, unknown>;
  /** Optional unique id for this script template (for serialisation). */
  scriptId?: string;
}

import { gameBus } from './EventBus';
import type { SystemCapabilities, SystemContext } from './types';

// ─── Runtime instance ────────────────────────────────────────────────────────

interface ScriptInstance {
  id: string;            // unique instance id
  objectId: string;
  script: Script;
  active: boolean;
  spawned: boolean;
  stateBag: Map<string, unknown>;
}

// ─── ScriptingSystem ──────────────────────────────────────────────────────────

export class ScriptingSystem {
  private instances: Map<string, ScriptInstance[]> = new Map(); // objectId → instances
  private instanceById: Map<string, ScriptInstance> = new Map();
  private apiImpl: ScriptAPI | null = null;
  private pendingDestroy: Set<string> = new Set(); // objectIds to destroy after update
  private idCounter = 0;
  private systemContext: SystemContext | null = null;

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
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
    return {
      status: 'active',
      active: true,
      metrics: {
        objectScriptCount: this.instances.size,
        instanceCount: this.instanceById.size,
        pendingDestroyCount: this.pendingDestroy.size,
        hasApi: this.apiImpl !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  // ─── Setup ────────────────────────────────────────────────────────────

  /**
   * Provide the concrete implementations for the sandbox API.
   * Call this once after all engine systems are initialised.
   */
  setAPI(impl: Omit<ScriptAPI, 'setState' | 'getState' | 'destroySelf'>): void {
    // We wrap impl so each instance gets its own setState/getState/destroySelf
    this.apiImpl = impl as ScriptAPI;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Attach a script to an object and immediately call onSpawn.
   * Returns the instance id (use to detach later).
   */
  attach(objectId: string, script: Script): string {
    const id = `si_${this.idCounter++}`;
    const stateBag = new Map<string, unknown>(
      script.state ? Object.entries(script.state) : [],
    );
    const instance: ScriptInstance = { id, objectId, script, active: true, spawned: false, stateBag };

    if (!this.instances.has(objectId)) this.instances.set(objectId, []);
    this.instances.get(objectId)!.push(instance);
    this.instanceById.set(id, instance);

    // Fire onSpawn immediately
    if (script.onSpawn) {
      this._safeCall(instance, () => script.onSpawn!(this._buildAPI(instance)));
      instance.spawned = true;
    } else {
      instance.spawned = true;
    }

    gameBus.emit('stateMutation', {
      source: 'scriptingSystem',
      path: `scripts.objects.${objectId}`,
      changedCount: 1,
    });

    return id;
  }

  /** Detach a specific script instance by its instance id. Calls onDestroy. */
  detach(instanceId: string): void {
    const instance = this.instanceById.get(instanceId);
    if (!instance) return;
    this._callDestroy(instance);
    instance.active = false;
    this.instanceById.delete(instanceId);
    const list = this.instances.get(instance.objectId);
    if (list) {
      const idx = list.indexOf(instance);
      if (idx !== -1) list.splice(idx, 1);
    }
    gameBus.emit('stateMutation', {
      source: 'scriptingSystem',
      path: `scripts.objects.${instance.objectId}`,
      changedCount: 1,
    });
  }

  /** Remove and destroy all scripts attached to an object. */
  detachAll(objectId: string): void {
    const list = this.instances.get(objectId) ?? [];
    for (const inst of [...list]) this.detach(inst.id);
    this.instances.delete(objectId);
  }

  // ─── Update ───────────────────────────────────────────────────────────

  /**
   * Advance all active scripts by dt seconds.
   * Call from the engine's fixed-step or RAF loop.
   */
  update(dt: number): void {
    for (const [, list] of this.instances) {
      for (const inst of list) {
        if (!inst.active || !inst.script.onUpdate) continue;
        this._safeCall(inst, () => inst.script.onUpdate!(this._buildAPI(inst), dt));
      }
    }

    // Flush pending destroys
    for (const objectId of this.pendingDestroy) {
      this.detachAll(objectId);
      // Notify via destroy event — caller should clean up the object
      this.dispatch(objectId, 'onDestroy', {});
    }
    this.pendingDestroy.clear();
  }

  // ─── Event dispatch ───────────────────────────────────────────────────

  /**
   * Dispatch a named event to all scripts on a specific object.
   * Known hooks: 'onHit', 'onDestroy', 'onDeath'.
   * Unknown events are routed through 'onEvent'.
   */
  dispatch(objectId: string, event: ScriptEventType | string, data: unknown = {}): void {
    const list = this.instances.get(objectId);
    if (!list) return;
    gameBus.emit('stateMutation', {
      source: 'scriptingSystem',
      path: `scripts.events.${String(event)}`,
      changedCount: 1,
    });
    for (const inst of list) {
      if (!inst.active) continue;
      const api = this._buildAPI(inst);
      switch (event) {
        case 'onHit':
          if (inst.script.onHit) this._safeCall(inst, () => inst.script.onHit!(api, data));
          break;
        case 'onDestroy':
          this._callDestroy(inst);
          break;
        case 'onDeath':
          if (inst.script.onEvent) this._safeCall(inst, () => inst.script.onEvent!(api, event, data));
          break;
        default:
          if (inst.script.onEvent) this._safeCall(inst, () => inst.script.onEvent!(api, event, data));
          break;
      }
    }
  }

  // ─── Script registry ──────────────────────────────────────────────────

  private scriptTemplates: Map<string, Script> = new Map();

  /** Register a named script template for use in prefabs / JSON. */
  registerTemplate(scriptId: string, template: Script): void {
    this.scriptTemplates.set(scriptId, { ...template, scriptId });
  }

  /** Attach a script by its registered template id. */
  attachByTemplateId(objectId: string, scriptId: string, overrides?: Partial<Script>): string {
    const template = this.scriptTemplates.get(scriptId);
    if (!template) throw new Error(`[ScriptingSystem] Template not found: ${scriptId}`);
    return this.attach(objectId, { ...template, ...overrides });
  }

  listTemplates(): string[] {
    return [...this.scriptTemplates.keys()];
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private _buildAPI(instance: ScriptInstance): ScriptAPI {
    const base = this.apiImpl;
    return {
      spawnObject: (def) => base?.spawnObject(def) ?? '',
      getTransform: (id) => base?.getTransform(id),
      sendEvent: (targetId, evt, data) => {
        base?.sendEvent(targetId, evt, data);
        this.dispatch(targetId, evt, data);
      },
      setState: (key, value) => { instance.stateBag.set(key, value); },
      getState: (key) => instance.stateBag.get(key),
      destroySelf: () => { this.pendingDestroy.add(instance.objectId); },
      playAudio: base?.playAudio?.bind(base),
    };
  }

  private _callDestroy(instance: ScriptInstance): void {
    if (!instance.active) return;
    if (instance.script.onDestroy) {
      this._safeCall(instance, () => instance.script.onDestroy!(this._buildAPI(instance)));
    }
  }

  private _safeCall(instance: ScriptInstance, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[ScriptingSystem] Error in script on object "${instance.objectId}":`, err);
      // Deactivate broken script so it doesn't keep throwing
      instance.active = false;
    }
  }
}

// ─── Built-in script templates ────────────────────────────────────────────────

/** Register these with scripting.registerTemplate() for quick use. */

/** Destroys the object after `lifetimeSec` seconds. */
export const LifetimeScript = (lifetimeSec: number): Script => ({
  scriptId: 'lifetime',
  onSpawn(api) { api.setState('remaining', lifetimeSec); },
  onUpdate(api, dt) {
    const rem = (api.getState('remaining') as number ?? lifetimeSec) - dt;
    api.setState('remaining', rem);
    if (rem <= 0) api.destroySelf();
  },
});

/** Rotates the object's Y by `speed` radians/sec (for visual effect). */
export const SpinScript = (speed = 1): Script => ({
  scriptId: 'spin',
  onUpdate(_api, _dt) {
    // Transform mutation is intentionally done via sendEvent / setState so the
    // caller can apply the rotation delta when it reads state.
    _api.setState('spin_delta', speed * _dt);
  },
});
