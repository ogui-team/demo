import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const options = {
    url: 'http://localhost:3000/',
    phaseId: 'phase3',
    reloadCount: 5,
    settleMs: 350,
    sampleCount: 3,
    sampleGapMs: 75,
    thresholdBytes: 2 * 1024 * 1024,
    output: 'tmp/memory-gate-report.json',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--url' && next) {
      options.url = next;
      i++;
    } else if (arg === '--phase' && next) {
      options.phaseId = next;
      i++;
    } else if (arg === '--reloads' && next) {
      options.reloadCount = Number(next);
      i++;
    } else if (arg === '--settle-ms' && next) {
      options.settleMs = Number(next);
      i++;
    } else if (arg === '--sample-count' && next) {
      options.sampleCount = Number(next);
      i++;
    } else if (arg === '--sample-gap-ms' && next) {
      options.sampleGapMs = Number(next);
      i++;
    } else if (arg === '--threshold-bytes' && next) {
      options.thresholdBytes = Number(next);
      i++;
    } else if (arg === '--output' && next) {
      options.output = next;
      i++;
    }
  }

  return options;
}

async function run() {
  const options = parseArgs(process.argv);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(options.url, { waitUntil: 'networkidle', timeout: 120000 });

    await page.waitForFunction(() => typeof window.__validateReloadMemoryGate === 'function', null, {
      timeout: 120000,
    });

    const report = await page.evaluate(async (validationOptions) => {
      // @ts-ignore runtime-injected diagnostics helper
      return window.__validateReloadMemoryGate(validationOptions);
    }, {
      phaseId: options.phaseId,
      reloadCount: options.reloadCount,
      settleMs: options.settleMs,
      sampleCount: options.sampleCount,
      sampleGapMs: options.sampleGapMs,
      thresholdBytes: options.thresholdBytes,
    });

    const outputPath = resolve(options.output);
    const outputDir = outputPath.replace(/[/\\][^/\\]+$/, '');
    if (outputDir) {
      mkdirSync(outputDir, { recursive: true });
    }
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log('[validate-reload-memory-gate] Report written:', outputPath);
    console.log('[validate-reload-memory-gate] Gate passed:', report.gatePassed);
    console.log('[validate-reload-memory-gate] Delta MB:', report.deltaMb);

    process.exit(report.gatePassed ? 0 : 1);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('[validate-reload-memory-gate] Failed:', error);
  process.exit(1);
});
