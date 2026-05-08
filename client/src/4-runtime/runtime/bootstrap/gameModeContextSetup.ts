import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import type { ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import type { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import type { SpawnSystem } from '../../../2-systems/gameplay/systems/SpawnSystem';
import type { PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { getCameraStateAdapter } from '../../../2-systems/camera/CameraStateAdapter';
import { logEvent } from '@engine/1-kernel/core/public-api';
import { FreeplayMode, SandboxMode, RoundBasedMode, FFAMode } from '../../../2-systems/gameplay/game/GameModeSystem';
import { HordeGameMode } from '../../../2-systems/gameplay/game/HordeGameMode';
import { DriftBombMode } from '../../../2-systems/gameplay/modes/DriftBombMode';

export interface GameModeContextSetupOptions {
  engineGameModes: GameModeSystem;
  gameModeManager: GameModeManager;
  worldRuntime: ClientWorldRuntimeCoordinator;
  healthSystem: HealthSystem;
  spawnSystem: SpawnSystem;
  playerModelSystem: PlayerModelSystem;
  stateManager: NonNullable<ReturnType<typeof Engine.getStateManagerInstance>>;
}

export function setupGameModeContext(options: GameModeContextSetupOptions): void {
  const {
    engineGameModes,
    gameModeManager,
    worldRuntime,
    healthSystem,
    spawnSystem,
    playerModelSystem,
  } = options;

  engineGameModes.setContext({
    getPlayers: () => {
      const players = new Map<string, { id: string; name: string; kills: number; deaths: number; health: number; team?: string }>();
      for (const player of gameModeManager.getPlayers()) {
        players.set(player.id, {
          id: player.id,
          name: player.name,
          kills: player.kills,
          deaths: player.deaths,
          health: player.health,
        });
      }
      const runtimeId = worldRuntime.getActiveRuntimePlayerId();
      if (runtimeId && !players.has(runtimeId)) {
        players.set(runtimeId, {
          id: runtimeId,
          name: runtimeId === worldRuntime.getLocalFreeplayPlayerId() ? 'Freeplay' : runtimeId,
          kills: 0,
          deaths: 0,
          health: healthSystem.getHp(runtimeId),
        });
      }
      return [...players.values()];
    },
    addScore: (_playerId: string, _delta: number) => {
    },
    setScore: (_playerId: string, _score: number) => {
    },
    spawnPlayer: (playerId: string) => {
      const position = spawnSystem.findSpawnPosition({ tag: 'player', clearance: 2 });
      if (playerId === worldRuntime.getActiveRuntimePlayerId()) {
        const loadout = engineGameModes.getSpawnLoadout(playerId);
        const maxHealth = loadout.maxHealth ?? 100;
        const maxShield = loadout.maxShield ?? 0;
        const armor = loadout.armor ?? healthSystem.get(playerId)?.armor ?? 0;

        worldRuntime.ensurePlayerRuntimeState(playerId);
        if (!healthSystem.get(playerId)) {
          healthSystem.register(playerId, {
            maxHp: maxHealth,
            armor,
            revivable: true,
            maxShield,
            shield: maxShield,
            shieldRegenRate: 4,
            shieldRegenDelay: 4,
          });
        }
        healthSystem.syncVitals(playerId, {
          hp: maxHealth,
          maxHp: maxHealth,
          shield: maxShield,
          maxShield,
          armor,
        });
        worldRuntime.syncGasVitalsFromHealth(playerId);
        worldRuntime.syncLocalPlayerToAuthoritativeSpawn(position, { x: 0, y: 0, z: 0 });
        worldRuntime.getLocalPlayerBootstrapCoordinator().setLocalPlayerDead(false);
        return;
      }
      playerModelSystem.handleRespawn(playerId, position, { x: 0, y: 0, z: 0 });
    },
    broadcastEvent: (topic: string, _data: unknown) => {
      logEvent('engine', `mode:${topic}`);
    },
    endMatch: (_winnerId: string | null | undefined, _reason: string | null | undefined) => {
    },
    captureSnapshot: () => ({
      runtimePlayerId: worldRuntime.getActiveRuntimePlayerId(),
      camera: Engine.getEngineCamera()
        ? {
            position: {
              x: Engine.getEngineCamera()!.position.x,
              y: Engine.getEngineCamera()!.position.y,
              z: Engine.getEngineCamera()!.position.z,
            },
            rotation: {
              x: Engine.getEngineCamera()!.rotation.x,
              y: Engine.getEngineCamera()!.rotation.y,
              z: Engine.getEngineCamera()!.rotation.z,
            },
          }
        : null,
    }),
    restoreSnapshot: (snapshot: unknown) => {
      const payload = snapshot as { runtimePlayerId?: string; camera?: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } } } | undefined;
      if (payload?.runtimePlayerId) {
        worldRuntime.ensurePlayerRuntimeState(payload.runtimePlayerId);
      }
      const cameraAdapter = getCameraStateAdapter();
      const engineController = Engine.getEngineController();
      if (payload?.camera && cameraAdapter && engineController) {
        engineController.setCameraAuthority('snapshot');
        const restored = cameraAdapter.applySnapshot({
          position: payload.camera.position,
          rotation: payload.camera.rotation,
        }, 'snapshot');
        engineController.restorePreviousCameraAuthority();
        if (!restored) {
          console.warn('[GameModeContextSetup] Snapshot camera restore was blocked by authority gating');
        }
      } else if (payload?.camera) {
        console.warn('[GameModeContextSetup] Snapshot camera restore skipped because the camera adapter or engine controller is unavailable');
      }
    },
  });

  engineGameModes.registerMode(new FreeplayMode());
  engineGameModes.registerMode(new HordeGameMode());
  engineGameModes.registerMode(new DriftBombMode());
  engineGameModes.registerMode(new SandboxMode());
  engineGameModes.registerMode(new RoundBasedMode());
  engineGameModes.registerMode(new FFAMode());
}
