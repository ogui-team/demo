#!/usr/bin/env node
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const sharedContractsDir = join(repoRoot, 'packages', 'shared-contracts');
const sharedDistDir = join(sharedContractsDir, 'dist');
const releaseRoot = join(repoRoot, 'dist-release', 'my-engine-sdk');
const releaseDist = join(releaseRoot, 'dist');

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function main() {
  console.log('[sdk-release] Building @shared/contracts...');
  run('npm', ['run', 'build'], sharedContractsDir);

  if (!existsSync(sharedDistDir)) {
    throw new Error('Expected shared-contracts dist output not found.');
  }

  console.log('[sdk-release] Creating dist-release/my-engine-sdk...');
  rmSync(releaseRoot, { recursive: true, force: true });
  mkdirSync(releaseDist, { recursive: true });

  cpSync(sharedDistDir, releaseDist, { recursive: true });

  const pkg = {
    name: 'my-engine-sdk',
    version: '0.3.0',
    description: 'Public SDK for external game engine plugins (contracts + deterministic utilities).',
    type: 'commonjs',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        require: './dist/index.js',
        default: './dist/index.js'
      }
    },
    files: [
      'dist',
      'README.md',
      'INSTALLATION_VIDEO.md',
      'examples'
    ],
    keywords: ['game-engine', 'sdk', 'plugin', 'deterministic', 'typescript'],
    license: 'UNLICENSED'
  };

  writeFileSync(join(releaseRoot, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const readme = `# my-engine-sdk\n\nExternal plugin SDK for deterministic engine extensions.\n\n## Install\n\n\`\`\`bash\nnpm install ./my-engine-sdk-0.3.0.tgz\n\`\`\`\n\n## Use\n\n\`\`\`ts\nimport type {\n  GamePlugin,\n  IAudioService,\n  ISettingsService,\n  PluginInitContext,\n} from 'my-engine-sdk';\n\nexport class MyPlugin implements GamePlugin {\n  readonly id = 'my-plugin';\n  readonly name = 'My Plugin';\n  readonly version = '1.0.0';\n\n  init(context: PluginInitContext): void {\n    const settings = context.sdk.getService<ISettingsService>('settings');\n    settings?.set('ui.volume', 80);\n\n    const audio = context.sdk.getService<IAudioService>('audio');\n    audio?.setMasterVolume(0.8);\n    audio?.play('ui_confirm');\n  }\n\n  dispose(): void {}\n}\n\`\`\`\n\n## Built-In Services\n\n- \`settings\`: deterministic settings state persisted through StateManager paths\n- \`audio\`: deterministic audio intents and options state (muted/master volume)\n\n## Includes\n\n- SDK contracts: \`GamePlugin\`, \`PluginInitContext\`, \`IPluginRegistry\`, \`GameEngineSdk\`, \`IService\`, \`ServiceRegistry\`\n- Service contracts: \`ISettingsService\`, \`IAudioService\`\n- Deterministic utilities: \`DeterministicTimeImpl\`, \`DeterministicRandomImpl\`, \`injectDeterminismShim\`, \`isDeterminismShimActive\`\n- Shared gameplay/network/geometry contracts\n\n## Runtime Safety Boundary\n\n- Plugins interact only with public SDK contracts.\n- No direct \`window\`, \`document\`, renderer internals, or kernel internals are exposed via context.\n\nSee \`INSTALLATION_VIDEO.md\` for setup details.\n`;
  writeFileSync(join(releaseRoot, 'README.md'), readme, 'utf8');

  const installVideo = `# Installation-Video (Text Version)\n\nDieses Dokument ist eine kurze, textbasierte Schritt-für-Schritt-Anleitung, wie ein Entwickler \`my-engine-sdk\` lokal in ein externes Projekt einbindet.\n\n## 1) SDK-Release bauen\n\nIm Engine-Repo:\n\n\`\`\`bash\nnode scripts/build-sdk-release.mjs\ncd dist-release/my-engine-sdk\nnpm pack\n\`\`\`\n\nErgebnis: eine Datei wie \`my-engine-sdk-0.3.0.tgz\`.\n\n## 2) Externes Projekt vorbereiten\n\nIm externen Projekt:\n\n\`\`\`bash\nnpm init -y\nnpm install typescript -D\n\`\`\`\n\n## 3) SDK lokal installieren\n\nKopiere die \`.tgz\` aus dem Engine-Repo in dein externes Projekt und installiere sie:\n\n\`\`\`bash\nnpm install ./my-engine-sdk-0.3.0.tgz\n\`\`\`\n\n## 4) SDK importieren\n\n\`\`\`ts\nimport type { GameEngineSdk, GamePlugin, PluginInitContext } from 'my-engine-sdk';\n\nexport class ExternalPlugin implements GamePlugin {\n  readonly id = 'external-plugin';\n  readonly name = 'External Plugin';\n  readonly version = '1.0.0';\n\n  init(context: PluginInitContext): void {\n    context.logger.log('External plugin loaded');\n  }\n\n  dispose(): void {}\n}\n\`\`\`\n\n## 5) Integration prüfen\n\n\`\`\`bash\nnpx tsc --noEmit\n\`\`\`\n\nWenn keine Typfehler auftreten, ist das SDK korrekt eingebunden.\n\n## 6) Optional: Paket später aus Registry installieren\n\nSobald \`my-engine-sdk\` veröffentlicht ist, reicht:\n\n\`\`\`bash\nnpm install my-engine-sdk\n\`\`\`\n`;
  writeFileSync(join(releaseRoot, 'INSTALLATION_VIDEO.md'), installVideo, 'utf8');

  mkdirSync(join(releaseRoot, 'examples'), { recursive: true });
  cpSync(join(repoRoot, 'test', 'sdk', 'EmptyPlugin.ts'), join(releaseRoot, 'examples', 'EmptyPlugin.ts'));

  console.log('[sdk-release] Done. Release folder: dist-release/my-engine-sdk');
  console.log('[sdk-release] Next: cd dist-release/my-engine-sdk && npm pack');
}

main();
