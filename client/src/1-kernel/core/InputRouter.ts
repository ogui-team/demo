import type { InputContext } from './InputContext';
import { getContext, onContextChange } from './InputContext';
import { getContextRaycastLayers, type RaycastLayer } from './RaycastLayers';

type InputResult = boolean | void;

export interface RoutedInputHandler {
  handleKeyDown?(event: KeyboardEvent): InputResult;
  handleKeyUp?(event: KeyboardEvent): InputResult;
  handlePointerDown?(event: MouseEvent): InputResult;
  handlePointerMove?(event: MouseEvent): InputResult;
  handlePointerUp?(event: MouseEvent): InputResult;
  handleDoubleClick?(event: MouseEvent): InputResult;
  handleWheel?(event: WheelEvent): InputResult;
}

export interface PointerLockHandler {
  requestPointerLock?(): void;
  releasePointerLock?(): void;
  syncPointerLockState?(): void;
  isMouseLocked?(): boolean;
}

export interface InputRouterConfig {
  canvas: HTMLCanvasElement;
  editorTool?: RoutedInputHandler;
  editorSelection?: RoutedInputHandler;
  editorGizmo?: RoutedInputHandler;
  editorController?: RoutedInputHandler;
  playController?: RoutedInputHandler & PointerLockHandler;
  combatSystem?: RoutedInputHandler;
  /** Physgun / grab tool — checked before combatSystem in play context. */
  physGun?: RoutedInputHandler;
  /** Pickup / interaction system — E-key proximity pickup. */
  interactionSystem?: RoutedInputHandler;
  /** Toolbar hotbar — 1-5 hotkeys; checked before playController. */
  toolbarSystem?: RoutedInputHandler;
  uiManager?: RoutedInputHandler;
  enableDebugOverlay?: boolean;
}

export class InputRouter {
  private canvas: HTMLCanvasElement;
  private editorTool?: RoutedInputHandler;
  private editorSelection?: RoutedInputHandler;
  private editorGizmo?: RoutedInputHandler;
  private editorController?: RoutedInputHandler;
  private playController?: RoutedInputHandler & PointerLockHandler;
  private combatSystem?: RoutedInputHandler;
  private physGun?: RoutedInputHandler;
  private interactionSystem?: RoutedInputHandler;
  private toolbarSystem?: RoutedInputHandler;
  private uiManager?: RoutedInputHandler;
  private currentContext: InputContext;
  private activeRaycastLayers: RaycastLayer[];
  private overlayEl: HTMLDivElement | null = null;
  private contextUnsub: (() => void) | null = null;

  constructor(config: InputRouterConfig) {
    this.canvas = config.canvas;
    this.editorTool        = config.editorTool;
    this.editorSelection   = config.editorSelection;
    this.editorGizmo        = config.editorGizmo;
    this.editorController   = config.editorController;
    this.playController     = config.playController;
    this.combatSystem       = config.combatSystem;
    this.physGun            = config.physGun;
    this.interactionSystem  = config.interactionSystem;
    this.toolbarSystem      = config.toolbarSystem;
    this.uiManager          = config.uiManager;
    this.currentContext = getContext();
    this.activeRaycastLayers = getContextRaycastLayers(this.currentContext);

    if (config.enableDebugOverlay !== false) {
      this.mountDebugOverlay();
    }

    this.contextUnsub = onContextChange((next) => {
      this.currentContext = next;
      this.activeRaycastLayers = getContextRaycastLayers(next);
      this.syncPointerLockForContext();
      this.renderDebugOverlay();
    });

    this.syncPointerLockForContext();
    this.renderDebugOverlay();
  }

  setCombatSystem(handler: RoutedInputHandler | undefined): void {
    this.combatSystem = handler;
  }

  setPhysGun(handler: RoutedInputHandler | undefined): void {
    this.physGun = handler;
  }

  setToolbarSystem(handler: RoutedInputHandler | undefined): void {
    this.toolbarSystem = handler;
  }

  setUiManager(handler: RoutedInputHandler | undefined): void {
    this.uiManager = handler;
  }

