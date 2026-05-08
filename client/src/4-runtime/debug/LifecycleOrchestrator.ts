/**
 * LifecycleOrchestrator.ts
 * 
 * Erzwingt 4 atomare Zustände im Game-Boot-Flow:
 * 1. BOOT - Assets geladen
 * 2. NETWORK_SYNC - Snapshot-Synchronisation vom Server (PlayerID bestätigt)
 * 3. SPAWN_READY - Player Entity existiert im SimulationKernel
 * 4. PLAY_ACTIVE - Controller BINDUNG, HUD Rebind, Input aktiv
 * 
 * CONSTRAINT: PLAY_ACTIVE darf NIEMALS erreicht werden wenn NETWORK_SYNC nicht 100% bestätigt ist.
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import { Logger } from './Logger';

export type LifecyclePhase =
  | 'BOOT'
  | 'NETWORK_SYNC'
  | 'SPAWN_READY'
  | 'PLAY_ACTIVE';

interface LifecycleCheckpoint {
  phase: LifecyclePhase;
  timestamp: number;
  playerId?: string;
  entityId?: string;
  data?: Record<string, any>;
}

interface LifecycleGuard {
  /** Funktioniert als Lock. True wenn Phase erlaubt ist. */
  canEnter: () => boolean;
  /** Called wenn Phase erreicht wird */
  onEnter?: () => void;
  /** Called wenn Phase verlassen wird */
  onExit?: () => void;
}

interface LifecycleOrchestratorConfig {
  getLocalPlayerId: () => string | null;
  getLocalPlayerEntity: () => any | null;
  hasFullNetworkSync: () => boolean;
  /**
   * Must return `true` once hydrateStateManager() has completed.
   * PLAY_ACTIVE is blocked until this guard passes.
   * Defaults to `() => true` when not provided (legacy behaviour).
   */
  isStateHydrated?: () => boolean;
}

export class LifecycleOrchestrator {
  private currentPhase: LifecyclePhase = 'BOOT';
  private checkpoints: LifecycleCheckpoint[] = [];
  private guards: Map<LifecyclePhase, LifecycleGuard> = new Map();
  private config: LifecycleOrchestratorConfig;
  private isTransitioning = false;
  private static readonly PHASE_ORDER: Record<LifecyclePhase, number> = {
    BOOT: 0,
    NETWORK_SYNC: 1,
    SPAWN_READY: 2,
    PLAY_ACTIVE: 3,
  };
  
  // ─ AWAIT-READY HANDSHAKE: Track when snapshot is fully verified with data ─
  private snapshotSyncVerified = false;
  private bufferHydrationComplete = false;

  constructor(config: LifecycleOrchestratorConfig) {
    this.config = config;
    this.setupGuards();
    this.setupEventListeners();
  }

  /**
   * Get the current lifecycle phase
   * ─ SAFE-INPUT-GATING: PlayController uses this to guard input during PLAY_ACTIVE ─
   */
  get phase(): LifecyclePhase {
    return this.currentPhase;
  }

  private setupGuards(): void {
    // BOOT → NETWORK_SYNC: Assets müssen geladen sein
    this.guards.set('NETWORK_SYNC', {
      canEnter: () => true, // Assets immer da, wenn wir starten
    });

    // NETWORK_SYNC → SPAWN_READY: Volle Synchronisation + State-Hydration erforderlich
    this.guards.set('SPAWN_READY', {
      canEnter: () => {
        const hasSyncOk = this.config.hasFullNetworkSync();
        const hydrated = (this.config.isStateHydrated ?? (() => true))();
        if (!hydrated) {
          Logger.warn('LifecycleOrchestrator', 'SPAWN_READY blocked: StateManager not yet hydrated', {});
        }
        return hasSyncOk && hydrated;
      },
      onEnter: () => {
        Logger.lifecycle('SPAWN_READY entered', {
          playerId: this.config.getLocalPlayerId(),
        });
      },
    });

    // SPAWN_READY → PLAY_ACTIVE: Entity muss existieren + NETWORK_SYNC bestätigt + State hydratisiert
    // ─ AWAIT-READY: Also requires snapshot sync verification + buffer hydration ─
    this.guards.set('PLAY_ACTIVE', {
      canEnter: () => {
        const hasEntity = this.config.getLocalPlayerEntity() !== null;
        const hasSyncConfirm = this.config.hasFullNetworkSync();
        const hydrated = (this.config.isStateHydrated ?? (() => true))();
        const snapshotVerified = this.snapshotSyncVerified;
        const buffersHydrated = this.bufferHydrationComplete;
        
        const result = hasEntity && hasSyncConfirm && hydrated && snapshotVerified && buffersHydrated;

        if (!result) {
          Logger.warn('LifecycleOrchestrator', 'Cannot enter PLAY_ACTIVE', {
            hasEntity,
            hasSyncConfirm,
            hydrated,
            snapshotVerified,
            buffersHydrated,
            phase: 'SPAWN_READY',
          });
        }

        return result;
      },
      onEnter: () => {
        Logger.lifecycle('PLAY_ACTIVE entered - Input enabled', {
          playerId: this.config.getLocalPlayerId(),
          entityId: this.config.getLocalPlayerEntity()?.id,
        });
        gameBus.emit('LIFECYCLE_PLAY_ACTIVE', {
          playerId: this.config.getLocalPlayerId(),
          entityId: this.config.getLocalPlayerEntity()?.id,
          timestamp: Date.now(),
        });
      },
    });
  }

