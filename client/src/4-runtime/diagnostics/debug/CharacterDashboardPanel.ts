import * as THREE from 'three';
import { OGUI } from '../../ui/OGUITheme';
import {
  AVATAR_MODEL_VARIANTS,
  AVATAR_TEXTURE_STYLES,
  AvatarAppearance,
  AvatarModelVariant,
  AvatarTextureStyle,
  createAvatarGroup,
  disposeAvatarGroup,
} from '../../../2-systems/gameplay/game/AvatarBuilder';

export interface CharacterDashboardSource {
  getLocalAppearance(): AvatarAppearance;
  setLocalAppearance(next: Partial<AvatarAppearance>): void;
  getLocalBindingSummary(): {
    playerId: string | null;
    entityId: string | null;
    liveAvatarVisible: boolean;
    bound: boolean;
  };
}

function toHexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export class CharacterDashboardPanel {
  private readonly source: CharacterDashboardSource;
  private readonly onChange: () => void;
  private readonly root: HTMLDivElement;
  private readonly summary: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly previewScene: THREE.Scene;
  private readonly previewCamera: THREE.PerspectiveCamera;
  private readonly previewLight: THREE.DirectionalLight;
  private previewAvatar: THREE.Group | null = null;
  private lastSignature = '';
  private controlsInitialized = false;

  constructor(source: CharacterDashboardSource, onChange: () => void) {
    this.source = source;
    this.onChange = onChange;

    this.root = document.createElement('div');
    this.root.style.cssText = `margin-top:18px;border:1px solid ${OGUI.borderDim};background:rgba(255,255,255,0.02);`;

    const header = document.createElement('div');
    header.textContent = 'Character Dashboard';
    header.style.cssText = `padding:10px 12px;border-bottom:1px solid ${OGUI.borderDim};color:${OGUI.textSec};font-size:10px;letter-spacing:1.5px;`;
    this.root.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'display:grid;grid-template-columns:minmax(220px, 300px) minmax(0,1fr);gap:14px;padding:12px;';
    this.root.appendChild(body);

    const previewColumn = document.createElement('div');
    previewColumn.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    body.appendChild(previewColumn);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 280;
    this.canvas.height = 320;
    this.canvas.style.cssText = `width:100%;max-width:280px;aspect-ratio:7/8;border:1px solid ${OGUI.borderDim};background:linear-gradient(180deg,#141414,#090909);image-rendering:pixelated;`;
    previewColumn.appendChild(this.canvas);

    this.summary = document.createElement('div');
    this.summary.style.cssText = `padding:8px 10px;border:1px solid ${OGUI.borderDim};background:rgba(0,0,0,0.28);color:${OGUI.textDim};font-size:11px;line-height:1.5;`;
    previewColumn.appendChild(this.summary);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;align-content:start;';
    body.appendChild(controls);

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x0b0b0b);
    this.previewCamera = new THREE.PerspectiveCamera(35, this.canvas.width / this.canvas.height, 0.1, 100);
    this.previewCamera.position.set(0, 1.25, 4.1);
    this.previewLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.previewLight.position.set(2, 3, 4);
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    this.previewScene.add(this.previewLight);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.canvas.width, this.canvas.height, false);

    this.buildControls(controls);
    this.sync();
  }

  getElement(): HTMLElement {
    this.sync();
    return this.root;
  }

  sync(): void {
    const appearance = this.source.getLocalAppearance();
    const binding = this.source.getLocalBindingSummary();
    this.summary.innerHTML = `
      <div>Player: ${binding.playerId ?? 'unbound'}</div>
      <div>Entity: ${binding.entityId ?? 'none'}</div>
      <div>Live Avatar: ${binding.liveAvatarVisible ? 'visible' : 'hidden'}</div>
      <div>Status: ${binding.bound ? 'linked to runtime player' : 'preview only until player is bound'}</div>
    `;

    this.syncControlValues(appearance);
    this.renderPreview(appearance);
  }

  destroy(): void {
    if (this.previewAvatar) {
      this.previewScene.remove(this.previewAvatar);
      disposeAvatarGroup(this.previewAvatar);
      this.previewAvatar = null;
    }
    this.renderer.dispose();
  }

  private buildControls(container: HTMLDivElement): void {
    if (this.controlsInitialized) return;
    this.controlsInitialized = true;

    container.appendChild(this.createSelectField('Model', 'modelVariant', AVATAR_MODEL_VARIANTS as readonly string[], (value) => {
      this.source.setLocalAppearance({ modelVariant: value as AvatarModelVariant });
    }));
    container.appendChild(this.createSelectField('Texture', 'textureStyle', AVATAR_TEXTURE_STYLES as readonly string[], (value) => {
      this.source.setLocalAppearance({ textureStyle: value as AvatarTextureStyle });
    }));
    container.appendChild(this.createColorField('Body Color', 'bodyColor', (value) => {
      this.source.setLocalAppearance({ bodyColor: Number.parseInt(value.replace('#', ''), 16) });
    }));
    container.appendChild(this.createColorField('Accent Color', 'accentColor', (value) => {
      this.source.setLocalAppearance({ accentColor: Number.parseInt(value.replace('#', ''), 16) });
    }));
    container.appendChild(this.createColorField('Skin Color', 'skinColor', (value) => {
      this.source.setLocalAppearance({ skinColor: Number.parseInt(value.replace('#', ''), 16) });
    }));
    container.appendChild(this.createColorField('Leg Color', 'legColor', (value) => {
      this.source.setLocalAppearance({ legColor: Number.parseInt(value.replace('#', ''), 16) });
    }));
    container.appendChild(this.createRangeField('Scale X', 'scaleX', 0.1, 1.6, 0.01, (value) => {
      this.source.setLocalAppearance({ scaleX: value });
    }));
    container.appendChild(this.createRangeField('Scale Y', 'scaleY', 0.1, 1.5, 0.01, (value) => {
      this.source.setLocalAppearance({ scaleY: value });
    }));
    container.appendChild(this.createRangeField('Scale Z', 'scaleZ', 0.1, 1.6, 0.01, (value) => {
      this.source.setLocalAppearance({ scaleZ: value });
    }));
  }

  private createFieldShell(labelText: string): { wrapper: HTMLDivElement; body: HTMLDivElement } {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.cssText = `color:${OGUI.textDim};font-size:10px;letter-spacing:0.6px;`;
    wrapper.appendChild(label);

    const body = document.createElement('div');
    wrapper.appendChild(body);
    return { wrapper, body };
  }

  private createSelectField(label: string, key: keyof AvatarAppearance, options: readonly string[], apply: (value: string) => void): HTMLElement {
    const { wrapper, body } = this.createFieldShell(label);
    const select = document.createElement('select');
    select.dataset.appearanceKey = String(key);
    select.style.cssText = `width:100%;padding:6px 8px;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};color:${OGUI.textPri};font:inherit;`;
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      select.appendChild(node);
    }
    select.addEventListener('change', () => {
      apply(select.value);
      this.sync();
      this.onChange();
    });
    body.appendChild(select);
    return wrapper;
  }

  private createColorField(label: string, key: keyof AvatarAppearance, apply: (value: string) => void): HTMLElement {
    const { wrapper, body } = this.createFieldShell(label);
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.appearanceKey = String(key);
    input.style.cssText = `width:100%;height:32px;padding:0;background:rgba(0,0,0,0.35);border:1px solid ${OGUI.borderDim};`;
    input.addEventListener('input', () => {
      apply(input.value);
      this.sync();
      this.onChange();
    });
    body.appendChild(input);
    return wrapper;
  }

  private createRangeField(label: string, key: keyof AvatarAppearance, min: number, max: number, step: number, apply: (value: number) => void): HTMLElement {
    const { wrapper, body } = this.createFieldShell(label);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.dataset.appearanceKey = String(key);
    input.style.cssText = 'flex:1 1 auto;';
    const valueNode = document.createElement('div');
    valueNode.dataset.appearanceValue = String(key);
    valueNode.style.cssText = `min-width:46px;color:${OGUI.textSec};font-size:11px;text-align:right;`;
    input.addEventListener('input', () => {
      const next = Number(input.value);
      apply(next);
      valueNode.textContent = next.toFixed(2);
      this.sync();
      this.onChange();
    });
    row.appendChild(input);
    row.appendChild(valueNode);
    body.appendChild(row);
    return wrapper;
  }

  private syncControlValues(appearance: AvatarAppearance): void {
    const modelSelect = this.root.querySelector<HTMLSelectElement>('[data-appearance-key="modelVariant"]');
    if (modelSelect) modelSelect.value = appearance.modelVariant;

    const textureSelect = this.root.querySelector<HTMLSelectElement>('[data-appearance-key="textureStyle"]');
    if (textureSelect) textureSelect.value = appearance.textureStyle;

    const bodyColor = this.root.querySelector<HTMLInputElement>('[data-appearance-key="bodyColor"]');
    if (bodyColor) bodyColor.value = toHexColor(appearance.bodyColor);

    const accentColor = this.root.querySelector<HTMLInputElement>('[data-appearance-key="accentColor"]');
    if (accentColor) accentColor.value = toHexColor(appearance.accentColor);

    const skinColor = this.root.querySelector<HTMLInputElement>('[data-appearance-key="skinColor"]');
    if (skinColor) skinColor.value = toHexColor(appearance.skinColor);

    const legColor = this.root.querySelector<HTMLInputElement>('[data-appearance-key="legColor"]');
    if (legColor) legColor.value = toHexColor(appearance.legColor);

    const scaleXRange = this.root.querySelector<HTMLInputElement>('[data-appearance-key="scaleX"]');
    if (scaleXRange) scaleXRange.value = String(appearance.scaleX);

    const scaleYRange = this.root.querySelector<HTMLInputElement>('[data-appearance-key="scaleY"]');
    if (scaleYRange) scaleYRange.value = String(appearance.scaleY);

    const scaleZRange = this.root.querySelector<HTMLInputElement>('[data-appearance-key="scaleZ"]');
    if (scaleZRange) scaleZRange.value = String(appearance.scaleZ);

    const scaleXValue = this.root.querySelector<HTMLElement>('[data-appearance-value="scaleX"]');
    if (scaleXValue) scaleXValue.textContent = appearance.scaleX.toFixed(2);

    const scaleYValue = this.root.querySelector<HTMLElement>('[data-appearance-value="scaleY"]');
    if (scaleYValue) scaleYValue.textContent = appearance.scaleY.toFixed(2);

    const scaleZValue = this.root.querySelector<HTMLElement>('[data-appearance-value="scaleZ"]');
    if (scaleZValue) scaleZValue.textContent = appearance.scaleZ.toFixed(2);
  }

  private renderPreview(appearance: AvatarAppearance): void {
    const signature = JSON.stringify(appearance);
    if (signature !== this.lastSignature) {
      if (this.previewAvatar) {
        this.previewScene.remove(this.previewAvatar);
        disposeAvatarGroup(this.previewAvatar);
      }
      this.previewAvatar = createAvatarGroup(appearance, { includeHitbox: false });
      this.previewScene.add(this.previewAvatar);
      this.lastSignature = signature;
    }

    if (this.previewAvatar) {
      this.previewAvatar.rotation.y = Date.now() * 0.0008;
      this.previewAvatar.position.set(0, -0.1, 0);
    }
    this.renderer.render(this.previewScene, this.previewCamera);
  }
}