  getActiveRaycastLayers(): RaycastLayer[] {
    return [...this.activeRaycastLayers];
  }

  getCurrentContext(): InputContext {
    return this.currentContext;
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  handlePointerLockChange(): void {
    this.playController?.syncPointerLockState?.();
    this.renderDebugOverlay();
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (this.isTypingTarget()) {
      this.renderDebugOverlay();
      return false;
    }

    let handled = false;

    if (this.currentContext === 'editor') {
      handled = this.invoke(this.editorTool?.handleKeyDown, this.editorTool, event)
        || this.invoke(this.editorController?.handleKeyDown, this.editorController, event);
    } else if (this.currentContext === 'game') {
      handled = this.invoke(this.physGun?.handleKeyDown, this.physGun, event)
        || this.invoke(this.interactionSystem?.handleKeyDown, this.interactionSystem, event)
        || this.invoke(this.toolbarSystem?.handleKeyDown, this.toolbarSystem, event)
        || this.invoke(this.playController?.handleKeyDown, this.playController, event)
        || this.invoke(this.combatSystem?.handleKeyDown, this.combatSystem, event);
    } else if (this.currentContext === 'ui') {
      handled = this.invoke(this.uiManager?.handleKeyDown, this.uiManager, event);
    }

    this.renderDebugOverlay();
    return handled;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    let handled = false;

    if (this.currentContext === 'editor') {
      handled = this.invoke(this.editorTool?.handleKeyUp, this.editorTool, event)
        || this.invoke(this.editorController?.handleKeyUp, this.editorController, event);
    } else if (this.currentContext === 'game') {
      handled = this.invoke(this.playController?.handleKeyUp, this.playController, event);
    } else if (this.currentContext === 'ui') {
      handled = this.invoke(this.uiManager?.handleKeyUp, this.uiManager, event);
    }

    this.renderDebugOverlay();
    return handled;
  }

  handlePointerDown(event: MouseEvent): boolean {
    let handled = false;

    if (this.currentContext === 'ui' || this.isUiTarget(event.target)) {
      handled = this.invoke(this.uiManager?.handlePointerDown, this.uiManager, event);
      this.renderDebugOverlay();
      return handled;
    }

    if (this.currentContext === 'editor') {
      handled = this.invoke(this.editorTool?.handlePointerDown, this.editorTool, event)
        || this.invoke(this.editorGizmo?.handlePointerDown, this.editorGizmo, event)
        || this.invoke(this.editorSelection?.handlePointerDown, this.editorSelection, event)
        || this.invoke(this.editorController?.handlePointerDown, this.editorController, event);
    } else if (this.currentContext === 'game') {
      if (this.invoke(this.physGun?.handlePointerDown, this.physGun, event)) {
        handled = true;
      } else {
        const playHandled = this.invoke(this.playController?.handlePointerDown, this.playController, event);
        handled = playHandled;

        if (!this.isPointerLocked() && event.button === 0 && event.target === this.canvas) {
          this.playController?.requestPointerLock?.();
          handled = true;
        } else if (!playHandled) {
          handled = this.invoke(this.combatSystem?.handlePointerDown, this.combatSystem, event);
        }
      }
    }

    this.renderDebugOverlay();
    return handled;
  }

  handlePointerMove(event: MouseEvent): boolean {
    let handled = false;

    if (this.currentContext === 'editor') {
      handled = this.invoke(this.editorTool?.handlePointerMove, this.editorTool, event)
        || this.invoke(this.editorGizmo?.handlePointerMove, this.editorGizmo, event)
        || this.invoke(this.editorController?.handlePointerMove, this.editorController, event)
        || this.invoke(this.editorSelection?.handlePointerMove, this.editorSelection, event);
    } else if (this.currentContext === 'game') {
      handled = this.invoke(this.playController?.handlePointerMove, this.playController, event);
    } else if (this.currentContext === 'ui') {
      handled = this.invoke(this.uiManager?.handlePointerMove, this.uiManager, event);
    }

    return handled;
  }

  handlePointerUp(event: MouseEvent): boolean {
    let handled = false;

    if (this.currentContext === 'editor') {
      handled = this.invoke(this.editorTool?.handlePointerUp, this.editorTool, event)
        || this.invoke(this.editorGizmo?.handlePointerUp, this.editorGizmo, event)
        || this.invoke(this.editorController?.handlePointerUp, this.editorController, event);
    } else if (this.currentContext === 'game') {
      handled = this.invoke(this.playController?.handlePointerUp, this.playController, event);
    } else if (this.currentContext === 'ui') {
      handled = this.invoke(this.uiManager?.handlePointerUp, this.uiManager, event);
    }

    this.renderDebugOverlay();
    return handled;
  }

  handleDoubleClick(event: MouseEvent): boolean {
    let handled = false;

    if (this.currentContext === 'editor' && !this.isUiTarget(event.target)) {
      handled = this.invoke(this.editorTool?.handleDoubleClick, this.editorTool, event)
        || this.invoke(this.editorGizmo?.handleDoubleClick, this.editorGizmo, event);
    } else if (this.currentContext === 'ui') {
      handled = this.invoke(this.uiManager?.handleDoubleClick, this.uiManager, event);
    }

    this.renderDebugOverlay();
    return handled;
  }

  handleWheel(event: WheelEvent): boolean {
    let handled = false;

    if (this.currentContext === 'editor' && !this.isUiTarget(event.target)) {
      handled = this.invoke(this.editorTool?.handleWheel, this.editorTool, event)
        || this.invoke(this.editorController?.handleWheel, this.editorController, event);
    } else if (this.currentContext === 'game') {
      handled = this.invoke(this.physGun?.handleWheel, this.physGun, event)
        || this.invoke(this.combatSystem?.handleWheel, this.combatSystem, event);
    } else if (this.currentContext === 'ui') {
      handled = this.invoke(this.uiManager?.handleWheel, this.uiManager, event);
    }

    return handled;
  }

  destroy(): void {
    this.contextUnsub?.();
    this.contextUnsub = null;
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  private syncPointerLockForContext(): void {
    if (this.currentContext !== 'game') {
      this.playController?.releasePointerLock?.();
    }

    this.playController?.syncPointerLockState?.();
  }

  private isUiTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target === this.canvas || this.canvas.contains(target)) return false;
    if (target.closest('[data-ui-interactive="true"]')) return true;
    if (target.isContentEditable) return true;

    const interactive = target.closest('button, input, select, textarea, a[href], summary, label, [role="button"], [role="dialog"], [role="menu"], [tabindex]');
    return interactive instanceof HTMLElement;
  }

