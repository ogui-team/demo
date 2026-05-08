import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { Input2DComponentData, Physics2DBodyData } from '../../../../4-runtime/ui/2d/TwoDTypes';

interface Input2DEntity {
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
}

interface Input2DEntityManager {
  getEntities(): Iterable<Input2DEntity>;
}

export class Input2DAdapterSystem {
  private readonly entityManager: Input2DEntityManager;
  private systemContext: SystemContext | null = null;
  private enabled = true;
  private keys = new Set<string>();
  private pointer = { x: 0, y: 0, down: false };
  private unbind: Array<() => void> = [];

  constructor(entityManager: Input2DEntityManager) {
    this.entityManager = entityManager;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (this.unbind.length > 0) return;

    const onKeyDown = (event: KeyboardEvent) => { this.keys.add(event.key); };
    const onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.key); };
    const onMouseDown = (event: MouseEvent) => {
      this.pointer.down = true;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
    };
    const onMouseUp = () => { this.pointer.down = false; };
    const onMouseMove = (event: MouseEvent) => {
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    this.unbind.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('mousemove', onMouseMove),
    );
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
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'ok' : 'disabled',
      active: this.enabled,
      metrics: {
        keys: [...this.keys].slice(0, 8),
        pointer: this.pointer,
      },
    };
  }

  update(): void {
    if (!this.enabled) return;
    const controlled = Array.from(this.entityManager.getEntities()).find((entity) => {
      const input = entity.getComponent('input2d')?.data as Input2DComponentData | undefined;
      return !!input?.localControlled || entity.hasComponent('localPlayer');
    });
    if (!controlled) return;

    const body = controlled.getComponent('physics2d')?.data as Physics2DBodyData | undefined;
    const input = controlled.getComponent('input2d')?.data as Input2DComponentData | undefined;
    if (!body || input?.enabled === false) return;

    const speed = input?.moveSpeed ?? body.maxSpeed ?? 6;
    const moveX = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    const moveY = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
    body.desiredVelocityX = moveX * speed;
    body.desiredVelocityY = moveY * speed;

    if (this.pointer.down) {
      gameBus.emit('stateMutation', {
        source: 'input2dAdapterSystem',
        path: '2d.pointer.tap',
        changedCount: 1,
      });
    }
  }

  destroy(): void {
    for (const dispose of this.unbind) dispose();
    this.unbind = [];
  }

  dispose(): void {
    this.destroy();
  }
}
