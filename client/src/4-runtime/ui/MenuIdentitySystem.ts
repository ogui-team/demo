import * as THREE from 'three';
import { ParameterBinding } from '../diagnostics/debug/ParameterBinding';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  cloneTropicalHorrorArchetypeAppearance,
  getTropicalHorrorArchetype,
  listTropicalHorrorArchetypes,
  persistTropicalHorrorArchetypeSelection,
  resolveTropicalHorrorArchetypeId,
  type TropicalHorrorArchetypeId,
} from '../../2-systems/ArchetypeDefinitions';
import {
  AVATAR_MODEL_VARIANTS,
  AVATAR_SCALE_MIN,
  AVATAR_SCALE_XZ_MAX,
  AVATAR_SCALE_Y_MAX,
  AVATAR_TEXTURE_STYLES,
  type AvatarAppearance,
  type AvatarModelVariant,
  type AvatarTextureStyle,
  createAvatarGroup,
  disposeAvatarGroup,
  normalizeAvatarAppearance,
} from '../../2-systems/gameplay/game/AvatarBuilder';
import { OGUI } from './OGUITheme';

const MENU_IDENTITY_STATE_PATH = 'lobby.localPlayer.appearance';
const MENU_ARCHETYPE_STATE_PATH = 'lobby.localPlayer.archetype';
const PLAYER_ARCHETYPE_STATE_PATH = 'player.local.archetype';
const PLAYERS_ARCHETYPE_STATE_PATH = 'players.local.archetype';
const PLAYER_APPEARANCE_STATE_PATH = 'player.local.appearance';

interface MenuIdentityStateStoreAdapter {
  get(path: string): unknown;
  set(path: string, value: unknown): boolean | void;
  subscribe(path: string, callback: (next: unknown, prev: unknown) => void): () => void;
}

interface MenuIdentityModeAdapter {
  registerListener(listener: { onMenuPreviewChange?(active: boolean): void }): () => void;
  isMenuPreviewActive(): boolean;
}

function toHexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export class MenuIdentitySystem {
  private readonly stateManager: MenuIdentityStateStoreAdapter;
  private readonly modeManager: MenuIdentityModeAdapter | null;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly summary: HTMLDivElement;
  private readonly archetypeHeader: HTMLDivElement;
  private readonly archetypeGrid: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly previewScene: THREE.Scene;
  private readonly previewCamera: THREE.PerspectiveCamera;
  private readonly previewLight: THREE.DirectionalLight;
  private readonly bindings: ParameterBinding[];
  private appearance: AvatarAppearance;
  private archetypeId: TropicalHorrorArchetypeId;
  private previewAvatar: THREE.Group | null = null;
  private lastSignature = '';
  private previewActive = false;
  private animationFrameId: number | null = null;
  private readonly unsubscribeState: () => void;
  private readonly unsubscribeArchetype: () => void;
  private readonly unsubscribeMode: (() => void) | null;

  constructor(
    stateManager: MenuIdentityStateStoreAdapter,
    modeManager: MenuIdentityModeAdapter | null,
  ) {
    this.stateManager = stateManager;
    this.modeManager = modeManager;
    this.archetypeId = this.readArchetypeId();
    this.appearance = this.readAppearance();

    this.root = document.createElement('div');
    this.root.classList.add('menu-identity-panel');
    this.root.style.cssText = [
      'width:100%',
      'max-width:none',
      'display:flex',
      'flex-direction:column',
      'gap:12px',
      'padding:18px',
      `border:1px solid ${OGUI.borderDim}`,
      'background:rgba(0,0,0,0.28)',
      'box-sizing:border-box',
      'height:100%',
      'min-height:0',
      'overflow:hidden',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'IDENTITY PREVIEW';
    title.style.cssText = `color:${OGUI.textHead};font-size:11px;letter-spacing:2px;`;
    this.root.appendChild(title);
    (this.root as any).setCompactMode = (compact: boolean) => this.setCompactMode(compact);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 620;
    this.canvas.height = 620;
    this.canvas.style.cssText = `width:100%;aspect-ratio:1/1;border:1px solid ${OGUI.borderDim};background:linear-gradient(180deg,#111,#070707);image-rendering:pixelated;flex:1;min-height:0;`;
    this.root.appendChild(this.canvas);

    this.summary = document.createElement('div');
    this.summary.style.cssText = `padding:8px 10px;border:1px solid ${OGUI.borderDim};background:rgba(255,255,255,0.02);color:${OGUI.textDim};font-size:10px;line-height:1.5;overflow:auto;max-height:120px;`;
    this.root.appendChild(this.summary);

    this.archetypeHeader = document.createElement('div');
    this.archetypeHeader.style.cssText = `color:${OGUI.textHead};font-size:10px;letter-spacing:1.2px;`;
    this.root.appendChild(this.archetypeHeader);

    this.archetypeGrid = document.createElement('div');
    this.archetypeGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;';
    this.root.appendChild(this.archetypeGrid);

    this.controls = document.createElement('div');
    this.controls.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;overflow:auto;max-height:220px;';
    this.root.appendChild(this.controls);

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x0b0b0b);
    this.previewCamera = new THREE.PerspectiveCamera(35, this.canvas.width / this.canvas.height, 0.1, 100);
    this.previewCamera.position.set(0, 1.25, 3.1);
    this.previewLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.previewLight.position.set(2, 3, 4);
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    this.previewScene.add(this.previewLight);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.canvas.width, this.canvas.height, false);

    this.bindings = this.createBindings();
    this.buildArchetypeControls();
    this.buildControls();
    this.sync();

    this.unsubscribeArchetype = this.stateManager.subscribe(MENU_ARCHETYPE_STATE_PATH, (next) => {
      this.archetypeId = this.resolveArchetypeId(next);
      this.sync();
    });
    this.unsubscribeState = this.stateManager.subscribe(MENU_IDENTITY_STATE_PATH, (next) => {
      this.appearance = normalizeAvatarAppearance((next ?? {}) as Record<string, unknown>);
      this.sync();
    });
    this.unsubscribeMode = this.modeManager?.registerListener({
      onMenuPreviewChange: (active) => {
        this.previewActive = active;
        if (active) {
          this.startPreviewLoop();
        } else {
          this.stopPreviewLoop();
        }
      },
    }) ?? null;
    this.previewActive = this.modeManager?.isMenuPreviewActive() ?? false;
    if (this.previewActive) {
      this.startPreviewLoop();
    }
  }

  getElement(): HTMLElement {
    this.sync();
    return this.root;
  }

  getViewportElement(): HTMLElement {
    return this.canvas;
  }

  setCompactMode(compact: boolean): void {
    this.summary.style.display = compact ? 'none' : 'block';
    this.archetypeHeader.style.display = compact ? 'none' : 'block';
    this.archetypeGrid.style.display = compact ? 'none' : 'grid';
    this.controls.style.display = compact ? 'none' : 'grid';
  }

  destroy(): void {
    this.stopPreviewLoop();
    this.unsubscribeState();
    this.unsubscribeArchetype();
    this.unsubscribeMode?.();
    if (this.previewAvatar) {
      this.previewScene.remove(this.previewAvatar);
      disposeAvatarGroup(this.previewAvatar);
      this.previewAvatar = null;
    }
    this.renderer.dispose();
    this.root.remove();
  }

  private readAppearance(): AvatarAppearance {
    const next = this.stateManager.get(MENU_IDENTITY_STATE_PATH);
    return normalizeAvatarAppearance((next ?? {}) as Record<string, unknown>);
  }

  private readArchetypeId(): TropicalHorrorArchetypeId {
    const next = this.stateManager.get(MENU_ARCHETYPE_STATE_PATH) ?? this.stateManager.get(PLAYER_ARCHETYPE_STATE_PATH);
    return this.resolveArchetypeId(next);
  }

  private resolveArchetypeId(raw: unknown): TropicalHorrorArchetypeId {
    return resolveTropicalHorrorArchetypeId(raw) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
  }

  private applyArchetypeSelection(raw: unknown): void {
    const archetypeId = this.resolveArchetypeId(raw);
    const appearance = cloneTropicalHorrorArchetypeAppearance(archetypeId);

    persistTropicalHorrorArchetypeSelection(typeof window !== 'undefined' ? window.localStorage : null, archetypeId);
    this.stateManager.set(MENU_ARCHETYPE_STATE_PATH, archetypeId);
    this.stateManager.set(PLAYER_ARCHETYPE_STATE_PATH, archetypeId);
    this.stateManager.set(PLAYERS_ARCHETYPE_STATE_PATH, archetypeId);
    this.stateManager.set(MENU_IDENTITY_STATE_PATH, { ...appearance });
    this.stateManager.set(PLAYER_APPEARANCE_STATE_PATH, { ...appearance });

    this.archetypeId = archetypeId;
    this.appearance = normalizeAvatarAppearance(appearance);
    this.sync();
  }

  private writeAppearance(patch: Partial<AvatarAppearance>): void {
    const current = this.readAppearance();
    const next = normalizeAvatarAppearance({ ...current, ...patch });
    this.stateManager.set(MENU_IDENTITY_STATE_PATH, { ...next });
  }

  private createBindings(): ParameterBinding[] {
    return [
      {
        id: 'modelVariant',
        name: 'Model',
        type: 'select',
        options: [...AVATAR_MODEL_VARIANTS],
        get: () => this.appearance.modelVariant,
        set: (value) => this.writeAppearance({ modelVariant: value as AvatarModelVariant }),
      },
      {
        id: 'textureStyle',
        name: 'Texture',
        type: 'select',
        options: [...AVATAR_TEXTURE_STYLES],
        get: () => this.appearance.textureStyle,
        set: (value) => this.writeAppearance({ textureStyle: value as AvatarTextureStyle }),
      },
      {
        id: 'bodyColor',
        name: 'Body Color',
        type: 'color',
        get: () => toHexColor(this.appearance.bodyColor),
        set: (value) => this.writeAppearance({ bodyColor: Number.parseInt(String(value).replace('#', ''), 16) }),
      },
      {
        id: 'accentColor',
        name: 'Accent Color',
        type: 'color',
        get: () => toHexColor(this.appearance.accentColor),
        set: (value) => this.writeAppearance({ accentColor: Number.parseInt(String(value).replace('#', ''), 16) }),
      },
      {
        id: 'skinColor',
        name: 'Skin Color',
        type: 'color',
        get: () => toHexColor(this.appearance.skinColor),
        set: (value) => this.writeAppearance({ skinColor: Number.parseInt(String(value).replace('#', ''), 16) }),
      },
      {
        id: 'legColor',
        name: 'Leg Color',
        type: 'color',
        get: () => toHexColor(this.appearance.legColor),
        set: (value) => this.writeAppearance({ legColor: Number.parseInt(String(value).replace('#', ''), 16) }),
      },
      {
        id: 'scaleX',
        name: 'Scale X',
        type: 'slider',
        min: AVATAR_SCALE_MIN,
        max: AVATAR_SCALE_XZ_MAX,
        step: 0.01,
        get: () => this.appearance.scaleX,
        set: (value) => this.writeAppearance({ scaleX: Number(value) }),
      },
      {
        id: 'scaleY',
        name: 'Scale Y',
        type: 'slider',
        min: AVATAR_SCALE_MIN,
        max: AVATAR_SCALE_Y_MAX,
        step: 0.01,
        get: () => this.appearance.scaleY,
        set: (value) => this.writeAppearance({ scaleY: Number(value) }),
      },
      {
        id: 'scaleZ',
        name: 'Scale Z',
        type: 'slider',
        min: AVATAR_SCALE_MIN,
        max: AVATAR_SCALE_XZ_MAX,
        step: 0.01,
        get: () => this.appearance.scaleZ,
        set: (value) => this.writeAppearance({ scaleZ: Number(value) }),
      },
    ];
  }

  private buildControls(): void {
    for (const binding of this.bindings) {
      this.controls.appendChild(this.buildControl(binding));
    }
  }

  private buildArchetypeControls(): void {
    this.archetypeGrid.replaceChildren();

    for (const archetype of listTropicalHorrorArchetypes()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.menuIdentityArchetype = archetype.id;
      button.style.cssText = [
        'display:flex',
        'flex-direction:column',
        'gap:4px',
        'padding:10px 10px 9px',
        `border:1px solid ${OGUI.borderDim}`,
        'background:rgba(0,0,0,0.3)',
        `color:${OGUI.textPri}`,
        'text-align:left',
        'cursor:pointer',
        'font:inherit',
      ].join(';');
      button.innerHTML = `
        <span style="font-size:10px;letter-spacing:1.1px;color:${OGUI.textDim};">${archetype.stats.classLabel.toUpperCase()}</span>
        <span style="font-size:13px;line-height:1.2;">${archetype.displayName}</span>
        <span style="font-size:10px;color:${OGUI.textSec};line-height:1.4;">HP ${archetype.stats.maxHealth} · SH ${archetype.stats.maxShield}</span>
      `;
      button.addEventListener('click', () => this.applyArchetypeSelection(archetype.id));
      this.archetypeGrid.appendChild(button);
    }
  }

  private buildControl(binding: ParameterBinding): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const label = document.createElement('label');
    label.textContent = binding.name;
    label.style.cssText = `color:${OGUI.textDim};font-size:10px;letter-spacing:0.8px;`;
    wrapper.appendChild(label);

    if (binding.type === 'select') {
      const select = document.createElement('select');
      select.dataset.menuIdentityKey = binding.id;
      select.style.cssText = `width:100%;padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};color:${OGUI.textPri};font:inherit;`;
      for (const option of binding.options ?? []) {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        select.appendChild(node);
      }
      select.addEventListener('change', () => binding.set?.(select.value));
      wrapper.appendChild(select);
      return wrapper;
    }

    if (binding.type === 'color') {
      const input = document.createElement('input');
      input.type = 'color';
      input.dataset.menuIdentityKey = binding.id;
      input.style.cssText = `width:100%;height:32px;padding:0;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};`;
      input.addEventListener('input', () => binding.set?.(input.value));
      wrapper.appendChild(input);
      return wrapper;
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(binding.min ?? 0);
    slider.max = String(binding.max ?? 1);
    slider.step = String(binding.step ?? 0.01);
    slider.dataset.menuIdentityKey = binding.id;
    slider.style.cssText = 'flex:1 1 auto;';
    const valueNode = document.createElement('div');
    valueNode.dataset.menuIdentityValue = binding.id;
    valueNode.style.cssText = `min-width:42px;color:${OGUI.textSec};font-size:11px;text-align:right;`;
    slider.addEventListener('input', () => {
      binding.set?.(Number(slider.value));
      valueNode.textContent = Number(slider.value).toFixed(2);
    });
    row.appendChild(slider);
    row.appendChild(valueNode);
    wrapper.appendChild(row);
    return wrapper;
  }

  private sync(): void {
    this.archetypeId = this.readArchetypeId();
    const archetype = getTropicalHorrorArchetype(this.archetypeId);
    this.summary.innerHTML = [
      `<div>Ritual: ${archetype.displayName} (${archetype.stats.classLabel})</div>`,
      `<div>Loadout: ${archetype.spawn.weapons.join(', ')}</div>`,
      `<div>Vitals: ${archetype.stats.maxHealth} HP / ${archetype.stats.maxShield} SH / ${archetype.stats.maxMana} MP</div>`,
      `<div>Model: ${this.appearance.modelVariant}</div>`,
      `<div>Texture: ${this.appearance.textureStyle}</div>`,
      `<div>Scale: ${this.appearance.scaleX.toFixed(2)} / ${this.appearance.scaleY.toFixed(2)} / ${this.appearance.scaleZ.toFixed(2)}</div>`,
      '<div>Join packet seeds this identity before local bind.</div>',
    ].join('');

    this.archetypeHeader.textContent = `RITUAL SELECT · ${archetype.displayName.toUpperCase()}`;
    this.archetypeGrid.querySelectorAll<HTMLButtonElement>('[data-menu-identity-archetype]').forEach((button) => {
      const selected = button.dataset.menuIdentityArchetype === this.archetypeId;
      button.style.borderColor = selected ? archetype.hudTheme.border : OGUI.borderDim;
      button.style.boxShadow = selected ? `0 0 0 1px ${archetype.hudTheme.shadow}` : 'none';
      button.style.background = selected ? archetype.hudTheme.panel : 'rgba(0,0,0,0.3)';
    });

    for (const binding of this.bindings) {
      const control = this.root.querySelector<HTMLElement>(`[data-menu-identity-key="${binding.id}"]`);
      const value = binding.get();
      if (control instanceof HTMLSelectElement) {
        control.value = String(value);
      } else if (control instanceof HTMLInputElement) {
        control.value = String(value);
      }
      const valueNode = this.root.querySelector<HTMLElement>(`[data-menu-identity-value="${binding.id}"]`);
      if (valueNode && typeof value === 'number') {
        valueNode.textContent = value.toFixed(2);
      }
    }

    this.renderPreview();
  }

  private renderPreview(): void {
    const signature = JSON.stringify(this.appearance);
    if (signature !== this.lastSignature) {
      if (this.previewAvatar) {
        this.previewScene.remove(this.previewAvatar);
        disposeAvatarGroup(this.previewAvatar);
      }
      this.previewAvatar = createAvatarGroup(this.appearance, { includeHitbox: false });
      this.previewScene.add(this.previewAvatar);
      this.lastSignature = signature;
    }

    if (this.previewAvatar) {
      this.previewAvatar.position.set(0, -0.1, 0);
    }
    this.renderer.render(this.previewScene, this.previewCamera);
  }

  private startPreviewLoop(): void {
    if (this.animationFrameId !== null) return;
    const tick = () => {
      this.animationFrameId = window.requestAnimationFrame(tick);
      if (!this.previewActive) return;
      if (this.previewAvatar) {
        this.previewAvatar.rotation.y = Engine.time.now() * 0.0008;
      }
      this.renderer.render(this.previewScene, this.previewCamera);
    };
    this.animationFrameId = window.requestAnimationFrame(tick);
  }

  private stopPreviewLoop(): void {
    if (this.animationFrameId === null) return;
    window.cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }
}