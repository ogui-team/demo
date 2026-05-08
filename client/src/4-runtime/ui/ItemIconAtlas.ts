import * as THREE from 'three';
import type { SpriteAtlas2D, SpriteFrame2D } from './2d/TwoDTypes';

type IconPalette = {
  background: string;
  foreground: string;
  accent: string;
};

type AtlasBundle = {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  texture: THREE.CanvasTexture;
  frames: Record<string, SpriteFrame2D>;
  width: number;
  height: number;
};

const ICON_SIZE = 64;
const ICON_COLUMNS = 4;

export const ITEM_ICON_ATLAS_ID = 'corridor_item_icons';

const ITEM_IDS = [
  'health_potion_sm',
  'health_potion_lg',
  'stim_pack',
  'weapon_pistol',
  'weapon_macuahuitl',
  'weapon_flareGun',
  'weapon_spiritSwarmStaff',
  'weapon_poisonBlowgun',
  'weapon_shotgun',
  'weapon_rifle',
  'weapon_knife',
  'weapon_smg',
  'armor_vest',
  'armor_helmet',
  'ammo_9mm',
  'ammo_shells',
  'ammo_rifle_mag',
  'ammo_smg_mag',
  'key_red',
  'key_blue',
  'key_yellow',
  'health_small',
  'shotgun_shells',
  'physgun_tool',
  'data_chip',
  'gold_coin',
  'grenade',
  'unknown_item',
] as const;

const aliasMap: Record<string, string> = {
  pickup_medkit: 'health_small',
  pickup_ammo_box: 'ammo_shells',
  pickup_shotgun: 'weapon_shotgun',
};

let atlasCache: AtlasBundle | null = null;
const frameUrlCache = new Map<string, string>();
const frameCanvasCache = new Map<string, HTMLCanvasElement>();
const frameTextureCache = new Map<string, THREE.Texture>();

function normalizePalette(itemId: string): IconPalette {
  if (/shotgun/i.test(itemId)) return { background: '#21160d', foreground: '#d8b16a', accent: '#f1dfb3' };
  if (/pistol|9mm/i.test(itemId)) return { background: '#101826', foreground: '#85b7ff', accent: '#d8ebff' };
  if (/rifle|mag/i.test(itemId)) return { background: '#112016', foreground: '#78d19a', accent: '#dff7e8' };
  if (/smg/i.test(itemId)) return { background: '#111922', foreground: '#87d0d8', accent: '#d9f7f9' };
  if (/knife/i.test(itemId)) return { background: '#171717', foreground: '#dadada', accent: '#ffffff' };
  if (/health|med|stim/i.test(itemId)) return { background: '#2a1010', foreground: '#ff7272', accent: '#ffe1e1' };
  if (/shell/i.test(itemId)) return { background: '#281706', foreground: '#ffbf66', accent: '#fff1d6' };
  if (/armor|vest|helmet/i.test(itemId)) return { background: '#10182c', foreground: '#8ea8ff', accent: '#edf2ff' };
  if (/physgun/i.test(itemId)) return { background: '#081828', foreground: '#57d9ff', accent: '#d7fbff' };
  if (/grenade/i.test(itemId)) return { background: '#18200e', foreground: '#b2d36d', accent: '#f1ffd0' };
  if (/key/i.test(itemId)) return { background: '#241d0a', foreground: '#f0cf72', accent: '#fff4c6' };
  if (/gold/i.test(itemId)) return { background: '#241a05', foreground: '#f7d15c', accent: '#fff0b0' };
  if (/data/i.test(itemId)) return { background: '#0a1810', foreground: '#74d1a8', accent: '#d7ffee' };
  return { background: '#151515', foreground: '#b8b8b8', accent: '#f2f2f2' };
}

function createAtlasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function drawFrame(ctx: CanvasRenderingContext2D, palette: IconPalette): void {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  const gradient = ctx.createLinearGradient(0, 0, 0, ICON_SIZE);
  gradient.addColorStop(0, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, ICON_SIZE - 2, ICON_SIZE - 2);
}

