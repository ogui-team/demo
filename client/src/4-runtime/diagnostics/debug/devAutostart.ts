export interface DevAutostartActions {
  hideMenu: () => void;
  showMenu: () => void;
  startLocalFreeplay: () => void;
  startEngineShowcase: () => void;
  startScriptedLevel: (levelId: string) => void;
  hostMultiplayer: (config: {
    playerName: string;
    roomName: string;
    map: string;
    mode?: 'ffa' | 'horde' | 'drift_bomb';
    killLimit: number;
    roundDurationSec: number;
    maxPlayers: number;
    forceStart: boolean;
  }) => void;
  joinMultiplayer: (config: {
    playerName: string;
    roomId: string | null;
    autoReady: boolean;
  }) => void;
}

export function runAutostartFromQuery(search: string, actions: DevAutostartActions): void {
  const params = new URLSearchParams(search);
  const autoStartMode = params.get('autostart');
  const autoStartLevelId = params.get('level');
  if (!autoStartMode) return;

  window.setTimeout(() => {
    actions.hideMenu();
    switch (autoStartMode) {
      case 'freeplay':
        actions.startLocalFreeplay();
        break;
      case 'showcase':
        actions.startEngineShowcase();
        break;
      case 'level':
        if (autoStartLevelId) {
          actions.startScriptedLevel(autoStartLevelId);
          break;
        }
        actions.showMenu();
        break;
      case 'host':
        actions.hostMultiplayer({
          playerName: params.get('player') ?? 'Host',
          roomName: params.get('room') ?? 'Local Perf Sample',
          map: params.get('map') ?? 'map_default',
          mode: params.get('mode') === 'horde'
            ? 'horde'
            : params.get('mode') === 'drift_bomb'
              ? 'drift_bomb'
              : 'ffa',
          killLimit: readNumberParam(params, 'killLimit', 5),
          roundDurationSec: readNumberParam(params, 'roundDurationSec', 120),
          maxPlayers: readNumberParam(params, 'maxPlayers', 4),
          forceStart: params.get('forceStart') !== '0',
        });
        break;
      case 'join':
        actions.joinMultiplayer({
          playerName: params.get('player') ?? 'Joiner',
          roomId: params.get('roomId'),
          autoReady: params.get('autoReady') !== '0',
        });
        break;
      default:
        actions.showMenu();
        break;
    }
  }, 0);
}

function readNumberParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
