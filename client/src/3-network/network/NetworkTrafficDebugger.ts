/**
 * network/NetworkTrafficDebugger.ts
 *
 * Monitors and logs all network traffic between client and server.
 * Purpose: Detect asymmetric synchronization (commands sent but not broadcasted back).
 *
 * Usage:
 *   const debugger = new NetworkTrafficDebugger();
 *   debugger.trackOutgoing('GAMEPLAY_COMMAND', { command: 'DROP_ITEM', data: {...} });
 *   debugger.trackIncoming('AUTHORITATIVE_BROADCAST', { type: 'ENTITY_SPAWNED', ... });
 *   debugger.printTrafficReport(); // See if commands have corresponding broadcasts
 */

export interface NetworkTrafficEvent {
  timestamp: number;
  direction: 'outgoing' | 'incoming';
  type: string;
  commandType?: string;
  playerId?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  matched?: boolean;
}

export class NetworkTrafficDebugger {
  private events: NetworkTrafficEvent[] = [];
  private readonly maxEvents = 500;
  private enabled = true;

  /**
   * Track outgoing traffic from client to server.
   */
  trackOutgoing(
    type: string,
    data: Record<string, unknown>,
    commandType?: string,
    playerId?: string,
    entityId?: string,
  ): void {
    if (!this.enabled) return;

    const event: NetworkTrafficEvent = {
      timestamp: Date.now(),
      direction: 'outgoing',
      type,
      commandType,
      playerId,
      entityId,
      data,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    console.log(`[NetTraffic] OUTGOING ${type}: ${commandType || '-'}`, {
      playerId,
      entityId,
      timestamp: event.timestamp,
    });
  }

  /**
   * Track incoming traffic from server to client.
   */
  trackIncoming(
    type: string,
    data: Record<string, unknown>,
    commandType?: string,
    playerId?: string,
    entityId?: string,
  ): void {
    if (!this.enabled) return;

    const event: NetworkTrafficEvent = {
      timestamp: Date.now(),
      direction: 'incoming',
      type,
      commandType,
      playerId,
      entityId,
      data,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    console.log(`[NetTraffic] INCOMING ${type}: ${commandType || '-'}`, {
      playerId,
      entityId,
      timestamp: event.timestamp,
    });
  }

  /**
   * Check if an outgoing command has a corresponding incoming broadcast.
   * Returns null if no match found (indicates missing broadcast).
   */
  findBroadcastForCommand(
    outgoingType: string,
    commandType: string,
    entityId?: string,
    maxDelayMs: number = 5000,
  ): NetworkTrafficEvent | null {
    const now = Date.now();
    const outgoing = this.events.find(
      (e) =>
        e.direction === 'outgoing' &&
        e.type === outgoingType &&
        e.commandType === commandType &&
        (!entityId || e.entityId === entityId) &&
        now - e.timestamp < maxDelayMs,
    );

    if (!outgoing) return null;

    const incoming = this.events.find(
      (e) =>
        e.direction === 'incoming' &&
        e.timestamp >= outgoing.timestamp &&
        e.timestamp <= outgoing.timestamp + maxDelayMs &&
        (e.commandType === commandType || e.type === `${commandType}_BROADCAST`),
    );

    return incoming || null;
  }

  /**
   * Generate comprehensive traffic report showing matched/unmatched commands.
   */
  printTrafficReport(): void {
    console.group('[Network Traffic Report]');

    const outgoinCmds = this.events.filter((e) => e.direction === 'outgoing' && e.commandType);
    const incomingBcasts = this.events.filter((e) => e.direction === 'incoming');

    console.log(`\n📤 Outgoing Commands: ${outgoinCmds.length}`);
    console.table(
      outgoinCmds.map((e) => ({
        Time: new Date(e.timestamp).toLocaleTimeString(),
        Type: e.type,
        Command: e.commandType,
        EntityId: e.entityId || '-',
        Matched: this.findBroadcastForCommand(e.type, e.commandType!, e.entityId)
          ? '✓'
          : '✗ MISSING BROADCAST',
      })),
    );

    console.log(`\n📥 Incoming Broadcasts: ${incomingBcasts.length}`);
    console.table(
      incomingBcasts.map((e) => ({
        Time: new Date(e.timestamp).toLocaleTimeString(),
        Type: e.type,
        Command: e.commandType,
        EntityId: e.entityId || '-',
      })),
    );

    const unmatched = outgoinCmds.filter(
      (e) => !this.findBroadcastForCommand(e.type, e.commandType!, e.entityId),
    );

    console.log(`\n⚠️  Unmatched Commands (Missing Server Broadcast): ${unmatched.length}`);
    if (unmatched.length > 0) {
      console.table(
        unmatched.map((e) => ({
          Time: new Date(e.timestamp).toLocaleTimeString(),
          Type: e.type,
          Command: e.commandType,
          EntityId: e.entityId || '-',
          Age: `${Date.now() - e.timestamp}ms`,
        })),
      );
    }

    console.groupEnd();
  }

  /**
   * Check for specific problem patterns.
   */
  detectAnomaly(name: string): boolean {
    switch (name) {
      case 'unmatched_spawns':
        return this.events.some(
          (e) =>
            e.direction === 'outgoing' &&
            e.commandType === 'SPAWN' &&
            !this.findBroadcastForCommand('GAMEPLAY_COMMAND', 'SPAWN', e.entityId),
        );

      case 'orphaned_items':
        return this.events.some(
          (e) =>
            e.direction === 'outgoing' &&
            e.commandType === 'DROP_ITEM' &&
            !this.findBroadcastForCommand('GAMEPLAY_COMMAND', 'DROP_ITEM'),
        );

      case 'unidirectional_traffic':
        const outCount = this.events.filter((e) => e.direction === 'outgoing').length;
        const inCount = this.events.filter((e) => e.direction === 'incoming').length;
        return outCount > 0 && inCount === 0;

      default:
        return false;
    }
  }

  /**
   * Clear all recorded traffic.
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Get all recorded events.
   */
  getEvents(): NetworkTrafficEvent[] {
    return [...this.events];
  }

  /**
   * Enable/disable tracking.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

/**
 * Global instance for easy access.
 */
export const networkTrafficDebugger = new NetworkTrafficDebugger();
