/**
 * ProceduralLevel  —  Tier 3
 * Prefab-based modular level generation for PS1-style horror environments.
 *
 * Architecture
 *   RoomTemplate   — JSON-defined room prefab (walls, floor, props, spawn points)
 *   RoomInstance   — a placed template with world origin & rotation
 *   LevelGenerator — connects rooms via matching doorway connectors
 *
 * Generation algorithm (BSP-style expansion):
 *   1. Place a start room
 *   2. For each open doorway, randomly pick a matching template and attach it
 *   3. Continue until target room count reached or no open doorways
 *   4. Optionally cap dead-end doorways with wall prefabs
 *
 * Integrates with:
 *   - PathfindingSystem — stamps blocked cells from room geometry into nav mesh
 *   - SaveLoadManager  — serialise/deserialise the placed room list
 *   - EntityManager    — spawn prop entities defined in room templates
 *
 * Usage:
 *   const gen = new ProceduralLevel({ seed: 12345, targetRoomCount: 12 });
 *   gen.registerTemplate(corridorTemplate);
 *   gen.registerTemplate(largeRoomTemplate);
 *
 *   const level = gen.generate();
 *   gen.buildThreeScene(level, scene, assetLoader);
 *   gen.stampNavMesh(level, pathfindingSystem);
 */

import * as THREE from 'three';
import { Vector3 } from '@engine/1-kernel/core/public-api';
import { PathfindingSystem } from './PathfindingSystem';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A doorway connection point on a room template. */
export interface Doorway {
  id:       string;
  /** Local-space position within the template. */
  localPos: Vector3;
  /** Direction the door faces (outward normal). */
  facing:   'N' | 'S' | 'E' | 'W';
}

/** A rectangular blocked region in local space (for nav mesh stamping). */
export interface BlockedRegion {
  min: { x: number; z: number };
  max: { x: number; z: number };
}

/** A prop spawned inside a room (enemy, item, decoration). */
export interface RoomProp {
  type:     'enemy' | 'item' | 'light' | 'decoration';
  localPos: Vector3;
  data:     Record<string, unknown>;
}

export interface RoomTemplate {
  id:           string;
  label:        string;
  /** Half-extents of the room bounding box. */
  sizeX:        number;
  sizeZ:        number;
  doorways:     Doorway[];
  /** Blocked regions (walls, pillars) for nav mesh. */
  blockedRegions?: BlockedRegion[];
  props?:          RoomProp[];
  /** Three.js builder function — receives a Group and should add geometry to it. */
  buildGeometry?: (group: THREE.Group, opts: BuildOpts) => void;
  /** Tags used for weighted selection (e.g. 'corridor' | 'room' | 'dead-end'). */
  tags?:          string[];
  /** Weight for random selection (default 1). */
  weight?:        number;
  /** Min/max times this template can appear. */
  minCount?:      number;
  maxCount?:      number;
}

export interface BuildOpts {
  wallColor:   number;
  floorColor:  number;
  ceilingColor: number;
  flatShading: boolean;
}

export interface RoomInstance {
  templateId:   string;
  worldPos:     Vector3;
  rotation:     number;   // Y-axis rotation in radians (0, π/2, π, 3π/2)
  doorways:     Array<{ doorwayId: string; connected: boolean; connectedRoomId?: string }>;
  instanceId:   string;
}

export interface GeneratedLevel {
  seed:    number;
  rooms:   RoomInstance[];
  startRoomId: string;
  exitRoomId:  string;
}

export interface LevelGenConfig {
  seed?:             number;
  targetRoomCount?:  number;
  maxAttempts?:      number;
  /** Minimum distance between room centres to prevent overlap. */
  roomSpacing?:      number;
  buildOptions?:     Partial<BuildOpts>;
}

// ─── Seeded RNG ───────────────────────────────────────────────────────────────

