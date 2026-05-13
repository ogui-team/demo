import type { GameLaunchCoordinator } from '../../2-systems/gameplay/game/GameLaunchCoordinator';

interface ModeListenerAdapter {
  registerListener(listener: { onExitPlay?: () => void }): () => void;
}

export class EditorSyncBackListener {
  private readonly unsubscribe: (() => void) | null;

  constructor(modeManager: ModeListenerAdapter | null, gameLaunchCoordinator: GameLaunchCoordinator) {
    this.unsubscribe = modeManager?.registerListener({
      onExitPlay: () => {
        gameLaunchCoordinator.onExitPlayMode();
      },
    }) ?? null;
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}