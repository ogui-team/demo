/**
 * CombatSystem
 * Client-side hitscan shooting & hit detection.
 *
 * Responsibilities:
 *  - Capture mouse-click (left button) as a "shoot" event
 *  - Cast a ray from the player camera center (hitscan)
 *  - Detect which entity mesh was hit via Three.js Raycaster
 *  - Send damage to server via MultiplayerClient.sendDamage()
 *  - Notify HitFeedback for local visual/audio cues
 *  - Track fire-rate cooldown from current weapon preset
 *
 * Server authority: server receives PLAYER_DAMAGE, validates, applies
 * damage, broadcasts PLAYER_KILLED / DAMAGE_TAKEN to all clients.
 */

import * as THREE from 'three';
import { matchesRaycastLayers } from '@engine/1-kernel/core/public-api';
import { logEvent } from '@engine/1-kernel/core/public-api';
import { WEAPON_PRESETS, type WeaponDefinition } from '../systems/WeaponContracts';
import type { HitFeedback } from '../../../4-runtime/ui/HitFeedback';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface CombatClientAdapter {
  readonly playerId: string;
  on(event: 'damage_taken', callback: (payload: { amount: number }) => void): void;
  on(event: 'player_killed', callback: (payload: { killerId: string; targetId: string }) => void): void;
  on(event: 'player_died', callback: (payload: { playerId: string; killedBy: string }) => void): void;
  sendDamage(targetId: string, amount?: number): void;
}

interface CombatEntityManagerAdapter {
  getEntities(): Array<{ id: string }>;
}

export interface CombatConfig {
  /** Starting weapon id (matches WEAPON_PRESETS key). Defaults to 'pistol'. */
  weaponId?: string;
  /** Max hitscan range when weapon has no range set. Default 500. */
  maxRange?: number;
  /** Log hits to console. Default false. */
  enableLogging?: boolean;
}

export type ShootCallback = (
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  hitEntityId: string | null,
) => void;

// ─── CombatSystem ─────────────────────────────────────────────────────────────

export class CombatSystem {
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private client: CombatClientAdapter;
  private entityManager: CombatEntityManagerAdapter | null;
  private hitFeedback: HitFeedback | null;
  private systemContext: SystemContext | null = null;

  private raycaster: THREE.Raycaster;
  private enabled = false;
  private cooldownTimer = 0;
  private currentWeaponId: string;
  private maxRange: number;
  private enableLogging: boolean;

  private shootCallbacks: Set<ShootCallback> = new Set();

