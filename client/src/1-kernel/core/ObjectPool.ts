export interface ObjectPoolStats {
  available: number;
  active: number;
  total: number;
}

export interface IPoolable {
  isActive: boolean;
  reset(): void;
}

function isPoolable(value: unknown): value is IPoolable {
  return !!value
    && typeof value === 'object'
    && 'isActive' in value
    && typeof (value as IPoolable).reset === 'function';
}

export interface ObjectPoolOptions<T> {
  initialSize?: number;
  onAcquire?: (value: T) => void;
  onRelease?: (value: T) => void;
  reset?: (value: T) => void;
}

export class ObjectPool<T> {
  private readonly available: T[] = [];
  private readonly active = new Set<T>();
  private readonly factory: () => T;
  private readonly onAcquire?: (value: T) => void;
  private readonly onRelease?: (value: T) => void;
  private readonly resetValue?: (value: T) => void;

  constructor(factory: () => T, options: ObjectPoolOptions<T> = {}) {
    this.factory = factory;
    this.onAcquire = options.onAcquire;
    this.onRelease = options.onRelease;
    this.resetValue = options.reset;

    this.prewarm(options.initialSize ?? 0);
  }

  prewarm(size: number): void {
    for (let index = this.available.length; index < size; index += 1) {
      this.available.push(this.factory());
    }
  }

  acquire(): T {
    const value = this.available.pop() ?? this.factory();
    if (isPoolable(value)) {
      value.isActive = true;
    }
    this.active.add(value);
    this.onAcquire?.(value);
    return value;
  }

  release(value: T): void {
    if (!this.active.delete(value)) return;
    this.onRelease?.(value);
    if (isPoolable(value)) {
      value.isActive = false;
    }
    if (this.resetValue) {
      this.resetValue(value);
    } else if (isPoolable(value)) {
      value.reset();
    }
    this.available.push(value);
  }

  releaseAll(): void {
    while (this.active.size > 0) {
      const next = this.active.values().next();
      if (next.done) break;
      this.release(next.value);
    }
  }

  forEachActive(callback: (value: T) => void): void {
    this.active.forEach(callback);
  }

  getActiveValues(): IterableIterator<T> {
    return this.active.values();
  }

  getStats(): ObjectPoolStats {
    return {
      available: this.available.length,
      active: this.active.size,
      total: this.available.length + this.active.size,
    };
  }
}