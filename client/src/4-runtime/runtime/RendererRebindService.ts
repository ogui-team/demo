import * as THREE from 'three';

export const DEFAULT_SCENE_ROOT_ID = 'engine-scene-root';
export const EDITOR_VIEWPORT_ID = 'editor-center-viewport';
export const PLAY_VIEWPORT_ID = 'play-fullscreen-viewport';

interface RendererRebindServiceConfig {
  getScene: () => THREE.Scene | null;
  getRenderer: () => THREE.WebGLRenderer | null;
}

export class RendererRebindService {
  private readonly getSceneRef: () => THREE.Scene | null;
  private readonly getRendererRef: () => THREE.WebGLRenderer | null;
  private activeBinding: { sceneRootId: string; viewportId: string; boundAt: number } | null = null;

  constructor(config: RendererRebindServiceConfig) {
    this.getSceneRef = config.getScene;
    this.getRendererRef = config.getRenderer;
  }

  async bindSceneRootToViewport(sceneRootId: string, viewportId: string): Promise<boolean> {
    const scene = this.getSceneRef();
    const renderer = this.getRendererRef();
    if (!scene || !renderer) {
      return false;
    }

    if (!scene.name) {
      scene.name = DEFAULT_SCENE_ROOT_ID;
    }

    if (scene.name !== sceneRootId) {
      console.warn('[RendererRebindService] Scene root mismatch', {
        requested: sceneRootId,
        actual: scene.name,
        viewportId,
      });
      return false;
    }

    const canvas = renderer.domElement;
    const host = this.resolveViewportHost(viewportId);
    if (!canvas || !host) {
      return false;
    }

    if (viewportId === PLAY_VIEWPORT_ID) {
      if (canvas.parentElement !== document.body) {
        document.body.appendChild(canvas);
      }
      canvas.style.position = 'fixed';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      canvas.style.zIndex = '1000';
    } else {
      if (canvas.parentElement !== host) {
        host.replaceChildren(canvas);
      }
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      canvas.style.zIndex = '1';
    }

    await this.waitForLayoutFlush();

    const bounds = this.getViewportBounds(viewportId, host);
    renderer.setSize(bounds.width, bounds.height, false);
    this.activeBinding = {
      sceneRootId,
      viewportId,
      boundAt: Date.now(),
    };
    return true;
  }

  getActiveBinding(): { sceneRootId: string; viewportId: string; boundAt: number } | null {
    return this.activeBinding;
  }

  private resolveViewportHost(viewportId: string): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null;
    }

    if (viewportId === PLAY_VIEWPORT_ID) {
      return document.body;
    }

    return document.getElementById(viewportId);
  }

  private getViewportBounds(viewportId: string, host: HTMLElement): { width: number; height: number } {
    if (viewportId === PLAY_VIEWPORT_ID) {
      return {
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
      };
    }

    const rect = host.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  }

  private async waitForLayoutFlush(): Promise<void> {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }
}