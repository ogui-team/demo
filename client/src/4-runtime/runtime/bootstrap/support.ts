import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getDefaultServerHttpUrl(): string {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return '';
  }
  const location = window.location;
  const currentPort = location.port;
  const targetPort = !currentPort || currentPort === '80' || currentPort === '443' || currentPort === '8080'
    ? currentPort
    : '8080';
  const suffix = targetPort ? `:${targetPort}` : '';
  return `${location.protocol}//${location.hostname}${suffix}`.replace(/\/$/, '');
}

export function getDefaultServerWsUrl(): string {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return '';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const currentPort = window.location.port;
  const targetPort = !currentPort || currentPort === '80' || currentPort === '443' || currentPort === '8080'
    ? currentPort
    : '8080';
  const suffix = targetPort ? `:${targetPort}` : '';
  return `${protocol}//${window.location.hostname}${suffix}`;
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