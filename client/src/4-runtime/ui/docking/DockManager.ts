type DockResizeTarget = 'left' | 'right' | 'bottom';

interface DockManagerOptions {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  minSidebarWidth: number;
  maxSidebarWidth: number;
  minBottomHeight: number;
  maxBottomHeight: number;
  storageKey: string;
}

interface ResizeSession {
  pointerId: number;
  target: DockResizeTarget;
  startX: number;
  startY: number;
  startLeftWidth: number;
  startRightWidth: number;
  startBottomHeight: number;
  latestX: number;
  latestY: number;
}

const DEFAULT_OPTIONS: DockManagerOptions = {
  leftWidth: 300,
  rightWidth: 360,
  bottomHeight: 220,
  minSidebarWidth: 220,
  maxSidebarWidth: 560,
  minBottomHeight: 120,
  maxBottomHeight: 420,
  storageKey: 'editor.dock.layout.v1',
};

interface PersistedDockState {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DockManager {
  private readonly root: HTMLElement;
  private readonly options: DockManagerOptions;
  private leftWidth: number;
  private rightWidth: number;
  private bottomHeight: number;
  private resizeSession: ResizeSession | null = null;
  private rafToken: number | null = null;

  constructor(root: HTMLElement, options: Partial<DockManagerOptions> = {}) {
    this.root = root;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    this.leftWidth = this.options.leftWidth;
    this.rightWidth = this.options.rightWidth;
    this.bottomHeight = this.options.bottomHeight;
    this.restore();
    this.applyVariables();
  }

  destroy(): void {
    if (this.rafToken !== null) {
      cancelAnimationFrame(this.rafToken);
      this.rafToken = null;
    }
    this.clearResizeSession();
  }

  beginResize(target: DockResizeTarget, event: PointerEvent): void {
    this.clearResizeSession();
    this.resizeSession = {
      pointerId: event.pointerId,
      target,
      startX: event.clientX,
      startY: event.clientY,
      startLeftWidth: this.leftWidth,
      startRightWidth: this.rightWidth,
      startBottomHeight: this.bottomHeight,
      latestX: event.clientX,
      latestY: event.clientY,
    };

    this.root.classList.add('editor-dock-layout--is-dragging');

    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerUp, true);
    document.body.style.cursor = target === 'bottom' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.resizeSession || event.pointerId !== this.resizeSession.pointerId) {
      return;
    }

    this.resizeSession.latestX = event.clientX;
    this.resizeSession.latestY = event.clientY;

    if (this.rafToken !== null) {
      return;
    }

    this.rafToken = requestAnimationFrame(() => {
      this.rafToken = null;
      this.flushResizeFrame();
    });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.resizeSession || event.pointerId !== this.resizeSession.pointerId) {
      return;
    }

    if (this.rafToken !== null) {
      cancelAnimationFrame(this.rafToken);
      this.rafToken = null;
    }
    this.flushResizeFrame();
    this.clearResizeSession();
  };

  private flushResizeFrame(): void {
    if (!this.resizeSession) {
      return;
    }

    const session = this.resizeSession;
    const dx = session.latestX - session.startX;
    const dy = session.latestY - session.startY;

    if (session.target === 'left') {
      this.leftWidth = clamp(
        session.startLeftWidth + dx,
        this.options.minSidebarWidth,
        this.options.maxSidebarWidth,
      );
    }

    if (session.target === 'right') {
      this.rightWidth = clamp(
        session.startRightWidth - dx,
        this.options.minSidebarWidth,
        this.options.maxSidebarWidth,
      );
    }

    if (session.target === 'bottom') {
      this.bottomHeight = clamp(
        session.startBottomHeight - dy,
        this.options.minBottomHeight,
        this.options.maxBottomHeight,
      );
    }

    this.applyVariables();
  }

  private clearResizeSession(): void {
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerUp, true);
    this.root.classList.remove('editor-dock-layout--is-dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    this.resizeSession = null;
  }

  private applyVariables(): void {
    this.root.style.setProperty('--dock-left-width', `${this.leftWidth}px`);
    this.root.style.setProperty('--dock-right-width', `${this.rightWidth}px`);
    this.root.style.setProperty('--dock-bottom-height', `${this.bottomHeight}px`);
    this.persist();
  }

  private persist(): void {
    try {
      const payload: PersistedDockState = {
        leftWidth: this.leftWidth,
        rightWidth: this.rightWidth,
        bottomHeight: this.bottomHeight,
      };
      window.localStorage.setItem(this.options.storageKey, JSON.stringify(payload));
    } catch {
      // Ignore persistence failures in restricted browser contexts.
    }
  }

  private restore(): void {
    try {
      const raw = window.localStorage.getItem(this.options.storageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<PersistedDockState>;
      if (typeof parsed.leftWidth === 'number') {
        this.leftWidth = clamp(parsed.leftWidth, this.options.minSidebarWidth, this.options.maxSidebarWidth);
      }
      if (typeof parsed.rightWidth === 'number') {
        this.rightWidth = clamp(parsed.rightWidth, this.options.minSidebarWidth, this.options.maxSidebarWidth);
      }
      if (typeof parsed.bottomHeight === 'number') {
        this.bottomHeight = clamp(parsed.bottomHeight, this.options.minBottomHeight, this.options.maxBottomHeight);
      }
    } catch {
      // Ignore malformed storage payloads.
    }
  }
}
