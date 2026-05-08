/**
 * Unified client boot entry.
 *
 * The runtime now boots through a single path:
 * 1. Initialize the minimal kernel/render surface
 * 2. Hand off to the main runtime and menu flow
 */

import { bootstrapMinimalRuntime } from './4-runtime/runtime/bootstrapMinimalRuntime';
import { bootstrapRuntime } from './4-runtime/runtime/bootstrapClientRuntime';
import { performanceMonitor } from './4-runtime/runtime/PerformanceMonitor';

declare global {
  interface Window {
    __showMainMenuFirst?: boolean;
  }
}

// ============================================================================
// BOOTLOADER STATE & UI
// ============================================================================

interface BootloaderState {
  phase: 'initializing' | 'ready' | 'error';
  error: Error | null;
  startTime: number;
}

const bootloaderState: BootloaderState = {
  phase: 'initializing',
  error: null,
  startTime: performance.now(),
};

/**
 * Create minimal loading UI shown during kernel initialization
 */
function createBootloaderUI(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'bootloader-ui';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #ffffff;
    z-index: 9999;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    text-align: center;
    animation: fadeIn 0.3s ease-in;
  `;

  const title = document.createElement('h1');
  title.textContent = 'TITAN';
  title.style.cssText = `
    font-size: 3em;
    font-weight: 700;
    margin: 0 0 0.5em 0;
    letter-spacing: 3px;
    background: linear-gradient(90deg, #00d4ff, #0099ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  `;

  const message = document.createElement('p');
  message.id = 'bootloader-message';
  message.textContent = 'Initializing kernel...';
  message.style.cssText = `
    font-size: 1.1em;
    margin: 1em 0;
    color: #a0a0a0;
    min-height: 2em;
  `;

  const spinner = document.createElement('div');
  spinner.style.cssText = `
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 212, 255, 0.2);
    border-top: 3px solid #00d4ff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 1em 0;
  `;

  const progress = document.createElement('div');
  progress.id = 'bootloader-progress';
  progress.style.cssText = `
    margin-top: 2em;
    font-size: 0.9em;
    color: #606080;
  `;
  progress.textContent = 'Phase 1/4: Kernel';

  content.appendChild(title);
  content.appendChild(spinner);
  content.appendChild(message);
  content.appendChild(progress);
  container.appendChild(content);

  // Add animation keyframes
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  return container;
}

/**
 * Update the bootloader message
 */
function updateBootloaderMessage(message: string, phase?: string) {
  const msgEl = document.getElementById('bootloader-message');
  const progressEl = document.getElementById('bootloader-progress');
  
  if (msgEl) msgEl.textContent = message;
  if (progressEl && phase) progressEl.textContent = phase;
  
  console.log(`[Titan Boot] ${message}${phase ? ` (${phase})` : ''}`);
}

/**
 * Show error modal with retry option
 */
function showErrorModal(
  error: Error,
  onRetry: () => Promise<void>
) {
  const ui = document.getElementById('bootloader-ui');
  if (!ui) return;

  const content = ui.querySelector('div');
  if (!content) return;

  content.innerHTML = '';
  content.style.cssText = `
    text-align: center;
    max-width: 500px;
  `;

  const icon = document.createElement('div');
  icon.style.cssText = `
    font-size: 3em;
    margin-bottom: 1em;
    animation: pulse 1.5s ease-in-out infinite;
  `;
  icon.textContent = '⚠️';

  const title = document.createElement('h1');
  title.textContent = 'Failed to Load';
  title.style.cssText = `
    font-size: 1.8em;
    margin: 0 0 0.5em 0;
    color: #ff6b6b;
  `;

  const message = document.createElement('p');
  message.style.cssText = `
    margin: 1em 0;
    color: #a0a0a0;
    line-height: 1.6;
  `;
  message.innerHTML = `
    <strong>Client boot failed</strong><br>
    <small style="color: #606080;">${error.message}</small>
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: center;
    margin-top: 1.5em;
  `;

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry Boot';
  retryBtn.style.cssText = `
    padding: 1em 2em;
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(0, 153, 255, 0.15));
    border: 2px solid #00d4ff;
    color: #ffffff;
    font-weight: 600;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.3s ease;
  `;

  retryBtn.onclick = async () => {
    console.log('[Titan Boot] Retrying...');
    bootloaderState.error = null;
    await onRetry();
  };

  buttonContainer.appendChild(retryBtn);

  content.appendChild(icon);
  content.appendChild(title);
  content.appendChild(message);
  content.appendChild(buttonContainer);

  // Add pulse animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Main bootloader sequence
 */
export async function bootloader() {
  const previousBootloaderListener = (window as any).__titanBootloaderDOMContentLoadedListener;
  if (typeof previousBootloaderListener === 'function') {
    document.removeEventListener('DOMContentLoaded', previousBootloaderListener);
    delete (window as any).__titanBootloaderDOMContentLoadedListener;
  }

  try {
    const bootloaderStartTime = performance.now();

    // Phase 1: Find canvas
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      throw new Error('Canvas element not found in DOM');
    }

    // Phase 2: Show loading UI
    const bootUi = createBootloaderUI();
    document.body.appendChild(bootUi);
    updateBootloaderMessage('Initializing kernel...', 'Phase 1/4: Kernel');

    // Phase 3: Initialize minimal runtime (kernel only)
    bootloaderState.phase = 'initializing';
    await bootstrapMinimalRuntime(canvas);
    const kernelReadyTime = performance.now();
    const bootloaderToKernelTime = kernelReadyTime - bootloaderStartTime;
    
    // Record Phase 1 metrics
    performanceMonitor.recordBootloaderMetrics(bootloaderStartTime, kernelReadyTime);
    
    updateBootloaderMessage('Kernel initialized. Starting runtime...', 'Phase 2/3: Runtime');

    window.__showMainMenuFirst = true;

    updateBootloaderMessage('Booting runtime and opening Main Menu...', 'Phase 3/3: Main Menu');
    bootloaderState.phase = 'ready';

    bootstrapRuntime();

    const fadeTitanUi = (el: HTMLElement): void => {
      el.style.transition = 'opacity 400ms ease';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      const cleanup = (): void => { el.style.display = 'none'; };
      el.addEventListener('transitionend', cleanup, { once: true });
      // Fallback: ensure removal even if transitionend never fires.
      setTimeout(cleanup, 600);
    };
    const bootUiEl = document.getElementById('bootloader-ui');
    if (bootUiEl) fadeTitanUi(bootUiEl);
    const staticUiEl = document.getElementById('ui');
    if (staticUiEl) staticUiEl.style.display = 'none';

    performanceMonitor.recordSessionMetrics(bootloaderToKernelTime, 0, 0);

    const perfStats = performanceMonitor.getStats();
    console.log('[Titan Boot] Performance stats:', perfStats);

  } catch (error) {
    bootloaderState.phase = 'error';
    bootloaderState.error = error instanceof Error ? error : new Error(String(error));

    console.error('[Bootloader] ✗ Fatal error:', bootloaderState.error);

    let ui = document.getElementById('bootloader-ui');
    if (!ui) {
      ui = createBootloaderUI();
      document.body.appendChild(ui);
    }

    showErrorModal(
      bootloaderState.error,
      async () => {
        bootloaderState.error = null;
        await bootloader();
      }
    );
  }
}

// Initialize on page load when not running under test
const shouldAutoStartBootloader = typeof process === 'undefined' || (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true');
if (shouldAutoStartBootloader) {
  const previousBootloaderListener = (window as any).__titanBootloaderDOMContentLoadedListener;
  if (typeof previousBootloaderListener === 'function') {
    document.removeEventListener('DOMContentLoaded', previousBootloaderListener);
  }

  if (document.readyState === 'loading') {
    (window as any).__titanBootloaderDOMContentLoadedListener = bootloader;
    document.addEventListener('DOMContentLoaded', bootloader);
  } else {
    bootloader();
  }
}
