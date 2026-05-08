import { chromium } from 'playwright';

const mode = process.argv[2] ?? 'freeplay';
const baseUrl = process.argv[3] ?? 'http://localhost:8081';
const scenarioClass = normalizeScenarioClass(process.argv[4] ?? 'baseline');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withCacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('cb', String(Date.now()));
  return parsed.toString();
}

function normalizeScenarioClass(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'expanded' || normalized === 'stress') {
    return normalized;
  }
  return 'baseline';
}

async function logPageState(page, label) {
  const state = await page.evaluate(() => ({
    href: window.location.href,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    title: document.title,
  }));
  console.log(`[sampler] ${label}`, state);
}

async function runFreeplay(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const url = withCacheBust(`${baseUrl}/?autostart=freeplay&perfMode=capture&metricsSessionId=release_freeplay&metricsScenarioClass=${encodeURIComponent(scenarioClass)}&metricsBaseUrl=${encodeURIComponent(baseUrl)}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.bringToFront();
  await page.mouse.move(800, 450);
  await logPageState(page, 'freeplay:start');
  await wait(45000);
  await logPageState(page, 'freeplay:end');
  await page.close();
}

async function runRepresentative(browser) {
  const hostPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const joinPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const hostUrl = withCacheBust(
    `${baseUrl}/?autostart=host&player=PerfHost&room=PerfGate&map=map_default&killLimit=5&roundDurationSec=120&maxPlayers=2&forceStart=1&perfMode=capture&metricsSessionId=release_representative&metricsScenarioClass=${encodeURIComponent(scenarioClass)}&serverHttpUrl=${encodeURIComponent(baseUrl)}&serverWsUrl=${encodeURIComponent(baseUrl.replace('http', 'ws'))}&metricsBaseUrl=${encodeURIComponent(baseUrl)}`,
  );
  const joinUrl = withCacheBust(
    `${baseUrl}/?autostart=join&player=PerfJoin&autoReady=1&perfMode=release&serverHttpUrl=${encodeURIComponent(baseUrl)}&serverWsUrl=${encodeURIComponent(baseUrl.replace('http', 'ws'))}`,
  );

  await hostPage.goto(hostUrl, { waitUntil: 'networkidle' });
  await hostPage.bringToFront();
  await hostPage.mouse.move(800, 450);
  await logPageState(hostPage, 'host:start');

  await wait(3000);
  await joinPage.goto(joinUrl, { waitUntil: 'networkidle' });
  await wait(3000);
  await hostPage.bringToFront();
  await logPageState(joinPage, 'join:start');

  await wait(45000);
  await hostPage.bringToFront();
  await logPageState(hostPage, 'host:end');
  await logPageState(joinPage, 'join:end');

  await joinPage.close();
  await hostPage.close();
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--run-all-compositor-stages-before-draw',
  ],
});

try {
  if (mode === 'multiplayer') {
    await runRepresentative(browser);
  } else {
    await runFreeplay(browser);
  }
} finally {
  await browser.close();
}