import { describe, expect, it, vi } from 'vitest';
import { TeardownRegistry } from '../../../client/src/1-kernel/core/TeardownRegistry';

describe('Bootstrap lifecycle guardrails', () => {
  it('removes registered window listeners and disposes phase-owned systems through the teardown registry', () => {
    const registry = new TeardownRegistry();
    const removeEventListener = vi.fn();
    const addEventListener = vi.fn((event: string, handler: EventListener) => {
      registry.register(() => removeEventListener(event, handler));
    });

    const windowMock = {
      addEventListener,
      removeEventListener,
    } as unknown as Window;

    const phase3System = {
      dispose: vi.fn(),
    };
    const phase5System = {
      teardown: vi.fn(),
    };
    const onKeyDown = vi.fn();

    function bootstrapPhase3(): void {
      registry.register(phase3System);
    }

    function bootstrapPhase4(): void {
      windowMock.addEventListener('keydown', onKeyDown as unknown as EventListener);
    }

    function bootstrapPhase5(): void {
      registry.register(phase5System);
    }

    bootstrapPhase3();
    bootstrapPhase4();
    bootstrapPhase5();

    registry.dispose();

    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('keydown', onKeyDown);
    expect(phase3System.dispose).toHaveBeenCalledTimes(1);
    expect(phase5System.teardown).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
