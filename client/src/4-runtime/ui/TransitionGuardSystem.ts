export class TransitionGuardSystem {
  private blockedUntil = 0;
  private isTransitioning = false;
  private readonly overlayContainer: HTMLDivElement | null;
  private releaseTimer: number | null = null;
  private safetyReleaseTimer: number | null = null;
  private readonly captureHandler = (event: Event) => {
    if (!this.isActive()) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement) {
      const isUiTarget = target.closest('[data-ui-interactive="true"], .editor-dock-layout, #editor-menu, #gizmo-mode-indicator');
      if (!isUiTarget) {
        return;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof (event as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation === 'function') {
      (event as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
    }
  };

  private readonly hardResetHandler = () => {
    this.releaseInputLock();
  };

  constructor() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.overlayContainer = null;
      return;
    }

    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'transition-guard-overlay';
    Object.assign(this.overlayContainer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '5000',
      pointerEvents: 'auto',
      background: 'transparent',
      display: 'none',
    });
    document.body.appendChild(this.overlayContainer);

    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'wheel']) {
      window.addEventListener(type, this.captureHandler, true);
    }
    window.addEventListener('ui:hard-reset-input-stack', this.hardResetHandler, true);
  }

  arm(durationMs = 500): void {
    this.isTransitioning = true;
    this.blockedUntil = Date.now() + durationMs;
    if (this.overlayContainer) {
      this.overlayContainer.style.pointerEvents = 'auto';
      this.overlayContainer.style.display = 'block';
    }

    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
    }
    if (this.safetyReleaseTimer !== null) {
      window.clearTimeout(this.safetyReleaseTimer);
    }

    this.releaseTimer = window.setTimeout(() => {
      this.releaseInputLock();
    }, durationMs);
    this.safetyReleaseTimer = window.setTimeout(() => {
      this.releaseInputLock();
    }, 1000);

    if (typeof document !== 'undefined' && typeof document.exitPointerLock === 'function' && document.pointerLockElement) {
      document.exitPointerLock();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ui:transition-guard', {
        detail: { durationMs },
      }));
    }
  }

  isActive(): boolean {
    return this.isTransitioning && Date.now() < this.blockedUntil;
  }

  public releaseInputLock(): void {
    this.blockedUntil = 0;
    if (this.overlayContainer) {
      this.overlayContainer.style.pointerEvents = 'auto';
      this.overlayContainer.style.display = 'none';
    }
    this.isTransitioning = false;
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (this.safetyReleaseTimer !== null) {
      window.clearTimeout(this.safetyReleaseTimer);
      this.safetyReleaseTimer = null;
    }
  }

  destroy(): void {
    if (typeof window === 'undefined') {
      return;
    }

    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'wheel']) {
      window.removeEventListener(type, this.captureHandler, true);
    }
    window.removeEventListener('ui:hard-reset-input-stack', this.hardResetHandler, true);
    this.releaseInputLock();
    this.overlayContainer?.remove();
  }
}