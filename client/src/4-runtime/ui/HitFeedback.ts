/**
 * HitFeedback
 * Lightweight client-side visual & audio feedback for combat events.
 *
 * Features:
 *  - Hit-marker (crosshair flash) when a shot connects
 *  - Kill-confirm (different colour hit-marker) on a kill
 *  - Damage-taken indicator (screen edge flash + numeric popup)
 *  - Death overlay (full-screen red vignette + text)
 *  - Kill-confirm banner (top-centre "YOU KILLED <name>")
 *  - Screen shake (camera position offset that damps to zero)
 *  - All DOM elements are created once and reused; mount() / destroy() manage them
 */

import * as THREE from 'three';
import * as Engine from '@engine/0-foundation/foundation/Engine';
import { getCameraStateAdapter } from '../../2-systems/camera/CameraStateAdapter';
import { OGUI } from './OGUITheme';

export interface HitFeedbackConfig {
  hitMarkerColor?: string;      // default '#ff2200'
  killMarkerColor?: string;     // default '#ffdd00'
  hitMarkerDuration?: number;   // ms, default 120
  screenShakeIntensity?: number;// world units, default 0.05
  screenShakeDuration?: number; // ms, default 180
  enableLogging?: boolean;
}

export interface DeathScreenActions {
  onRespawnWaveOne?: () => void;
  onMainMenu?: () => void;
}

type DamageDirection = 'front' | 'back' | 'left' | 'right';

// ─── HitFeedback ─────────────────────────────────────────────────────────────

export class HitFeedback {
  private cfg: Required<HitFeedbackConfig>;

  // DOM elements
  private container: HTMLElement | null = null;
  private hitMarkerEl: HTMLElement | null = null;
  private damageFlashEl: HTMLElement | null = null;
  private deathOverlayEl: HTMLElement | null = null;
  private killBannerEl: HTMLElement | null = null;
  private damageLabelEl: HTMLElement | null = null;
  private crosshairEl: HTMLElement | null = null;
  private damageDirectionEls: Partial<Record<DamageDirection, HTMLElement>> = {};
  private damageDirectionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Screen shake state
  private shakeIntensity = 0;
  private shakeDecay = 0;
  private shakeOffset = new THREE.Vector3();
  private shaking = false;
  private readonly shakeChannel = 'hit-feedback-shake';

  private hitMarkerTimeout: ReturnType<typeof setTimeout> | null = null;
  private killBannerTimeout: ReturnType<typeof setTimeout> | null = null;
  private deathTimeout: ReturnType<typeof setTimeout> | null = null;
  private damageLabelTimeout: ReturnType<typeof setTimeout> | null = null;
  private deathScreenActions: DeathScreenActions | null = null;
  private deathActionLocked = false;

