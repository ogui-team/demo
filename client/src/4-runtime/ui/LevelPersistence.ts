import * as Engine from '../../0-foundation/foundation/Engine';
import { createClosablePanel } from './ClosablePanel';

export function saveLevelToStorage(name: string): boolean {
  if (!name || !name.trim()) return false;
  return Engine.saveMap(name.trim());
}

export function getSavedLevelNames(): string[] {
  return Engine.listMaps();
}

export function loadLevelFromStorage(name: string): boolean {
  return Engine.loadMap(name).success;
}

let loadingScreen: HTMLElement | null = null;
let loadingScreenDispose: (() => void) | null = null;

function getLoadingScreen(): HTMLElement {
  if (loadingScreen) return loadingScreen;

  loadingScreen = document.createElement('div');
  loadingScreen.id = 'engine-loading-screen';
  loadingScreen.style.cssText = `
    position:fixed;
    inset:0;
    z-index:11000;
    display:none;
    align-items:center;
    justify-content:center;
    background:rgba(0,0,0,0.85);
    backdrop-filter:blur(4px);
  `;
  loadingScreen.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 32px;border-radius:18px;background:rgba(12,12,12,0.96);border:1px solid rgba(255,255,255,0.06);">
      <div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.16);border-top-color:#ffffff;border-radius:50%;animation:engine-loading-spin 1s linear infinite;"></div>
      <div style="color:#ffffff;font-family:monospace;font-size:14px;letter-spacing:0.5px;">Loading...</div>
    </div>
    <style>@keyframes engine-loading-spin{to{transform:rotate(360deg)}}</style>
  `;

  document.body.appendChild(loadingScreen);
  loadingScreenDispose = createClosablePanel(loadingScreen);
  return loadingScreen;
}

export function createLoadingScreen(): { show: () => void; hide: () => void } {
  const screen = getLoadingScreen();
  return {
    show: () => { screen.style.display = 'flex'; },
    hide: () => { screen.style.display = 'none'; },
  };
}

export async function runWithLoading(task: () => void | Promise<void>): Promise<void> {
  const screen = createLoadingScreen();
  screen.show();
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await task();
  } finally {
    screen.hide();
  }
}
