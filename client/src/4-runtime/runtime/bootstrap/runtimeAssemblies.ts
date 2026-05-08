import { MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';
import { RuntimeAuxiliaryAssembly } from '../RuntimeAuxiliaryAssembly';

export function createMultiplayerRuntimeCoordinator(
  options: ConstructorParameters<typeof MultiplayerRuntimeCoordinator>[0],
): MultiplayerRuntimeCoordinator {
  return new MultiplayerRuntimeCoordinator(options);
}

export function createRuntimeAuxiliaryAssembly(
  options: ConstructorParameters<typeof RuntimeAuxiliaryAssembly>[0],
): RuntimeAuxiliaryAssembly {
  return new RuntimeAuxiliaryAssembly(options);
}