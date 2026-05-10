/**
 * PathfindingSystem  —  Tier 1
 * Grid-based A* pathfinding with NavMesh support.
 *
 * Architecture
 *   GridNavMesh  — 2D grid of walkable/blocked cells built from level geometry
 *   AStarFinder  — standard A* over the grid with optional path-smoothing
 *   PathRequest  — async path query with caching and deferred execution
 *
 * Usage:
 *   const nav = new PathfindingSystem({ cellSize: 1, width: 64, height: 64 });
 *   nav.markBlocked(3, 5);                                     // obstacle at grid cell
 *   nav.markBlockedAABB({ min:{x:-2,y:0,z:-2}, max:{x:2,y:0,z:2} }); // from geometry
 *
 *   const path = await nav.findPath({ x:0,y:0,z:0 }, { x:10,y:0,z:10 });
 *   // path is an array of { x, y, z } waypoints (world space)
 *
 *   // Per-frame steering:
 *   const direction = nav.steer(agentPos, path);  // Vector3 direction to move
 */

import { Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import {
  cancelAIControllerPath,
  clearAIControllerTarget,
  type AIControllerComponent,
  type AIControllerTargetState,
  normalizeAIControllerRuntimeState,
} from '../game/components/AIControllerComponent';
import {
  getRuntimeLifecycleState,
  isEntitySimulationActive,
  isEntityStreamLoaded,
} from './RuntimeLifecycle';

interface ColliderLike {
  shape: 'box' | 'sphere' | 'capsule';
  size: {
    width?: number;
    height?: number;
    depth?: number;
    radius?: number;
    capsuleRadius?: number;
    capsuleHeight?: number;
  };
  isTrigger?: boolean;
}

// ─── Grid cell ────────────────────────────────────────────────────────────────

interface Cell {
  gx: number;   // grid x
  gz: number;   // grid z
  walkable: boolean;
}

interface AStarNode extends Cell {
  g: number;    // cost from start
  h: number;    // heuristic to end
  f: number;    // g + h
  parent: AStarNode | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface NavMeshConfig {
  /** Cell size in world units. */
  cellSize:   number;
  /** Number of cells on X axis. */
  width:      number;
  /** Number of cells on Z axis. */
  height:     number;
  /** World origin of (0,0) cell top-left corner. */
  originX?:   number;
  originZ?:   number;
  /** Allow diagonal movement. Default true. */
  diagonal?:  boolean;
  /** Smooth waypoints with string-pulling. Default true. */
  smooth?:    boolean;
  /** How close an agent must be to a waypoint to advance. */
  waypointRadius?: number;
}

export interface AABB2D {
  min: { x: number; z: number };
  max: { x: number; z: number };
}

const ZERO_VELOCITY: Vector3 = { x: 0, y: 0, z: 0 };

// ─── PathfindingSystem ───────────────────────────────────────────────────────

export class PathfindingSystem {
  private cellSize:    number;
  private gridWidth:   number;
  private gridHeight:  number;
  private originX:     number;
  private originZ:     number;
  private diagonal:    boolean;
  private smooth:      boolean;
  private waypointRadius: number;

  /** Flat array of cells, row-major: index = gz * width + gx */
  private grid:        Uint8Array;  // 0 = walkable, 1 = blocked

  /** LRU path cache — key: "sx,sz->ex,ez" */
  private pathCache:   Map<string, Vector3[]> = new Map();
  private cacheMaxSize = 64;
  private systemContext: SystemContext | null = null;
  private readonly steerIndexRef = { value: 0 };
  private activePathJobs = 0;
  private cancelledPathJobs = 0;
  private stalePathPrunes = 0;
  private lastGridSignature = 0;
  private lastBlockedCellCount = 0;

  constructor(cfg: NavMeshConfig) {
    this.cellSize      = cfg.cellSize;
    this.gridWidth     = cfg.width;
    this.gridHeight    = cfg.height;
    this.originX       = cfg.originX ?? -(cfg.width  * cfg.cellSize) / 2;
    this.originZ       = cfg.originZ ?? -(cfg.height * cfg.cellSize) / 2;
    this.diagonal      = cfg.diagonal  ?? true;
    this.smooth        = cfg.smooth    ?? true;
    this.waypointRadius = cfg.waypointRadius ?? 0.5;
    this.grid          = new Uint8Array(cfg.width * cfg.height);
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  update(dt: number): void {
    if (!this.systemContext?.entityManager) {
      return;
    }

    this.rebuildFromStaticColliders();
    this.activePathJobs = 0;

    for (const entity of this.systemContext.entityManager.getEntities()) {
      const aiController = entity.getComponent('aiController')?.data as AIControllerComponent | undefined;
      if (!aiController) {
        continue;
      }

      normalizeAIControllerRuntimeState(aiController);

      if (!isEntitySimulationActive(entity)) {
        this.deactivateAgent(entity, aiController, 'dormant');
        continue;
      }

      const targetPosition = this.resolveTargetPosition(aiController);
      if (!targetPosition) {
        this.deactivateAgent(entity, aiController, aiController.targetState ?? 'lost');
        continue;
      }

      aiController.repathTimerMs = Math.max(0, (aiController.repathTimerMs ?? 0) - dt * 1000);
      const needsRepath = (aiController.currentPath?.length ?? 0) === 0
        || (aiController.currentPathIndex ?? 0) >= (aiController.currentPath?.length ?? 0)
        || (aiController.repathTimerMs ?? 0) === 0
        || this.hasTargetChanged(aiController, targetPosition);

      if (needsRepath) {
        aiController.currentPath = this.findPath(entity.getPosition(), targetPosition);
        aiController.currentPathIndex = 0;
        aiController.repathTimerMs = aiController.repathIntervalMs;
        aiController.lastTargetPosition = { ...targetPosition };
      }

      this.steerIndexRef.value = aiController.currentPathIndex ?? 0;
      const direction = this.steer(entity.getPosition(), aiController.currentPath ?? [], this.steerIndexRef);
      aiController.currentPathIndex = this.steerIndexRef.value;

      const speed = Math.max(0, aiController.speed ?? 0);
      if (!direction || speed === 0) {
        this.setEntityVelocity(entity, ZERO_VELOCITY);
        continue;
      }

      this.activePathJobs += 1;

      this.setEntityVelocity(entity, {
        x: direction.x * speed,
        y: 0,
        z: direction.z * speed,
      });
    }
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        gridWidth: this.gridWidth,
        gridHeight: this.gridHeight,
        cachedPaths: this.pathCache.size,
        activePathJobs: this.activePathJobs,
        cancelledPathJobs: this.cancelledPathJobs,
        stalePathPrunes: this.stalePathPrunes,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  rebuildNavMesh(): void {
    this.rebuildFromStaticColliders();
  }

  // ─── Grid editing ──────────────────────────────────────────────────────────

  markBlocked(gx: number, gz: number, blocked = true): void {
    if (!this._inBounds(gx, gz)) return;
    this.grid[gz * this.gridWidth + gx] = blocked ? 1 : 0;
    this.pathCache.clear();
    gameBus.emit('stateMutation', {
      source: 'pathfindingSystem',
      path: `pathfinding.grid.${gx}.${gz}`,
      changedCount: 1,
    });
  }

  markBlockedAABB(aabb: AABB2D, blocked = true): void {
    const minGx = this._worldToGridX(aabb.min.x);
    const maxGx = this._worldToGridX(aabb.max.x);
    const minGz = this._worldToGridZ(aabb.min.z);
    const maxGz = this._worldToGridZ(aabb.max.z);
    for (let gz = minGz; gz <= maxGz; gz++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        this.markBlocked(gx, gz, blocked);
      }
    }
  }

  isWalkable(gx: number, gz: number): boolean {
    if (!this._inBounds(gx, gz)) return false;
    return this.grid[gz * this.gridWidth + gx] === 0;
  }

  isWalkableWorld(pos: Vector3): boolean {
    return this.isWalkable(this._worldToGridX(pos.x), this._worldToGridZ(pos.z));
  }

  // ─── Pathfinding ──────────────────────────────────────────────────────────

  /**
   * Find path from `start` to `end` (world space positions).
   * Returns array of world-space waypoints, or empty array if no path.
   */
  findPath(start: Vector3, end: Vector3): Vector3[] {
    const sgx = this._worldToGridX(start.x);
    const sgz = this._worldToGridZ(start.z);
    const egx = this._worldToGridX(end.x);
    const egz = this._worldToGridZ(end.z);

    const cacheKey = `${sgx},${sgz}->${egx},${egz}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached) return cached;

    if (!this.isWalkable(sgx, sgz) || !this.isWalkable(egx, egz)) return [];
    if (sgx === egx && sgz === egz) return [end];

    const path = this._astar(sgx, sgz, egx, egz);
    const worldPath = path.map(([gx, gz]) => this._gridToWorld(gx, gz, start.y));

    const result = this.smooth ? this._stringPull(worldPath, start.y) : worldPath;

    // Cache management
    if (this.pathCache.size >= this.cacheMaxSize) {
      const firstKey = this.pathCache.keys().next().value;
      if (firstKey) this.pathCache.delete(firstKey);
    }
    this.pathCache.set(cacheKey, result);

    return result;
  }

  /**
   * Returns a normalised direction vector the agent should move toward on the path.
   * Advances the path index when within waypointRadius.
   * Returns null when the path is exhausted.
   */
  steer(agentPos: Vector3, path: Vector3[], indexRef: { value: number }): Vector3 | null {
    if (!Number.isFinite(indexRef.value) || indexRef.value < 0) {
      indexRef.value = 0;
    }

    while (indexRef.value < path.length) {
      const target = path[indexRef.value];
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) {
        indexRef.value++;
        this.stalePathPrunes += 1;
        continue;
      }
      const dx = target.x - agentPos.x;
      const dz = target.z - agentPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < this.waypointRadius) {
        indexRef.value++;
        continue;
      }
      return { x: dx / dist, y: 0, z: dz / dist };
    }
    return null; // reached end
  }

  // ─── A* ───────────────────────────────────────────────────────────────────

  private _astar(sgx: number, sgz: number, egx: number, egz: number): [number, number][] {
    const open:   Map<number, AStarNode> = new Map();
    const closed: Set<number>            = new Set();

    const key  = (gx: number, gz: number) => gz * this.gridWidth + gx;
    const heur = (gx: number, gz: number) =>
      this.diagonal
        ? Math.max(Math.abs(gx - egx), Math.abs(gz - egz))  // Chebyshev
        : Math.abs(gx - egx) + Math.abs(gz - egz);          // Manhattan

    const startNode: AStarNode = {
      gx: sgx, gz: sgz, walkable: true,
      g: 0, h: heur(sgx, sgz), f: heur(sgx, sgz), parent: null,
    };
    open.set(key(sgx, sgz), startNode);

    const DIRS = this.diagonal
      ? [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
      : [         [0,-1],         [-1,0],[1,0],        [0,1]];

    while (open.size > 0) {
      // Get lowest f
      let current: AStarNode | null = null;
      for (const node of open.values()) {
        if (!current || node.f < current.f) current = node;
      }
      if (!current) break;

      if (current.gx === egx && current.gz === egz) {
        // Reconstruct path
        const path: [number, number][] = [];
        let n: AStarNode | null = current;
        while (n) { path.unshift([n.gx, n.gz]); n = n.parent; }
        return path;
      }

      open.delete(key(current.gx, current.gz));
      closed.add(key(current.gx, current.gz));

      for (const [dx, dz] of DIRS) {
        const nx = current.gx + dx;
        const nz = current.gz + dz;
        if (!this.isWalkable(nx, nz)) continue;
        if (closed.has(key(nx, nz)))  continue;

        // Diagonal cost = ~1.414, cardinal = 1
        const stepCost = (dx !== 0 && dz !== 0) ? 1.414 : 1;
        const g = current.g + stepCost;
        const h = heur(nx, nz);

        const existing = open.get(key(nx, nz));
        if (!existing || g < existing.g) {
          const node: AStarNode = { gx: nx, gz: nz, walkable: true, g, h, f: g + h, parent: current };
          open.set(key(nx, nz), node);
        }
      }
    }

    return []; // no path
  }

  // ─── String-pulling (Funnel path smoothing) ───────────────────────────────

  private _stringPull(path: Vector3[], y: number): Vector3[] {
    if (path.length <= 2) return path;
    const result: Vector3[] = [path[0]];
    let anchor = 0;

    for (let i = 1; i < path.length - 1; i++) {
      // Check if we can walk directly from result.last to path[i+1]
      const from = result[result.length - 1];
      const to   = path[i + 1];
      if (!this._lineOfSight(from, to)) {
        result.push(path[i]);
        anchor = i;
      }
    }
    result.push(path[path.length - 1]);
    return result;
  }

  private _lineOfSight(a: Vector3, b: Vector3): boolean {
    // Bresenham line through grid
    let gx0 = this._worldToGridX(a.x);
    let gz0 = this._worldToGridZ(a.z);
    const gx1 = this._worldToGridX(b.x);
    const gz1 = this._worldToGridZ(b.z);

    const dx = Math.abs(gx1 - gx0);
    const dz = Math.abs(gz1 - gz0);
    const sx = gx0 < gx1 ? 1 : -1;
    const sz = gz0 < gz1 ? 1 : -1;
    let err = dx - dz;

    while (true) {
      if (!this.isWalkable(gx0, gz0)) return false;
      if (gx0 === gx1 && gz0 === gz1) break;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; gx0 += sx; }
      if (e2 <  dx) { err += dx; gz0 += sz; }
    }
    return true;
  }

  // ─── Coordinate conversion ────────────────────────────────────────────────

  private _worldToGridX(wx: number): number {
    return Math.floor((wx - this.originX) / this.cellSize);
  }
  private _worldToGridZ(wz: number): number {
    return Math.floor((wz - this.originZ) / this.cellSize);
  }
  private _gridToWorld(gx: number, gz: number, y = 0): Vector3 {
    return {
      x: this.originX + (gx + 0.5) * this.cellSize,
      y,
      z: this.originZ + (gz + 0.5) * this.cellSize,
    };
  }
  private _inBounds(gx: number, gz: number): boolean {
    return gx >= 0 && gz >= 0 && gx < this.gridWidth && gz < this.gridHeight;
  }

  // ─── Debug helpers ────────────────────────────────────────────────────────

  /** Return a string grid (# = blocked, . = free) for console debugging. */
  debugPrintGrid(): string {
    let out = '';
    for (let gz = 0; gz < this.gridHeight; gz++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        out += this.isWalkable(gx, gz) ? '.' : '#';
      }
      out += '\n';
    }
    return out;
  }

  /** Returns all blocked cells as world positions (centre of cell). */
  getBlockedWorldPositions(): Vector3[] {
    const result: Vector3[] = [];
    for (let gz = 0; gz < this.gridHeight; gz++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        if (!this.isWalkable(gx, gz)) result.push(this._gridToWorld(gx, gz));
      }
    }
    return result;
  }

  private rebuildFromStaticColliders(): void {
    if (!this.systemContext?.entityManager) {
      return;
    }

    this.grid.fill(0);

    let blockedCellCount = 0;

    for (const entity of this.systemContext.entityManager.getEntities()) {
      if (!isEntityStreamLoaded(entity) || entity.hasComponent('aiController')) {
        continue;
      }

      const collider = entity.getComponent('collider')?.data as ColliderLike | undefined;
      if (!collider || collider.isTrigger) {
        continue;
      }

      const position = entity.getPosition();
      const scale = entity.getScale();

      if (collider.shape === 'box') {
        blockedCellCount += this.stampBlockedAABB({
          min: {
            x: position.x - ((collider.size.width ?? 1) * scale.x) / 2,
            z: position.z - ((collider.size.depth ?? 1) * scale.z) / 2,
          },
          max: {
            x: position.x + ((collider.size.width ?? 1) * scale.x) / 2,
            z: position.z + ((collider.size.depth ?? 1) * scale.z) / 2,
          },
        });
        continue;
      }

      const radius = collider.shape === 'sphere'
        ? (collider.size.radius ?? 0.5) * Math.max(scale.x, scale.z)
        : (collider.size.capsuleRadius ?? 0.5) * Math.max(scale.x, scale.z);

      blockedCellCount += this.stampBlockedAABB({
        min: { x: position.x - radius, z: position.z - radius },
        max: { x: position.x + radius, z: position.z + radius },
      });
    }

    const gridSignature = this.computeGridSignature();
    if (gridSignature !== this.lastGridSignature || blockedCellCount !== this.lastBlockedCellCount) {
      this.pathCache.clear();
      this.lastGridSignature = gridSignature;
      this.lastBlockedCellCount = blockedCellCount;
    }

    if (blockedCellCount > 0) {
      gameBus.emit('stateMutation', {
        source: 'pathfindingSystem',
        path: 'pathfinding.grid',
        changedCount: blockedCellCount,
      });
    }
  }

  private stampBlockedAABB(aabb: AABB2D): number {
    const minGx = this._worldToGridX(aabb.min.x);
    const maxGx = this._worldToGridX(aabb.max.x);
    const minGz = this._worldToGridZ(aabb.min.z);
    const maxGz = this._worldToGridZ(aabb.max.z);
    let blockedCellCount = 0;

    for (let gz = minGz; gz <= maxGz; gz++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (!this._inBounds(gx, gz)) {
          continue;
        }

        const index = gz * this.gridWidth + gx;
        if (this.grid[index] === 1) {
          continue;
        }

        this.grid[index] = 1;
        blockedCellCount += 1;
      }
    }

    return blockedCellCount;
  }

  private hasTargetChanged(aiController: AIControllerComponent, targetPosition: Vector3): boolean {
    const lastTarget = aiController.lastTargetPosition;
    if (!lastTarget) {
      return true;
    }

    const dx = targetPosition.x - lastTarget.x;
    const dz = targetPosition.z - lastTarget.z;
    return dx * dx + dz * dz > this.cellSize * this.cellSize * 0.25;
  }

  private resolveTargetPosition(aiController: AIControllerComponent): Vector3 | null {
    const entityManager = this.systemContext?.entityManager;
    if (aiController.targetEntityId && entityManager) {
      const target = entityManager.getEntity(aiController.targetEntityId);
      if (!target) {
        clearAIControllerTarget(aiController, 'lost');
        return null;
      }

      const lifecycleState = getRuntimeLifecycleState(target);
      if (lifecycleState === 'streamingOut' || lifecycleState === 'unloaded') {
        clearAIControllerTarget(aiController, 'lost');
        return null;
      }
      if (!isEntitySimulationActive(target)) {
        cancelAIControllerPath(aiController, 'dormant');
        return null;
      }

      const targetPosition = target.getPosition();
      aiController.targetPosition = targetPosition;
      aiController.targetState = 'entity';
      aiController.lastResolvedAtMs = Engine.time.now();
      return targetPosition;
    }

    const targetPosition = aiController.targetPosition;
    if (!targetPosition || !Number.isFinite(targetPosition.x) || !Number.isFinite(targetPosition.z)) {
      clearAIControllerTarget(aiController, 'lost');
      return null;
    }

    aiController.targetState = 'position';
    return targetPosition;
  }

  private deactivateAgent(
    entity: {
      getComponent(name: string): { data: Record<string, any> } | undefined;
      addComponent(component: { name: string; data: Record<string, any> }): void;
    },
    aiController: AIControllerComponent,
    reason: AIControllerTargetState,
  ): void {
    if (reason === 'lost') {
      clearAIControllerTarget(aiController, reason);
    } else {
      cancelAIControllerPath(aiController, reason);
    }
    this.cancelledPathJobs += 1;
    this.stalePathPrunes += 1;
    this.setEntityVelocity(entity, ZERO_VELOCITY);
  }

  private computeGridSignature(): number {
    let signature = 2166136261;
    for (let index = 0; index < this.grid.length; index += 1) {
      if (this.grid[index] === 0) {
        continue;
      }
      signature ^= index + 1;
      signature = Math.imul(signature, 16777619);
    }
    return signature >>> 0;
  }

  private setEntityVelocity(entity: { getComponent(name: string): { data: Record<string, any> } | undefined; addComponent(component: { name: string; data: Record<string, any> }): void }, velocity: Vector3): void {
    const existingVelocity = entity.getComponent('velocity');
    if (existingVelocity) {
      existingVelocity.data.x = velocity.x;
      existingVelocity.data.y = velocity.y;
      existingVelocity.data.z = velocity.z;
      return;
    }

    entity.addComponent({
      name: 'velocity',
      data: { x: velocity.x, y: velocity.y, z: velocity.z },
    });
  }
}
