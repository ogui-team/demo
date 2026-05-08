/**
 * DRIFT BOMB LOCAL CONTROLLER
 * Manages the offline/solo Drift Bomb experience:
 *  1. When drift_bomb mode starts → show spectator banner + team-select overlay
 *  2. On team chosen → commit team, switch HUD back to play, show HUD overlay
 *  3. Each frame → drive DriftBombHUDOverlay with live round-manager data
 *  4. When mode ends → tear down overlay
 */

import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  getTropicalHorrorArchetype,
  resolveTropicalHorrorArchetypeId,
} from '../../../2-systems/ArchetypeDefinitions';
import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { StateManager } from '../../../0-foundation/foundation/state/StateManager';
import type { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import { DriftBombMode } from '../../../2-systems/gameplay/modes/DriftBombMode';
import type { PhysicsBackendMode } from '../../../2-systems/gameplay/systems/PhysicsSystem';
import { DriftBombBombController, type BombWaypoint } from './DriftBombBombController';
import { DriftBombHUDOverlay } from './DriftBombHUDOverlay';
import { DriftBombObjectiveSystem } from './DriftBombObjectiveSystem';

function isDriftBombDebugSession(): boolean {
  try {
    const query = new URLSearchParams(window.location.search);
    return query.get('driftBombDebug') === '1' || query.get('autostart') === 'driftbomb_debug';
  } catch {
    return false;
  }
}

function resolveDebugTeam(): 'attacker' | 'defender' | null {
  try {
    const query = new URLSearchParams(window.location.search);
    const value = (query.get('driftBombAutoTeam') ?? '').toLowerCase();
    if (value === 'attacker' || value === 'terrorist') return 'attacker';
    if (value === 'defender' || value === 'ct') return 'defender';
  } catch {
    // ignore
  }
  return null;
}

export class DriftBombLocalController {
  private readonly engineGameModes: GameModeSystem;
  private readonly stateManager: StateManager;
  private readonly gameHUD: HUDSystem;
  private readonly localPlayerId: string;

  private overlay: DriftBombHUDOverlay | null = null;
  private teamPickerEl: HTMLElement | null = null;
  private active = false;
  private selectedTeam: 'attacker' | 'defender' | null = null;
  private bombController: DriftBombBombController | null = null;
  private bombMesh: THREE.Group | null = null;
  private routeDebugGroup: THREE.Group | null = null;
  private tetherDebugMesh: THREE.Mesh | null = null;
  private debugDriftRouteVisible = false;
  private readonly driftBombDebugSession = isDriftBombDebugSession();
  private readonly autoTeamSelection = resolveDebugTeam();
  private bombRouteInitialized = false;
  private lastObservedPhase: string | null = null;
  private lastRoundOutcomeKey: string | null = null;
  private readonly objectiveSystem = new DriftBombObjectiveSystem(
    this.driftBombDebugSession
      ? DriftBombObjectiveSystem.createDebugMap()
      : DriftBombObjectiveSystem.createDefaultMap(),
  );
  private previousBombPosition: { x: number; y: number; z: number } | null = null;
  private previousBombPositionTimeMs = 0;
  private inventoryMutationInFlight = false;

  private readonly unsubs: Array<() => void> = [];
  private readonly onMouseDownBound: (event: MouseEvent) => void;
  private readonly onKeyDownBound: (event: KeyboardEvent) => void;

  constructor(opts: {
    engineGameModes: GameModeSystem;
    stateManager: StateManager;
    gameHUD: HUDSystem;
    localPlayerId: string;
  }) {
    this.engineGameModes = opts.engineGameModes;
    this.stateManager = opts.stateManager;
    this.gameHUD = opts.gameHUD;
    this.localPlayerId = opts.localPlayerId;
    this.onMouseDownBound = (event: MouseEvent) => this.onMouseDown(event);
    this.onKeyDownBound = (event: KeyboardEvent) => this.onKeyDown(event);

    this.unsubs.push(
      gameBus.on('gameModeStarted', ({ modeName }) => {
        if (modeName === 'drift_bomb') this.onModeStart();
      }),
    );
    this.unsubs.push(
      gameBus.on('gameModeEnded', ({ modeName }) => {
        if (modeName === 'drift_bomb') this.onModeEnd();
      }),
    );

    window.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  // ─── Per-frame update ───────────────────────────────────────────────────

  update(_dt: number): void {
    if (!this.active || this.teamPickerEl) return; // Nothing to do while team picker is open
    const mode = this.engineGameModes.getMode('drift_bomb');
    if (!(mode instanceof DriftBombMode)) return;

    const rm = mode.getRoundManager();
    const previousPhase = this.lastObservedPhase;
    const currentPhase = rm.getPhase();
    if (currentPhase !== previousPhase) {
      void this.handlePhaseChanged(previousPhase, currentPhase);
    }
    this.syncBombPresentation(rm.getPhase(), rm, _dt);

    const state = rm.getState();

    const phaseTime = rm.getPhaseTimeRemaining();
    const defuseProgress = state.phase === 'defusing' && state.maxPhaseSeconds > 0
      ? Math.max(0, Math.min(1, 1 - (phaseTime / state.maxPhaseSeconds)))
      : 0;
    const tetherDistance = this.computeTetherDistance(state);
    const driftVelocity = this.estimateDriftVelocity(state.bombPosition ?? null);
    const backendMode = this.resolvePhysicsBackendMode();

    // Build the DriftBombModeState shape expected by DriftBombHUDOverlay.update()
    const modeState = {
      state: state.phase as string,
      roundConfig: {
        roundNumber: state.roundNumber,
        buyPhaseDuration: 20000,
        actionPhaseDuration: 100000,
        plantTimeSec: 3,
        defuseTimeSec: 40,
        bombDriftDuration: 30000,
        tetherRadius: 15,
      },
      bombPosition: state.bombPosition ?? { x: 0, y: 0, z: 0, epoch: 0 },
      bombCarrierEntityId: state.bombPlantedAt == null && this.selectedTeam === 'attacker' ? this.localPlayerId : null,
      defuserEntityId: state.defusingBy ?? null,
      defuseProgress,
      attackerScore: state.attackerScore.roundsWon,
      defenderScore: state.defenderScore.roundsWon,
      teamEconomy: {
        attackers: state.attackerScore.economy - state.attackerScore.spent,
        defenders: state.defenderScore.economy - state.defenderScore.spent,
      },
      roundStartFrame: 0,
      determinismEpoch: rm.getFrameCounter(),
      debugMetrics: {
        backendMode,
        replayEpoch: rm.getFrameCounter(),
        authorityOwner: state.defusingBy ?? state.bombPlantedBy ?? 'none',
        driftVelocity,
        tetherDistance,
        listeners: this.resolveListenerCount(),
      },
    };

    if (!this.overlay) {
      this.overlay = new DriftBombHUDOverlay();
      this.overlay.initialize();
    }
    this.overlay.update(modeState as any, phaseTime);

    // Reuse the generic round strip for a visible timer/round indicator in Drift Bomb.
    this.gameHUD.setRoundState(
      Math.max(0, Math.floor(phaseTime * 1000)),
      0,
      state.attackerScore.roundsWon,
      state.defenderScore.roundsWon,
      state.roundNumber,
    );

    this.stateManager.set('driftBomb.scoreboard', {
      phase: state.phase,
      roundNumber: state.roundNumber,
      phaseTimeRemaining: phaseTime,
      attackersRoundsWon: state.attackerScore.roundsWon,
      defendersRoundsWon: state.defenderScore.roundsWon,
      attackersAlive: state.attackerScore.alive,
      defendersAlive: state.defenderScore.alive,
      attackerEconomy: state.attackerScore.economy - state.attackerScore.spent,
      defenderEconomy: state.defenderScore.economy - state.defenderScore.spent,
      bombPosition: state.bombPosition ?? null,
      backendMode,
      driftVelocity,
      tetherDistance,
    });

    this.stateManager.set('driftBomb.debug', {
      backendMode,
      phase: state.phase,
      replayEpoch: rm.getFrameCounter(),
      authorityOwner: state.defusingBy ?? state.bombPlantedBy ?? null,
      bombState: state.bombPlantedAt ? 'planted' : 'carried_or_idle',
      driftVelocity,
      tetherDistance,
      defuseProgress,
      roundPhase: state.phase,
      entityCount: Engine.getEntityManager()?.getEntityCount() ?? 0,
      listenerCount: this.resolveListenerCount(),
      queuePressure: this.resolveQueuePressure(),
      routeDebugVisible: this.debugDriftRouteVisible,
    });

    this.lastObservedPhase = state.phase;
  }

  destroy(): void {
    window.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('keydown', this.onKeyDownBound);
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.tearDownOverlay();
    this.hideTeamPicker();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  private onModeStart(): void {
    this.active = true;
    this.selectedTeam = null;
    this.lastObservedPhase = null;
    this.lastRoundOutcomeKey = null;
    this.resetBombPresentation();
    Engine.getToolbarSystem()?.clearPhysGunSlot();
    // Switch HUD to spectator while team picker is open
    this.stateManager.set('ui.hud.mode', 'spectator');
    this.gameHUD.setTeam('none');

    if (this.driftBombDebugSession) {
      this.ensureRouteDebugVisuals();
      this.debugDriftRouteVisible = true;
      this.setRouteDebugVisible(true);
    }

    if (this.autoTeamSelection) {
      this.gameHUD.showNotification(`Debug auto-team: ${this.autoTeamSelection.toUpperCase()}`, 2);
      this.commitTeam(this.autoTeamSelection);
      return;
    }

    this.showTeamPicker();
  }

  private onModeEnd(): void {
    this.active = false;
    this.selectedTeam = null;
    this.lastObservedPhase = null;
    this.lastRoundOutcomeKey = null;
    this.resetBombPresentation();
    this.disposeRouteDebugVisuals();
    this.tearDownOverlay();
    this.hideTeamPicker();
    this.stateManager.set('driftBomb.scoreboard', null);
  }

  // ─── Team picker ────────────────────────────────────────────────────────

  private showTeamPicker(): void {
    this.hideTeamPicker(); // Defensive cleanup

    const el = document.createElement('div');
    el.id = 'drift-bomb-team-picker';
    el.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.75)',
      'z-index:2000',
      'font-family:monospace',
      'color:#fff',
      'pointer-events:all',
    ].join(';');

    el.innerHTML = `
      <div style="text-align:center;background:rgba(10,10,20,0.95);padding:40px 60px;border:2px solid #f80;border-radius:4px;">
        <div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:#f80;margin-bottom:8px;">DRIFT BOMB</div>
        <div style="font-size:14px;color:#aaa;margin-bottom:32px;">Choose your role for this match</div>
        <div style="display:flex;gap:24px;">
          <button id="db-pick-attacker" style="
            background:#c0392b;border:2px solid #e74c3c;color:#fff;
            padding:18px 36px;font-size:16px;font-family:monospace;
            cursor:pointer;border-radius:2px;letter-spacing:2px;
            transition:background 0.15s;">
            ⚔ ATTACKER
          </button>
          <button id="db-pick-defender" style="
            background:#2980b9;border:2px solid #3498db;color:#fff;
            padding:18px 36px;font-size:16px;font-family:monospace;
            cursor:pointer;border-radius:2px;letter-spacing:2px;
            transition:background 0.15s;">
            🛡 DEFENDER
          </button>
        </div>
        <div style="margin-top:20px;font-size:11px;color:#666;">
          Attackers plant the drift bomb · Defenders defuse it
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this.teamPickerEl = el;

    const atkBtn = el.querySelector<HTMLButtonElement>('#db-pick-attacker');
    const defBtn = el.querySelector<HTMLButtonElement>('#db-pick-defender');
    atkBtn?.addEventListener('click', () => this.commitTeam('attacker'));
    defBtn?.addEventListener('click', () => this.commitTeam('defender'));
  }

  private hideTeamPicker(): void {
    if (this.teamPickerEl) {
      this.teamPickerEl.remove();
      this.teamPickerEl = null;
    }
  }

  private commitTeam(team: 'attacker' | 'defender'): void {
    // Remove picker first so the click can't fire again
    this.hideTeamPicker();
    this.selectedTeam = team;

    const mode = this.engineGameModes.getMode('drift_bomb');
    if (mode instanceof DriftBombMode) {
      mode.setLocalSpawnWeapons(this.localPlayerId, this.resolveCurrentWeaponLoadout());
      mode.beginLocalMatch(this.localPlayerId, team);
    }

    void this.initializeLocalInventory(team);
    Engine.getToolbarSystem()?.clearPhysGunSlot();

    // Update the HUD team badge
    this.gameHUD.setTeam(team === 'attacker' ? 'red' : 'blue');

    // Notify player and switch HUD to play
    this.gameHUD.showNotification(
      team === 'attacker' ? 'You are ATTACKING — plant the drift bomb!' : 'You are DEFENDING — defuse the drift bomb!',
      4,
    );
    this.stateManager.set('ui.hud.mode', 'play');
  }

  private onMouseDown(event: MouseEvent): void {
    if (!this.active || this.teamPickerEl) return;
    if (event.button !== 0) return;
    if (this.selectedTeam !== 'attacker') return;
    if (!this.isBombEquipped()) return;

    const mode = this.engineGameModes.getMode('drift_bomb');
    if (!(mode instanceof DriftBombMode)) return;

    const rm = mode.getRoundManager();
    if (rm.getTeam(this.localPlayerId) !== 'attacker') return;
    if (rm.getPhase() !== 'action_phase') return;

    const plantPosition = this.computePlantPosition(rm.getFrameCounter());
    rm.plantBomb(this.localPlayerId, plantPosition);
    this.initializeBombRoute(plantPosition);
    void this.consumePlantedBombFromInventory();
    this.gameHUD.showNotification('Bomb planted.', 2);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.active || this.teamPickerEl) return;

    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
    }

    const mode = this.engineGameModes.getMode('drift_bomb');
    if (!(mode instanceof DriftBombMode)) return;

    const rm = mode.getRoundManager();

    if (event.code === 'F6') {
      event.preventDefault();
      rm.startNextRound();
      this.resetBombPresentation();
      this.gameHUD.showNotification('Drift Bomb round restarted.', 2);
      return;
    }

    if (event.code === 'F7') {
      event.preventDefault();
      this.debugDriftRouteVisible = !this.debugDriftRouteVisible;
      this.setRouteDebugVisible(this.debugDriftRouteVisible);
      this.gameHUD.showNotification(`Route debug ${this.debugDriftRouteVisible ? 'enabled' : 'disabled'}.`, 2);
      return;
    }

    if (event.code === 'F8') {
      event.preventDefault();
      this.togglePhysicsBackendLive();
      return;
    }

    if (event.code === 'F9') {
      event.preventDefault();
      this.teleportLocalPlayerToBomb(rm);
      return;
    }

    if (event.code === 'F10') {
      event.preventDefault();
      this.dumpRuntimeSnapshot(rm);
      return;
    }

    if (event.code !== 'KeyE') return;

    const localTeam = rm.getTeam(this.localPlayerId);
    if (localTeam !== 'defender') return;

    if (rm.getPhase() === 'defusing' && rm.getDefuser() === this.localPlayerId) {
      rm.completeBombDefusal();
      this.gameHUD.showNotification('Bomb defused.', 2);
      return;
    }

    if (rm.getPhase() === 'drifting' || rm.getPhase() === 'action_phase') {
      rm.startDefuse(this.localPlayerId);
      this.gameHUD.showNotification('Defusing started. Press E again to complete.', 2);
    }
  }

  private isBombEquipped(): boolean {
    const activeSlot = Engine.getToolbarSystem()?.getActiveSlot();
    return activeSlot?.itemId === 'drift_bomb_device';
  }

  private async initializeLocalInventory(team: 'attacker' | 'defender'): Promise<void> {
    const inventoryManager = Engine.getInventoryGridManager();
    if (!inventoryManager) {
      return;
    }

    const rawArchetypeId = this.stateManager.getRaw('lobby.localPlayer.archetype')
      ?? this.stateManager.getRaw('player.local.archetype');
    const archetypeId = resolveTropicalHorrorArchetypeId(rawArchetypeId)
      ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
    const archetype = getTropicalHorrorArchetype(archetypeId);
    const archetypeItems = archetype.spawn.weapons.map((weaponId) =>
      weaponId === 'debug_fireball' ? weaponId : `weapon_${weaponId}`,
    );

    const existingInventory = inventoryManager.getInventory();
    if (!existingInventory) {
      await inventoryManager.initOffline(this.localPlayerId, ['physgun_tool', ...archetypeItems]);
    }

    let latestInventory = inventoryManager.getInventory();
    const existingIds = new Set((latestInventory?.items ?? []).map((item) => item.itemId));

    for (const itemId of archetypeItems) {
      if (!existingIds.has(itemId)) {
        await inventoryManager.giveItem(itemId, 1);
        existingIds.add(itemId);
      }
    }

    latestInventory = inventoryManager.getInventory();
    const hasBomb = !!latestInventory?.items.some((item) => item.itemId === 'drift_bomb_device');
    if (team === 'attacker' && !hasBomb) {
      await inventoryManager.giveItem('drift_bomb_device', 1);
    }

    this.syncToolbarSelectionForTeam(team, {
      preferBomb: team === 'attacker',
    });
  }

  private async handlePhaseChanged(previousPhase: string | null, currentPhase: string): Promise<void> {
    if (currentPhase === 'buy_phase' && previousPhase !== 'buy_phase') {
      this.resetBombPresentation();
      if (this.selectedTeam) {
        await this.reconcileRoundInventory(this.selectedTeam);
      }
      return;
    }

    if (currentPhase === 'action_phase' && previousPhase !== 'action_phase' && this.selectedTeam) {
      this.syncToolbarSelectionForTeam(this.selectedTeam, {
        preferBomb: this.selectedTeam === 'attacker',
      });
    }
  }

  private async reconcileRoundInventory(team: 'attacker' | 'defender'): Promise<void> {
    if (this.inventoryMutationInFlight) {
      return;
    }

    this.inventoryMutationInFlight = true;
    try {
      const inventoryManager = Engine.getInventoryGridManager();
      if (!inventoryManager) {
        return;
      }

      const inventory = inventoryManager.getInventory();
      const bombInstance = inventory?.items.find((item) => item.itemId === 'drift_bomb_device') ?? null;

      if (team === 'attacker') {
        if (!bombInstance) {
          await inventoryManager.giveItem('drift_bomb_device', 1);
        }
      } else if (bombInstance) {
        await inventoryManager.dropItem(bombInstance.instanceId);
      }

      this.syncToolbarSelectionForTeam(team, {
        preferBomb: team === 'attacker',
      });
    } finally {
      this.inventoryMutationInFlight = false;
    }
  }

  private async consumePlantedBombFromInventory(): Promise<void> {
    if (this.inventoryMutationInFlight) {
      return;
    }

    this.inventoryMutationInFlight = true;
    try {
      const inventoryManager = Engine.getInventoryGridManager();
      const inventory = inventoryManager?.getInventory();
      const bombInstance = inventory?.items.find((item) => item.itemId === 'drift_bomb_device') ?? null;
      if (!inventoryManager || !bombInstance) {
        this.syncToolbarSelectionForTeam(this.selectedTeam, { preferBomb: false });
        return;
      }

      await inventoryManager.dropItem(bombInstance.instanceId);
      this.syncToolbarSelectionForTeam(this.selectedTeam, { preferBomb: false });
    } finally {
      this.inventoryMutationInFlight = false;
    }
  }

  private syncToolbarSelectionForTeam(
    team: 'attacker' | 'defender' | null,
    options: { preferBomb: boolean },
  ): void {
    const toolbar = Engine.getToolbarSystem();
    if (!toolbar) {
      return;
    }

    if (options.preferBomb && toolbar.selectSlotWithItem('drift_bomb_device')) {
      return;
    }

    if (team === 'attacker') {
      toolbar.selectFirstAvailableSlot(['weapon_rifle_ar', 'weapon_pistol', 'debug_fireball']);
      return;
    }

    toolbar.selectFirstAvailableSlot(['weapon_pistol', 'weapon_rifle_ar', 'debug_fireball']);
  }

  private resolveCurrentWeaponLoadout(): string[] {
    const inventoryManager = Engine.getInventoryGridManager();
    const inventory = inventoryManager?.getInventory();
    if (!inventory) {
      return [];
    }

    const weaponItemIds = inventory.items
      .map((item) => item.itemId)
      .filter((itemId) => itemId.startsWith('weapon_') || itemId === 'debug_fireball');

    const weaponIds = weaponItemIds
      .map((itemId) => this.toWeaponId(itemId))
      .filter((weaponId): weaponId is string => typeof weaponId === 'string' && weaponId.length > 0);

    return Array.from(new Set(weaponIds));
  }

  private toWeaponId(itemId: string): string | null {
    if (itemId === 'debug_fireball') {
      return itemId;
    }
    if (!itemId.startsWith('weapon_')) {
      return null;
    }
    return itemId.replace(/^weapon_/, '');
  }

  // ─── Overlay lifecycle ──────────────────────────────────────────────────

  private tearDownOverlay(): void {
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }

  private syncBombPresentation(phase: string, rm: ReturnType<DriftBombMode['getRoundManager']>, dt: number): void {
    const state = rm.getState();
    if (phase === 'planting' || phase === 'drifting' || phase === 'defusing' || phase === 'round_end') {
      if (state.bombPosition) {
        this.ensureBombMesh();
        this.updateBombMesh(state.bombPosition);
      }

      if ((phase === 'planting' || phase === 'drifting') && this.bombController) {
        if (!this.bombRouteInitialized) {
          this.bombController.startDrift(rm.getFrameCounter());
          this.bombRouteInitialized = true;
        }

        const driftPosition = this.bombController.updateDriftPosition(rm.getFrameCounter(), dt);
        const bombPosition = {
          ...driftPosition,
          epoch: state.bombPosition?.epoch ?? 0,
        };
        rm.setBombPosition(bombPosition);
        this.updateBombMesh(bombPosition);
      }

      if (phase === 'round_end') {
        this.announceRoundOutcome(state.roundWinner ?? null, state.winReason ?? null);
        this.setBombRoundEndPresentation(state.winReason ?? null);
      }
      return;
    }

    if (phase !== this.lastObservedPhase) {
      this.resetBombPresentation();
    }
  }

  private computePlantPosition(epoch: number): { x: number; y: number; z: number; epoch: number } {
    const entityPosition = Engine.getEntityManager()?.getEntity(this.localPlayerId)?.getPosition();
    const camera = Engine.getEngineCamera();
    const direction = new THREE.Vector3(0, 0, -1);
    camera?.getWorldDirection(direction);
    direction.y = 0;
    if (direction.lengthSq() <= 0.0001) {
      direction.set(0, 0, -1);
    }
    direction.normalize();

    const origin = entityPosition ?? {
      x: camera?.position.x ?? 0,
      y: camera?.position.y ?? 0,
      z: camera?.position.z ?? 0,
    };

    return {
      x: origin.x + (direction.x * 3),
      y: Math.max(0.75, origin.y - 0.9),
      z: origin.z + (direction.z * 3),
      epoch,
    };
  }

  private initializeBombRoute(plantPosition: { x: number; y: number; z: number; epoch: number }): void {
    const waypoints = this.buildRouteWaypoints(plantPosition);
    this.bombController = new DriftBombBombController();
    this.bombController.initializeDriftPath(waypoints);
    this.bombRouteInitialized = false;
    this.ensureBombMesh();
    this.updateBombMesh(plantPosition);
  }

  private buildRouteWaypoints(plantPosition: { x: number; y: number; z: number; epoch: number }): BombWaypoint[] {
    const bombSites = this.objectiveSystem.getBombSites();
    const closestSite = bombSites.reduce((best, site) => {
      const bestDistance = best
        ? this.distanceSquared(best.position, plantPosition)
        : Number.POSITIVE_INFINITY;
      const siteDistance = this.distanceSquared(site.position, plantPosition);
      return siteDistance < bestDistance ? site : best;
    }, null as (typeof bombSites)[number] | null);

    const route = closestSite
      ? this.objectiveSystem.plantBomb(closestSite.id)
      : null;
    const routeWaypoints = this.objectiveSystem.getRouteWaypoints();

    if (!route || routeWaypoints.length < 2) {
      return this.buildFallbackWaypoints(plantPosition);
    }

    const origin = routeWaypoints[0].position;
    return routeWaypoints.map((waypoint) => ({
      position: {
        x: plantPosition.x + (waypoint.position.x - origin.x),
        y: Math.max(0.75, plantPosition.y + (waypoint.position.y - origin.y)),
        z: plantPosition.z + (waypoint.position.z - origin.z),
      },
      order: waypoint.order,
      epoch: plantPosition.epoch,
    }));
  }

  private buildFallbackWaypoints(plantPosition: { x: number; y: number; z: number; epoch: number }): BombWaypoint[] {
    return [
      { position: { x: plantPosition.x, y: plantPosition.y, z: plantPosition.z }, order: 0, epoch: plantPosition.epoch },
      { position: { x: plantPosition.x + 6, y: plantPosition.y + 1.2, z: plantPosition.z + 4 }, order: 1, epoch: plantPosition.epoch },
      { position: { x: plantPosition.x + 10, y: plantPosition.y + 2, z: plantPosition.z - 2 }, order: 2, epoch: plantPosition.epoch },
      { position: { x: plantPosition.x + 4, y: plantPosition.y + 1.1, z: plantPosition.z - 7 }, order: 3, epoch: plantPosition.epoch },
      { position: { x: plantPosition.x - 3, y: plantPosition.y + 0.6, z: plantPosition.z - 3 }, order: 4, epoch: plantPosition.epoch },
    ];
  }

  private ensureBombMesh(): void {
    if (this.bombMesh) {
      return;
    }

    const scene = Engine.getEngineScene();
    if (!scene) {
      return;
    }

    const group = new THREE.Group();
    group.name = 'DriftBombPlaceholder';

    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.45, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xcf5a1a, roughness: 0.35, metalness: 0.65 }),
    );
    core.castShadow = true;
    group.add(core);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff3b1f, emissive: 0xaa2200, emissiveIntensity: 1.8 }),
    );
    beacon.position.set(0, 0.42, 0.1);
    group.add(beacon);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0xd2d7db, roughness: 0.2, metalness: 0.8 }),
    );
    antenna.position.set(0.22, 0.48, -0.24);
    group.add(antenna);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.05, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.45 }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.12;
    group.add(halo);

    const beaconColumn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.2, 6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    beaconColumn.position.y = 3;
    group.add(beaconColumn);

    const bombLight = new THREE.PointLight(0xff6a21, 3.5, 14, 2);
    bombLight.position.set(0, 1.5, 0);
    group.add(bombLight);

    scene.add(group);
    this.bombMesh = group;
  }

  private updateBombMesh(position: { x: number; y: number; z: number }): void {
    if (!this.bombMesh) {
      return;
    }

    this.bombMesh.position.set(position.x, position.y, position.z);
    this.bombMesh.rotation.y += 0.01;

    const pulse = 0.8 + (Math.sin(performance.now() * 0.01) * 0.08);
    this.bombMesh.scale.setScalar(pulse);

    if (this.tetherDebugMesh) {
      this.tetherDebugMesh.position.set(position.x, position.y + 0.1, position.z);
    }
  }

  private setBombRoundEndPresentation(winReason: string | null): void {
    if (!this.bombMesh) {
      return;
    }

    if (winReason === 'bomb_detonated') {
      this.bombMesh.scale.setScalar(1.9);
      this.bombMesh.rotation.y += 0.04;
    }
  }

  private announceRoundOutcome(roundWinner: string | null, winReason: string | null): void {
    const outcomeKey = `${roundWinner ?? 'none'}:${winReason ?? 'none'}`;
    if (this.lastRoundOutcomeKey === outcomeKey) {
      return;
    }
    this.lastRoundOutcomeKey = outcomeKey;

    if (roundWinner === 'attackers') {
      const text = winReason === 'bomb_detonated'
        ? 'Bomb exploded. Terrorists won.'
        : 'Terrorists won.';
      this.gameHUD.showNotification(text, 5);
      return;
    }

    if (roundWinner === 'defenders') {
      this.gameHUD.showNotification('Counter-Terrorists won.', 5);
    }
  }

  private resetBombPresentation(): void {
    if (this.bombMesh) {
      Engine.getEngineScene()?.remove(this.bombMesh);
      this.disposeObject(this.bombMesh);
      this.bombMesh = null;
    }

    this.bombController = null;
    this.bombRouteInitialized = false;
    this.previousBombPosition = null;
    this.previousBombPositionTimeMs = 0;
  }

  private ensureRouteDebugVisuals(): void {
    if (this.routeDebugGroup) {
      return;
    }

    const scene = Engine.getEngineScene();
    if (!scene) {
      return;
    }

    const group = new THREE.Group();
    group.name = 'DriftBombDebugRoute';

    for (const site of this.objectiveSystem.getBombSites()) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8 }),
      );
      marker.position.set(site.position.x, site.position.y + 0.12, site.position.z);
      group.add(marker);
    }

    for (const route of this.objectiveSystem.getDriftRoutes()) {
      const points = route.waypoints
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((wp) => new THREE.Vector3(wp.x, wp.y + 0.2, wp.z));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.8 }),
      );
      group.add(line);

      for (const wp of route.waypoints) {
        const waypointMarker = new THREE.Mesh(
          new THREE.SphereGeometry(0.2, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x8ef9f3, transparent: true, opacity: 0.9 }),
        );
        waypointMarker.position.set(wp.x, wp.y + 0.2, wp.z);
        group.add(waypointMarker);
      }
    }

    this.tetherDebugMesh = new THREE.Mesh(
      new THREE.RingGeometry(14.8, 15.1, 64),
      new THREE.MeshBasicMaterial({ color: 0xff5e5e, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    this.tetherDebugMesh.rotation.x = -Math.PI / 2;
    this.tetherDebugMesh.visible = false;
    group.add(this.tetherDebugMesh);

    scene.add(group);
    this.routeDebugGroup = group;
  }

  private disposeRouteDebugVisuals(): void {
    if (!this.routeDebugGroup) {
      return;
    }
    Engine.getEngineScene()?.remove(this.routeDebugGroup);
    this.disposeObject(this.routeDebugGroup);
    this.routeDebugGroup = null;
    this.tetherDebugMesh = null;
  }

  private setRouteDebugVisible(visible: boolean): void {
    if (visible) {
      this.ensureRouteDebugVisuals();
    }
    if (this.routeDebugGroup) {
      this.routeDebugGroup.visible = visible;
    }
  }

  private computeTetherDistance(state: ReturnType<ReturnType<DriftBombMode['getRoundManager']>['getState']>): number {
    if (!state.bombPosition || !state.defusingBy) {
      if (this.tetherDebugMesh) {
        this.tetherDebugMesh.visible = false;
      }
      return 0;
    }

    const defuserPos = Engine.getEntityManager()?.getEntity(state.defusingBy)?.getPosition();
    if (!defuserPos) {
      if (this.tetherDebugMesh) {
        this.tetherDebugMesh.visible = false;
      }
      return 0;
    }

    if (this.tetherDebugMesh) {
      this.tetherDebugMesh.visible = this.debugDriftRouteVisible;
    }
    const distance = Math.sqrt(this.distanceSquared(defuserPos, state.bombPosition));
    return Math.round(distance * 100) / 100;
  }

  private estimateDriftVelocity(bombPosition: { x: number; y: number; z: number } | null): number {
    if (!bombPosition) {
      this.previousBombPosition = null;
      this.previousBombPositionTimeMs = 0;
      return 0;
    }

    const now = performance.now();
    if (!this.previousBombPosition || this.previousBombPositionTimeMs <= 0) {
      this.previousBombPosition = { ...bombPosition };
      this.previousBombPositionTimeMs = now;
      return 0;
    }

    const dt = Math.max(0.001, (now - this.previousBombPositionTimeMs) / 1000);
    const distance = Math.sqrt(this.distanceSquared(this.previousBombPosition, bombPosition));
    const velocity = distance / dt;

    this.previousBombPosition = { ...bombPosition };
    this.previousBombPositionTimeMs = now;

    return Math.round(velocity * 100) / 100;
  }

  private resolvePhysicsBackendMode(): PhysicsBackendMode {
    const physicsSystem = Engine.getSystemRegistry()?.getSystem<any>('physicsSystem');
    if (physicsSystem && typeof physicsSystem.getBackendMode === 'function') {
      return physicsSystem.getBackendMode() as PhysicsBackendMode;
    }
    const globalBackend = (globalThis as any).__physicsBackend;
    return globalBackend === 'rapier' ? 'rapier' : 'legacy';
  }

  private togglePhysicsBackendLive(): void {
    const physicsSystem = Engine.getSystemRegistry()?.getSystem<any>('physicsSystem');
    const current = this.resolvePhysicsBackendMode();
    const next: PhysicsBackendMode = current === 'rapier' ? 'legacy' : 'rapier';

    (globalThis as any).__physicsBackend = next;
    if (physicsSystem && typeof physicsSystem.switchBackend === 'function') {
      physicsSystem.switchBackend(next);
    }

    this.gameHUD.showNotification(`Physics backend: ${next.toUpperCase()}`, 2);
    console.log('[DriftBombDebug] physics backend switched', { from: current, to: next });
  }

  private teleportLocalPlayerToBomb(rm: ReturnType<DriftBombMode['getRoundManager']>): void {
    const state = rm.getState();
    if (!state.bombPosition) {
      this.gameHUD.showNotification('No active bomb position to teleport to.', 2);
      return;
    }
    const entity = Engine.getEntityManager()?.getEntity(this.localPlayerId);
    if (!entity) {
      this.gameHUD.showNotification('Local player entity missing.', 2);
      return;
    }
    entity.setPosition({
      x: state.bombPosition.x,
      y: state.bombPosition.y,
      z: state.bombPosition.z + 1.5,
    });
    this.gameHUD.showNotification('Teleported to bomb.', 2);
  }

  private dumpRuntimeSnapshot(rm: ReturnType<DriftBombMode['getRoundManager']>): void {
    const snapshot = {
      phase: rm.getPhase(),
      frame: rm.getFrameCounter(),
      phaseTimeRemaining: rm.getPhaseTimeRemaining(),
      backendMode: this.resolvePhysicsBackendMode(),
      state: rm.getState(),
      debug: this.stateManager.getRaw('driftBomb.debug') ?? null,
    };
    console.log('[DriftBombDebug] Runtime snapshot', snapshot);
    this.gameHUD.showNotification('Runtime snapshot dumped to console.', 2);
  }

  private resolveListenerCount(): number {
    const bus = gameBus as any;
    const directCount = typeof bus.listenerCount === 'function'
      ? bus.listenerCount()
      : null;
    if (typeof directCount === 'number') {
      return directCount;
    }
    const events = bus.events;
    if (events && typeof events === 'object') {
      return Object.values(events)
        .reduce((sum: number, value: unknown) => {
          if (Array.isArray(value)) {
            return sum + value.length;
          }
          return sum;
        }, 0);
    }
    return 0;
  }

  private resolveQueuePressure(): number {
    const diagnostics = this.stateManager.getRaw('diagnostics.queue');
    if (typeof diagnostics === 'number') {
      return diagnostics;
    }
    if (diagnostics && typeof diagnostics === 'object') {
      const size = (diagnostics as { pending?: unknown }).pending;
      if (typeof size === 'number') {
        return size;
      }
    }
    return 0;
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material?.dispose?.();
      }
    });
  }

  private distanceSquared(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return (dx * dx) + (dy * dy) + (dz * dz);
  }
}