class SeededRNG {
  private s: number;
  constructor(seed: number) { this.s = seed; }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) & 0xffffffff;
    return (this.s >>> 0) / 0xffffffff;
  }
  nextInt(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(arr: T[]): T { return arr[this.nextInt(arr.length)]; }
}

// ─── ProceduralLevel ─────────────────────────────────────────────────────────

export class ProceduralLevel {
  private templates:    Map<string, RoomTemplate> = new Map();
  private templateList: RoomTemplate[]            = [];
  private cfg:          Required<LevelGenConfig>;

  private static instanceCounter = 0;

  private static readonly DEFAULT_BUILD: BuildOpts = {
    wallColor:   0x333344,
    floorColor:  0x222233,
    ceilingColor: 0x111122,
    flatShading: true,
  };

  constructor(cfg: LevelGenConfig = {}) {
    this.cfg = {
      seed:            cfg.seed            ?? Math.floor(Math.random() * 999999),
      targetRoomCount: cfg.targetRoomCount ?? 10,
      maxAttempts:     cfg.maxAttempts     ?? 200,
      roomSpacing:     cfg.roomSpacing     ?? 0,
      buildOptions:    { ...ProceduralLevel.DEFAULT_BUILD, ...(cfg.buildOptions ?? {}) },
    };
  }

  // ─── Template registry ───────────────────────────────────────────────────

  registerTemplate(tmpl: RoomTemplate): void {
    this.templates.set(tmpl.id, tmpl);
    this.templateList.push(tmpl);
  }

  /** Register a batch of built-in templates (corridor + plain room). */
  registerBuiltIns(): void {
    this.registerTemplate(this._makeCorridor());
    this.registerTemplate(this._makeSmallRoom());
    this.registerTemplate(this._makeLargeRoom());
    this.registerTemplate(this._makeTJunction());
  }

  // ─── Generation ──────────────────────────────────────────────────────────

  generate(): GeneratedLevel {
    const rng     = new SeededRNG(this.cfg.seed);
    const rooms:  RoomInstance[]  = [];
    const placed: THREE.Box3[]    = [];   // for overlap detection

    // Place start room
    const startTmpl   = rng.pick(this.templateList.filter((t) => t.tags?.includes('start') || true));
    const startRoom   = this._placeRoom(startTmpl, { x: 0, y: 0, z: 0 }, 0);
    rooms.push(startRoom);
    placed.push(this._roomBounds(startRoom, startTmpl));

    const openDoorways: Array<{ roomId: string; doorwayIdx: number; worldPos: Vector3; facing: 'N'|'S'|'E'|'W' }> = [];

    for (let i = 0; i < startRoom.doorways.length; i++) {
      const dw      = startRoom.doorways[i];
      const tmpl    = this.templates.get(startRoom.templateId)!;
      const wdw     = this._worldDoorway(startRoom, tmpl.doorways[i]);
      openDoorways.push({ roomId: startRoom.instanceId, doorwayIdx: i, worldPos: wdw.pos, facing: wdw.facing });
    }

    let attempts = 0;
    while (rooms.length < this.cfg.targetRoomCount && openDoorways.length > 0 && attempts < this.cfg.maxAttempts) {
      attempts++;
      const dw = rng.pick(openDoorways);
      const candidateTmpls = this._compatibleTemplates(dw.facing);
      if (candidateTmpls.length === 0) continue;

      const candidateTmpl = this._weightedPick(rng, candidateTmpls);
      if (!candidateTmpl) continue;

      // Find the doorway on the candidate that faces the opposite direction
      const matchingDoor = candidateTmpl.doorways.find((d) => d.facing === this._opposite(dw.facing));
      if (!matchingDoor) continue;

      // Compute new room world position
      const newPos = this._connectPosition(dw.worldPos, dw.facing, candidateTmpl, matchingDoor);
      const newRot = this._rotationForFacing(dw.facing, matchingDoor.facing);
      const newRoom = this._placeRoom(candidateTmpl, newPos, newRot);

      // Overlap check
      const bounds = this._roomBounds(newRoom, candidateTmpl);
      if (this._overlaps(bounds, placed)) continue;

      // Connect
      newRoom.doorways[candidateTmpl.doorways.indexOf(matchingDoor)].connected      = true;
      newRoom.doorways[candidateTmpl.doorways.indexOf(matchingDoor)].connectedRoomId = dw.roomId;

      const parentRoom = rooms.find((r) => r.instanceId === dw.roomId);
      if (parentRoom) {
        parentRoom.doorways[dw.doorwayIdx].connected       = true;
        parentRoom.doorways[dw.doorwayIdx].connectedRoomId = newRoom.instanceId;
      }

      rooms.push(newRoom);
      placed.push(bounds);

      // Remove consumed open doorway
      const idx = openDoorways.indexOf(dw);
      openDoorways.splice(idx, 1);

      // Add new open doorways
      for (let i = 0; i < newRoom.doorways.length; i++) {
        if (!newRoom.doorways[i].connected) {
          const wdw = this._worldDoorway(newRoom, candidateTmpl.doorways[i]);
          openDoorways.push({ roomId: newRoom.instanceId, doorwayIdx: i, worldPos: wdw.pos, facing: wdw.facing });
        }
      }
    }

    // Pick exit room (furthest from start)
    const exitRoom = [...rooms].sort((a, b) => {
      const da = this._dist(a.worldPos, rooms[0].worldPos);
      const db = this._dist(b.worldPos, rooms[0].worldPos);
      return db - da;
    })[0];

    return {
      seed:        this.cfg.seed,
      rooms,
      startRoomId: rooms[0].instanceId,
      exitRoomId:  exitRoom.instanceId,
    };
  }