  constructor(config: HitFeedbackConfig = {}) {
    this.cfg = {
      hitMarkerColor: config.hitMarkerColor ?? OGUI.hitFlash,
      killMarkerColor: config.killMarkerColor ?? OGUI.killFlash,
      hitMarkerDuration: config.hitMarkerDuration ?? 120,
      screenShakeIntensity: config.screenShakeIntensity ?? 0.05,
      screenShakeDuration: config.screenShakeDuration ?? 180,
      enableLogging: config.enableLogging ?? false,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  mount(camera?: THREE.PerspectiveCamera): void {
    if (this.container) return;
    void camera;

    this.container = document.createElement('div');
    this.container.id = 'hit-feedback-root';
    Object.assign(this.container.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '8000',
    });

    this._buildCrosshair();
    this._buildHitMarker();
    this._buildDamageFlash();
    this._buildDamageDirectionIndicators();
    this._buildDeathOverlay();
    this._buildKillBanner();
    this._buildDamageLabel();

    document.body.appendChild(this.container);
  }

  destroy(): void {
    getCameraStateAdapter()?.clearPositionOffset(this.shakeChannel);
    this.container?.remove();
    this.container = null;
    this.hitMarkerEl = null;
    this.damageFlashEl = null;
    this.deathOverlayEl = null;
    this.killBannerEl = null;
    this.damageLabelEl = null;
    this.crosshairEl = null;
    this.damageDirectionEls = {};
  }

  // ─── Public triggers ────────────────────────────────────────────────────────

  /** Flash hit-marker. Pass `isKill = true` for gold colour. */
  showHitMarker(isKill: boolean): void {
    if (!this.hitMarkerEl) return;

    const color = isKill ? this.cfg.killMarkerColor : this.cfg.hitMarkerColor;
    this.hitMarkerEl.style.opacity = '1';
    this.hitMarkerEl.style.color = color;

    if (this.hitMarkerTimeout) clearTimeout(this.hitMarkerTimeout);
    this.hitMarkerTimeout = setTimeout(() => {
      if (this.hitMarkerEl) this.hitMarkerEl.style.opacity = '0';
    }, this.cfg.hitMarkerDuration);
  }

  /** Show damage taken — screen-edge flash + numeric label. */
  showDamageTaken(amount: number, options?: { direction?: DamageDirection | null }): void {
    // Red edge flash
    if (this.damageFlashEl) {
      this.damageFlashEl.style.opacity = '0.55';
      requestAnimationFrame(() => {
        if (this.damageFlashEl) {
          this.damageFlashEl.style.transition = 'opacity 0.4s ease';
          this.damageFlashEl.style.opacity = '0';
        }
      });
    }

    // Numeric popup
    if (this.damageLabelEl) {
      this.damageLabelEl.textContent = `-${Math.round(amount)}`;
      this.damageLabelEl.style.opacity = '1';
      this.damageLabelEl.style.transform = 'translate(-50%, 0)';

      if (this.damageLabelTimeout) clearTimeout(this.damageLabelTimeout);
      this.damageLabelTimeout = setTimeout(() => {
        if (this.damageLabelEl) {
          this.damageLabelEl.style.opacity = '0';
          this.damageLabelEl.style.transform = 'translate(-50%, -24px)';
        }
      }, 800);
    }

    this._showDamageDirection(options?.direction ?? null);

    // Camera shake on damage
    this._triggerShake(this.cfg.screenShakeIntensity * 1.5);
  }

  /** Flash kill-confirm hit-marker (gold) and show banner. */
  showKillConfirm(targetId: string): void {
    this.showHitMarker(true);
    this._showKillBanner(`ENEMY ELIMINATED`);
  }

  /** Show full-screen death overlay. */
  showDeathScreen(killedById: string): void {
    if (!this.deathOverlayEl) return;
    const hasActions = Boolean(this.deathScreenActions?.onRespawnWaveOne || this.deathScreenActions?.onMainMenu);
    this.deathActionLocked = false;

    if (hasActions) {
      this.deathOverlayEl.innerHTML =
        `<div style="font-size:32px;letter-spacing:6px;color:${OGUI.deathText};">YOU DIED</div>` +
        `<div style="font-size:12px;margin-top:10px;color:${OGUI.hpLow};">by ${killedById}</div>` +
        `<div style="display:flex;gap:12px;margin-top:22px;pointer-events:auto;">` +
          `<button data-death-action="respawn" style="padding:10px 14px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;letter-spacing:0.8px;cursor:pointer;">RESPAWN WAVE 1</button>` +
          `<button data-death-action="menu" style="padding:10px 14px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);color:${OGUI.textPri};font-family:${OGUI.font};font-size:11px;letter-spacing:0.8px;cursor:pointer;">MAIN MENU</button>` +
        `</div>`;

      const respawnButton = this.deathOverlayEl.querySelector('[data-death-action="respawn"]') as HTMLButtonElement | null;
      const menuButton = this.deathOverlayEl.querySelector('[data-death-action="menu"]') as HTMLButtonElement | null;

      respawnButton?.addEventListener('click', () => {
        if (this.deathActionLocked) return;
        this.deathActionLocked = true;
        this.deathScreenActions?.onRespawnWaveOne?.();
      });

      menuButton?.addEventListener('click', () => {
        if (this.deathActionLocked) return;
        this.deathActionLocked = true;
        this.deathScreenActions?.onMainMenu?.();
      });
    } else {
      this.deathOverlayEl.innerHTML =
        `<div style="font-size:32px;letter-spacing:6px;color:${OGUI.deathText};">YOU DIED</div>` +
        `<div style="font-size:12px;margin-top:10px;color:${OGUI.hpLow};">by ${killedById}</div>` +
        `<div style="font-size:10px;margin-top:18px;color:${OGUI.textDim};letter-spacing:2px;">RESPAWNING...</div>`;
    }

    this.deathOverlayEl.style.opacity = '1';
    this.deathOverlayEl.style.pointerEvents = hasActions ? 'auto' : 'none';

    this._triggerShake(this.cfg.screenShakeIntensity * 3);

    if (this.deathTimeout) clearTimeout(this.deathTimeout);
    if (!hasActions) {
      this.deathTimeout = setTimeout(() => {
        if (this.deathOverlayEl) {
          this.deathOverlayEl.style.transition = 'opacity 1s ease';
          this.deathOverlayEl.style.opacity = '0';
        }
      }, 2500);
    }
  }

  /** Hide death overlay (e.g. on respawn). */
  hideDeathScreen(): void {
    if (!this.deathOverlayEl) return;
    this.deathOverlayEl.style.opacity = '0';
    this.deathOverlayEl.style.pointerEvents = 'none';
    this.deathActionLocked = false;
    if (this.deathTimeout) {
      clearTimeout(this.deathTimeout);
      this.deathTimeout = null;
    }
  }

  setDeathActions(actions: DeathScreenActions | null): void {
    this.deathScreenActions = actions;
  }

  /** Show / hide persistent crosshair. */
  setCrosshairVisible(visible: boolean): void {
    if (this.crosshairEl) this.crosshairEl.style.display = visible ? 'block' : 'none';
  }

  // ─── Per-frame update (screen shake) ────────────────────────────────────────

  update(deltaTime: number): void {
    const cameraAdapter = getCameraStateAdapter();
    if (!this.shaking || !cameraAdapter) return;

    this.shakeIntensity -= this.shakeDecay * deltaTime;

    if (this.shakeIntensity <= 0) {
      this.shakeIntensity = 0;
      this.shaking = false;
      this.shakeOffset.set(0, 0, 0);
      cameraAdapter.clearPositionOffset(this.shakeChannel);
      return;
    }

    this.shakeOffset.set(
      (Engine.random.next() - 0.5) * 2 * this.shakeIntensity,
      (Engine.random.next() - 0.5) * 2 * this.shakeIntensity,
      0,
    );
    cameraAdapter.setPositionOffset(this.shakeChannel, this.shakeOffset);
  }

  // ─── Private methods ────────────────────────────────────────────────────────

  private _triggerShake(intensity: number): void {
    const cameraAdapter = getCameraStateAdapter();
    if (!cameraAdapter) return;
    if (this.shaking) {
      cameraAdapter.clearPositionOffset(this.shakeChannel);
      this.shakeOffset.set(0, 0, 0);
    }
    this.shakeIntensity = intensity;
    this.shakeDecay = intensity / (this.cfg.screenShakeDuration / 1000);
    this.shaking = true;
  }

  private _showKillBanner(text: string): void {
    if (!this.killBannerEl) return;
    this.killBannerEl.textContent = text;
    this.killBannerEl.style.opacity = '1';
    this.killBannerEl.style.transform = 'translateX(-50%) translateY(0)';

    if (this.killBannerTimeout) clearTimeout(this.killBannerTimeout);
    this.killBannerTimeout = setTimeout(() => {
      if (this.killBannerEl) {
        this.killBannerEl.style.opacity = '0';
        this.killBannerEl.style.transform = 'translateX(-50%) translateY(-12px)';
      }
    }, 1400);
  }

  // ─── DOM builders ────────────────────────────────────────────────────────────

  private _buildCrosshair(): void {
    this.crosshairEl = document.createElement('div');
    Object.assign(this.crosshairEl.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '14px',
      height: '14px',
      transform: 'translate(-50%, -50%)',
      color: 'rgba(255,255,255,0.85)',
      fontSize: '20px',
      lineHeight: '14px',
      textAlign: 'center',
      fontFamily: 'monospace',
      pointerEvents: 'none',
      userSelect: 'none',
      textShadow: '0 0 3px #000',
    });
    this.crosshairEl.textContent = '+';
    this.container!.appendChild(this.crosshairEl);
  }

