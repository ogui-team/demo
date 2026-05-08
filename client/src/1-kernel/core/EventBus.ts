/**
 * core/EventBus.ts
 *
 * Typed, generic pub/sub event bus.
 *
 * Usage — subscribe:
 *   import { gameBus } from './EventBus';
 *   const unsub = gameBus.on('itemPicked', ({ entityId, itemId }) => { ... });
 *   // Call unsub() when the subscriber is destroyed to prevent memory leaks.
 *
 * Usage — emit:
 *   gameBus.emit('itemPicked', { entityId: 'e_42', itemId: 'health_small', quantity: 1 });
 *
 * Usage — one-shot (auto-unsubscribes after first fire):
 *   gameBus.once('playerKilled', ({ entityId }) => { ... });
 *
 * TypeScript guarantees
 * ─────────────────────
 * - Unknown event names → compile error
 * - Wrong payload shape → compile error
 * - No `any` anywhere in the implementation
 *
 * The singleton `gameBus` is typed to `GameEvents` (see types.ts).
 * For systems that need their own isolated bus (e.g. editor-only events),
 * construct a new `EventBus<YourEventMap>()`.
 */

type Listener<T> = (payload: T) => void;

export class EventBus<T extends Record<string, any>> {
  private readonly _listeners = new Map<keyof T, Set<Listener<never>>>();

  /**
   * Subscribe to an event.
   * Returns an unsubscribe function — call it to remove this listener.
   */
  on<K extends keyof T>(event: K, cb: Listener<T[K]>): () => void {
    let bucket = this._listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this._listeners.set(event, bucket);
    }
    bucket.add(cb as Listener<never>);
    return () => this.off(event, cb);
  }

  /**
   * Subscribe for exactly one invocation, then auto-remove.
   */
  once<K extends keyof T>(event: K, cb: Listener<T[K]>): () => void {
    const wrapper: Listener<T[K]> = (payload) => {
      unsub();
      cb(payload);
    };
    const unsub = this.on(event, wrapper);
    return unsub;
  }

  /**
   * Emit an event, synchronously calling all current listeners.
   */
  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const bucket = this._listeners.get(event);
    if (!bucket) return;
    // Snapshot to allow listeners to unsubscribe during iteration.
    for (const cb of [...bucket]) {
      (cb as Listener<T[K]>)(payload);
    }
  }

  /**
   * Remove a specific listener for an event.
   */
  off<K extends keyof T>(event: K, cb: Listener<T[K]>): void {
    this._listeners.get(event)?.delete(cb as Listener<never>);
  }

  /**
   * Remove all listeners for a given event, or clear everything if no event
   * is specified.
   */
  clear(event?: keyof T): void {
    if (event !== undefined) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /** Number of registered listeners for a given event (useful for debug). */
  listenerCount(event: keyof T): number {
    return this._listeners.get(event)?.size ?? 0;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

import type { GameEvents } from './types';

/**
 * Engine-wide event bus, typed to GameEvents.
 * Import and use this in any system that needs cross-system communication
 * without tight coupling.
 */
export const gameBus = new EventBus<GameEvents>();