  private setupEventListeners(): void {
    // Server-seitige Snapshot-Bestätigung
    gameBus.on('FULL_SYNC_DATA', () => {
      Logger.lifecycle('FULL_SYNC_DATA received', {
        playerId: this.config.getLocalPlayerId(),
      });
      if (this.currentPhase === 'BOOT' || this.currentPhase === 'NETWORK_SYNC') {
        this.tryTransitionTo('SPAWN_READY');
      }
    });

    // Entity wurde im Kernel/serverseitig spawned
    gameBus.on('ENTITY_SPAWNED', ({ entityId, playerId }: any) => {
      if (playerId === this.config.getLocalPlayerId()) {
        Logger.lifecycle('Local player entity spawned', {
          entityId,
          playerId,
        });
        this.tryTransitionTo('PLAY_ACTIVE');
      }
    });

    // Fallback: falls ENTITY_SPAWNED ausbleibt, kann der Controller-Bind trotzdem aktivieren.
    gameBus.on('CONTROLLER_BOUND', ({ playerId, entityId }: any) => {
      if (playerId === this.config.getLocalPlayerId()) {
        Logger.lifecycle('Controller bound to entity', {
          playerId,
          entityId,
        });
        this.tryTransitionTo('PLAY_ACTIVE');
      }
    });

    // Boot-lock: if a previous transition was blocked because hydration was
    // not yet complete, retry now that the state tree is fully pre-filled.
    gameBus.on('STATE_HYDRATION_COMPLETE', () => {
      Logger.lifecycle('STATE_HYDRATION_COMPLETE received — retrying pending transitions', {});
      if (this.currentPhase === 'BOOT' || this.currentPhase === 'NETWORK_SYNC') {
        this.tryTransitionTo('SPAWN_READY');
      }
      if (this.currentPhase === 'SPAWN_READY') {
        this.tryTransitionTo('PLAY_ACTIVE');
      }
    });

    // ─ AWAIT-READY HANDSHAKE: Snapshot sync verification complete ─
    gameBus.on('SYNC_VERIFIED', ({ playerId, tick, networkEntityId }: any) => {
      if (playerId === this.config.getLocalPlayerId()) {
        Logger.lifecycle('SYNC_VERIFIED received - Snapshot data confirmed', {
          playerId,
          tick,
          networkEntityId,
        });
        this.snapshotSyncVerified = true;
        // Try transitioning to PLAY_ACTIVE now that snapshot is verified
        this.tryTransitionTo('PLAY_ACTIVE');
      }
    });

    // ─ AWAIT-READY HANDSHAKE: Buffer hydration complete ─
    gameBus.on('FORCE_BUFFER_HYDRATION', ({ playerId, tick, networkEntityId }: any) => {
      if (playerId === this.config.getLocalPlayerId()) {
        Logger.lifecycle('FORCE_BUFFER_HYDRATION complete - DOD buffers initialized', {
          playerId,
          tick,
          networkEntityId,
        });
        this.bufferHydrationComplete = true;
        // Try transitioning to PLAY_ACTIVE now that buffers are hydrated
        this.tryTransitionTo('PLAY_ACTIVE');
      }
    });

    // Fallback: if the local player has already been actualized against an
    // authoritative spawn, do not let missing debug-handshake events keep
    // input locked forever. The normal guards (entity/full sync/hydration)
    // still apply before PLAY_ACTIVE is entered.
    gameBus.on('LOCAL_PLAYER_ACTUALIZED', ({ playerId, entityId, source }: any) => {
      const localPlayerId = this.config.getLocalPlayerId();
      if (!localPlayerId) {
        return;
      }
      if (typeof playerId === 'string' && playerId !== localPlayerId) {
        return;
      }

      this.snapshotSyncVerified = true;
      this.bufferHydrationComplete = true;
      Logger.lifecycle('LOCAL_PLAYER_ACTUALIZED received - enabling PLAY_ACTIVE fallback', {
        playerId: localPlayerId,
        entityId,
        source,
      });
      this.tryTransitionTo('PLAY_ACTIVE');
    });
  }

