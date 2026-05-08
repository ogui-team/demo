export type Vector3Like = { x: number; y: number; z: number };

export type RuntimeAppState = 'menu' | 'lobby' | 'starting' | 'in_game' | 'post_game';

export type ResetPhase = 'soft' | 'full';

export interface LocalTransformState {
  position: Vector3Like;
  rotation: Vector3Like;
}

export interface RuntimeIssueSnapshot {
  suspectedProblems: string[];
  app: Record<string, unknown>;
  multiplayer: Record<string, unknown>;
  server: Record<string, unknown>;
  lobby: Record<string, unknown>;
  round: Record<string, unknown>;
  localPlayer: Record<string, unknown>;
  rendering: Record<string, unknown>;
  networkSync: Record<string, unknown>;
  controlTower?: Record<string, unknown> | null;
}