function drawWeapon(ctx: CanvasRenderingContext2D, itemId: string, palette: IconPalette): void {
  ctx.save();
  ctx.translate(32, 30);
  ctx.fillStyle = palette.foreground;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;

  if (/shotgun/i.test(itemId)) {
    ctx.fillRect(-20, -3, 34, 6);
    ctx.fillRect(10, -2, 14, 4);
    ctx.fillRect(-6, 2, 7, 16);
    ctx.beginPath();
    ctx.moveTo(-4, 14);
    ctx.lineTo(-13, 22);
    ctx.lineTo(-8, 22);
    ctx.lineTo(0, 16);
    ctx.closePath();
    ctx.fill();
  } else if (/pistol/i.test(itemId)) {
    ctx.fillRect(-14, -4, 22, 8);
    ctx.fillRect(8, -2, 10, 4);
    ctx.fillRect(-6, 4, 7, 15);
    ctx.beginPath();
    ctx.moveTo(-6, 18);
    ctx.lineTo(-12, 18);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-1, 8);
    ctx.closePath();
    ctx.fill();
  } else if (/rifle/i.test(itemId)) {
    ctx.fillRect(-23, -3, 40, 6);
    ctx.fillRect(14, -2, 13, 4);
    ctx.fillRect(-2, 2, 6, 18);
    ctx.fillRect(-18, 3, 9, 4);
    ctx.beginPath();
    ctx.moveTo(-16, 8);
    ctx.lineTo(-21, 15);
    ctx.lineTo(-18, 16);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
  } else if (/smg/i.test(itemId)) {
    ctx.fillRect(-16, -4, 24, 8);
    ctx.fillRect(7, -2, 8, 4);
    ctx.fillRect(-2, 4, 6, 14);
    ctx.fillRect(-10, 5, 6, 3);
  } else if (/knife/i.test(itemId)) {
    ctx.rotate(-0.45);
    ctx.fillRect(-2, -18, 4, 24);
    ctx.beginPath();
    ctx.moveTo(-2, -18);
    ctx.lineTo(0, -28);
    ctx.lineTo(2, -18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.accent;
    ctx.fillRect(-5, 5, 10, 4);
  } else {
    ctx.fillRect(-15, -4, 24, 8);
    ctx.fillRect(9, -1, 12, 2);
    ctx.fillRect(-4, 4, 8, 14);
    ctx.strokeStyle = palette.accent;
    ctx.beginPath();
    ctx.moveTo(18, -8);
    ctx.lineTo(24, -14);
    ctx.moveTo(19, 0);
    ctx.lineTo(28, 0);
    ctx.moveTo(18, 8);
    ctx.lineTo(24, 14);
    ctx.stroke();
  }

  ctx.restore();
}

function drawAmmo(ctx: CanvasRenderingContext2D, itemId: string, palette: IconPalette): void {
  ctx.save();
  ctx.fillStyle = palette.foreground;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;

  if (/shell/i.test(itemId)) {
    for (const x of [18, 28, 38]) {
      ctx.fillRect(x, 16, 7, 26);
      ctx.fillStyle = palette.accent;
      ctx.fillRect(x, 38, 7, 6);
      ctx.fillStyle = palette.foreground;
    }
  } else if (/mag/i.test(itemId)) {
    ctx.translate(32, 30);
    ctx.rotate(0.1);
    ctx.fillRect(-8, -18, 16, 34);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(-8, -18, 16, 6);
  } else {
    for (const x of [22, 32]) {
      ctx.fillRect(x, 14, 6, 28);
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x + 3, 8);
      ctx.lineTo(x + 6, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.foreground;
    }
  }

  ctx.restore();
}