  /**
   * Versucht zu einer neuen Phase zu transitieren.
   * Blockiert wenn Guard sagt "nein".
   */
  tryTransitionTo(targetPhase: LifecyclePhase): boolean {
    if (this.isTransitioning) {
      Logger.warn('LifecycleOrchestrator', 'Already transitioning, ignoring request', {
        from: this.currentPhase,
        to: targetPhase,
      });
      return false;
    }

    if (this.currentPhase === targetPhase) {
      return true; // Already there
    }

    if (LifecycleOrchestrator.PHASE_ORDER[targetPhase] < LifecycleOrchestrator.PHASE_ORDER[this.currentPhase]) {
      return false;
    }

    const guard = this.guards.get(targetPhase);
    if (!guard?.canEnter() ?? false) {
      Logger.warn('LifecycleOrchestrator', 'Guard blocked transition', {
        from: this.currentPhase,
        to: targetPhase,
      });
      return false;
    }

    this.isTransitioning = true;

    try {
      const previousPhase = this.currentPhase;
      this.currentPhase = targetPhase;

      // Checkpoint speichern
      this.checkpoints.push({
        phase: targetPhase,
        timestamp: Date.now(),
        playerId: this.config.getLocalPlayerId() ?? undefined,
        entityId: this.config.getLocalPlayerEntity()?.id,
      });

      Logger.lifecycle(`${previousPhase} → ${targetPhase}`);

      // Guard.onEnter() aufrufen
      guard?.onEnter?.();

      gameBus.emit('LIFECYCLE_CHANGED', {
        from: previousPhase,
        to: targetPhase,
        timestamp: Date.now(),
      });

      return true;
    } finally {
      this.isTransitioning = false;
    }
  }

  /** Explizite Transition mit Validierung */
  transitionTo(targetPhase: LifecyclePhase): void {
    if (!this.tryTransitionTo(targetPhase)) {
      throw new Error(
        `[LifecycleOrchestrator] Cannot transition from ${this.currentPhase} to ${targetPhase}`
      );
    }
  }

  getPhase(): LifecyclePhase {
    return this.currentPhase;
  }

  isPhase(phase: LifecyclePhase): boolean {
    return this.currentPhase === phase;
  }

  isPhaseOrLater(phase: LifecyclePhase): boolean {
    const phases: LifecyclePhase[] = ['BOOT', 'NETWORK_SYNC', 'SPAWN_READY', 'PLAY_ACTIVE'];
    const currentIndex = phases.indexOf(this.currentPhase);
    const targetIndex = phases.indexOf(phase);
    return currentIndex >= targetIndex;
  }

  /** Checkpoint History für Debugging */
  getCheckpoints(): LifecycleCheckpoint[] {
    return [...this.checkpoints];
  }

  /** Debug-Dump */
  debugDump(): Record<string, any> {
    return {
      currentPhase: this.currentPhase,
      playerId: this.config.getLocalPlayerId(),
      entityId: this.config.getLocalPlayerEntity()?.id,
      hasFullNetworkSync: this.config.hasFullNetworkSync(),
      hasEntity: this.config.getLocalPlayerEntity() !== null,
      checkpointCount: this.checkpoints.length,
      checkpoints: this.getCheckpoints(),
    };
  }

  /** Reset für neue Runde */
  reset(): void {
    this.currentPhase = 'BOOT';
    this.checkpoints = [];
    this.isTransitioning = false;
    Logger.lifecycle('LifecycleOrchestrator reset', {});
  }
}

// Global verfügbar machen für Debugging
(window as any).LifecycleOrchestrator = {
  debugDump: (orchestrator: LifecycleOrchestrator) => {
    if (!orchestrator) {
      console.warn('No LifecycleOrchestrator instance provided');
      return;
    }
    const dump = orchestrator.debugDump();
    console.table(dump);
    return dump;
  },
};
