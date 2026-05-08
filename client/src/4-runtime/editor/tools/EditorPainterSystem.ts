import * as THREE from 'three';
import {
  gameBus,
  type RoutedInputHandler,
  type SystemCapabilities,
  type SystemContext,
  type Vector3,
} from '@engine/1-kernel/core/public-api';
import type { PrefabPlacementSystem } from './PrefabPlacementSystem';

interface ToolCoordinatorAdapter {
  getActiveTool(): 'SELECT' | 'PAINT' | 'WHITEBOX';
  beginPaintStroke(reason?: string): boolean;
  endPaintStroke(reason?: string): boolean;
}

export interface EditorPainterSystemConfig {
  toolCoordinator: ToolCoordinatorAdapter;
  placementSystem: PrefabPlacementSystem;
  enableLogging?: boolean;
}

interface PainterConfigState {
  selectedPrefabId: string | null;
  spacing: number;
  randomRotation: number;
  randomScaleMin: number;
  randomScaleMax: number;
}

const DEFAULT_CONFIG: PainterConfigState = {
  selectedPrefabId: null,
  spacing: 1.5,
  randomRotation: 360,
  randomScaleMin: 0.8,
  randomScaleMax: 1.2,
};

export class EditorPainterSystem implements RoutedInputHandler {
  private readonly toolCoordinator: ToolCoordinatorAdapter;
  private readonly placementSystem: PrefabPlacementSystem;
  private readonly enableLogging: boolean;
  private config: PainterConfigState = { ...DEFAULT_CONFIG };
  private systemContext: SystemContext | null = null;
  private readonly lifecycleDisposers: Array<() => void> = [];
  private isStrokeActive = false;
  private lastPaintPoint: Vector3 | null = null;
  private lastPaintAt = 0;
  private readonly minPaintIntervalMs = 50;

  constructor(config: EditorPainterSystemConfig) {
    this.toolCoordinator = config.toolCoordinator;
    this.placementSystem = config.placementSystem;
    this.enableLogging = config.enableLogging ?? false;

    this.lifecycleDisposers.push(
      gameBus.on('EDITOR_PAINTER_CONFIG_CHANGED', (payload) => {
        this.config = {
          selectedPrefabId: payload.selectedPrefabId,
          spacing: Math.max(0.1, payload.spacing),
          randomRotation: Math.max(0, payload.randomRotation),
          randomScaleMin: Math.max(0.01, Math.min(payload.randomScaleMin, payload.randomScaleMax)),
          randomScaleMax: Math.max(payload.randomScaleMin, payload.randomScaleMax),
        };
      }),
      gameBus.on('EDITOR_TOOL_CHANGED', ({ tool }) => {
        if (tool !== 'PAINT') {
          this.endStroke('tool_changed');
        }
      }),
      gameBus.on('ENGINE_RESET', () => this.endStroke('engine_reset')),
      gameBus.on('ROUND_TRANSITION', () => this.endStroke('round_transition')),
    );
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  handleDoubleClick(_event: MouseEvent): boolean {
    return false;
  }

  handleWheel(_event: WheelEvent): boolean {
    return false;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  update(_dt: number): void {
    // Pointer driven.
  }

  disable(): void {
    this.endStroke('disable');
  }

  destroy(): void {
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.isStrokeActive ? 'painting' : 'idle',
      active: true,
      metrics: {
        ...this.config,
        isStrokeActive: this.isStrokeActive,
      },
    };
  }

  handlePointerDown(event: MouseEvent): boolean {
    if (event.button !== 0) return false;
    if (this.toolCoordinator.getActiveTool() !== 'PAINT') return false;

    event.preventDefault();
    if (!this.toolCoordinator.beginPaintStroke('pointer_down')) {
      return true;
    }
    this.isStrokeActive = true;
    this.lastPaintPoint = null;
    this.lastPaintAt = 0;
    this.paintAtPointer(event);
    return true;
  }

  handlePointerMove(event: MouseEvent): boolean {
    if (this.toolCoordinator.getActiveTool() !== 'PAINT') return false;
    if (!this.isStrokeActive) return false;
    this.paintAtPointer(event);
    return true;
  }

  handlePointerUp(event: MouseEvent): boolean {
    if (event.button !== 0) return false;
    if (this.toolCoordinator.getActiveTool() !== 'PAINT' && !this.isStrokeActive) return false;
    this.endStroke('pointer_up');
    return true;
  }

  private paintAtPointer(event: MouseEvent): void {
    if (!this.config.selectedPrefabId) return;
    const hit = this.placementSystem.pickGroundPointFromPointer(event);
    if (!hit) return;

    const now = Date.now();
    if (now - this.lastPaintAt < this.minPaintIntervalMs) return;
    if (this.lastPaintPoint && distanceSquared(this.lastPaintPoint, hit.point) < this.config.spacing * this.config.spacing) {
      return;
    }

    const scale = randomBetween(this.config.randomScaleMin, this.config.randomScaleMax);
    const rotationY = THREE.MathUtils.degToRad(randomBetween(0, this.config.randomRotation));
    this.placementSystem.placePrefab(this.config.selectedPrefabId, {
      position: { ...hit.point },
      rotation: { x: 0, y: rotationY, z: 0 },
      scale: { x: scale, y: scale, z: scale },
      source: 'paint',
    });

    this.lastPaintPoint = { ...hit.point };
    this.lastPaintAt = now;
  }

  private endStroke(reason: string): void {
    if (!this.isStrokeActive) return;
    this.isStrokeActive = false;
    this.lastPaintPoint = null;
    this.toolCoordinator.endPaintStroke(reason);
    this.log(`Paint stroke ended (${reason})`);
  }

  private log(message: string): void {
    if (!this.enableLogging) return;
    console.log(`[EditorPainterSystem] ${message}`);
  }
}

function distanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}