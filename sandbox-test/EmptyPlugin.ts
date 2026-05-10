import type { GamePlugin, PluginInitContext } from 'my-engine-sdk';

class EmptyPlugin implements GamePlugin {
  readonly id = 'empty-plugin';
  readonly name = 'Empty Plugin';
  readonly version = '1.0.0';

  init(context: PluginInitContext): void {
    context.logger.log('[Sandbox] EmptyPlugin initialized');
  }

  dispose(): void {
    console.log('[Sandbox] EmptyPlugin disposed');
  }
}

const plugin = new EmptyPlugin();
plugin.init({
  gameLoop: {},
  stateManager: {},
  systemContext: {},
  gameBus: {
    emit: () => {},
    on: () => () => {},
    once: () => () => {},
    off: () => {},
  },
  logger: {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  },
  features: {
    isEnabled: () => false,
  },
  config: {
    get: () => undefined,
    set: () => {},
  },
} as unknown as PluginInitContext);

plugin.dispose();
console.log('[Sandbox] Smoke test run completed');
