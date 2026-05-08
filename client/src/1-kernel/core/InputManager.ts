import { EventListenerRegistry } from './EventListenerRegistry';
import { InputRouter } from './InputRouter';
import { gameBus } from './EventBus';

export class InputManager {
  private router: InputRouter;
  private enabled = false;
  private listenerRegistry = new EventListenerRegistry();
  private disposed = false;
  private keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((event: KeyboardEvent) => void) | null = null;
  private mouseDownHandler: ((event: MouseEvent) => void) | null = null;
  private mouseMoveHandler: ((event: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((event: MouseEvent) => void) | null = null;
  private dblClickHandler: ((event: MouseEvent) => void) | null = null;
  private wheelHandler: ((event: WheelEvent) => void) | null = null;
  private contextMenuHandler: ((event: MouseEvent) => void) | null = null;
  private pointerLockHandler: (() => void) | null = null;
  private readonly eventCounts = {
    keyDown: 0,
    keyUp: 0,
    mouseDown: 0,
    mouseMove: 0,
    mouseUp: 0,
    doubleClick: 0,
    wheel: 0,
    pointerLockChange: 0,
  };

  constructor(router: InputRouter) {
    this.router = router;
  }

  enable(): void {
    if (this.disposed) {
      console.warn('[InputManager] Cannot enable a disposed input manager');
      return;
    }
    if (this.enabled) return;
    this.enabled = true;

    this.keyDownHandler = (event) => {
      this.eventCounts.keyDown += 1;
      this.router.handleKeyDown(event);
    };
    this.keyUpHandler = (event) => {
      this.eventCounts.keyUp += 1;
      this.router.handleKeyUp(event);
    };
    this.mouseDownHandler = (event) => {
      this.eventCounts.mouseDown += 1;
      this.router.handlePointerDown(event);
    };
    this.mouseMoveHandler = (event) => {
      this.eventCounts.mouseMove += 1;
      this.router.handlePointerMove(event);
    };
    this.mouseUpHandler = (event) => {
      this.eventCounts.mouseUp += 1;
      this.router.handlePointerUp(event);
    };
    this.dblClickHandler = (event) => {
      this.eventCounts.doubleClick += 1;
      this.router.handleDoubleClick(event);
    };
    this.wheelHandler = (event) => {
      this.eventCounts.wheel += 1;
      this.router.handleWheel(event);
    };
    this.contextMenuHandler = (event) => {
      if (this.router.getCurrentContext() === 'editor') {
        event.preventDefault();
      }
    };
    this.pointerLockHandler = () => {
      this.eventCounts.pointerLockChange += 1;
      this.router.handlePointerLockChange();
    };

    this.listenerRegistry.addEventListener(window, 'keydown', this.keyDownHandler);
    this.listenerRegistry.addEventListener(window, 'keyup', this.keyUpHandler);
    this.listenerRegistry.addEventListener(window, 'mousedown', this.mouseDownHandler);
    this.listenerRegistry.addEventListener(window, 'mousemove', this.mouseMoveHandler);
    this.listenerRegistry.addEventListener(window, 'mouseup', this.mouseUpHandler);
    this.listenerRegistry.addEventListener(window, 'dblclick', this.dblClickHandler);
    this.listenerRegistry.addEventListener(window, 'wheel', this.wheelHandler, { passive: false });
    this.listenerRegistry.addEventListener(window, 'contextmenu', this.contextMenuHandler);
    this.listenerRegistry.addEventListener(document, 'pointerlockchange', this.pointerLockHandler);
    gameBus.emit('stateMutation', {
      source: 'InputManager',
      path: 'input.enabled',
      changedCount: 1,
    });
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    this.listenerRegistry.clear();
    this.keyDownHandler = null;
    this.keyUpHandler = null;
    this.mouseDownHandler = null;
    this.mouseMoveHandler = null;
    this.mouseUpHandler = null;
    this.dblClickHandler = null;
    this.wheelHandler = null;
    this.contextMenuHandler = null;
    this.pointerLockHandler = null;
    gameBus.emit('stateMutation', {
      source: 'InputManager',
      path: 'input.enabled',
      changedCount: 1,
    });
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        router: this.router.constructor.name,
        disposed: this.disposed,
        trackedListeners: this.listenerRegistry.getListenerCount(),
        ...this.eventCounts,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disable();
    this.listenerRegistry.dispose();
    this.disposed = true;
  }

  destroy(): void {
    this.dispose();
  }
}