  // ─── Three.js scene builder ───────────────────────────────────────────────

  buildThreeScene(level: GeneratedLevel, scene: THREE.Scene): THREE.Group {
    const levelGroup = new THREE.Group();
    levelGroup.name  = 'generated_level';
    const opts       = this.cfg.buildOptions as BuildOpts;

    for (const room of level.rooms) {
      const tmpl = this.templates.get(room.templateId);
      if (!tmpl) continue;

      const roomGroup = new THREE.Group();
      roomGroup.name  = `room_${room.instanceId}`;
      roomGroup.position.set(room.worldPos.x, room.worldPos.y, room.worldPos.z);
      roomGroup.rotation.y = room.rotation;

      if (tmpl.buildGeometry) {
        tmpl.buildGeometry(roomGroup, opts);
      } else {
        this._defaultRoomGeometry(roomGroup, tmpl, opts);
      }

      levelGroup.add(roomGroup);
    }

    scene.add(levelGroup);
    return levelGroup;
  }

  /** Stamp blocked regions from all rooms into the nav mesh. */
  stampNavMesh(level: GeneratedLevel, nav: PathfindingSystem): void {
    for (const room of level.rooms) {
      const tmpl = this.templates.get(room.templateId);
      if (!tmpl?.blockedRegions) continue;

      for (const region of tmpl.blockedRegions) {
        // Transform region to world space (simplified, ignores rotation for static rooms)
        nav.markBlockedAABB({
          min: { x: room.worldPos.x + region.min.x, z: room.worldPos.z + region.min.z },
          max: { x: room.worldPos.x + region.max.x, z: room.worldPos.z + region.max.z },
        });
      }
    }
  }

  /** Returns all prop spawns across the level (enemy/item/light placements). */
  getProps(level: GeneratedLevel): Array<{ worldPos: Vector3; prop: RoomProp }> {
    const result: Array<{ worldPos: Vector3; prop: RoomProp }> = [];
    for (const room of level.rooms) {
      const tmpl = this.templates.get(room.templateId);
      if (!tmpl?.props) continue;
      for (const prop of tmpl.props) {
        result.push({
          worldPos: {
            x: room.worldPos.x + prop.localPos.x,
            y: room.worldPos.y + prop.localPos.y,
            z: room.worldPos.z + prop.localPos.z,
          },
          prop,
        });
      }
    }
    return result;
  }

