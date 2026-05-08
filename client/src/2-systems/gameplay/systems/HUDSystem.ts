/**
 * HUDSystem
 * DOM-based minimal HUD for health, ammo, debug info, and player list.
 * Integrates with HealthSystem, WeaponSystem, and StateManager subscriptions.
 *
 * Now supports mode-aware rendering:
 *   'play'      — health bar, ammo, crosshair, round timer, kill count
 *   'editor'    — editor mode badge, entity count, no crosshair/health
 *   'spectator' — spectating banner, free-cam hint, no health/ammo
 *   'hidden'    — nothing rendered
 *
 * Usage:
 *   import { HUDSystem } from './systems/HUDSystem';
 *
 *   const hud = new HUDSystem({ health, weapons });
 *   hud.mount();
 *   hud.setPlayerId('player_01');
 *   hud.setPlayerMode('play');
 *   onUpdate((dt) => hud.update(dt));
 *   hud.show();
 */

import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { OGUI } from '../../../4-runtime/ui/OGUITheme';
import type { TropicalHorrorArchetypeDefinition } from '@engine/2-systems/ArchetypeDefinitions';

interface HealthSystemAdapter {
  getHpFraction(entityId: string): number;
  getHp(entityId: string): number;
  getShield(entityId: string): number;
  getShieldFraction(entityId: string): number;
  getMaxShield(entityId: string): number;
}

interface WeaponDefinitionAdapter {
  name?: string;
}

interface WeaponSystemAdapter {
  getCurrentAmmo(playerId: string): number;
  getReserveAmmo(playerId: string): number;
  isReloading(playerId: string): boolean;
  getEquipped(playerId: string): string | undefined;
  getDefinition(id: string): WeaponDefinitionAdapter | undefined;
}

interface StateManagerAdapter {
  subscribe(path: string, callback: (value?: unknown) => void): () => void;
  get?(path: string): unknown;
  getRaw?(path: string): unknown;
  set?(path: string, value: unknown): void | boolean;
}

export type PlayerHUDMode = 'play' | 'editor' | 'spectator' | 'hidden' | 'loading';

// ─── HUD config ───────────────────────────────────────────────────────────────

export interface HUDConfig {
  health?:         HealthSystemAdapter;
  weapons?:        WeaponSystemAdapter;
  stateManager?:   StateManagerAdapter;
  kernelAdapter?:  any; // Kernel movement integration adapter
  /** Show debug overlay (entity count, FPS). Default false. */
  showDebug?:      boolean;
  /** Initial player mode. Default 'play'. */
  playerMode?:     PlayerHUDMode;
  /** PS1-style color palette for UI elements. */
  theme?: Partial<HUDTheme>;
}

interface HUDTheme {
  healthFull:  string;
  healthMid:   string;
  healthLow:   string;
  text:        string;
  background:  string;
  accent:      string;
  panel:       string;
  border:      string;
  shadow:      string;
  damageFlash: string;
  crosshair:   string;
  notification:string;
  atmosphere:  string;
}

const DEFAULT_THEME: HUDTheme = {
  healthFull: OGUI.hpFull,
  healthMid:  OGUI.hpMid,
  healthLow:  OGUI.hpLow,
  text:       OGUI.textPri,
  background: OGUI.bgBase,
  accent:     OGUI.hpLow,
  panel:      OGUI.bgPanel,
  border:     OGUI.borderDim,
  shadow:     'rgba(0, 0, 0, 0.8)',
  damageFlash: OGUI.dmgFlash,
  crosshair:  OGUI.textPri,
  notification: OGUI.textPri,
  atmosphere: 'transparent',
};

// ─── HUDSystem ────────────────────────────────────────────────────────────────

export class HUDSystem {
  private health:       HealthSystemAdapter | null;
  private weapons:      WeaponSystemAdapter | null;
  private stateManager: StateManagerAdapter | null;
  private theme:        HUDTheme;
  private playerId:     string        = 'player';
  private showDebug:    boolean;
  private systemContext: SystemContext | null = null;
  private archetypeName = '';
  private archetypeTitle = '';

  // Mode state
  private playerMode:         PlayerHUDMode = 'play';
  private roundNumber:        number = 0;
  private kills:              number = 0;
  private deaths:             number = 0;
  private roundTimeRemaining: number = 0;  // seconds
  private killLimit:          number = 0;
  private waveStatusText:     string = '';
  private enemiesRemaining:   number | null = null;
  private isHordeModeActive:  boolean = false;
  private spectatingName:     string = '';
  private entityCount:        number = 0;
  private team:               'none' | 'red' | 'blue' = 'none';
  private playerName:         string = '';

