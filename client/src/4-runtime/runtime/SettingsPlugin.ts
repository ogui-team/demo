import type { GamePlugin, ISettingsService, PluginInitContext } from '@shared/contracts';

const SETTINGS_SERVICE_ID = 'settings';
const SETTINGS_VISIBLE_PATH = 'sdk.services.settings.visible';
const SETTINGS_VALUE_PREFIX = 'sdk.services.settings.values';

class SettingsService implements ISettingsService {
  readonly id = SETTINGS_SERVICE_ID;

  constructor(private readonly context: PluginInitContext) {}

  show(): void {
    this.context.stateManager.set(SETTINGS_VISIBLE_PATH, true);
  }

  hide(): void {
    this.context.stateManager.set(SETTINGS_VISIBLE_PATH, false);
  }

  isVisible(): boolean {
    return this.context.stateManager.get(SETTINGS_VISIBLE_PATH) === true;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.context.stateManager.get(`${SETTINGS_VALUE_PREFIX}.${key}`) as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.context.stateManager.set(`${SETTINGS_VALUE_PREFIX}.${key}`, value as unknown);
    this.context.gameBus.emit('plugin:settings:changed', {
      key,
      value,
    });
  }

  dispose(): void {
    // State is owned by StateManager; no external listeners are held here.
  }
}

export class SettingsPlugin implements GamePlugin {
  readonly id = 'sdk-settings-plugin';
  readonly name = 'SDK Settings Plugin';
  readonly version = '0.3.0';
  readonly description = 'Registers the built-in deterministic settings service.';

  private context: PluginInitContext | null = null;

  init(context: PluginInitContext): void {
    this.context = context;
    context.sdk.registerService(SETTINGS_SERVICE_ID, new SettingsService(context));

    if (context.sdk.getService<ISettingsService>(SETTINGS_SERVICE_ID)?.get('ui.volume') === undefined) {
      context.sdk.getService<ISettingsService>(SETTINGS_SERVICE_ID)?.set('ui.volume', 100);
    }

    context.logger.log('[SettingsPlugin] Registered settings service');
  }

  dispose(): void {
    if (!this.context) {
      return;
    }

    this.context.sdk.unregisterService(SETTINGS_SERVICE_ID);
    this.context = null;
  }
}