  // ─── Serialise ────────────────────────────────────────────────────────────

  serialise(level: GeneratedLevel): string {
    return JSON.stringify(level);
  }

  deserialise(json: string): GeneratedLevel {
    return JSON.parse(json) as GeneratedLevel;
  }

  // ─── Built-in templates ───────────────────────────────────────────────────

  private _makeCorridor(): RoomTemplate {
    return {
      id: 'builtin_corridor', label: 'Corridor',
      sizeX: 3, sizeZ: 8,
      doorways: [
        { id: 'door_n', localPos: { x: 0, y: 0, z: -4 }, facing: 'N' },
        { id: 'door_s', localPos: { x: 0, y: 0, z:  4 }, facing: 'S' },
      ],
      blockedRegions: [
        { min: { x: -1.5, z: -4 }, max: { x: -1, z: 4 } },
        { min: { x:  1,   z: -4 }, max: { x: 1.5, z: 4 } },
      ],
      tags: ['corridor'], weight: 3,
    };
  }

  private _makeSmallRoom(): RoomTemplate {
    return {
      id: 'builtin_small_room', label: 'Small Room',
      sizeX: 6, sizeZ: 6,
      doorways: [
        { id: 'door_n', localPos: { x: 0, y: 0, z: -3 }, facing: 'N' },
        { id: 'door_s', localPos: { x: 0, y: 0, z:  3 }, facing: 'S' },
        { id: 'door_e', localPos: { x: 3, y: 0, z:  0 }, facing: 'E' },
      ],
      tags: ['room'], weight: 2,
    };
  }

  private _makeLargeRoom(): RoomTemplate {
    return {
      id: 'builtin_large_room', label: 'Large Room',
      sizeX: 10, sizeZ: 10,
      doorways: [
        { id: 'door_n', localPos: { x: 0, y: 0, z: -5 }, facing: 'N' },
        { id: 'door_s', localPos: { x: 0, y: 0, z:  5 }, facing: 'S' },
        { id: 'door_e', localPos: { x: 5, y: 0, z:  0 }, facing: 'E' },
        { id: 'door_w', localPos: { x:-5, y: 0, z:  0 }, facing: 'W' },
      ],
      tags: ['room', 'start'], weight: 1,
    };
  }

  private _makeTJunction(): RoomTemplate {
    return {
      id: 'builtin_t_junction', label: 'T-Junction',
      sizeX: 8, sizeZ: 8,
      doorways: [
        { id: 'door_n', localPos: { x: 0, y: 0, z: -4 }, facing: 'N' },
        { id: 'door_e', localPos: { x: 4, y: 0, z:  0 }, facing: 'E' },
        { id: 'door_w', localPos: { x:-4, y: 0, z:  0 }, facing: 'W' },
      ],
      tags: ['junction'], weight: 1,
    };
  }

  // ─── Default geometry builder ─────────────────────────────────────────────

  private _defaultRoomGeometry(group: THREE.Group, tmpl: RoomTemplate, opts: BuildOpts): void {
    const W = tmpl.sizeX, H = 3, D = tmpl.sizeZ;
    const flatShading = opts.flatShading;

    const floorGeo   = new THREE.BoxGeometry(W, 0.2, D);
    const ceilGeo    = new THREE.BoxGeometry(W, 0.2, D);
    const wallNGeo   = new THREE.BoxGeometry(W, H, 0.2);
    const wallSGeo   = new THREE.BoxGeometry(W, H, 0.2);
    const wallEGeo   = new THREE.BoxGeometry(0.2, H, D);
    const wallWGeo   = new THREE.BoxGeometry(0.2, H, D);

    const floor  = new THREE.MeshLambertMaterial({ color: opts.floorColor,   flatShading });
    const ceil   = new THREE.MeshLambertMaterial({ color: opts.ceilingColor, flatShading });
    const wall   = new THREE.MeshLambertMaterial({ color: opts.wallColor,    flatShading });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      group.add(m);
    };

