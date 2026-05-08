import * as THREE from 'three';
import { EntityManager } from './EntityManager';
import { getActiveSystemNames } from './SystemRegistry';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from './RuntimePerformanceMode';

export interface EngineStats {
  fps: number;
  frameTimeMs: number;
  memoryUsageMB: number | null;
  entityCount: number;
  activeSystems: string[];
  drawCalls: number;
  timestamp: number;
}

export class EngineDiagnostics {
  private renderer: THREE.WebGLRenderer;
  private entityManager: EntityManager;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private fps = 0;
  private heavyRefreshAccumulator = 0;
  private lastStats: EngineStats = {
    fps: 0,
    frameTimeMs: 0,
    memoryUsageMB: null,
    entityCount: 0,
    activeSystems: [],
    drawCalls: 0,
    timestamp: Date.now(),
  };

  constructor(renderer: THREE.WebGLRenderer, entityManager: EntityManager) {
    this.renderer = renderer;
    this.entityManager = entityManager;
  }

  update(deltaTime: number): void {
    this.fpsAccumulator += deltaTime;
    this.fpsFrames += 1;
    this.heavyRefreshAccumulator += deltaTime;

    if (this.fpsAccumulator >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    const mode = getRuntimePerformanceMode();
    const heavyRefreshInterval = mode === RuntimePerformanceMode.DEV ? 0 : 0.25;
    if (heavyRefreshInterval > 0 && this.heavyRefreshAccumulator < heavyRefreshInterval) {
      this.lastStats = {
        ...this.lastStats,
        fps: this.fps,
        frameTimeMs: Math.round(deltaTime * 1000 * 100) / 100,
      };
      return;
    }

    this.heavyRefreshAccumulator = 0;
    const perfMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.lastStats = {
      fps: this.fps,
      frameTimeMs: Math.round(deltaTime * 1000 * 100) / 100,
      memoryUsageMB: perfMemory ? Math.round((perfMemory.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null,
      entityCount: this.entityManager.getEntityCount(),
      activeSystems: getActiveSystemNames(),
      drawCalls: this.renderer.info.render.calls,
      timestamp: Date.now(),
    };
  }

  getDiagnostics(): EngineStats {
    return {
      ...this.lastStats,
      activeSystems: [...this.lastStats.activeSystems],
    };
  }
}
