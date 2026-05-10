export interface DisposableLike {
  dispose(): void;
}

export interface TeardownLike {
  teardown(): void;
}

export interface DestroyLike {
  destroy(): void;
}

export type TeardownTarget = (() => void) | DisposableLike | TeardownLike | DestroyLike;

function hasDispose(target: unknown): target is DisposableLike {
  return typeof target === 'object' && target !== null && 'dispose' in target && typeof (target as { dispose?: unknown }).dispose === 'function';
}

function hasTeardown(target: unknown): target is TeardownLike {
  return typeof target === 'object' && target !== null && 'teardown' in target && typeof (target as { teardown?: unknown }).teardown === 'function';
}

function hasDestroy(target: unknown): target is DestroyLike {
  return typeof target === 'object' && target !== null && 'destroy' in target && typeof (target as { destroy?: unknown }).destroy === 'function';
}

export class TeardownRegistry {
  private readonly teardowns: Array<() => void> = [];
  private disposed = false;

  register(target: TeardownTarget | null | undefined): void {
    if (!target) {
      return;
    }

    if (this.disposed) {
      return;
    }

    if (typeof target === 'function') {
      this.teardowns.push(target);
      return;
    }

    if (hasDispose(target)) {
      this.teardowns.push(() => (target as DisposableLike).dispose());
      return;
    }

    if (hasTeardown(target)) {
      this.teardowns.push(() => (target as TeardownLike).teardown());
      return;
    }

    if (hasDestroy(target)) {
      this.teardowns.push(() => target.destroy());
    }
  }

  clear(): void {
    while (this.teardowns.length > 0) {
      this.teardowns.pop()?.();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clear();
    this.disposed = true;
  }

  get size(): number {
    return this.teardowns.length;
  }
}