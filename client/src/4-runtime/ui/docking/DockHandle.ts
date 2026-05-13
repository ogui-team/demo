import { DockManager } from './DockManager';

type DockHandleTarget = 'left' | 'right' | 'bottom';

interface DockHandleOptions {
  target: DockHandleTarget;
  className: string;
  manager: DockManager;
}

export class DockHandle {
  private readonly element: HTMLDivElement;
  private readonly target: DockHandleTarget;
  private readonly manager: DockManager;

  constructor(options: DockHandleOptions) {
    this.target = options.target;
    this.manager = options.manager;
    this.element = document.createElement('div');
    this.element.className = options.className;
    this.element.setAttribute('role', 'separator');
    this.element.setAttribute('aria-orientation', this.target === 'bottom' ? 'horizontal' : 'vertical');
    this.element.addEventListener('pointerdown', this.onPointerDown);
  }

  getElement(): HTMLElement {
    return this.element;
  }

  destroy(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.element.setPointerCapture(event.pointerId);
    this.manager.beginResize(this.target, event);
  };
}
