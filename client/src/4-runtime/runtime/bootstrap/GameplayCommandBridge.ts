/**
 * GameplayCommandBridge.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * v0.1.6: Bridge between Gameplay Layer and Transactional Kernel
 * 
 * Pattern:
 *   Gameplay Event (CombatSystem fires) 
 *     ↓
 *   GameplayCommandBridge subscribes
 *     ↓
 *   Enqueues KernelCommand in transactional queue
 *     ↓
 *   Kernel.resolveCommands() mutates buffers
 *     ↓
 *   Events emit for UI/Network
 * 
 * Result: Gameplay talks DOD language
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SimulationKernel } from '@engine/1-kernel/core/public-api';
import type { TransactionalKernelMode } from '@engine/1-kernel/core/public-api';
import type { EntityHandle } from '@engine/1-kernel/core/public-api';

export interface CombatEventPayload {
  attackerId: EntityHandle | null;
  targetId: EntityHandle;
  damageAmount: number;
  damageType?: string; // 'physical', 'fire', 'magic', etc
}

export class GameplayCommandBridge {
  private kernel: SimulationKernel;
  private transactional: TransactionalKernelMode;
  private commandSeq = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(kernel: SimulationKernel, transactional: TransactionalKernelMode) {
    this.kernel = kernel;
    this.transactional = transactional;

    // Subscribe to gameplay combat events — store disposers to allow clean teardown
    this.disposers.push(
      (gameBus as any).on('FIRE_REQUESTED', (payload: any) => {
        this.onFireRequested(payload);
      }),
      (gameBus as any).on('APPLY_DAMAGE_REQUESTED', (payload: any) => {
        this.onApplyDamageRequested(payload);
      }),
    );

    console.log('[GameplayCommandBridge] Initialized');
  }

  dispose(): void {
    while (this.disposers.length > 0) { this.disposers.pop()?.(); }
    console.log('[GameplayCommandBridge] Disposed');
  }

  /**
   * Called when player fires weapon
   * Payload: { targetHandle: EntityHandle, damageAmount: number }
   */
  private onFireRequested(payload: any): void {
    const { targetHandle, damageAmount } = payload;
    if (!targetHandle || !damageAmount) return;

    this.onApplyDamageRequested({ 
      targetId: targetHandle, 
      damageAmount 
    });
  }

  /**
   * Apply damage: enqueue command in transactional kernel
   */
  private onApplyDamageRequested(payload: any): void {
    const { targetId, damageAmount, damageType } = payload;

    // Enqueue in kernel command queue
    const success = this.kernel.commands.enqueue(
      this.commandSeq++,                    // seq
      performance.now() | 0,                // tick (use timestamp as tick proxy)
      Date.now(),                           // timestamp
      'system',                             // source (valid: freeplay|editor|multiplayer|server|automation|system|test)
      'APPLY_DAMAGE',                       // type
      null,                                 // playerId (single player for now)
      {
        targetHandle: targetId,
        damageAmount,
        damageType: damageType ?? 'physical',
      }
    );

    if (success) {
      console.log('[GameplayCommandBridge] Damage command queued:', {
        targetId,
        damageAmount,
      });

      // Emit local event (UI can react immediately)
      const denseIndex = this.kernel.entities.getDenseIndex(targetId);
      if (denseIndex >= 0) {
        const health = this.kernel.healths.getHealth(denseIndex);
        const newHealth = Math.max(0, health - damageAmount);
        const positionBuffer = this.kernel.positions.getReadBuffer();
        const basePos = denseIndex * 3;

        (gameBus as any).emit('ENTITY_TOOK_DAMAGE', {
          entityHandle: targetId,
          damageAmount,
          damageType: damageType ?? 'physical',
          oldHealth: health,
          newHealth,
          worldPos: [
            positionBuffer[basePos],
            positionBuffer[basePos + 1],
            positionBuffer[basePos + 2],
          ],
        });
      }
    } else {
      console.warn('[GameplayCommandBridge] Command queue full');
    }
  }
}
