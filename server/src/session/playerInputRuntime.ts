import { type PlayerInputState } from '../movement/MovementRuntime';
import { type Vec3 } from '../sessionContracts';

interface InputCommandPlayer {
  dead: boolean;
  lastInputSeq: number;
  lastProcessedInputSeq: number;
  lastProcessedInputTick: number;
  lastUpdate: number;
  lastMoveCommandAt: number;
  rotation: Vec3;
  jumpHeld: boolean;
  jumpBufferRemaining: number;
  currentInput: PlayerInputState;
}

interface ProcessPlayerInputOptions<TPlayer extends InputCommandPlayer> {
  player: TPlayer | undefined;
  seq: number;
  now: number;
  currentTick: number;
  tickRate: number;
  isRoundActive: boolean;
  jumpBufferSeconds: number;
  sanitizeInput: (currentRotation: Vec3) => PlayerInputState;
}

export function processPlayerInput<TPlayer extends InputCommandPlayer>(options: ProcessPlayerInputOptions<TPlayer>): void {
  const player = options.player;
  if (!player || player.dead || !options.isRoundActive) {
    return;
  }

  if (options.seq <= player.lastInputSeq) {
    return;
  }

  player.lastInputSeq = options.seq;
  player.lastProcessedInputSeq = options.seq;
  player.lastProcessedInputTick = options.currentTick;
  player.lastUpdate = options.now;
  player.lastMoveCommandAt = options.now;

  const nextInput = options.sanitizeInput(player.rotation);
  if (nextInput.jump && !player.jumpHeld) {
    player.jumpBufferRemaining = options.jumpBufferSeconds;
  }

  player.jumpHeld = nextInput.jump;
  player.currentInput = nextInput;
}