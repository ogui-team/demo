import * as THREE from 'three';

export const AVATAR_MODEL_VARIANTS = ['operator', 'scout', 'heavy'] as const;
export type AvatarModelVariant = typeof AVATAR_MODEL_VARIANTS[number];

export const AVATAR_TEXTURE_STYLES = ['flat', 'checker', 'stripes', 'digital'] as const;
export type AvatarTextureStyle = typeof AVATAR_TEXTURE_STYLES[number];

export interface AvatarAppearance {
  modelVariant: AvatarModelVariant;
  textureStyle: AvatarTextureStyle;
  bodyColor: number;
  accentColor: number;
  skinColor: number;
  legColor: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface AvatarAppearanceInput extends Partial<AvatarAppearance> {
  heightScale?: number;
  widthScale?: number;
}

export interface CreateAvatarOptions {
  includeHitbox?: boolean;
}

export interface AvatarRig {
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
}

type AvatarGeometryProfile = {
  torso: [number, number, number];
  head: [number, number, number];
  arm: [number, number, number];
  leg: [number, number, number];
  offsets: {
    torsoY: number;
    headY: number;
    armX: number;
    armY: number;
    legX: number;
    legY: number;
  };
};

const DEFAULT_APPEARANCE: AvatarAppearance = {
  modelVariant: 'operator',
  textureStyle: 'flat',
  bodyColor: 0xffff00,
  accentColor: 0x1f1f1f,
  skinColor: 0xf5c89a,
  legColor: 0x2a3a5a,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
};

export const AVATAR_SCALE_MIN = 0.1;
export const AVATAR_SCALE_XZ_MAX = 1.6;
export const AVATAR_SCALE_Y_MAX = 1.5;

const MODEL_PROFILES: Record<AvatarModelVariant, AvatarGeometryProfile> = {
  operator: {
    torso: [0.6, 0.8, 0.35],
    head: [0.35, 0.35, 0.35],
    arm: [0.2, 0.55, 0.2],
    leg: [0.2, 0.55, 0.2],
    offsets: { torsoY: 0.9, headY: 1.55, armX: 0.42, armY: 0.9, legX: 0.18, legY: 0.28 },
  },
  scout: {
    torso: [0.52, 0.76, 0.3],
    head: [0.33, 0.33, 0.33],
    arm: [0.16, 0.6, 0.16],
    leg: [0.16, 0.62, 0.16],
    offsets: { torsoY: 0.92, headY: 1.53, armX: 0.38, armY: 0.92, legX: 0.16, legY: 0.26 },
  },
  heavy: {
    torso: [0.78, 0.92, 0.44],
    head: [0.38, 0.38, 0.38],
    arm: [0.26, 0.62, 0.24],
    leg: [0.26, 0.62, 0.24],
    offsets: { torsoY: 0.94, headY: 1.62, armX: 0.5, armY: 0.94, legX: 0.22, legY: 0.3 },
  },
};

export const AVATAR_ROOT_OFFSET_Y = 0.925;

const geometryCache = new Map<string, THREE.BufferGeometry>();

function getSharedGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geometry = factory();
  geometryCache.set(key, geometry);
  return geometry;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createPatternTexture(style: AvatarTextureStyle, primary: number, accent: number): THREE.CanvasTexture | null {
  if (style === 'flat') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = `#${primary.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;

  if (style === 'checker') {
    const size = 8;
    for (let y = 0; y < canvas.height; y += size) {
      for (let x = 0; x < canvas.width; x += size) {
        if (((x / size) + (y / size)) % 2 === 0) {
          ctx.fillRect(x, y, size, size);
        }
      }
    }
  } else if (style === 'stripes') {
    for (let y = 0; y < canvas.height; y += 6) {
      ctx.fillRect(0, y, canvas.width, 3);
    }
  } else {
    for (let x = -canvas.height; x < canvas.width; x += 7) {
      ctx.fillRect(x, 0, 3, canvas.height);
      ctx.save();
      ctx.translate(x, 0);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(0, 0, 3, canvas.height * 1.5);
      ctx.restore();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterial(baseColor: number, textureStyle: AvatarTextureStyle, accentColor: number): THREE.MeshLambertMaterial {
  const map = createPatternTexture(textureStyle, baseColor, accentColor);
  return new THREE.MeshLambertMaterial({
    color: baseColor,
    flatShading: true,
    map,
  });
}

function stampMeshMetadata(mesh: THREE.Mesh, baseColor: number, ownsGeometry: boolean): THREE.Mesh {
  mesh.userData._baseColor = baseColor;
  mesh.userData.disposeGeometry = ownsGeometry;
  return mesh;
}

export function normalizeAvatarAppearance(partial: AvatarAppearanceInput = {}): AvatarAppearance {
  const legacyWidthScale = partial.widthScale;
  const legacyHeightScale = partial.heightScale;
  return {
    modelVariant: partial.modelVariant ?? DEFAULT_APPEARANCE.modelVariant,
    textureStyle: partial.textureStyle ?? DEFAULT_APPEARANCE.textureStyle,
    bodyColor: partial.bodyColor ?? DEFAULT_APPEARANCE.bodyColor,
    accentColor: partial.accentColor ?? DEFAULT_APPEARANCE.accentColor,
    skinColor: partial.skinColor ?? DEFAULT_APPEARANCE.skinColor,
    legColor: partial.legColor ?? DEFAULT_APPEARANCE.legColor,
    scaleX: clamp(partial.scaleX ?? legacyWidthScale ?? DEFAULT_APPEARANCE.scaleX, AVATAR_SCALE_MIN, AVATAR_SCALE_XZ_MAX),
    scaleY: clamp(partial.scaleY ?? legacyHeightScale ?? DEFAULT_APPEARANCE.scaleY, AVATAR_SCALE_MIN, AVATAR_SCALE_Y_MAX),
    scaleZ: clamp(partial.scaleZ ?? legacyWidthScale ?? DEFAULT_APPEARANCE.scaleZ, AVATAR_SCALE_MIN, AVATAR_SCALE_XZ_MAX),
  };
}

export function createAvatarGroup(
  appearanceInput: AvatarAppearanceInput = {},
  options: CreateAvatarOptions = {},
): THREE.Group {
  const appearance = normalizeAvatarAppearance(appearanceInput);
  const profile = MODEL_PROFILES[appearance.modelVariant];
  const root = new THREE.Group();

  const bodyMat = createMaterial(appearance.bodyColor, appearance.textureStyle, appearance.accentColor);
  const skinMat = createMaterial(appearance.skinColor, 'flat', appearance.skinColor);
  const legMat = createMaterial(appearance.legColor, appearance.textureStyle, appearance.accentColor);

  const torsoGeometry = getSharedGeometry(
    `${appearance.modelVariant}:torso`,
    () => new THREE.BoxGeometry(...profile.torso),
  );
  const headGeometry = getSharedGeometry(
    `${appearance.modelVariant}:head`,
    () => new THREE.BoxGeometry(...profile.head),
  );
  const armGeometry = getSharedGeometry(
    `${appearance.modelVariant}:arm`,
    () => new THREE.BoxGeometry(...profile.arm),
  );
  const legGeometry = getSharedGeometry(
    `${appearance.modelVariant}:leg`,
    () => new THREE.BoxGeometry(...profile.leg),
  );

  const torsoMesh = stampMeshMetadata(new THREE.Mesh(torsoGeometry, bodyMat), appearance.bodyColor, false);
  torsoMesh.position.set(0, profile.offsets.torsoY, 0);
  root.add(torsoMesh);

  const headMesh = stampMeshMetadata(new THREE.Mesh(headGeometry, skinMat), appearance.skinColor, false);
  headMesh.position.set(0, profile.offsets.headY, 0);
  root.add(headMesh);

  const armLeftMesh = stampMeshMetadata(new THREE.Mesh(armGeometry, bodyMat), appearance.bodyColor, false);
  armLeftMesh.position.set(-profile.offsets.armX, profile.offsets.armY, 0);
  armLeftMesh.userData.avatarPart = 'leftArm';
  root.add(armLeftMesh);

  const armRightMesh = stampMeshMetadata(new THREE.Mesh(armGeometry, bodyMat), appearance.bodyColor, false);
  armRightMesh.position.set(profile.offsets.armX, profile.offsets.armY, 0);
  armRightMesh.userData.avatarPart = 'rightArm';
  root.add(armRightMesh);

  const legLeftMesh = stampMeshMetadata(new THREE.Mesh(legGeometry, legMat), appearance.legColor, false);
  legLeftMesh.position.set(-profile.offsets.legX, profile.offsets.legY, 0);
  legLeftMesh.userData.avatarPart = 'leftLeg';
  root.add(legLeftMesh);

  const legRightMesh = stampMeshMetadata(new THREE.Mesh(legGeometry, legMat), appearance.legColor, false);
  legRightMesh.position.set(profile.offsets.legX, profile.offsets.legY, 0);
  legRightMesh.userData.avatarPart = 'rightLeg';
  root.add(legRightMesh);

  if (options.includeHitbox !== false) {
    const hitboxGeometry = new THREE.BoxGeometry(0.7, 1.85, 0.5);
    const hitboxMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitbox = stampMeshMetadata(new THREE.Mesh(hitboxGeometry, hitboxMaterial), 0x000000, true);
    hitbox.position.set(0, 0.925, 0);
    hitbox.userData.isHitbox = true;
    root.add(hitbox);
  }

  root.scale.set(appearance.scaleX, appearance.scaleY, appearance.scaleZ);
  root.userData.avatarAppearance = appearance;
  root.userData.avatarRig = {
    torso: torsoMesh,
    head: headMesh,
    leftArm: armLeftMesh,
    rightArm: armRightMesh,
    leftLeg: legLeftMesh,
    rightLeg: legRightMesh,
  } satisfies AvatarRig;
  root.userData.avatarRestPose = {
    torsoY: torsoMesh.position.y,
    headY: headMesh.position.y,
    leftArmY: armLeftMesh.position.y,
    rightArmY: armRightMesh.position.y,
    leftLegY: legLeftMesh.position.y,
    rightLegY: legRightMesh.position.y,
  };
  root.userData.avatarRootOffsetY = AVATAR_ROOT_OFFSET_Y;
  root.traverse((obj) => {
    obj.userData.playerModel = true;
  });

  return root;
}

export function disposeAvatarGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.userData.disposeGeometry) {
      obj.geometry?.dispose();
    }
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material instanceof THREE.Material) {
        const maybeMap = material as THREE.Material & { map?: THREE.Texture | null };
        maybeMap.map?.dispose?.();
        material.dispose();
      }
    }
  });
}
