# my-engine-sdk

External plugin SDK for deterministic engine extensions.

## Install

```bash
npm install ./my-engine-sdk-0.3.0.tgz
```

## Use

```ts
import type {
  GamePlugin,
  IAudioService,
  ISettingsService,
  PluginInitContext,
} from 'my-engine-sdk';

export class MyPlugin implements GamePlugin {
  readonly id = 'my-plugin';
  readonly name = 'My Plugin';
  readonly version = '1.0.0';

  init(context: PluginInitContext): void {
    const settings = context.sdk.getService<ISettingsService>('settings');
    settings?.set('ui.volume', 80);

    const audio = context.sdk.getService<IAudioService>('audio');
    audio?.setMasterVolume(0.8);
    audio?.play('ui_confirm');
  }

  dispose(): void {}
}
```

## Built-In Services

- `settings`: deterministic settings state persisted through StateManager paths
- `audio`: deterministic audio intents and options state (muted/master volume)

## Includes

- SDK contracts: `GamePlugin`, `PluginInitContext`, `IPluginRegistry`, `GameEngineSdk`, `IService`, `ServiceRegistry`
- Service contracts: `ISettingsService`, `IAudioService`
- Deterministic utilities: `DeterministicTimeImpl`, `DeterministicRandomImpl`, `injectDeterminismShim`, `isDeterminismShimActive`
- Shared gameplay/network/geometry contracts

## Runtime Safety Boundary

- Plugins interact only with public SDK contracts.
- No direct `window`, `document`, renderer internals, or kernel internals are exposed via context.

See `INSTALLATION_VIDEO.md` for setup details.
