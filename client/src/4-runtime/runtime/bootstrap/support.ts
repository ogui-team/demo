import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import { NetworkConnectionResolver } from '../../../3-network/network/NetworkConnectionResolver';

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getDefaultServerHttpUrl(): string {
  const resolver = new NetworkConnectionResolver();
  return resolver.resolveHttpUrl();
}

export function getDefaultServerWsUrl(): string {
  const resolver = new NetworkConnectionResolver();
  return resolver.resolveWebSocketUrl();
}

export function getHalfExtentsFromRenderData(renderData: Record<string, unknown> | undefined): { x: number; y: number; z: number } {
  const meshType = typeof renderData?.meshType === 'string' ? renderData.meshType : 'box';
  const geometry = (renderData?.geometry ?? {}) as Record<string, unknown>;

  switch (meshType) {
    case 'sphere': {
      const radius = readNumber(geometry.radius, 0.5);
      return { x: radius, y: radius, z: radius };
    }
    case 'capsule': {
      const radius = readNumber(geometry.radius, 0.4);
      const height = readNumber(geometry.height, 1);
      return { x: radius, y: radius + (height * 0.5), z: radius };
    }
    case 'cylinder': {
      const radius = Math.max(readNumber(geometry.radiusTop, 0.5), readNumber(geometry.radiusBottom, 0.5));
      const height = readNumber(geometry.height, 1);
      return { x: radius, y: height * 0.5, z: radius };
    }
    case 'plane': {
      return {
        x: readNumber(geometry.width, 1) * 0.5,
        y: 0.1,
        z: readNumber(geometry.height, 1) * 0.5,
      };
    }
    default:
      return {
        x: readNumber(geometry.width, 1) * 0.5,
        y: readNumber(geometry.height, 1) * 0.5,
        z: readNumber(geometry.depth, 1) * 0.5,
      };
  }
}

export function getContextDeps(mpClient: MultiplayerClient) {
  return {
    eventBus: gameBus,
    entityManager: Engine.getEntityManager(),
    networkManager: Engine.getNetworkManager(),
    networkSyncSystem: Engine.getNetworkSyncSystem(),
    replicationSystem: Engine.getReplicationSystem(),
    multiplayerClient: mpClient,
    resourceManager: Engine.getResourceManager(),
  };
}