import * as THREE from 'three';

export type TwoDRenderLayer = 'background' | 'world2D' | 'entities2D' | 'ui2D';

export interface SpriteFrame2D {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX?: number;
  anchorY?: number;
}

export interface SpriteAtlas2D {
  id: string;
  texture: THREE.Texture;
  width: number;
  height: number;
  frames: Record<string, SpriteFrame2D>;
  image?: HTMLCanvasElement | HTMLImageElement | null;
}

export interface SpriteComponentData {
  atlasId: string;
  frame: string;
  layer?: TwoDRenderLayer;
  width?: number;
  height?: number;
  tint?: number;
  opacity?: number;
  rotation2D?: number;
  visible?: boolean;
  sortY?: boolean;
  pivotX?: number;
  pivotY?: number;
}

export interface SpriteAnimationClip2D {
  id: string;
  frames: string[];
  fps: number;
  loop?: boolean;
}

export interface AnimationComponentData {
  clips: Record<string, SpriteAnimationClip2D>;
  state: string;
  elapsed?: number;
  frameIndex?: number;
  speed?: number;
  playing?: boolean;
  deterministic?: boolean;
}

export interface TilemapLayer2D {
  id: string;
  atlasId: string;
  width: number;
  height: number;
  tileSize: number;
  tiles: string[];
  solidFrames?: string[];
  renderLayer?: Exclude<TwoDRenderLayer, 'ui2D'>;
  scrollFactor?: number;
}

export interface TilemapComponentData {
  layers: TilemapLayer2D[];
  visible?: boolean;
}

export interface Physics2DBodyData {
  width: number;
  height: number;
  velocityX?: number;
  velocityY?: number;
  desiredVelocityX?: number;
  desiredVelocityY?: number;
  maxSpeed?: number;
  dynamic?: boolean;
  solid?: boolean;
  gravityScale?: number;
}

export interface Input2DComponentData {
  enabled?: boolean;
  localControlled?: boolean;
  moveSpeed?: number;
}

export interface UI2DComponentData {
  kind: 'health_bar' | 'label' | 'panel';
  anchor?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  background?: string;
}

export interface ParallaxLayer2D {
  id: string;
  atlasId: string;
  frame: string;
  factorX: number;
  factorY: number;
  y: number;
  width: number;
  height: number;
  tint?: number;
}

export interface TwoDRenderPass {
  layer: TwoDRenderLayer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export interface TwoDRenderPassProvider {
  getRenderPasses(): TwoDRenderPass[];
}

export interface SpritePrefabData {
  atlasId: string;
  frame: string;
  width?: number;
  height?: number;
  tint?: number;
  layer?: TwoDRenderLayer;
}

export interface TilemapPrefabData {
  layers: TilemapLayer2D[];
}

export interface UIPrefabData extends UI2DComponentData {}

export const DEFAULT_2D_ATLAS_ID = 'corridor_2d_demo';
