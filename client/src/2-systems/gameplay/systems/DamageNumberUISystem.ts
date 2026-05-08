/**
 * DamageNumberUISystem.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * v0.1.5 Gameplay Feature: Floating Damage Numbers
 * 
 * When an entity takes damage:
 *   1. Listen to 'ENTITY_TOOK_DAMAGE' event
 *   2. Create floating number at entity position
 *   3. Rise + fade over 1 second
 *   4. Beautiful visual feedback
 */

import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { EntityHandle } from '@engine/1-kernel/core/public-api';
import type { TropicalHorrorDamageTheme } from '@engine/2-systems/ArchetypeDefinitions';

interface FloatingDamageNumber {
  id: string;
  text: string;
  worldPos: [number, number, number];
  screenPos: [number, number];
  damage: number;
  createdAt: number;
  duration: number; // milliseconds
}

export class DamageNumberUISystem {
  private floatingNumbers: Map<string, FloatingDamageNumber> = new Map();
  private nextId = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private camera: THREE.Camera | null = null;
  private readonly projectionVector = new THREE.Vector3();
  private theme: TropicalHorrorDamageTheme = {
    fill: '#FF0000',
    stroke: '#220000',
    shadow: 'rgba(255, 0, 0, 0.3)',
    fontFamily: 'Georgia, serif',
    fontSize: 24,
  };

  constructor(canvas: HTMLCanvasElement | null, camera?: THREE.Camera | null) {
    this.canvas = canvas;
    this.camera = camera ?? null;
    if (canvas) {
      this.ctx = canvas.getContext('2d');
    }

    // Subscribe to damage events
    (gameBus as any).on('ENTITY_TOOK_DAMAGE', (payload: any) => {
      this.onEntityTookDamage(payload);
    });

    console.log('[DamageNumberUISystem] Initialized');
  }

  setCamera(camera: THREE.Camera | null): void {
    this.camera = camera;
  }

  setTheme(theme: Partial<TropicalHorrorDamageTheme>): void {
    this.theme = { ...this.theme, ...theme };
  }

  /**
   * Called when entity takes damage
   * Payload: { entityHandle: EntityHandle, damageAmount: number, worldPos?: [x,y,z] }
   */
  private onEntityTookDamage(payload: any): void {
    const { entityHandle, damageAmount, worldPos } = payload;

    if (!damageAmount || damageAmount <= 0) return;

    // Create floating number
    const id = `damage-${this.nextId++}`;
    const duration = 1000; // 1 second

    const floatingNumber: FloatingDamageNumber = {
      id,
      text: `-${Math.floor(damageAmount)}`,
      worldPos: worldPos || [0, 0, 0],
      screenPos: this.projectWorldToScreen(worldPos, damageAmount),
      damage: damageAmount,
      createdAt: Date.now(),
      duration,
    };

    this.floatingNumbers.set(id, floatingNumber);

    console.log('[DamageNumberUISystem] Damage number created:', id, damageAmount);
  }

  /**
   * Update floating numbers (called each frame)
   */
  update(dt: number): void {
    const now = Date.now();
    const toRemove: string[] = [];

    // Update each floating number
    for (const [id, number] of this.floatingNumbers) {
      const elapsed = now - number.createdAt;
      const progress = elapsed / number.duration;

      if (progress >= 1) {
        toRemove.push(id);
        continue;
      }

      // Rise effect: move up over time
      const riseAmount = 50 * progress; // pixels
      number.screenPos[1] -= riseAmount * (dt * 60); // dt-aware
    }

    // Remove expired
    for (const id of toRemove) {
      this.floatingNumbers.delete(id);
    }
  }

  /**
   * Render floating numbers to canvas
   * (Called from main render loop)
   */
  render(): void {
    if (!this.ctx || !this.canvas) return;

    const now = Date.now();

    for (const [id, number] of this.floatingNumbers) {
      const elapsed = now - number.createdAt;
      const progress = elapsed / number.duration;

      // Calculate alpha: 1.0 → 0.0 over duration
      const alpha = 1.0 - progress;

      // Calculate position: rise effect
      const riseAmount = 50 * progress;
      const y = number.screenPos[1] - riseAmount;

      // Draw damage number
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.font = `bold ${Math.max(18, Math.round(this.theme.fontSize + Math.min(10, number.damage * 0.08)))}px ${this.theme.fontFamily}`;
      this.ctx.fillStyle = this.theme.fill;
      this.ctx.strokeStyle = this.theme.stroke;
      this.ctx.lineWidth = 4;
      this.ctx.shadowColor = this.theme.shadow;
      this.ctx.shadowBlur = 12;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';

      this.ctx.strokeText(number.text, number.screenPos[0], y);
      this.ctx.fillText(number.text, number.screenPos[0], y);

      this.ctx.restore();
    }
  }

  /**
   * Get count of active floating numbers
   */
  getActiveCount(): number {
    return this.floatingNumbers.size;
  }

  private projectWorldToScreen(worldPos?: [number, number, number], damageAmount = 0): [number, number] {
    if (this.canvas && this.camera && Array.isArray(worldPos) && worldPos.length === 3) {
      this.projectionVector.set(worldPos[0], worldPos[1] + 0.8, worldPos[2]);
      this.projectionVector.project(this.camera);
      if (Number.isFinite(this.projectionVector.x) && Number.isFinite(this.projectionVector.y)) {
        return [
          (this.projectionVector.x * 0.5 + 0.5) * this.canvas.width,
          (-this.projectionVector.y * 0.5 + 0.5) * this.canvas.height,
        ];
      }
    }

    const width = this.canvas?.width ?? 0;
    const height = this.canvas?.height ?? 0;
    const spread = Math.min(80, 20 + damageAmount * 0.6);
    return [
      width * 0.5 + (Math.random() - 0.5) * spread,
      height * 0.42 + (Math.random() - 0.5) * 24,
    ];
  }
}