  // DOM
  private root:             HTMLDivElement | null = null;
  private atmosphereEl:     HTMLDivElement | null = null;
  private healthBar:        HTMLDivElement | null = null;
  private healthFill:       HTMLDivElement | null = null;
  private shieldBar:        HTMLDivElement | null = null;
  private shieldFill:       HTMLDivElement | null = null;
  private healthText:       HTMLDivElement | null = null;
  private healthAreaEl:     HTMLDivElement | null = null;
  private ammoEl:           HTMLDivElement | null = null;
  private ammoAreaEl:       HTMLDivElement | null = null;
  private weaponNameEl:     HTMLDivElement | null = null;
  private reloadingEl:      HTMLDivElement | null = null;
  private debugEl:          HTMLDivElement | null = null;
  private crosshairEl:      HTMLDivElement | null = null;
  private damageFlashEl:    HTMLDivElement | null = null;
  private playerListEl:     HTMLDivElement | null = null;
  private notificationEl:   HTMLDivElement | null = null;
  private archetypeBadgeEl: HTMLDivElement | null = null;

  // Mode-specific layers
  private playLayerEl:       HTMLDivElement | null = null;  // round timer + kills (top-centre)
  private editorBadgeEl:     HTMLDivElement | null = null;  // editor mode badge (top-left)
  private spectatorBannerEl: HTMLDivElement | null = null;  // spectating banner (centre-top)
  private teamBarEl:         HTMLDivElement | null = null;  // team colour bar (bottom health area)
  private timerEl:           HTMLDivElement | null = null;
  private roundInfoEl:       HTMLDivElement | null = null;
  private enemyInfoEl:       HTMLDivElement | null = null;

  private visible:           boolean = false;
  private mounted:           boolean = false;

  // State
  private fps:               number = 0;
  private fpsTimer:          number = 0;
  private frameCount:        number = 0;
  private damageFlashTimer:  number = 0;
  private notificationTimer: number = 0;
  private hudSyncAccumulator: number = 0;
  private debugSyncAccumulator: number = 0;

  // Unsubscribe handles
  private unsubs: Array<() => void> = [];

