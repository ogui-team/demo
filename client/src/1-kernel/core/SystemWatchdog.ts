import { EntityManager } from './EntityManager';
import { logEvent } from './EventLogger';
import { disableSystem, listSystems } from './SystemRegistry';

export class SystemWatchdog {
  private entityManager: EntityManager;
  private scanTimer = 0;
  private readonly scanInterval = 1;
  private readonly warningCooldownMs = 4000;
  private lastWarningAt = new Map<string, number>();

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
  }

  update(deltaTime: number): void {
    this.scanTimer += deltaTime;
    if (this.scanTimer < this.scanInterval) return;
    this.scanTimer = 0;

    this.scanSystems();
    this.scanEntities();
  }

  private scanSystems(): void {
    const now = Engine.time.now();

    for (const entry of listSystems()) {
      const candidate = entry.system as { update?: (dt: number) => void; isEnabled?: () => boolean };
      if (typeof candidate.update !== 'function') continue;
      if (entry.status !== 'active') continue;
      if (typeof candidate.isEnabled === 'function' && !candidate.isEnabled()) continue;
      if (entry.lastUpdateAt === 0) continue;

      if (now - entry.lastUpdateAt > 5000) {
        this.warn(`system:${entry.name}`, `System "${entry.name}" has not updated in ${(now - entry.lastUpdateAt)}ms`);
      }
    }
  }

  private scanEntities(): void {
    for (const entity of this.entityManager.getEntities()) {
      const transform = entity.getTransform();
      const values = [
        transform.position.x,
        transform.position.y,
        transform.position.z,
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
        transform.scale?.x ?? 1,
        transform.scale?.y ?? 1,
        transform.scale?.z ?? 1,
      ];

      if (values.some((value) => Number.isNaN(value) || !Number.isFinite(value))) {
        this.warn(`entity:nan:${entity.id}`, `Entity "${entity.id}" has invalid transform values; clamping to origin`);
        entity.setTransform({
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        });
      }

      const render = entity.getComponent('render');
      if (render && typeof render.data !== 'object') {
        this.warn(`entity:render:${entity.id}`, `Entity "${entity.id}" has an invalid render component`);
      }

      if (!entity.active) {
        this.warn(`entity:inactive:${entity.id}`, `Entity "${entity.id}" is inactive but still registered`);
      }
    }
  }

  private warn(key: string, message: string): void {
    const now = Engine.time.now();
    const last = this.lastWarningAt.get(key) ?? 0;
    if (now - last < this.warningCooldownMs) return;

    this.lastWarningAt.set(key, now);
    console.warn(`[Watchdog] ${message}`);
    logEvent('engine', `[watchdog] ${message}`);

    if (message.includes('has not updated')) {
      const systemName = key.split(':')[1];
      disableSystem(systemName, 'watchdog timeout');
    }
  }
}