function drawSupport(ctx: CanvasRenderingContext2D, itemId: string, palette: IconPalette): void {
  ctx.save();
  ctx.fillStyle = palette.foreground;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;

  if (/health|med|stim/i.test(itemId)) {
    ctx.fillRect(18, 18, 28, 28);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(29, 22, 6, 20);
    ctx.fillRect(22, 29, 20, 6);
  } else if (/armor|vest|helmet/i.test(itemId)) {
    ctx.beginPath();
    ctx.moveTo(18, 18);
    ctx.lineTo(32, 12);
    ctx.lineTo(46, 18);
    ctx.lineTo(42, 42);
    ctx.lineTo(32, 50);
    ctx.lineTo(22, 42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (/grenade/i.test(itemId)) {
    ctx.beginPath();
    ctx.arc(32, 34, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(27, 14, 10, 8);
    ctx.strokeRect(25, 10, 14, 8);
  } else if (/key/i.test(itemId)) {
    ctx.beginPath();
    ctx.arc(24, 30, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(30, 28, 16, 5);
    ctx.fillRect(40, 28, 3, 10);
    ctx.fillRect(45, 28, 3, 7);
  } else if (/gold/i.test(itemId)) {
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (/data/i.test(itemId)) {
    ctx.fillRect(18, 14, 28, 36);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(22, 20, 20, 3);
    ctx.fillRect(22, 27, 16, 3);
    ctx.fillRect(22, 34, 18, 3);
  } else {
    ctx.fillRect(16, 16, 32, 32);
  }

  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, itemId: string): void {
  const palette = normalizePalette(itemId);
  drawFrame(ctx, palette);
  if (/weapon|physgun|knife|pistol|shotgun|rifle|smg/i.test(itemId)) {
    drawWeapon(ctx, itemId, palette);
  } else if (/ammo|shell|9mm|mag/i.test(itemId)) {
    drawAmmo(ctx, itemId, palette);
  } else {
    drawSupport(ctx, itemId, palette);
  }
}

function resolveFrameId(itemId: string): string {
  const normalized = aliasMap[itemId] ?? itemId;
  return ITEM_IDS.includes(normalized as typeof ITEM_IDS[number]) ? normalized : 'unknown_item';
}

function ensureAtlas(): AtlasBundle {
  if (atlasCache) return atlasCache;
  const rows = Math.ceil(ITEM_IDS.length / ICON_COLUMNS);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_COLUMNS * ICON_SIZE;
  canvas.height = rows * ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create item atlas canvas');
  }

  const frames: Record<string, SpriteFrame2D> = {};
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const [index, itemId] of ITEM_IDS.entries()) {
    const column = index % ICON_COLUMNS;
    const row = Math.floor(index / ICON_COLUMNS);
    const x = column * ICON_SIZE;
    const y = row * ICON_SIZE;
    ctx.save();
    ctx.translate(x, y);
    drawItem(ctx, itemId);
    ctx.restore();
    frames[itemId] = { id: itemId, x, y, width: ICON_SIZE, height: ICON_SIZE, anchorX: 0.5, anchorY: 0.5 };
  }

  atlasCache = {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    texture: createAtlasTexture(canvas),
    frames,
    width: canvas.width,
    height: canvas.height,
  };
  return atlasCache;
}

function buildFrameCanvas(frameId: string): HTMLCanvasElement {
  const atlas = ensureAtlas();
  const frame = atlas.frames[frameId] ?? atlas.frames.unknown_item;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create extracted frame canvas');
  }
  ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  return canvas;
}

export function getItemIconAtlas(): SpriteAtlas2D {
  const atlas = ensureAtlas();
  return {
    id: ITEM_ICON_ATLAS_ID,
    texture: atlas.texture,
    width: atlas.width,
    height: atlas.height,
    frames: atlas.frames,
    image: atlas.canvas,
  };
}

export function getItemIconFrameId(itemId: string): string {
  return resolveFrameId(itemId);
}

export function getGeneratedItemIconUrl(itemId: string): string {
  const frameId = resolveFrameId(itemId);
  const existing = frameUrlCache.get(frameId);
  if (existing) return existing;
  const url = buildFrameCanvas(frameId).toDataURL('image/png');
  frameUrlCache.set(frameId, url);
  return url;
}

export function getGeneratedItemCanvas(itemId: string): HTMLCanvasElement {
  const frameId = resolveFrameId(itemId);
  const existing = frameCanvasCache.get(frameId);
  if (existing) return existing;
  const canvas = buildFrameCanvas(frameId);
  frameCanvasCache.set(frameId, canvas);
  return canvas;
}

export function getGeneratedItemTexture(itemId: string): THREE.Texture {
  const frameId = resolveFrameId(itemId);
  const existing = frameTextureCache.get(frameId);
  if (existing) return existing;
  const texture = createAtlasTexture(getGeneratedItemCanvas(frameId));
  frameTextureCache.set(frameId, texture);
  return texture;
}