  constructor(config: HUDConfig = {}) {
    this.health       = config.health       ?? null;
    this.weapons      = config.weapons      ?? null;
    this.stateManager = config.stateManager ?? null;
    this.showDebug    = config.showDebug    ?? false;
    this.playerMode   = config.playerMode   ?? (this.stateManager ? 'hidden' : 'play');
    this.theme        = { ...DEFAULT_THEME, ...(config.theme ?? {}) };
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.health = (ctx.systems.healthSystem as HealthSystemAdapter | undefined) ?? this.health;
    this.weapons = (ctx.systems.weaponSystem as WeaponSystemAdapter | undefined) ?? this.weapons;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: this.visible,
      metrics: {
        hasSystemContext: this.systemContext !== null,
        mounted: this.mounted,
        visible: this.visible,
        playerMode: this.playerMode,
        playerId: this.playerId,
      },
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  mount(): void {
    if (this.mounted) return;
    this._buildDOM();
    this._attachStateSubscriptions();
    this.mounted = true;
  }

  unmount(): void {
    if (!this.mounted || !this.root) return;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    document.body.removeChild(this.root);
    this.root = null;
    this.mounted = false;
  }

  show(): void {
    this._applyVisibilityState(true);
  }

  hide(): void {
    this._applyVisibilityState(false);
  }

  isVisible(): boolean {
    return this.visible;
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  setPlayerId(id: string): void {
    if (this.playerId === id) return;
    this.playerId = id;
    this._resetStateSubscriptions();
    this._updateHealth();
    this._updateAmmo();
  }

  getPlayerId(): string {
    return this.playerId;
  }

  setGameplaySystems(health: HealthSystemAdapter | null, weapons: WeaponSystemAdapter | null): void {
    this.health = health;
    this.weapons = weapons;
  }

  setDebugVisible(show: boolean): void {
    this.showDebug = show;
    if (this.debugEl) this.debugEl.style.display = show ? 'block' : 'none';
  }

  setTheme(theme: Partial<HUDTheme>): void {
    this.theme = { ...this.theme, ...theme };
    this._applyTheme();
  }

  setArchetypePresentation(archetype: TropicalHorrorArchetypeDefinition): void {
    this.archetypeName = archetype.displayName;
    this.archetypeTitle = archetype.title;
    this.theme = { ...DEFAULT_THEME, ...archetype.hudTheme };
    this._applyTheme();
  }

  // ─── Mode API ──────────────────────────────────────────────────────────────

  /** Switch the HUD rendering mode. Hides/shows layers accordingly. */
  setPlayerMode(mode: PlayerHUDMode): void {
    this._applyPlayerModeState(mode);
  }

  getPlayerMode(): PlayerHUDMode {
    return this.playerMode;
  }

  /** Push live round data for the play-mode timer / round status. */
  setRoundState(timeRemainingMs: number, killLimit: number, kills: number, deaths: number, roundNumber: number = 0): void {
    if (this.isHordeModeActive) return; // horde manages its own HUD via hordeWaveState events
    this.roundTimeRemaining = timeRemainingMs / 1000;
    this.roundNumber = roundNumber;
    this.killLimit = killLimit;
    this.kills = kills;
    this.deaths = deaths;
    this._updatePlayLayer();
  }

  /** Set the name shown in spectator mode. */
  setSpectatingTarget(name: string): void {
    this.spectatingName = name;
    this._updateSpectatorBanner();
  }

  /** Set entity count shown in editor mode badge. */
  setEntityCount(count: number): void {
    this.entityCount = count;
    this._updateEditorBadge();
  }

  /** Set the local player's team ('none' | 'red' | 'blue'). */
  setTeam(team: 'none' | 'red' | 'blue'): void {
    this.team = team;
    this._updateTeamBar();
  }

  /** Set the local player's display name. */
  setPlayerName(name: string): void {
    this.playerName = name;
  }

  // ─── Per-frame update ──────────────────────────────────────────────────────

  update(deltaTime: number): void {
    if (!this.visible || !this.mounted) return;
    const dt = Math.min(deltaTime, 0.2);
    this.hudSyncAccumulator += dt;
    this.debugSyncAccumulator += dt;

    // FPS counter
    this.fpsTimer  += dt;
    this.frameCount++;
    if (this.fpsTimer >= 0.5) {
      this.fps        = Math.round(this.frameCount / this.fpsTimer);
      this.fpsTimer   = 0;
      this.frameCount = 0;
    }

    // Tick round timer in play mode
    if (this.playerMode === 'play' && this.roundTimeRemaining > 0) {
      this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - dt);
    }

    if (this.hudSyncAccumulator >= 0.1) {
      this.hudSyncAccumulator = 0;
      if (this.playerMode === 'play' && this.roundTimeRemaining >= 0) {
        this._updatePlayLayer();
      }
      if (this.playerMode === 'play' || this.playerMode === 'spectator') {
        this._updateHealth();
        this._updateAmmo();
      }
    }

    if (this.debugSyncAccumulator >= 0.25) {
      this.debugSyncAccumulator = 0;
      this._updateDebug();
    }

    this._tickDamageFlash(dt);
    this._tickNotification(dt);
  }

  // ─── Manual data pushes ────────────────────────────────────────────────────

  /** Flash a red vignette to indicate the player took damage. */
  flashDamage(intensity: number = 1): void {
    this.damageFlashTimer = 0.35 * intensity;
    if (this.damageFlashEl) {
      this.damageFlashEl.style.opacity = String(Math.min(1, intensity));
      this.damageFlashEl.style.display = 'block';
    }
  }

  /** Show a temporary notification message (kill, pickup, etc.). */
  showNotification(text: string, durationSeconds: number = 3): void {
    if (!this.notificationEl) return;
    this.notificationEl.textContent = text;
    this.notificationEl.style.opacity = '1';
    this.notificationTimer = durationSeconds;
  }

  /** Update the multiplayer/team player list. */
  setPlayerList(players: Array<{ name: string; hp: number; team?: number }>): void {
    if (!this.playerListEl) return;
    this.playerListEl.innerHTML = players.map((p) => {
      const hpColor = p.hp > 60 ? this.theme.healthFull : p.hp > 30 ? this.theme.healthMid : this.theme.healthLow;
      return `<div style="color:${hpColor};font-size:10px;margin:1px 0;letter-spacing:0.5px;">${p.name}  <span style="font-size:9px;color:${this.theme.text}">${p.hp}hp</span></div>`;
    }).join('');
  }

  setDebugInfo(info: Record<string, string | number>): void {
    if (!this.debugEl || !this.showDebug) return;
    const lines = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('<br>');
    this.debugEl.innerHTML = `FPS: ${this.fps}<br>${lines}`;
  }

  // ─── DOM building ──────────────────────────────────────────────────────────

  private _buildDOM(): void {
    const t = this.theme;

    // Root container
    this.root = this._el('div', {
      position: 'fixed', inset: '0', pointerEvents: 'none',
      zIndex: '1000', fontFamily: OGUI.font,
      display: 'none', userSelect: 'none',
    });

    this.atmosphereEl = this._el('div', {
      position: 'absolute', inset: '0', background: t.atmosphere,
      opacity: '1', mixBlendMode: 'screen',
    });
    this.root.appendChild(this.atmosphereEl);

    // ── Damage flash vignette
    this.damageFlashEl = this._el('div', {
      position: 'absolute', inset: '0',
      background: `radial-gradient(ellipse at center, transparent 40%, ${t.damageFlash} 100%)`,
      opacity: '0', display: 'none', transition: 'opacity 0.08s',
    });
    this.root.appendChild(this.damageFlashEl);

    // ── Crosshair
    this.crosshairEl = this._el('div', {
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '12px', height: '12px',
      border: `1px solid ${t.crosshair}`, borderRadius: '50%',
      boxShadow: `0 0 8px ${t.shadow}`,
    });
    this.root.appendChild(this.crosshairEl);

    // ── Bottom-left: health
    const healthArea = this._el('div', {
      position: 'absolute', bottom: '24px', left: '20px',
      padding: '8px 10px 9px',
      background: t.panel,
      border: `1px solid ${t.border}`,
      boxShadow: `0 0 14px ${t.shadow}`,
    });
    this.healthAreaEl = healthArea;
    healthArea.dataset['hud'] = 'health';

    this.archetypeBadgeEl = this._el('div', {
      color: t.accent,
      fontSize: '10px',
      letterSpacing: '2px',
      marginBottom: '6px',
      textTransform: 'uppercase',
      display: 'none',
    });
    healthArea.appendChild(this.archetypeBadgeEl);

    const hpLabel = this._el('div', {
      color: t.accent, fontSize: '9px', letterSpacing: '2px',
      marginBottom: '4px',
    });
    hpLabel.textContent = 'HEALTH';
    healthArea.appendChild(hpLabel);

    this.healthBar = this._el('div', {
      width: '148px', height: '4px', background: t.background,
      border: `1px solid ${t.border}`, position: 'relative',
    });
    this.healthFill = this._el('div', {
      position: 'absolute', top: '0', left: '0',
      height: '100%', width: '100%',
      background: t.healthFull, transition: 'width 0.12s, background 0.2s',
    });
    this.healthBar.appendChild(this.healthFill);
    healthArea.appendChild(this.healthBar);

    this.shieldBar = this._el('div', {
      width: '148px', height: '3px', background: t.background,
      border: `1px solid ${t.border}`, position: 'relative', marginTop: '3px',
    });
    this.shieldFill = this._el('div', {
      position: 'absolute', top: '0', left: '0',
      height: '100%', width: '0%',
      background: '#22a6d9', transition: 'width 0.12s, opacity 0.12s',
      opacity: '0',
    });
    this.shieldBar.appendChild(this.shieldFill);
    healthArea.appendChild(this.shieldBar);

    this.healthText = this._el('div', {
      color: t.text, fontSize: '17px', fontWeight: 'bold',
      marginTop: '4px', letterSpacing: '1px',
    });
    this.healthText.textContent = '100';
    healthArea.appendChild(this.healthText);

    this.root.appendChild(healthArea);

    // ── Bottom-right: ammo + weapon name
    const ammoArea = this._el('div', {
      position: 'absolute', bottom: '24px', right: '20px', textAlign: 'right',
      padding: '8px 10px 9px',
      background: t.panel,
      border: `1px solid ${t.border}`,
      boxShadow: `0 0 14px ${t.shadow}`,
    });
    this.ammoAreaEl = ammoArea;
    ammoArea.dataset['hud'] = 'ammo';

    this.weaponNameEl = this._el('div', {
      color: t.accent, fontSize: '9px', letterSpacing: '2px',
      marginBottom: '4px',
    });
    this.weaponNameEl.textContent = '';
    ammoArea.appendChild(this.weaponNameEl);

    this.ammoEl = this._el('div', {
      color: t.text, fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px',
    });
    this.ammoEl.textContent = '∞';
    ammoArea.appendChild(this.ammoEl);

    this.reloadingEl = this._el('div', {
      color: t.healthLow, fontSize: '10px', letterSpacing: '3px',
      marginTop: '3px', display: 'none',
    });
    this.reloadingEl.textContent = 'RELOADING...';
    ammoArea.appendChild(this.reloadingEl);

    this.root.appendChild(ammoArea);

    // ── Top-left: debug
    this.debugEl = this._el('div', {
      position: 'absolute', top: '12px', left: '12px',
      color: t.text, fontSize: '10px', lineHeight: '1.4',
      background: t.panel, padding: '5px 8px',
      border: `1px solid ${t.border}`,
      fontFamily: OGUI.font,
      display: this.showDebug ? 'block' : 'none',
      boxShadow: `0 0 12px ${t.shadow}`,
    });
    this.debugEl.textContent = 'FPS: --';
    this.root.appendChild(this.debugEl);

    // ── Top-right: player list
    this.playerListEl = this._el('div', {
      position: 'absolute', top: '12px', right: '12px',
      minWidth: '120px', background: t.panel, padding: '5px 8px',
      border: `1px solid ${t.border}`, fontFamily: OGUI.font,
      boxShadow: `0 0 12px ${t.shadow}`,
    });
    this.root.appendChild(this.playerListEl);

    // ── Centre-top: notification
    this.notificationEl = this._el('div', {
      position: 'absolute', top: '14%', left: '50%',
      transform: 'translateX(-50%)',
      color: t.notification, fontSize: '13px', fontWeight: 'bold',
      letterSpacing: '2px', textShadow: `0 0 12px ${t.shadow}, 0 1px 2px #000`,
      opacity: '0', transition: 'opacity 0.25s',
      textAlign: 'center', fontFamily: OGUI.font,
    });
    this.root.appendChild(this.notificationEl);

    // ── Play layer: round timer + kills (top-centre)
    this.playLayerEl = this._el('div', {
      position: 'absolute', top: '10px', left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '2px', pointerEvents: 'none',
    });
    const timerEl = this._el('div', {
      color: t.text, fontSize: '16px', fontWeight: 'bold',
      letterSpacing: '4px', textShadow: `0 0 8px ${t.shadow}`,
      fontFamily: OGUI.font,
    });
    this.timerEl = timerEl;
    timerEl.id = '_hud_timer';
    this.playLayerEl.appendChild(timerEl);

    const roundInfoEl = this._el('div', {
      color: t.accent, fontSize: '12px', fontWeight: 'bold',
      letterSpacing: '2px', textShadow: `0 0 6px ${t.shadow}`,
      fontFamily: OGUI.font,
    });
    this.roundInfoEl = roundInfoEl;
    roundInfoEl.id = '_hud_roundinfo';
    this.playLayerEl.appendChild(roundInfoEl);

    const enemyInfoEl = this._el('div', {
      color: t.text, fontSize: '10px', letterSpacing: '2px',
      textShadow: `0 0 6px ${t.shadow}`,
      fontFamily: OGUI.font,
    });
    this.enemyInfoEl = enemyInfoEl;
    enemyInfoEl.id = '_hud_enemyinfo';
    this.playLayerEl.appendChild(enemyInfoEl);

    this.root.appendChild(this.playLayerEl);

    // ── Editor badge: top-left mode indicator
    this.editorBadgeEl = this._el('div', {
      position: 'absolute', top: '10px', left: '10px',
      background: t.panel, border: `1px solid ${t.border}`,
      color: t.accent, fontSize: '10px', letterSpacing: '2px',
      padding: '5px 10px', fontFamily: OGUI.font,
      display: 'none',
      boxShadow: `0 0 12px ${t.shadow}`,
    });
    this.editorBadgeEl.innerHTML = `&#9670; EDITOR MODE<br><span id="_hud_entcount" style="color:${t.text};font-size:10px;letter-spacing:1px"></span>`;
    this.root.appendChild(this.editorBadgeEl);

    // ── Spectator banner: centre-top below notification
    this.spectatorBannerEl = this._el('div', {
      position: 'absolute', top: '8%', left: '50%',
      transform: 'translateX(-50%)',
      background: t.panel, border: `1px solid ${t.border}`,
      color: t.text, fontSize: '12px', letterSpacing: '2px',
      padding: '6px 18px', textAlign: 'center',
      fontFamily: OGUI.font, display: 'none',
      boxShadow: `0 0 12px ${t.shadow}`,
    });
    this.root.appendChild(this.spectatorBannerEl);

    // ── Team bar: coloured accent line above health bar
    this.teamBarEl = this._el('div', {
      position: 'absolute', bottom: '60px', left: '20px',
      width: '160px', height: '3px', background: 'transparent',
      transition: 'background 0.3s',
    });
    this.root.appendChild(this.teamBarEl);

    document.body.appendChild(this.root);

    // Apply initial mode
    this._applyTheme();
    this._applyMode();
  }

  // ─── Private update helpers ────────────────────────────────────────────────

  private _updateHealth(): void {
    if (!this.healthFill || !this.healthText) return;

    const stateHp = this._readNumber(`health.${this.playerId}.hp`);
    const stateMaxHp = this._readNumber(`health.${this.playerId}.maxHp`);
    const stateShield = this._readNumber(`health.${this.playerId}.shield`);
    const stateMaxShield = this._readNumber(`health.${this.playerId}.maxShield`);

      // Prefer live HealthSystem adapter data; fall back to state (which may be stale from DODStateBridge)
      const adapterHp = this.health ? this.health.getHp(this.playerId) : null;
      const hp = (adapterHp !== null && adapterHp > 0) ? Math.round(adapterHp) : (stateHp ?? 0);
      const adapterHpFraction = this.health?.getHpFraction(this.playerId) ?? 0;
      const inferredMaxHp = adapterHpFraction > 0 ? hp / adapterHpFraction : hp;
      const resolvedMaxHp = (adapterHp !== null && adapterHp > 0 && adapterHpFraction > 0)
        ? inferredMaxHp
        : (stateMaxHp ?? inferredMaxHp ?? 100);
      const maxHp = Math.max(1, Math.round(resolvedMaxHp));
      const frac = Math.max(0, Math.min(1, hp / maxHp));
      const adapterShield = this.health ? this.health.getShield(this.playerId) : null;
      const shield = adapterShield !== null ? Math.round(adapterShield) : (stateShield ?? 0);
      const adapterMaxShield = this.health ? this.health.getMaxShield(this.playerId) : null;
      const maxShield = Math.max(0, Math.round(
        (adapterMaxShield !== null && adapterMaxShield > 0) ? adapterMaxShield : (stateMaxShield ?? 0)
      ));
    const shieldFrac = maxShield > 0
      ? Math.max(0, Math.min(1, shield / maxShield))
      : (this.health?.getShieldFraction(this.playerId) ?? 0);

    this.healthFill.style.width = `${Math.max(0, frac * 100)}%`;
    this.healthText.textContent  = maxShield > 0
      ? `HP ${hp}  SH ${shield}`
      : `HP ${hp}`;

    if (this.shieldFill) {
      this.shieldFill.style.width = `${Math.max(0, shieldFrac * 100)}%`;
      this.shieldFill.style.opacity = maxShield > 0 ? '1' : '0';
    }
    if (this.shieldBar) {
      this.shieldBar.style.display = maxShield > 0 ? '' : 'none';
    }

    let color = this.theme.healthFull;
    if (frac < 0.5) color = this.theme.healthMid;
    if (frac < 0.25) color = this.theme.healthLow;
    this.healthFill.style.background = color;
    this.healthText.style.color      = color;
  }

  private _updateAmmo(): void {
    if (!this.weapons || !this.ammoEl) return;

    const current = this.weapons.getCurrentAmmo(this.playerId);
    const reserve = this.weapons.getReserveAmmo(this.playerId);
    const reload  = this.weapons.isReloading(this.playerId);
    const equippedId = this.weapons.getEquipped(this.playerId);
    const def = equippedId ? this.weapons.getDefinition(equippedId) : null;

    if (this.weaponNameEl) {
      this.weaponNameEl.textContent = def?.name ?? '';
    }

    if (current === -1) {
      this.ammoEl.textContent = '∞';
    } else {
      const reserveStr = reserve === -1 ? '∞' : String(reserve);
      this.ammoEl.textContent = `${current} / ${reserveStr}`;
    }

    if (this.reloadingEl) {
      this.reloadingEl.style.display = reload ? 'block' : 'none';
    }

    // Tint red when ammo is low
    if (current !== -1 && current <= 3) {
      this.ammoEl.style.color = this.theme.healthLow;
    } else {
      this.ammoEl.style.color = this.theme.text;
    }
  }

  private _updateDebug(): void {
    if (!this.debugEl || !this.showDebug) return;
    this.debugEl.innerHTML = `FPS: ${this.fps}`;
  }

  private _tickDamageFlash(dt: number): void {
    if (!this.damageFlashEl || this.damageFlashTimer <= 0) return;
    this.damageFlashTimer -= dt;
    if (this.damageFlashTimer <= 0) {
      this.damageFlashTimer = 0;
      this.damageFlashEl.style.opacity = '0';
      const el = this.damageFlashEl;
      setTimeout(() => { el.style.display = 'none'; }, 300);
    } else {
      const fade = Math.min(1, this.damageFlashTimer / 0.35);
      this.damageFlashEl.style.opacity = String(fade * 0.85);
    }
  }

  private _tickNotification(dt: number): void {
    if (!this.notificationEl || this.notificationTimer <= 0) return;
    this.notificationTimer -= dt;
    if (this.notificationTimer <= 0) {
      this.notificationEl.style.opacity = '0';
    }
  }

  // ─── Mode helpers ──────────────────────────────────────────────────────────

  private _applyMode(): void {
    if (!this.root) return;
    const isPlay  = this.playerMode === 'play';
    const isEdit  = this.playerMode === 'editor';
    const isSpec  = this.playerMode === 'spectator';
    const isShown = this.playerMode !== 'hidden';

    // Core play elements
    const showPlay = (el: HTMLElement | null, show: boolean) => {
      if (el) el.style.display = show ? '' : 'none';
    };

    showPlay(this.crosshairEl,      isPlay);
    showPlay(this.healthAreaEl,     isPlay);
    showPlay(this.ammoAreaEl,       isPlay);
    showPlay(this.playLayerEl,      isPlay);
    showPlay(this.editorBadgeEl,    isEdit);
    showPlay(this.spectatorBannerEl, isSpec);
    showPlay(this.teamBarEl,        isPlay);
    showPlay(this.playerListEl,     isPlay || isSpec);
    showPlay(this.damageFlashEl,    isPlay || isSpec);
    showPlay(this.atmosphereEl,     isPlay || isSpec);
    showPlay(this.archetypeBadgeEl, isPlay && this.archetypeName.length > 0);

    if (isEdit) this._updateEditorBadge();
    if (isSpec) this._updateSpectatorBanner();
    if (isPlay) { this._updatePlayLayer(); this._updateTeamBar(); }

    if (this.root) this.root.style.display = (isShown && this.visible) ? 'block' : 'none';
  }

  private _updatePlayLayer(): void {
    if (!this.playLayerEl) return;
    const timerEl = this.timerEl;
    const roundInfoEl = this.roundInfoEl;
    const enemyInfoEl = this.enemyInfoEl;

    if (timerEl) {
      const secs  = Math.max(0, Math.ceil(this.roundTimeRemaining));
      const mm    = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss    = String(secs % 60).padStart(2, '0');
      timerEl.textContent = this.roundTimeRemaining > 0 ? `${mm}:${ss}` : '';
    }
    if (roundInfoEl) {
      if (this.isHordeModeActive) {
        roundInfoEl.textContent = this.roundNumber > 0 ? `WAVE ${this.roundNumber}` : 'HORDE';
      } else if (this.roundNumber > 0) {
        roundInfoEl.textContent = `ROUND ${this.roundNumber}`;
      } else {
        roundInfoEl.textContent = '';
      }
    }
    if (enemyInfoEl) {
      if (this.enemiesRemaining !== null) {
        enemyInfoEl.textContent = this.kills > 0
          ? `${this.kills} KILLS  ·  ${this.enemiesRemaining} LEFT`
          : `${this.enemiesRemaining} ENEMIES REMAINING`;
      } else if (this.waveStatusText) {
        enemyInfoEl.textContent = this.kills > 0
          ? `${this.kills} KILLS  ·  ${this.waveStatusText}`
          : this.waveStatusText;
      } else if (this.killLimit > 0) {
        enemyInfoEl.textContent = `${this.kills} / ${this.killLimit} kills`;
      } else {
        enemyInfoEl.textContent = '';
      }
    }
  }

  private _onHordeWaveState(payload: any): void {
    if (!payload || typeof payload !== 'object') return;
    // Mark HUD as in horde mode and suppress the FFA kill-limit counter.
    this.isHordeModeActive = true;
    this.killLimit = 0;
    if (typeof payload.wave === 'number') {
      this.roundNumber = payload.wave;
    }
    if (typeof payload.kills === 'number') {
      this.kills = payload.kills;
    }
    if (typeof payload.enemyCount === 'number') {
      this.enemiesRemaining = payload.enemyCount;
    }
    if (typeof payload.status === 'string') {
      switch (payload.status) {
        case 'waiting_to_start':
          this.waveStatusText = 'Press Z to start Horde';
          break;
        case 'waiting':
          this.waveStatusText = 'Preparing next wave';
          break;
        case 'active':
          this.waveStatusText = 'Wave active';
          break;
        case 'stopped':
          this.waveStatusText = 'Horde ended';
          this.isHordeModeActive = false;
          break;
        case 'victory':
          this.waveStatusText = 'Victory! All waves cleared!';
          break;
        case 'initiated':
          this.waveStatusText = 'Horde launched';
          break;
        default:
          this.waveStatusText = payload.status;
      }
    }
    if (typeof payload.nextWaveIn === 'number') {
      this.waveStatusText = `Next wave in ${Math.ceil(payload.nextWaveIn)}s`;
    }
    // When a wave is actively in progress and enemies are known, clear the
    // generic wave status text so the enemy count line takes priority.
    if (payload.status === 'active' && typeof payload.enemyCount === 'number') {
      this.waveStatusText = '';
    }
    this._updatePlayLayer();
  }

  private _updateEditorBadge(): void {
    if (!this.editorBadgeEl) return;
    const countEl = document.getElementById('_hud_entcount');
    if (countEl) countEl.textContent = `${this.entityCount} entities`;
  }

  private _updateSpectatorBanner(): void {
    if (!this.spectatorBannerEl) return;
    this.spectatorBannerEl.innerHTML = this.spectatingName
      ? `&#128065; SPECTATING  <strong>${this.spectatingName}</strong><br><span style="font-size:10px;color:${this.theme.text};letter-spacing:1px">FREE CAMERA</span>`
      : `&#128065; SPECTATOR MODE<br><span style="font-size:10px;color:${this.theme.text};letter-spacing:1px">FREE CAMERA</span>`;
  }

  private _updateTeamBar(): void {
    if (!this.teamBarEl) return;
    const colors: Record<string, string> = {
      red:  '#cc3322',
      blue: '#2266cc',
      none: this.theme.accent,
    };
    this.teamBarEl.style.background = colors[this.team] ?? 'transparent';
  }

  private _updateArchetypeBadge(): void {
    if (!this.archetypeBadgeEl) return;
    if (!this.archetypeName) {
      this.archetypeBadgeEl.style.display = 'none';
      this.archetypeBadgeEl.textContent = '';
      return;
    }

    this.archetypeBadgeEl.style.display = '';
    this.archetypeBadgeEl.innerHTML = `${this.archetypeName.toUpperCase()}<br><span style="font-size:9px;color:${this.theme.text};letter-spacing:1px">${this.archetypeTitle.toUpperCase()}</span>`;
  }

  private _applyTheme(): void {
    const t = this.theme;

    if (this.atmosphereEl) {
      this.atmosphereEl.style.background = t.atmosphere;
    }
    if (this.damageFlashEl) {
      this.damageFlashEl.style.background = `radial-gradient(ellipse at center, transparent 40%, ${t.damageFlash} 100%)`;
    }
    if (this.crosshairEl) {
      this.crosshairEl.style.border = `1px solid ${t.crosshair}`;
      this.crosshairEl.style.boxShadow = `0 0 8px ${t.shadow}`;
    }

    [
      this.healthAreaEl,
      this.ammoAreaEl,
      this.debugEl,
      this.playerListEl,
      this.editorBadgeEl,
      this.spectatorBannerEl,
    ].forEach((panel) => {
      if (!panel) return;
      panel.style.background = t.panel;
      panel.style.border = `1px solid ${t.border}`;
      panel.style.boxShadow = `0 0 12px ${t.shadow}`;
    });

    if (this.healthBar) {
      this.healthBar.style.background = t.background;
      this.healthBar.style.border = `1px solid ${t.border}`;
    }
    if (this.shieldBar) {
      this.shieldBar.style.background = t.background;
      this.shieldBar.style.border = `1px solid ${t.border}`;
    }
    if (this.weaponNameEl) {
      this.weaponNameEl.style.color = t.accent;
    }
    if (this.notificationEl) {
      this.notificationEl.style.color = t.notification;
      this.notificationEl.style.textShadow = `0 0 12px ${t.shadow}, 0 1px 2px #000`;
    }
    if (this.timerEl) {
      this.timerEl.style.color = t.text;
      this.timerEl.style.textShadow = `0 0 8px ${t.shadow}`;
    }
    if (this.roundInfoEl) {
      this.roundInfoEl.style.color = t.accent;
      this.roundInfoEl.style.textShadow = `0 0 6px ${t.shadow}`;
    }
    if (this.enemyInfoEl) {
      this.enemyInfoEl.style.color = t.text;
      this.enemyInfoEl.style.textShadow = `0 0 6px ${t.shadow}`;
    }
    if (this.editorBadgeEl) {
      this.editorBadgeEl.style.color = t.accent;
    }

    this._updateArchetypeBadge();
    this._updateHealth();
    this._updateAmmo();
    this._updateTeamBar();
  }

  private _resetStateSubscriptions(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    if (this.mounted) {
      this._attachStateSubscriptions();
    }
  }

  private _attachStateSubscriptions(): void {
    // Re-register gameBus subscriptions (these must survive setPlayerId resets).
    this.unsubs.push(gameBus.on('hordeWaveState', this._onHordeWaveState.bind(this)));
    this.unsubs.push(gameBus.on('gameModeStarted', (payload) => {
      const wasHorde = this.isHordeModeActive;
      this.isHordeModeActive = payload.modeName === 'horde';
      if (wasHorde !== this.isHordeModeActive) {
        if (!this.isHordeModeActive) {
          // Leaving horde — reset horde-only state.
          this.enemiesRemaining = null;
          this.waveStatusText = '';
          this.kills = 0;
          this.roundNumber = 0;
        }
        this._updatePlayLayer();
      }
    }));

    if (!this.stateManager) return;
    const refreshHealth = () => this._updateHealth();
    this.unsubs.push(this.stateManager.subscribe(`health.${this.playerId}.hp`, refreshHealth));
    this.unsubs.push(this.stateManager.subscribe(`health.${this.playerId}.maxHp`, refreshHealth));
    this.unsubs.push(this.stateManager.subscribe(`health.${this.playerId}.shield`, refreshHealth));
    this.unsubs.push(this.stateManager.subscribe(`health.${this.playerId}.maxShield`, refreshHealth));
    this.unsubs.push(this.stateManager.subscribe('ui.hud.mode', (value) => {
      this._applyPlayerModeState(this._normalizePlayerMode(value));
    }));
    this.unsubs.push(this.stateManager.subscribe('hud.visible', (value) => {
      this._applyVisibilityState(Boolean(value));
    }));

    const currentMode = this._readStateValue('ui.hud.mode');
    if (currentMode !== undefined) {
      this._applyPlayerModeState(this._normalizePlayerMode(currentMode));
    }
    const currentVisible = this._readStateValue('hud.visible');
    if (typeof currentVisible === 'boolean') {
      this._applyVisibilityState(currentVisible);
    }
  }

  private _applyPlayerModeState(mode: PlayerHUDMode): void {
    if (this.playerMode === mode) return;
    this.playerMode = mode;
    this._applyMode();
    gameBus.emit('stateMutation', {
      source: 'hudSystem',
      path: 'ui.hud.mode',
      changedCount: 1,
    });
  }

  private _applyVisibilityState(visible: boolean): void {
    this.visible = visible;
    if (this.root) {
      this.root.style.display = (visible && this.playerMode !== 'hidden') ? 'block' : 'none';
    }
    gameBus.emit('stateMutation', {
      source: 'hudSystem',
      path: 'hud.visible',
      changedCount: 1,
    });
  }

  private _normalizePlayerMode(value: unknown): PlayerHUDMode {
    switch (value) {
      case 'play':
      case 'editor':
      case 'spectator':
      case 'hidden':
        return value;
      default:
        return 'hidden';
    }
  }

  private _readNumber(path: string): number | null {
    const value = this._readStateValue(path);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private _readStateValue(path: string): unknown {
    if (!this.stateManager) return undefined;
    if (typeof this.stateManager.getRaw === 'function') {
      return this.stateManager.getRaw(path);
    }
    if (typeof this.stateManager.get === 'function') {
      return this.stateManager.get(path);
    }
    return undefined;
  }

  // ─── DOM helper ───────────────────────────────────────────────────────────

  private _el(tag: string, styles: Partial<CSSStyleDeclaration>): HTMLDivElement {
    const el = document.createElement(tag) as HTMLDivElement;
    Object.assign(el.style, styles);
    return el;
  }
}
