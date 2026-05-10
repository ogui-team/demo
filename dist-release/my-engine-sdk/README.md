# my-engine-sdk

External plugin SDK for the engine.

## Install

```bash
npm install ./my-engine-sdk-0.3.0.tgz
```

## Use

```ts
import type { GameEngineSdk, GamePlugin, PluginInitContext } from 'my-engine-sdk';

export class MyPlugin implements GamePlugin {
  readonly id = 'my-plugin';
  readonly name = 'My Plugin';
  readonly version = '1.0.0';

  init(context: PluginInitContext): void {
    context.logger.log('MyPlugin initialized');
  }

  dispose(): void {}
}
```

## Includes

- SDK plugin contracts: `GamePlugin`, `PluginInitContext`, `IPluginRegistry`, `GameEngineSdk`
- Deterministic utilities: `DeterministicTimeImpl`, `DeterministicRandomImpl`, `injectDeterminismShim`
- Shared gameplay/network/geometry contracts

See `INSTALLATION_VIDEO.md` for a step-by-step setup walkthrough.
