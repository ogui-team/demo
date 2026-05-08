import { applyPlayerMovementStep, type MovementRuntimeConfig, type MovementRuntimePlayer } from '../movement/MovementRuntime';
import { type Vec3 } from '../sessionContracts';

interface TickRuntimePlayer extends MovementRuntimePlayer {
  id: string;
  dead: boolean;
}

interface ApplyActivePlayerMovementOptions<TPlayer extends TickRuntimePlayer> {
  players: Iterable<TPlayer>;
  step: number;
  now: number;
  tick: number;
  config: MovementRuntimeConfig;
  resolveMovement: (playerId: string, position: Vec3, desiredMovement: Vec3, radius: number, playerHalfHeight: number) => Vec3;
  refreshPlayerStatusMovementModifier: (player: TPlayer, now: number) => void;
  syncPlayerEntity: (playerId: string) => void;
}

interface ActorRuntimeDriver {
  ensureSingleton: (profileId: string) => void;
  update: (step: number) => void;
  destroyActor: (profileId: string) => void;
}

export function applyActivePlayerMovement<TPlayer extends TickRuntimePlayer>(options: ApplyActivePlayerMovementOptions<TPlayer>): void {
  for (const player of options.players) {
    if (player.dead) continue;
    applyPlayerMovementStep({
      player,
      step: options.step,
      now: options.now,
      tick: options.tick,
      config: options.config,
      resolveMovement: options.resolveMovement,
      refreshPlayerStatusMovementModifier: options.refreshPlayerStatusMovementModifier,
      syncPlayerEntity: options.syncPlayerEntity,
    });
  }
}

export function updateActorRuntimeForRound(
  actorRuntime: ActorRuntimeDriver,
  roundStatus: 'warmup' | 'active' | 'ended',
  profileId: string,
  step: number,
): void {
  if (roundStatus === 'active') {
    actorRuntime.ensureSingleton(profileId);
    actorRuntime.update(step);
    return;
  }

  actorRuntime.destroyActor(profileId);
}