  private isTypingTarget(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return active.tagName === 'INPUT'
      || active.tagName === 'TEXTAREA'
      || active.isContentEditable;
  }

  private invoke<T extends Event>(
    handler: ((event: T) => InputResult) | undefined,
    scope: RoutedInputHandler | undefined,
    event: T,
  ): boolean {
    if (!handler || !scope) return false;
    return Boolean(handler.call(scope, event));
  }

  private mountDebugOverlay(): void {
    if (this.overlayEl) return;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'input-debug-overlay';
    Object.assign(this.overlayEl.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      zIndex: '9000',
      pointerEvents: 'none',
      background: 'rgba(10, 10, 10, 0.78)',
      border: '1px solid rgba(80, 80, 80, 0.65)',
      color: '#c0c0c0',
      padding: '6px 8px',
      fontFamily: '"Courier New", monospace',
      fontSize: '10px',
      lineHeight: '1.4',
      letterSpacing: '1px',
    });
    document.body.appendChild(this.overlayEl);
  }

  private renderDebugOverlay(): void {
    if (!this.overlayEl) return;

    this.overlayEl.innerHTML = [
      `context: ${this.currentContext}`,
      `layers: ${this.activeRaycastLayers.length > 0 ? this.activeRaycastLayers.join(', ') : 'none'}`,
      `pointer lock: ${this.isPointerLocked() ? 'locked' : 'unlocked'}`,
    ].join('<br>');
  }
}
