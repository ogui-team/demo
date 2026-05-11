# Installation-Video (Text Version)

Dieses Dokument ist eine kurze, textbasierte Schritt-für-Schritt-Anleitung, wie ein Entwickler `my-engine-sdk` lokal in ein externes Projekt einbindet.

## 1) SDK-Release bauen

Im Engine-Repo:

```bash
node scripts/build-sdk-release.mjs
cd dist-release/my-engine-sdk
npm pack
```

Ergebnis: eine Datei wie `my-engine-sdk-0.3.0.tgz`.

## 2) Externes Projekt vorbereiten

Im externen Projekt:

```bash
npm init -y
npm install typescript -D
```

## 3) SDK lokal installieren

Kopiere die `.tgz` aus dem Engine-Repo in dein externes Projekt und installiere sie:

```bash
npm install ./my-engine-sdk-0.3.0.tgz
```

## 4) SDK importieren

```ts
import type { GameEngineSdk, GamePlugin, PluginInitContext } from 'my-engine-sdk';

export class ExternalPlugin implements GamePlugin {
  readonly id = 'external-plugin';
  readonly name = 'External Plugin';
  readonly version = '1.0.0';

  init(context: PluginInitContext): void {
    context.logger.log('External plugin loaded');
  }

  dispose(): void {}
}
```

## 5) Integration prüfen

```bash
npx tsc --noEmit
```

Wenn keine Typfehler auftreten, ist das SDK korrekt eingebunden.

## 6) Optional: Paket später aus Registry installieren

Sobald `my-engine-sdk` veröffentlicht ist, reicht:

```bash
npm install my-engine-sdk
```
