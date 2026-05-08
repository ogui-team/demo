// Compatibility layer - allow both old and new import paths
// Old: from '../gameplay/game/' or from '../gameplay/systems/'
// New: from '../gameplay/game/' or from '../gameplay/systems/'

export * from './2-systems/gameplay/game/index';
export * from './2-systems/gameplay/systems/index';
export * from './4-runtime/diagnostics/debug/index';
export * from './2-systems/render/index';
export * from './4-runtime/ui/index';
export { MultiplayerClient, type HostedRoomConfig, type LobbyPlayer, type LobbyState, type ServerInfo } from './3-network/network/MultiplayerClient';
export { CollisionAuthoritySystem } from './3-network/network/CollisionAuthoritySystem';
export * from './0-foundation/foundation/index';
