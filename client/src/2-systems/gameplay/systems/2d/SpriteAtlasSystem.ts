import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { DEFAULT_2D_ATLAS_ID, type SpriteAtlas2D, type SpriteFrame2D } from '../../../../4-runtime/ui/2d/TwoDTypes';
import { getItemIconAtlas } from '../../../../4-runtime/ui/ItemIconAtlas';

function createCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class SpriteAtlasSystem {
  private systemContext: SystemContext | null = null;
  private atlases = new Map<string, SpriteAtlas2D>();
  private usage = new Map<string, number>();
  private selectedAtlasId: string = DEFAULT_2D_ATLAS_ID;

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.atlases.has(DEFAULT_2D_ATLAS_ID)) {
      this.registerAtlas(this.buildBuiltinAtlas());
    }
    if (!this.atlases.has(getItemIconAtlas().id)) {
      this.registerAtlas(getItemIconAtlas());
    }
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
        atlasCount: this.atlases.size,
        selectedAtlasId: this.selectedAtlasId,
        usage: Object.fromEntries(this.usage.entries()),
      },
    };
  }

  registerAtlas(atlas: SpriteAtlas2D): void {
    this.atlases.set(atlas.id, atlas);
    gameBus.emit('stateMutation', {
      source: 'spriteAtlasSystem',
      path: `2d.atlases.${atlas.id}`,
      changedCount: 1,
    });
  }

  getAtlas(id: string): SpriteAtlas2D | null {
    return this.atlases.get(id) ?? null;
  }

  getFrame(atlasId: string, frameId: string): SpriteFrame2D | null {
    return this.atlases.get(atlasId)?.frames[frameId] ?? null;
  }

  listAtlases(): string[] {
    return [...this.atlases.keys()].sort();
  }

  noteUsage(atlasId: string, count: number): void {
    this.usage.set(atlasId, count);
  }

  update(): void {}

  getDebugPanel(requestRefresh: () => void): HTMLElement | null {
    const root = document.createElement('div');
    root.style.cssText = 'margin-top:18px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);';
    root.innerHTML = '<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:10px;letter-spacing:1.5px;color:#9ea7ad;">Sprite Preview Panel</div>';

    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;';
    root.appendChild(body);

    const select = document.createElement('select');
    select.style.cssText = 'padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);color:#e6edf3;font:inherit;';
    for (const atlasId of this.listAtlases()) {
      const option = document.createElement('option');
      option.value = atlasId;
      option.textContent = atlasId;
      option.selected = atlasId === this.selectedAtlasId;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.selectedAtlasId = select.value;
      requestRefresh();
    });
    body.appendChild(select);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    canvas.style.cssText = 'width:100%;max-width:320px;border:1px solid rgba(255,255,255,0.08);background:#0a0a0a;image-rendering:pixelated;';
    body.appendChild(canvas);

    const atlas = this.getAtlas(this.selectedAtlasId);
    const ctx = canvas.getContext('2d');
    if (atlas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (atlas.image) {
        ctx.drawImage(atlas.image, 0, 0, canvas.width, canvas.height);
      }
      ctx.strokeStyle = '#44d4ff';
      ctx.lineWidth = 1;
      Object.values(atlas.frames).slice(0, 8).forEach((frame) => {
        ctx.strokeRect(
          (frame.x / atlas.width) * canvas.width,
          (frame.y / atlas.height) * canvas.height,
          (frame.width / atlas.width) * canvas.width,
          (frame.height / atlas.height) * canvas.height,
        );
      });
    }

    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:#9ea7ad;line-height:1.5;';
    info.textContent = atlas
      ? `Frames: ${Object.keys(atlas.frames).length} | Usage: ${this.usage.get(atlas.id) ?? 0}`
      : 'No atlas selected';
    body.appendChild(info);

    return root;
  }

  private buildBuiltinAtlas(): SpriteAtlas2D {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create 2D atlas canvas');
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frames: Record<string, SpriteFrame2D> = {};
    const drawFrame = (id: string, column: number, row: number, draw: (x: number, y: number) => void): void => {
      const x = column * 32;
      const y = row * 32;
      ctx.save();
      ctx.translate(x, y);
      draw(0, 0);
      ctx.restore();
      frames[id] = { id, x, y, width: 32, height: 32, anchorX: 0.5, anchorY: 0.1 };
    };

    const drawPlayer = (primary: string, accent: string, legOffset: number): ((x: number, y: number) => void) => {
      return () => {
        ctx.fillStyle = primary;
        ctx.fillRect(11, 10, 10, 11);
        ctx.fillStyle = '#f0c79a';
        ctx.fillRect(11, 4, 10, 7);
        ctx.fillStyle = accent;
        ctx.fillRect(8, 11, 3, 9);
        ctx.fillRect(21, 11, 3, 9);
        ctx.fillStyle = '#304864';
        ctx.fillRect(11 + legOffset, 21, 4, 9);
        ctx.fillRect(17 - legOffset, 21, 4, 9);
      };
    };

    drawFrame('player_idle_0', 0, 0, drawPlayer('#ffd447', '#202020', 0));
    drawFrame('player_idle_1', 1, 0, drawPlayer('#ffe36d', '#202020', 0));
    drawFrame('player_run_0', 2, 0, drawPlayer('#ffd447', '#202020', -2));
    drawFrame('player_run_1', 3, 0, drawPlayer('#ffd447', '#202020', 2));
    drawFrame('player_remote_0', 4, 0, drawPlayer('#5db4ff', '#142030', 0));
    drawFrame('tile_grass', 0, 1, () => {
      ctx.fillStyle = '#2a5b30';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#3e7f41';
      ctx.fillRect(0, 16, 32, 16);
      ctx.fillStyle = '#183a1f';
      ctx.fillRect(4, 6, 4, 4);
      ctx.fillRect(22, 12, 5, 5);
    });
    drawFrame('tile_stone', 1, 1, () => {
      ctx.fillStyle = '#5b5b63';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#7f7f89';
      ctx.fillRect(3, 3, 10, 10);
      ctx.fillRect(15, 6, 14, 11);
      ctx.fillRect(8, 18, 17, 9);
    });
    drawFrame('tile_water', 2, 1, () => {
      ctx.fillStyle = '#214d8f';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#4da0ff';
      ctx.fillRect(0, 6, 32, 4);
      ctx.fillRect(0, 18, 32, 4);
    });
    drawFrame('parallax_hills', 3, 1, () => {
      ctx.fillStyle = '#28364d';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#3c5573';
      ctx.beginPath();
      ctx.moveTo(0, 24);
      ctx.lineTo(8, 18);
      ctx.lineTo(16, 22);
      ctx.lineTo(24, 15);
      ctx.lineTo(32, 21);
      ctx.lineTo(32, 32);
      ctx.lineTo(0, 32);
      ctx.closePath();
      ctx.fill();
    });

    return {
      id: DEFAULT_2D_ATLAS_ID,
      texture: createCanvasTexture(canvas),
      width: canvas.width,
      height: canvas.height,
      frames,
      image: canvas,
    };
  }
}