    add(floorGeo, floor, 0, -0.1,  0);
    add(ceilGeo,  ceil,  0, H,     0);
    add(wallNGeo, wall,  0, H / 2, -D / 2);
    add(wallSGeo, wall,  0, H / 2,  D / 2);
    add(wallEGeo, wall,  W / 2, H / 2, 0);
    add(wallWGeo, wall, -W / 2, H / 2, 0);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _placeRoom(tmpl: RoomTemplate, pos: Vector3, rot: number): RoomInstance {
    const id = `room_${++ProceduralLevel.instanceCounter}`;
    return {
      templateId:  tmpl.id,
      worldPos:    { ...pos },
      rotation:    rot,
      instanceId:  id,
      doorways:    tmpl.doorways.map((d) => ({ doorwayId: d.id, connected: false })),
    };
  }

  private _worldDoorway(room: RoomInstance, door: Doorway): { pos: Vector3; facing: 'N'|'S'|'E'|'W' } {
    // Simplified: ignore rotation for doorway world pos (good enough for orthogonal rooms)
    return {
      pos: {
        x: room.worldPos.x + door.localPos.x,
        y: room.worldPos.y + door.localPos.y,
        z: room.worldPos.z + door.localPos.z,
      },
      facing: door.facing,
    };
  }

  private _connectPosition(
    fromWorldDoor: Vector3, facing: 'N'|'S'|'E'|'W',
    newTmpl: RoomTemplate, matchDoor: Doorway
  ): Vector3 {
    // Centre of new room such that matchDoor aligns with fromWorldDoor
    return {
      x: fromWorldDoor.x - matchDoor.localPos.x,
      y: fromWorldDoor.y,
      z: fromWorldDoor.z - matchDoor.localPos.z,
    };
  }

  private _rotationForFacing(_from: 'N'|'S'|'E'|'W', _to: 'N'|'S'|'E'|'W'): number {
    return 0; // Simplified — full rotation support would require per-doorway transform
  }

  private _roomBounds(room: RoomInstance, tmpl: RoomTemplate): THREE.Box3 {
    return new THREE.Box3(
      new THREE.Vector3(room.worldPos.x - tmpl.sizeX / 2, -1, room.worldPos.z - tmpl.sizeZ / 2),
      new THREE.Vector3(room.worldPos.x + tmpl.sizeX / 2,  4, room.worldPos.z + tmpl.sizeZ / 2)
    );
  }

  private _overlaps(box: THREE.Box3, placed: THREE.Box3[]): boolean {
    const spacing = this.cfg.roomSpacing;
    for (const b of placed) {
      const expanded = b.clone().expandByScalar(spacing);
      if (box.intersectsBox(expanded)) return true;
    }
    return false;
  }

  private _compatibleTemplates(facing: 'N'|'S'|'E'|'W'): RoomTemplate[] {
    const opp = this._opposite(facing);
    return this.templateList.filter((t) => t.doorways.some((d) => d.facing === opp));
  }

  private _weightedPick(rng: SeededRNG, templates: RoomTemplate[]): RoomTemplate | null {
    if (templates.length === 0) return null;
    const totalWeight = templates.reduce((s, t) => s + (t.weight ?? 1), 0);
    let pick = rng.next() * totalWeight;
    for (const t of templates) {
      pick -= t.weight ?? 1;
      if (pick <= 0) return t;
    }
    return templates[templates.length - 1];
  }

  private _opposite(facing: 'N'|'S'|'E'|'W'): 'N'|'S'|'E'|'W' {
    const map: Record<string, 'N'|'S'|'E'|'W'> = { N:'S', S:'N', E:'W', W:'E' };
    return map[facing];
  }

  private _dist(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x; const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
