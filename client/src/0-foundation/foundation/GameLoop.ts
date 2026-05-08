/**
 * GameLoop module
 * Handles the main game loop and timing
 */

import { runtimeFrameCostProfiler } from '../../4-runtime/diagnostics/debug/FrameCostProfiler';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';

type UpdateCallback = (deltaTime: number) => void;
type RenderCallback = () => void;

let isRunning = false;
const callbacks = {
  update: [] as UpdateCallback[],
  render: [] as RenderCallback[],
};
let lastTime = performance.now();
let deltaTime = 0;
let frameIndex = 0;
let activeFrameRequest: number | null = null;

export function startGameLoop(): void {
  if (isRunning) return;
  isRunning = true;
  lastTime = performance.now();

  function tick(currentTime: number) {
    if (!isRunning) {
      activeFrameRequest = null;
      return;
    }

    // Calculate delta time in seconds
    deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    frameIndex += 1;

    const mode = getRuntimePerformanceMode();
    // DEV: profile every frame. STABLE: every 4th frame. RELEASE: never.
    const shouldProfile = mode === RuntimePerformanceMode.DEV
      || (mode === RuntimePerformanceMode.STABLE && (frameIndex & 3) === 0);

    runtimeFrameCostProfiler.beginFrame(shouldProfile);

    // Execute update callbacks
    for (let i = 0, len = callbacks.update.length; i < len; i++) {
      callbacks.update[i](deltaTime);
    }

    // Execute render callbacks
    for (let i = 0, len = callbacks.render.length; i < len; i++) {
      callbacks.render[i]();
    }

    runtimeFrameCostProfiler.endFrame(deltaTime * 1000);

    if (isRunning) {
      activeFrameRequest = requestAnimationFrame(tick);
    } else {
      activeFrameRequest = null;
    }
  }

  activeFrameRequest = requestAnimationFrame(tick);
}

export function stopGameLoop(): void {
  if (activeFrameRequest !== null) {
    cancelAnimationFrame(activeFrameRequest);
    activeFrameRequest = null;
  }
  isRunning = false;
}

export function onUpdate(callback: UpdateCallback): () => void {
  callbacks.update.push(callback);

  // Return unsubscribe function
  return () => {
    const index = callbacks.update.indexOf(callback);
    if (index > -1) {
      callbacks.update.splice(index, 1);
    }
  };
}

export function onRender(callback: RenderCallback): () => void {
  callbacks.render.push(callback);

  // Return unsubscribe function
  return () => {
    const index = callbacks.render.indexOf(callback);
    if (index > -1) {
      callbacks.render.splice(index, 1);
    }
  };
}

export function getDeltaTime(): number {
  return deltaTime;
}

export function isGameLoopRunning(): boolean {
  return isRunning;
}
