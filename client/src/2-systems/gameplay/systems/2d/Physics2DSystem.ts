import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { Physics2DBodyData } from '../../../../4-runtime/ui/2d/TwoDTypes';
import { gameBus } from '@engine/1-kernel/core/public-api';

interface Physics2DEntity {
  id: string;
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
  getPosition(): { x: number; y: number; z: number };
  setPosition(position: { x: number; y: number; z: number }): void;
}

interface Physics2DEntityManager {
  getEntities(): Iterable<Physics2DEntity>;
}

type TilemapCollisionLookup = {
  isSolidAtWorld(x: number, y: number): boolean;
};

export class Physics2DSystem {
  private readonly entityManager: Physics2DEntityManager;
  private systemContext: SystemContext | null = null;
  private activeBodies = 0;
  private collisionCount = 0;
  private gravity = 0;
  private lastReportedMetrics = { activeBodies: -1, collisionCount: -1 };

  constructor(entityManager: Physics2DEntityManager) {
    this.entityManager = entityManager;
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
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        activeBodies: this.activeBodies,
        collisionCount: this.collisionCount,
      },
    };
  }

  update(dt: number): void {
    this.activeBodies = 0;
    this.collisionCount = 0;
    const entities = Array.from(this.entityManager.getEntities()).filter((entity) => entity.hasComponent('physics2d'));
    const tilemap = this.systemContext?.systems.tilemapSystem as TilemapCollisionLookup | undefined;
    const bodies = entities.map((entity) => ({ entity, body: entity.getComponent('physics2d')?.data as Physics2DBodyData }));

    for (const { entity, body } of bodies) {
      this.activeBodies += 1;
      if (body.dynamic === false) continue;
      body.velocityX = this.approach(body.velocityX ?? 0, body.desiredVelocityX ?? 0, dt * 24);
      body.velocityY = this.approach(body.velocityY ?? 0, body.desiredVelocityY ?? 0, dt * 24);
      body.velocityY += this.gravity * (body.gravityScale ?? 0) * dt;
      const next = entity.getPosition();
      next.x += (body.velocityX ?? 0) * dt;
      next.z += (body.velocityY ?? 0) * dt;

      if (tilemap?.isSolidAtWorld(next.x, next.z)) {
        body.velocityX = 0;
        body.velocityY = 0;
        this.collisionCount += 1;
        continue;
      }

      const halfWidth = body.width / 2;
      const halfHeight = body.height / 2;
      for (const other of bodies) {
        if (other.entity.id === entity.id) continue;
        if (other.body.solid === false) continue;
        if (this.intersects(next.x, next.z, halfWidth, halfHeight, other.entity, other.body)) {
          body.velocityX = 0;
          body.velocityY = 0;
          this.collisionCount += 1;
          continue;
        }
      }

      entity.setPosition(next);
    }

    if (this.activeBodies !== this.lastReportedMetrics.activeBodies || this.collisionCount !== this.lastReportedMetrics.collisionCount) {
      this.lastReportedMetrics = {
        activeBodies: this.activeBodies,
        collisionCount: this.collisionCount,
      };
      gameBus.emit('stateMutation', {
        source: 'physics2DSystem',
        path: '2d.physics.metrics',
        changedCount: 1,
      });
    }
  }

  private intersects(x: number, y: number, halfWidth: number, halfHeight: number, entity: Physics2DEntity, body: Physics2DBodyData): boolean {
    const other = entity.getPosition();
    const otherHalfWidth = body.width / 2;
    const otherHalfHeight = body.height / 2;
    return Math.abs(x - other.x) < halfWidth + otherHalfWidth && Math.abs(y - other.z) < halfHeight + otherHalfHeight;
  }

  private approach(current: number, target: number, delta: number): number {
    if (current < target) return Math.min(current + delta, target);
    if (current > target) return Math.max(current - delta, target);
    return target;
  }
}
