/**
 * State Manager
 * Unified state layer for all engine systems
 * 
 * All engine data flows through this central state object.
 * No system should directly modify another system's internal data.
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { getSchemaDefault, hydrateStateManager } from './hydrateStateManager';

type StateValue = string | number | boolean | object | any;

interface Subscription {
  id: string;
  path: string;
  callback: (newValue: StateValue, oldValue: StateValue) => void;
}

export class StateManager {
  private state: Record<string, any>;
  private subscriptions: Map<string, Subscription[]> = new Map();
  private subscriptionId: number = 0;
  private updateListeners: Array<(changes: Record<string, any>) => void> = [];
  private systemContext: SystemContext | null = null;

  /** True once hydrateStateManager() has completed its initial fill pass. */
  public isHydrated = false;

  /** ─ REENTRANCY GUARD ─ Set to true during initialization/hydration to prevent recursive get/set loops. */
  private isHydrating = false;

  /** ─ RECURSION DETECTION ─ Tracks current call depth to prevent infinite loops. */
  private callDepth = 0;
  private readonly maxCallDepth = 100; // Safety threshold

  constructor(initialState: Record<string, any> = {}) {
    this.state = this.deepFreeze(JSON.parse(JSON.stringify(initialState)));
  }

  /**
   * Called by hydrateStateManager() after the fill pass.
   * Sets the hydration flag and fires a diagnostic log.
   */
  markHydrated(): void {
    this.isHydrated = true;
  }

  /**
   * ─ HYDRATION CONTROL ─
   * Called at the start of hydration to enable the reentrancy guard.
   * Prevents events from firing during initial state fill.
   */
  beginHydration(): void {
    this.isHydrating = true;
  }

  /**
   * Called at the end of hydration to disable the reentrancy guard.
   */
  endHydration(): void {
    this.isHydrating = false;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        subscriptionPaths: this.subscriptions.size,
        subscriptionCount: [...this.subscriptions.values()].reduce((count, subs) => count + subs.length, 0),
        updateListenerCount: this.updateListeners.length,
        topLevelKeys: Object.keys(this.state).length,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  /**
   * Raw read — returns the live value or `undefined` when the path does not
   * exist. Does NOT emit any events. Use this inside hydrateStateManager
   * itself (before hydration is complete) to avoid re-entrant warnings.
   */
  getRaw(path: string): StateValue {
    const keys = path.split('.');
    let current: any = this.state;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  /**
   * Get a value from state by path (e.g., "camera.position.x").
   *
   * Recovery behaviour (auto-hydration from schema):
   *  – If the path does not exist but IS in INITIAL_STATE_SCHEMA, the schema
   *    default is AUTOMATICALLY written to StateManager and returned.
   *  – If the path is completely unknown, `undefined` is returned and a
   *    warning is emitted.
   *
   * Uses _setSilent() to avoid recursive get/set loops (REENTRANCY GUARD).
   * No events fired during auto-hydration.
   * 
   * Recursion Detection: Tracks call depth to prevent infinite loops.
   */
  get(path: string): StateValue {
    // ─ RECURSION GUARD ─
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      console.error(`[STATE_RECURSION_PREVENTED] Maximum call depth exceeded (${this.maxCallDepth}) at path: ${path}`);
      this.callDepth--;
      return undefined;
    }

    try {
      const keys = path.split('.');
      let current: any = this.state;

      for (const key of keys) {
        if (current === null || current === undefined) {
          // Path missing — look up safe default from schema
          const { found, value: schemaDefault } = getSchemaDefault(path);
          const recoveryValue = found ? schemaDefault : undefined;
          
          // Auto-hydrate: If schema knows this path, write the default SILENTLY (no events)
          if (found && this.isHydrated) {
            this._setSilent(path, this.deepClone(schemaDefault));
            console.log(`[STATE_AUTO_HYDRATION] Initialized missing path with schema default: ${path}`);
          }
          
          gameBus.emit('LOG_STATE_MISSING_WARNING', {
            path,
            usedSchemaDefault: found,
            recoveryValue: found ? recoveryValue : null,
            timestamp: Date.now(),
          });
          if (found) {
            return recoveryValue;
          }
          console.warn(`[State] Path "${path}" not found and has no schema default.`);
          return undefined;
        }
        current = current[key];
      }

      return current;
    } finally {
      this.callDepth--;
    }
  }

  /**
   * Get entire state or subtree
   */
  getState(path?: string): Record<string, any> {
    if (!path) {
      return JSON.parse(JSON.stringify(this.state));
    }
    return this.get(path);
  }

  /**
   * Set a value in state by path (e.g., "camera.position.x", 5)
   * Returns true if value changed, false otherwise
   * Rebuilds frozen object chain to ensure immutability
   * 
   * Uses getRaw() instead of get() to avoid reentrancy in oldValue comparison.
   * Recursion detection tracks depth to prevent infinite loops.
   */
  set(path: string, value: StateValue): boolean {
    // ─ RECURSION GUARD ─
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      console.error(`[STATE_RECURSION_PREVENTED] Maximum call depth exceeded (${this.maxCallDepth}) at path: ${path}`);
      this.callDepth--;
      return false;
    }

    try {
      const keys = path.split('.');
      const lastKey = keys.pop();

      if (!lastKey) {
        console.error(`[State] Invalid path: ${path}`);
        return false;
      }

      // Get old value using getRaw() to prevent reentrancy
      const oldValue = this.getRaw(path);

      // Check if value actually changed
      if (this.valuesEqual(oldValue, value)) {
        return false;
      }

      // Build a new state object by cloning and modifying
      const newState = this._setNestedValue(this.deepClone(this.state), keys, lastKey, value);

      // Replace the entire state with the new frozen state
      this.state = this.deepFreeze(newState);

      // Only fire events if NOT in hydration/initialization phase
      if (!this.isHydrating) {
        // Notify subscribers
        this.notifySubscribers(path, value, oldValue);

        // Notify general update listeners
        this.updateListeners.forEach((listener) => {
          listener({ [path]: value });
        });

        gameBus.emit('stateMutation', {
          source: 'StateManager.set',
          path,
          paths: [path],
          changedCount: 1,
        });
      }

      return true;
    } finally {
      this.callDepth--;
    }
  }

  remove(path: string): boolean {
    return this.set(path, undefined);
  }

  /**
   * Internal: Set nested value in an unfrozen object
   */
  private _setNestedValue(obj: any, keys: string[], lastKey: string, value: any): any {
    if (keys.length === 0) {
      // Setting at root level
      if (value === undefined) {
        delete obj[lastKey];
      } else {
        obj[lastKey] = this.deepClone(value);
      }
      return obj;
    }

    // Navigate and build path
    let current = obj;
    for (const key of keys) {
      if (
        !(key in current)
        || current[key] === null
        || current[key] === undefined
        || typeof current[key] !== 'object'
        || Array.isArray(current[key])
      ) {
        current[key] = {};
      }
      current = current[key];
    }

    // Set the value at the final key
    if (value === undefined) {
      delete current[lastKey];
    } else {
      current[lastKey] = this.deepClone(value);
    }
    return obj;
  }

  /**
   * ─ SILENT SET ─ 
   * Internal method that sets a value WITHOUT firing any events or notifications.
   * Used during hydration/initialization to prevent reentrancy loops.
   * 
   * @param path Dot-notation path (e.g., "camera.position.x")
   * @param value The value to set
   */
  private _setSilent(path: string, value: StateValue): void {
    const keys = path.split('.');
    const lastKey = keys.pop();

    if (!lastKey) {
      console.error(`[State] Invalid path: ${path}`);
      return;
    }

    // Build a new state object by cloning and modifying
    const newState = this._setNestedValue(this.deepClone(this.state), keys, lastKey, value);

    // Replace the entire state with the new frozen state
    this.state = this.deepFreeze(newState);

    // ─ NO EVENT FIRING ─ This is the key to breaking the recursion loop
  }

  /**
   * Update multiple values at once
   * Batches notifications for efficiency
   */
  update(updates: Record<string, StateValue>): Record<string, boolean> {
    const changes: Record<string, any> = {};
    const results: Record<string, boolean> = {};

    for (const [path, value] of Object.entries(updates)) {
      const changed = this.set(path, value);
      results[path] = changed;
      if (changed) {
        changes[path] = value;
      }
    }

    // Batch notify update listeners once
    if (Object.keys(changes).length > 0) {
      this.updateListeners.forEach((listener) => {
        listener(changes);
      });
      gameBus.emit('stateMutation', {
        source: 'StateManager.update',
        paths: Object.keys(changes),
        changedCount: Object.keys(changes).length,
      });
    }

    return results;
  }

  /**
   * Subscribe to changes on a specific path
   * Returns unsubscribe function
   */
  subscribe(
    path: string,
    callback: (newValue: StateValue, oldValue?: StateValue) => void
  ): () => void {
    const id = `sub_${this.subscriptionId++}`;
    const subscription: Subscription = { id, path, callback };

    if (!this.subscriptions.has(path)) {
      this.subscriptions.set(path, []);
    }

    this.subscriptions.get(path)!.push(subscription);

    if ((globalThis as any).DEBUG_STATE) {
      console.log(`[State] Subscribed to "${path}"`);
    }

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(path);
      if (subs) {
        const index = subs.findIndex((s) => s.id === id);
        if (index > -1) {
          subs.splice(index, 1);
          if ((globalThis as any).DEBUG_STATE) {
            console.log(`[State] Unsubscribed from "${path}"`);
          }
        }
      }
    };
  }

  /**
   * Subscribe to all state changes
   */
  onUpdate(callback: (changes: Record<string, any>) => void): () => void {
    this.updateListeners.push(callback);

    return () => {
      const index = this.updateListeners.indexOf(callback);
      if (index > -1) {
        this.updateListeners.splice(index, 1);
      }
    };
  }

  /**
   * Reset state to initial state
   */
  reset(initialState: Record<string, any>): void {
    this.state = this.deepFreeze(JSON.parse(JSON.stringify(initialState)));
    console.log('[State] State reset to initial value');
    gameBus.emit('stateMutation', {
      source: 'StateManager.reset',
      changedCount: Object.keys(initialState).length,
    });
  }

  /**
   * Get state snapshot for debugging
   */
  snapshot(): Record<string, any> {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Internal: Deep freeze to prevent mutations
   */
  private deepFreeze(obj: any): any {
    Object.freeze(obj);

    Object.getOwnPropertyNames(obj).forEach((prop) => {
      if (
        obj[prop] !== null &&
        (typeof obj[prop] === 'object' || typeof obj[prop] === 'function') &&
        !Object.isFrozen(obj[prop])
      ) {
        this.deepFreeze(obj[prop]);
      }
    });

    return obj;
  }

  /**
   * Internal: Deep clone to prevent reference mutations
   */
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepClone(item));
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    const cloned: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }
    return cloned;
  }

  /**
   * Internal: Check if two values are equal
   */
  private valuesEqual(a: StateValue, b: StateValue): boolean {
    // For primitives
    if (a === b) return true;

    // For objects, do shallow comparison
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);

      if (aKeys.length !== bKeys.length) return false;

      for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Internal: Notify subscribers of a change
   * Uses getRaw() to prevent reentrancy in parent path notifications
   */
  private notifySubscribers(path: string, newValue: StateValue, oldValue: StateValue): void {
    const subs = this.subscriptions.get(path);
    if (subs) {
      subs.forEach((sub) => {
        sub.callback(newValue, oldValue);
      });
    }

    // Also notify parent paths (for wildcard-like behavior)
    // e.g., if "camera.position.x" changes, notify "camera.position" subscribers
    const pathParts = path.split('.');
    for (let i = pathParts.length - 1; i > 0; i--) {
      const parentPath = pathParts.slice(0, i).join('.');
      const parentSubs = this.subscriptions.get(parentPath);
      if (parentSubs && parentSubs.length > 0) {
        const newVal = this.getRaw(parentPath);
        const oldVal = this.getRaw(parentPath); // For parent paths, use same value
        parentSubs.forEach((sub) => {
          sub.callback(newVal, oldVal);
        });
      }
    }
  }
}

// Singleton instance
let stateManagerInstance: StateManager | null = null;

export function initStateManager(initialState: Record<string, any> = {}): StateManager {
  if (stateManagerInstance) {
    console.warn('[State] State manager already initialized');
    return stateManagerInstance;
  }

  stateManagerInstance = new StateManager(initialState);
  hydrateStateManager(stateManagerInstance);
  console.log('[State] State manager initialized');

  return stateManagerInstance;
}

export function getStateManager(): StateManager | null {
  return stateManagerInstance;
}

export function destroyStateManager(): void {
  stateManagerInstance = null;
}
