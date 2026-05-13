import type { GamePlugin, PluginInitContext } from '@shared/contracts';
import { OGUI } from '../ui/OGUITheme';

type PhysicsSystemLike = {
  update: (...args: any[]) => Map<string, unknown>;
};

type HordeSystemLike = {
  update: (...args: any[]) => void;
};

type HudLike = {
  showNotification?: (text: string, durationSeconds?: number) => void;
};

type EditorShellDebugState = {
  paused: boolean;
  active: boolean;
};

export class EditorShellPlugin implements GamePlugin {
  readonly id = 'editor-shell-plugin';
  readonly name = 'Editor Shell Plugin';
  readonly version = '0.3.0';
  readonly description = 'Unreal-Mode editor shell with selective simulation freeze controls.';

  private context: PluginInitContext | null = null;
  private root: HTMLDivElement | null = null;
  private playButton: HTMLButtonElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private paused = false;

  private physicsSystemRef: PhysicsSystemLike | null = null;
  private hordeSystemRef: HordeSystemLike | null = null;
  private physicsUpdateOriginal: PhysicsSystemLike['update'] | null = null;
  private hordeUpdateOriginal: HordeSystemLike['update'] | null = null;
  private uiReadyUnsubscribe: (() => void) | null = null;
  private initialized = false;

  init(context: PluginInitContext): void {
    this.context = context;

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      context.logger.warn('[EditorShellPlugin] DOM unavailable, editor shell disabled');
      return;
    }

    this.tryInitialize();
  }

  getDebugState(): EditorShellDebugState {
    return {
      paused: this.paused,
      active: this.root !== null,
    };
  }

  dispose(): void {
    if (this.uiReadyUnsubscribe) {
      this.uiReadyUnsubscribe();
      this.uiReadyUnsubscribe = null;
    }

    this.restoreSimulationUpdates();

    if (this.root) {
      this.root.remove();
      this.root = null;
    }

    this.playButton = null;
    this.pauseButton = null;
    this.context = null;
    this.paused = false;
    this.initialized = false;
  }

  private tryInitialize(): void {
    const context = this.context;
    if (!context || this.initialized) {
      return;
    }

    const ui2DSystem = context.systemRegistry.getSystem('ui2DSystem');
    if (!ui2DSystem) {
      if (!this.uiReadyUnsubscribe) {
        this.uiReadyUnsubscribe = context.eventBus.on('UI_READY', () => {
          if (this.uiReadyUnsubscribe) {
            this.uiReadyUnsubscribe();
            this.uiReadyUnsubscribe = null;
          }
          this.tryInitialize();
        });
      }
      return;
    }

    this.initialized = true;
    this.createShellUi();
    this.decoupleViewportFromHud();
    this.refreshButtonState();
    context.logger.log('[EditorShellPlugin] Unreal-Mode shell initialized');
  }

  private createShellUi(): void {
    const root = document.createElement('div');
    root.id = 'editor-shell-overlay';
    Object.assign(root.style, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: String(OGUI.zDebug + 60),
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '7px 9px',
      border: `1px solid ${OGUI.border}`,
      background: OGUI.bgBase,
      boxShadow: '0 10px 28px rgba(0,0,0,0.4)',
      fontFamily: OGUI.font,
      letterSpacing: '1px',
      pointerEvents: 'auto',
    });

    const label = document.createElement('div');
    label.textContent = 'EDITOR SHELL';
    Object.assign(label.style, {
      color: OGUI.textHead,
      fontSize: '10px',
      fontWeight: 'bold',
      letterSpacing: '2px',
      marginRight: '4px',
    });
    root.appendChild(label);

    this.playButton = this.createButton('PLAY', () => {
      this.setPaused(false);
    });

    this.pauseButton = this.createButton('PAUSE', () => {
      this.setPaused(true);
    });

    root.appendChild(this.playButton);
    root.appendChild(this.pauseButton);

    document.body.appendChild(root);
    this.root = root;
  }

  private createButton(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    Object.assign(button.style, {
      border: `1px solid ${OGUI.borderDim}`,
      background: 'rgba(0,0,0,0.3)',
      color: OGUI.textPri,
      fontFamily: OGUI.font,
      fontSize: '10px',
      letterSpacing: '1px',
      padding: '4px 10px',
      cursor: 'pointer',
      minWidth: '72px',
    });
    return button;
  }

  private decoupleViewportFromHud(): void {
    const hudRoot = document.querySelector('[data-hud-root]') as HTMLElement | null;
    if (hudRoot) {
      hudRoot.style.pointerEvents = 'none';
      hudRoot.style.zIndex = String(OGUI.zHUD);
    }

    this.context?.logger.log('[EditorShellPlugin] Viewport/HUD decoupling applied');
  }

  private setPaused(nextPaused: boolean): void {
    if (this.paused === nextPaused) {
      return;
    }

    this.paused = nextPaused;
    if (this.paused) {
      this.freezeSimulationUpdates();
      this.notifyHud('UNREAL-MODE: physics + horde paused');
    } else {
      this.restoreSimulationUpdates();
      this.notifyHud('UNREAL-MODE: simulation resumed');
    }

    this.refreshButtonState();
  }

  private freezeSimulationUpdates(): void {
    const context = this.context;
    if (!context) {
      return;
    }

    const physicsSystem = context.systemRegistry.getSystem('physicsSystem') as PhysicsSystemLike | undefined;
    if (physicsSystem && typeof physicsSystem.update === 'function') {
      this.physicsSystemRef = physicsSystem;
      this.physicsUpdateOriginal = this.physicsUpdateOriginal ?? physicsSystem.update.bind(physicsSystem);
      physicsSystem.update = (..._args: any[]) => new Map<string, unknown>();
    }

    const hordeSystem = context.systemRegistry.getSystem('hordeSystem') as HordeSystemLike | undefined;
    if (hordeSystem && typeof hordeSystem.update === 'function') {
      this.hordeSystemRef = hordeSystem;
      this.hordeUpdateOriginal = this.hordeUpdateOriginal ?? hordeSystem.update.bind(hordeSystem);
      hordeSystem.update = (..._args: any[]) => undefined;
    }
  }

  private restoreSimulationUpdates(): void {
    if (this.physicsSystemRef && this.physicsUpdateOriginal) {
      this.physicsSystemRef.update = this.physicsUpdateOriginal;
    }
    if (this.hordeSystemRef && this.hordeUpdateOriginal) {
      this.hordeSystemRef.update = this.hordeUpdateOriginal;
    }

    this.physicsSystemRef = null;
    this.hordeSystemRef = null;
    this.physicsUpdateOriginal = null;
    this.hordeUpdateOriginal = null;
  }

  private refreshButtonState(): void {
    if (!this.playButton || !this.pauseButton) {
      return;
    }

    this.playButton.style.borderColor = this.paused ? OGUI.borderDim : OGUI.textHead;
    this.playButton.style.background = this.paused ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.12)';

    this.pauseButton.style.borderColor = this.paused ? OGUI.textHead : OGUI.borderDim;
    this.pauseButton.style.background = this.paused ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.3)';
  }

  private notifyHud(message: string): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const hud = context.systemRegistry.getSystem('hud') as HudLike | undefined;
    hud?.showNotification?.(message, 1.5);
  }
}
