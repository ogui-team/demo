import type { EditorAuthorityCoordinator } from '../EditorAuthorityCoordinator';
import type { WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';
import type { SessionLifecycleCoordinator } from '../../../2-systems/gameplay/game/SessionLifecycleCoordinator';
import type { GameLaunchCoordinator } from '../../../2-systems/gameplay/game/GameLaunchCoordinator';
import type { RuntimeAuxiliaryAssembly } from '../RuntimeAuxiliaryAssembly';

interface WireRuntimeAssembliesOptions {
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  sessionLifecycleCoordinator: SessionLifecycleCoordinator;
  gameLaunchCoordinator: GameLaunchCoordinator;
  editorAuthorityCoordinator: EditorAuthorityCoordinator;
  auxiliaryAssembly: RuntimeAuxiliaryAssembly;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  mpClient: MultiplayerClient;
  kernelMovementIntegration: any;
}

export function wireRuntimeAssemblies(options: WireRuntimeAssembliesOptions): void {
  options.multiplayerRuntime.setSessionLifecycleCoordinator(options.sessionLifecycleCoordinator);
  options.multiplayerRuntime.setGameLaunchCoordinator(options.gameLaunchCoordinator);
  options.multiplayerRuntime.wire();
  options.editorAuthorityCoordinator.syncEditorPrefabLibrary();
  options.editorAuthorityCoordinator.wire();
  options.auxiliaryAssembly.register(options.kernelMovementIntegration);

  options.worldObjectAuthorityService.bindTransport({
    on: (event, handler) => {
      options.mpClient.on(event as never, handler as never);
    },
    isConnected: () => options.mpClient.connected,
    sendWorldObjectPlace: (obj) => options.mpClient.sendWorldObjectPlace(obj),
    sendWorldObjectUpdate: (obj) => options.mpClient.sendWorldObjectUpdate(obj),
    sendWorldObjectRemove: (id) => options.mpClient.sendWorldObjectRemove(id),
  });
}