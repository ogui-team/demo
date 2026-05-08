/**
 * EventListenerRegistry
 * 
 * Tracks all addEventListener calls and gameBus subscriptions in one place.
 * Provides centralized cleanup for mode transitions.
 * 
 * CRITICAL FIX for TIER 0A: Prevents 100+ untracked listeners.
 * 
 * Usage:
 *   const registry = new EventListenerRegistry();
 *   registry.addEventListener(window, 'keydown', handler);
 *   registry.on(gameBus, 'itemPicked', callback);
 *   // Later during mode transition:
 *   registry.dispose(); // Removes ALL tracked listeners
 */

import { EventBus } from './EventBus';

type EventListenerOrEventListenerObject = 
  | EventListener 
  | EventListenerObject
  | null;

interface ListenerRecord {
  type: 'addEventListener' | 'eventBus';
  target: EventTarget | EventBus<any>;
  eventType: string;
  handler: Function;
  options?: AddEventListenerOptions | boolean;
}

export class EventListenerRegistry {
  private listeners: ListenerRecord[] = [];
  private disposed = false;

  /**
   * Register a DOM addEventListener call for tracking and cleanup.
   */
  addEventListener<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    event: K | string,
    handler: ((this: EventTarget, ev: any) => any) | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (this.disposed) {
      console.warn('[EventListenerRegistry] Registry is disposed, ignoring new listener');
      return;
    }

    if (!handler) return;

    target.addEventListener(event as any, handler as any, options);
    this.listeners.push({
      type: 'addEventListener',
      target,
      eventType: String(event),
      handler,
      options,
    });
  }

  /**
   * Register a gameBus subscription for tracking and cleanup.
   */
  on<T extends Record<string, any>, K extends keyof T>(
    bus: EventBus<T>,
    event: K,
    callback: (payload: T[K]) => void
  ): void {
    if (this.disposed) {
      console.warn('[EventListenerRegistry] Registry is disposed, ignoring new subscription');
      return;
    }

    if (!callback) return;

    // Store the unsub function so we can call it later
    const unsub = bus.on(event, callback);
    this.listeners.push({
      type: 'eventBus',
      target: bus,
      eventType: String(event),
      handler: unsub,
    });
  }

  private removeAllListeners(): number {
    let removedCount = 0;

    for (const record of this.listeners) {
      try {
        if (record.type === 'addEventListener') {
          const target = record.target as EventTarget;
          target.removeEventListener(
            record.eventType,
            record.handler as EventListenerOrEventListenerObject,
            record.options
          );
        } else if (record.type === 'eventBus') {
          // Handler is the unsub function
          (record.handler as () => void)();
        }
        removedCount++;
      } catch (error) {
        console.error(`[EventListenerRegistry] Failed to remove listener for ${record.eventType}:`, error);
      }
    }

    this.listeners.length = 0;
    return removedCount;
  }

  /**
   * Remove all tracked listeners and subscriptions without disposing the registry.
   * Used for temporary lifecycle transitions where listeners will be rebound later.
   */
  clear(): void {
    const removedCount = this.removeAllListeners();
    if (removedCount > 0) {
      console.log(`[EventListenerRegistry] Cleared ${removedCount} listeners`);
    }
  }

  /**
   * Remove all tracked listeners and subscriptions.
   * Called during permanent teardown to prevent future registrations.
   */
  dispose(): void {
    if (this.disposed) return;

    const removedCount = this.removeAllListeners();
    this.disposed = true;

    console.log(`[EventListenerRegistry] Disposed ${removedCount} listeners`);
  }

  /**
   * Get count of tracked listeners (for debugging/validation).
   */
  getListenerCount(): number {
    return this.listeners.length;
  }

  /**
   * Get breakdown of listener types (for debugging).
   */
  getListenerBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {
      addEventListener: 0,
      eventBus: 0,
    };

    for (const record of this.listeners) {
      breakdown[record.type]++;
    }

    return breakdown;
  }

  /**
   * Get list of all tracked events (for debugging).
   */
  getTrackedEvents(): Array<{ type: string; event: string }> {
    return this.listeners.map((r) => ({
      type: r.type,
      event: r.eventType,
    }));
  }
}
