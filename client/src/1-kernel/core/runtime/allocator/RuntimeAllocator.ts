import { FrameMemoryArena } from './FrameMemoryArena';

export class RuntimeAllocator {
  private readonly arenas = new Map<string, FrameMemoryArena>();

  createArena(name: string, sizeInBytes: number): FrameMemoryArena {
    if (this.arenas.has(name)) {
      throw new Error(`[RuntimeAllocator] Arena already exists: ${name}`);
    }
    const arena = new FrameMemoryArena(sizeInBytes);
    this.arenas.set(name, arena);
    return arena;
  }

  getArena(name: string): FrameMemoryArena | undefined {
    return this.arenas.get(name);
  }

  resetArena(name: string): boolean {
    const arena = this.arenas.get(name);
    if (!arena) {
      return false;
    }
    arena.reset();
    return true;
  }

  resetAll(): void {
    for (const arena of this.arenas.values()) {
      arena.reset();
    }
  }

  destroyArena(name: string): boolean {
    return this.arenas.delete(name);
  }

  getDiagnostics(): Record<string, unknown> {
    const diagnostics: Record<string, unknown> = {};
    for (const [name, arena] of this.arenas.entries()) {
      diagnostics[name] = {
        capacity: arena.capacity,
        usedBytes: arena.usedBytes,
        remainingBytes: arena.remainingBytes,
      };
    }
    return diagnostics;
  }
}
