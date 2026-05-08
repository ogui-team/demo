import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { AnimationComponentData, SpriteComponentData, SpriteAnimationClip2D } from '../../../../4-runtime/ui/2d/TwoDTypes';

interface SpriteAnimationEntity {
  id: string;
  hasComponent(name: string): boolean;
  getComponent(name: string): { data: unknown } | undefined;
}

interface SpriteAnimationEntityManager {
  getEntities(): Iterable<SpriteAnimationEntity>;
  getEntity(id: string): SpriteAnimationEntity | undefined;
}

export class SpriteAnimationSystem {
  private readonly entityManager: SpriteAnimationEntityManager;
  private systemContext: SystemContext | null = null;
  private activeAnimations = 0;
  private selectedEntityId: string | null = null;
  private scrubFrameIndex: number | null = null;

  constructor(entityManager: SpriteAnimationEntityManager) {
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
      status: 'ok',
      active: true,
      metrics: {
        activeAnimations: this.activeAnimations,
        selectedEntityId: this.selectedEntityId,
        scrubFrameIndex: this.scrubFrameIndex,
      },
    };
  }

  update(dt: number): void {
    this.activeAnimations = 0;
    for (const entity of this.entityManager.getEntities()) {
      const animation = entity.getComponent('animation2d')?.data as AnimationComponentData | undefined;
      const sprite = entity.getComponent('sprite')?.data as SpriteComponentData | undefined;
      if (!animation) continue;
      if (!sprite) {
        gameBus.emit('stateMutation', {
          source: 'spriteAnimationSystem',
          path: `2d.animation.${entity.id}.missingSprite`,
          changedCount: 1,
        });
        continue;
      }
      this.activeAnimations += 1;
      const nextState = this.resolveAnimationState(entity, animation);
      if (nextState !== animation.state && animation.clips[nextState]) {
        animation.state = nextState;
        animation.elapsed = 0;
        animation.frameIndex = 0;
        gameBus.emit('stateMutation', {
          source: 'spriteAnimationSystem',
          path: `2d.animation.${entity.id}.state`,
          changedCount: 1,
        });
      }

      const clip = animation.clips[animation.state];
      if (!clip || clip.frames.length === 0) continue;
      const frameIndex = this.computeFrameIndex(entity, animation, clip, dt);
      animation.frameIndex = frameIndex;
      sprite.frame = clip.frames[frameIndex] ?? clip.frames[0];
    }
  }

  getDebugPanel(requestRefresh: () => void): HTMLElement | null {
    const root = document.createElement('div');
    root.style.cssText = 'margin-top:18px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);';
    root.innerHTML = '<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:10px;letter-spacing:1.5px;color:#9ea7ad;">Animation Scrubber</div>';
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;';
    root.appendChild(body);

    const animatedEntities = Array.from(this.entityManager.getEntities()).filter((entity) => entity.hasComponent('animation2d'));
    const select = document.createElement('select');
    select.style.cssText = 'padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);color:#e6edf3;font:inherit;';
    for (const entity of animatedEntities) {
      const option = document.createElement('option');
      option.value = entity.id;
      option.textContent = entity.id;
      option.selected = entity.id === this.selectedEntityId;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.selectedEntityId = select.value || null;
      requestRefresh();
    });
    body.appendChild(select);

    const selected = this.selectedEntityId ? this.entityManager.getEntity(this.selectedEntityId) : animatedEntities[0];
    if (selected && !this.selectedEntityId) this.selectedEntityId = selected.id;
    const animation = selected?.getComponent('animation2d')?.data as AnimationComponentData | undefined;
    const clip = animation?.clips[animation.state ?? ''];
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(Math.max(0, (clip?.frames.length ?? 1) - 1));
    slider.step = '1';
    slider.value = String(this.scrubFrameIndex ?? animation?.frameIndex ?? 0);
    slider.addEventListener('input', () => {
      this.scrubFrameIndex = Number(slider.value);
      requestRefresh();
    });
    body.appendChild(slider);

    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:#9ea7ad;line-height:1.5;';
    info.textContent = animation
      ? `State: ${animation.state} | Frames: ${clip?.frames.length ?? 0} | Active: ${this.activeAnimations}`
      : 'No animation entity selected';
    body.appendChild(info);
    return root;
  }

  private resolveAnimationState(entity: SpriteAnimationEntity, animation: AnimationComponentData): string {
    const body = entity.getComponent('physics2d')?.data as { velocityX?: number; velocityY?: number } | undefined;
    const moving = Math.abs(body?.velocityX ?? 0) + Math.abs(body?.velocityY ?? 0) > 0.2;
    if (moving && animation.clips.run) return 'run';
    if (animation.clips.idle) return 'idle';
    return animation.state;
  }

  private computeFrameIndex(entity: SpriteAnimationEntity, animation: AnimationComponentData, clip: SpriteAnimationClip2D, dt: number): number {
    if (this.selectedEntityId === entity.id && this.scrubFrameIndex !== null) {
      return Math.max(0, Math.min(clip.frames.length - 1, this.scrubFrameIndex));
    }
    if (animation.playing === false) {
      return animation.frameIndex ?? 0;
    }
    const elapsed = (animation.elapsed ?? 0) + dt * (animation.speed ?? 1);
    animation.elapsed = elapsed;
    const frame = Math.floor(elapsed * clip.fps);
    if (clip.loop === false) {
      return Math.min(frame, clip.frames.length - 1);
    }
    return clip.frames.length > 0 ? frame % clip.frames.length : 0;
  }

  dispose(): void {
    // Clear animation state
    this.activeAnimations = 0;
    this.selectedEntityId = null;
    this.scrubFrameIndex = null;
  }
}