  private _buildHitMarker(): void {
    this.hitMarkerEl = document.createElement('div');
    Object.assign(this.hitMarkerEl.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '20px',
      height: '20px',
      transform: 'translate(-50%, -50%)',
      fontSize: '24px',
      lineHeight: '20px',
      textAlign: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      color: this.cfg.hitMarkerColor,
      opacity: '0',
      transition: 'opacity 0.05s',
      pointerEvents: 'none',
      userSelect: 'none',
      textShadow: '0 0 6px currentColor',
    });
    this.hitMarkerEl.textContent = '✕';
    this.container!.appendChild(this.hitMarkerEl);
  }

  private _buildDamageFlash(): void {
    this.damageFlashEl = document.createElement('div');
    Object.assign(this.damageFlashEl.style, {
      position: 'absolute',
      inset: '0',
      background:
        `radial-gradient(ellipse at center, transparent 40%, ${OGUI.dmgFlash} 100%)`,
      opacity: '0',
      pointerEvents: 'none',
    });
    this.container!.appendChild(this.damageFlashEl);
  }

  private _buildDamageDirectionIndicators(): void {
    const makeIndicator = (direction: DamageDirection, style: Partial<CSSStyleDeclaration>): void => {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        background: OGUI.hitFlash,
        opacity: '0',
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease',
        boxShadow: '0 0 10px rgba(255,255,255,0.5)',
        ...style,
      });
      this.container!.appendChild(el);
      this.damageDirectionEls[direction] = el;
    };

    makeIndicator('front', {
      width: '80px',
      height: '5px',
      marginLeft: '-40px',
      marginTop: '-72px',
      borderRadius: '4px',
    });
    makeIndicator('back', {
      width: '80px',
      height: '5px',
      marginLeft: '-40px',
      marginTop: '66px',
      borderRadius: '4px',
    });
    makeIndicator('left', {
      width: '5px',
      height: '80px',
      marginLeft: '-72px',
      marginTop: '-40px',
      borderRadius: '4px',
    });
    makeIndicator('right', {
      width: '5px',
      height: '80px',
      marginLeft: '66px',
      marginTop: '-40px',
      borderRadius: '4px',
    });
  }

  private _buildDeathOverlay(): void {
    this.deathOverlayEl = document.createElement('div');
    Object.assign(this.deathOverlayEl.style, {
      position: 'absolute',
      inset: '0',
      background: OGUI.deathBg,
      opacity: '0',
      transition: 'opacity 0.3s',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Courier New", monospace',
      pointerEvents: 'none',
    });
    this.container!.appendChild(this.deathOverlayEl);
  }

  private _buildKillBanner(): void {
    this.killBannerEl = document.createElement('div');
    Object.assign(this.killBannerEl.style, {
      position: 'absolute',
      top: '20%',
      left: '50%',
      transform: 'translateX(-50%) translateY(0)',
      color: OGUI.killFlash,
      fontFamily: OGUI.font,
      fontSize: '13px',
      letterSpacing: '3px',
      textTransform: 'uppercase',
      opacity: '0',
      transition: 'opacity 0.2s, transform 0.2s',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });
    this.container!.appendChild(this.killBannerEl);
  }

  private _buildDamageLabel(): void {
    this.damageLabelEl = document.createElement('div');
    Object.assign(this.damageLabelEl.style, {
      position: 'absolute',
      top: '45%',
      left: '50%',
      transform: 'translate(-50%, 0)',
      color: OGUI.hpLow,
      fontFamily: OGUI.font,
      fontSize: '16px',
      fontWeight: 'bold',
      opacity: '0',
      transition: 'opacity 0.3s, transform 0.3s',
      pointerEvents: 'none',
    });
    this.container!.appendChild(this.damageLabelEl);
  }

  private _showDamageDirection(direction: DamageDirection | null): void {
    const indicators = this.damageDirectionEls;
    (['front', 'back', 'left', 'right'] as DamageDirection[]).forEach((entry) => {
      const el = indicators[entry];
      if (el) {
        el.style.opacity = entry === direction ? '0.95' : '0';
      }
    });

    if (this.damageDirectionTimeout) {
      clearTimeout(this.damageDirectionTimeout);
    }

    this.damageDirectionTimeout = setTimeout(() => {
      (['front', 'back', 'left', 'right'] as DamageDirection[]).forEach((entry) => {
        const el = indicators[entry];
        if (el) {
          el.style.opacity = '0';
        }
      });
    }, 360);
  }
}