  constructor(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    client: CombatClientAdapter,
    entityManager: CombatEntityManagerAdapter | null = null,
    hitFeedback: HitFeedback | null = null,
    config: CombatConfig = {},
  ) {
    this.camera = camera;
    this.scene = scene;
    this.client = client;
    this.entityManager = entityManager;
    this.hitFeedback = hitFeedback;
    this.raycaster = new THREE.Raycaster();
    this.currentWeaponId = config.weaponId ?? 'pistol';
    this.maxRange = config.maxRange ?? 500;
    this.enableLogging = config.enableLogging ?? false;

    // Server-authoritative hit confirmations → feedback
    this.client.on('damage_taken', (payload) => {
      this.hitFeedback?.showDamageTaken(payload.amount);
    });

    this.client.on('player_killed', (payload) => {
      if (payload.killerId === this.client.playerId) {
        this.hitFeedback?.showHitMarker(true);
        this.hitFeedback?.showKillConfirm(payload.targetId);
      }
    });

    this.client.on('player_died', (payload) => {
      if (payload.playerId === this.client.playerId) {
        this.hitFeedback?.showDeathScreen(payload.killedBy);
      }
    });
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    const client = ctx.network.getClient() as CombatClientAdapter | null;
    if (client) {
      this.client = client;
    }
    if (ctx.entityManager) {
      this.entityManager = ctx.entityManager as CombatEntityManagerAdapter;
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: {
        currentWeaponId: this.currentWeaponId,
        cooldownTimer: this.cooldownTimer,
        shootCallbackCount: this.shootCallbacks.size,
        hasEntityManager: this.entityManager !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
  }

  destroy(): void {
    this.disable();
    this.shootCallbacks.clear();
  }

  // ─── Shoot ──────────────────────────────────────────────────────────────────

  /**
   * Attempt to fire. Returns true if a shot was fired (not on cooldown).
   * Safe to call every frame; will no-op if cooldown is active.
   */
  shoot(): boolean {
    if (!this.enabled || this.cooldownTimer > 0) return false;

    const weapon = this._getWeapon();
    this.cooldownTimer = 1 / weapon.fireRate;

    // Build ray from camera center screen position (0,0 = center)
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = weapon.range ?? this.maxRange;

    const origin = this.raycaster.ray.origin.clone();
    const direction = this.raycaster.ray.direction.clone();

    // Raycast against all entity meshes (exclude local player)
    const entityMeshes = this._collectEntityMeshes();
    const intersects = this.raycaster.intersectObjects(entityMeshes, true);

    let hitEntityId: string | null = null;
    if (intersects.length > 0) {
      hitEntityId = this._resolveEntityId(intersects[0].object);
    }

    if (hitEntityId) {
      const pellets = weapon.pellets ?? 1;
      const damagePerPellet = weapon.damage;

      // For multi-pellet weapons apply spread for additional pellets
      this.client.sendDamage(hitEntityId, damagePerPellet * pellets);

      // Optimistic (instant) hit-marker – server confirms via player_killed
      this.hitFeedback?.showHitMarker(false);

      if (this.enableLogging) {
        console.log(
          `[CombatSystem] Shot hit entity "${hitEntityId}" — ${damagePerPellet * pellets} dmg`,
        );
      }
      logEvent('combat', `Shot hit ${hitEntityId} for ${damagePerPellet * pellets}`);
    } else {
      if (this.enableLogging) {
        console.log('[CombatSystem] Shot missed');
      }
      logEvent('combat', 'Shot missed');
    }

    for (const cb of this.shootCallbacks) {
      cb(origin, direction, hitEntityId);
    }

    gameBus.emit('weaponFired', {
      entityId: this.client.playerId,
      weaponId: this.currentWeaponId,
    });

    return true;
  }

  // ─── Per-frame update ───────────────────────────────────────────────────────

  update(deltaTime: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - deltaTime);
    }
  }

  // ─── State accessors ────────────────────────────────────────────────────────

  setWeapon(weaponId: string): void {
    if (WEAPON_PRESETS[weaponId]) this.currentWeaponId = weaponId;
  }

  getCurrentWeapon(): string { return this.currentWeaponId; }
  getCooldownFraction(): number {
    const weapon = this._getWeapon();
    const interval = 1 / weapon.fireRate;
    return this.cooldownTimer / interval;
  }
  isEnabled(): boolean { return this.enabled; }

  handlePointerDown(e: MouseEvent): boolean {
    if (e.button !== 0) return false;
    return this.shoot();
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  onShoot(cb: ShootCallback): () => void {
    this.shootCallbacks.add(cb);
    return () => this.shootCallbacks.delete(cb);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _getWeapon(): WeaponDefinition {
    return WEAPON_PRESETS[this.currentWeaponId] ?? WEAPON_PRESETS['pistol']!;
  }

  /** Traverse the scene and collect entity meshes, excluding the local player. */
  private _collectEntityMeshes(): THREE.Object3D[] {
    const localId = this.client.playerId;
    const result: THREE.Object3D[] = [];

    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (!matchesRaycastLayers(obj, ['player', 'world'])) return;

      const playerId: string | undefined = obj.userData.playerId ?? obj.parent?.userData?.playerId;
      if (playerId === localId) return;
      result.push(obj);
    });

    return result;
  }

  /** Walk the object hierarchy upwards until we find an entity ID. */
  private _resolveEntityId(obj: THREE.Object3D | null): string | null {
    let current = obj;
    while (current) {
      if (current.userData.playerId) return current.userData.playerId as string;
      current = current.parent;
    }
    return null;
  }
}
