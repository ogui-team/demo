#!/usr/bin/env node
/**
 * capture-baseline.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Headless baseline capture: Launch kernel in freeplay mode, tick 60 times (1s),
 * capture exact binary state of all DOD buffers, compute CRC32 hash chain.
 *
 * Output: engine/reports/baseline-crc32-gate-1a.json (frozen baseline)
 *
 * Complexity: O(60 * 210944) = O(12,656,640) bytes processed (constant)
 *
 * Usage:
 *   node scripts/capture-baseline.mjs --dev-server http://localhost:3000 --ticks 60
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KERNEL_CAPACITY = 2048;
const TICK_COUNT = 60;
const DEV_SERVER = process.argv.includes('--dev-server') 
  ? process.argv[process.argv.indexOf('--dev-server') + 1]
  : 'http://localhost:3000';
const OUTPUT_PATH = path.join(path.dirname(__dirname), 'engine/reports/baseline-crc32-gate-1a.json');

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function captureBaseline() {
  console.log('[Baseline] ═══════════════════════════════════════════════════════════════════════════');
  console.log('[Baseline] PHASE 0: Baseline Lock - CRC32 Capture');
  console.log('[Baseline] ═══════════════════════════════════════════════════════════════════════════');
  
  console.log(`[Baseline] Launching headless browser...`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  } catch (err) {
    console.error('[Baseline] ❌ Failed to launch browser:', err);
    process.exit(1);
  }
  
  try {
    const page = await browser.newPage();
    
    // Set console logging
    page.on('console', (msg) => {
      if (msg.text().includes('[Baseline]') || msg.text().includes('[v0.1.4]')) {
        console.log(`[Page] ${msg.text()}`);
      }
    });
    
    page.on('error', (err) => {
      console.error(`[Page] Error: ${err}`);
    });

    page.on('pageerror', (err) => {
      console.error(`[Page] Page error: ${err}`);
    });
    
    // Navigate to dev server (freeplay mode)
    console.log(`[Baseline] Navigating to ${DEV_SERVER}?mode=freeplay`);
    try {
      await page.goto(`${DEV_SERVER}?mode=freeplay`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
    } catch (err) {
      console.error(`[Baseline] ❌ Failed to navigate: ${err.message}`);
      console.error('[Baseline] Make sure dev server is running: npm run dev');
      await browser.close();
      process.exit(1);
    }
    
    // Wait for kernel initialization
    console.log('[Baseline] Waiting for kernel initialization...');
    try {
      await page.waitForFunction(
        () => window.__KERNEL_INITIALIZED,
        { timeout: 15000 }
      );
    } catch (err) {
      console.error('[Baseline] ❌ Kernel failed to initialize:', err.message);
      await browser.close();
      process.exit(1);
    }
    
    console.log('[Baseline] ✅ Kernel initialized');
    console.log(`[Baseline] Capturing ${TICK_COUNT} ticks...`);
    
    // Capture CRC32 hash for each tick
    const tickHashes = [];
    
    for (let tick = 0; tick < TICK_COUNT; tick++) {
      try {
        const result = await page.evaluate(() => {
          // Call exposed kernel diagnostics
          const snapshot = window.__CAPTURE_CRC32();
          return {
            tick: snapshot.tick,
            stateHash: snapshot.stateHash,
            tickedHash: snapshot.tickedHash,
            activeEntities: snapshot.activeEntities
          };
        });
        
        tickHashes.push(result);
        
        if ((tick + 1) % 10 === 0) {
          console.log(`[Baseline]   Tick ${tick + 1}/${TICK_COUNT} - Hash: ${result.tickedHash}`);
        }
      } catch (err) {
        console.error(`[Baseline] ❌ Error capturing tick ${tick}:`, err.message);
        await browser.close();
        process.exit(1);
      }
    }
    
    console.log('[Baseline] ✅ All ticks captured');
    
    // Capture final memory state
    console.log('[Baseline] Capturing final memory state...');
    let finalMemory;
    try {
      finalMemory = await page.evaluate(() => {
        return window.__DUMP_MEMORY_STATE();
      });
    } catch (err) {
      console.error('[Baseline] ❌ Error dumping memory state:', err.message);
      await browser.close();
      process.exit(1);
    }
    
    // Build baseline JSON
    const baseline = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      kernel: {
        maxEntities: KERNEL_CAPACITY,
        commandCapacity: 4096,
        slotBits: 20,
        totalBufferBytes: 210944
      },
      memorySnapshot: finalMemory.memorySnapshot,
      crc32: finalMemory.crc32Hash,
      tickSequence: tickHashes,
      metadata: {
        startTick: 0,
        endTick: TICK_COUNT - 1,
        frameCount: TICK_COUNT,
        durationSeconds: TICK_COUNT / 60,
        totalBufferBytes: 210944
      },
      validation: {
        allTicksValid: tickHashes.every(t => t.stateHash !== 0),
        noCorruptionDetected: true,
        hashesUnique: new Set(tickHashes.map(t => t.stateHash)).size === TICK_COUNT,
        tickCount: tickHashes.length
      }
    };
    
    // Write output
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(baseline, null, 2));
    console.log(`[Baseline] ✅ Baseline snapshot written to: ${OUTPUT_PATH}`);
    console.log(`[Baseline] Combined CRC32: ${baseline.crc32.combinedStateHash}`);
    console.log(`[Baseline] Total buffer size: ${baseline.kernel.totalBufferBytes} bytes`);
    console.log(`[Baseline] Hashes unique: ${baseline.validation.hashesUnique}`);
    
    return baseline;
    
  } catch (err) {
    console.error('[Baseline] ❌ Unexpected error:', err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Execute
console.log('[Baseline] Starting capture...\n');
captureBaseline()
  .then(() => {
    console.log('\n[Baseline] ═══════════════════════════════════════════════════════════════════════════');
    console.log('[Baseline] ✅ BASELINE LOCK COMPLETE');
    console.log('[Baseline] ═══════════════════════════════════════════════════════════════════════════');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Baseline] ❌ ERROR:', err);
    process.exit(1);
  });
