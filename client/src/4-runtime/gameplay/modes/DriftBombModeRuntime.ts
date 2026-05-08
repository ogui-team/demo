/**
 * DRIFT BOMB MODE RUNTIME
 * Counter-Strike inspired mobile bomb defusal
 * Authority-owned via EngineController
 */

export type DriftBombState =
  | 'idle'
  | 'round_starting'
  | 'buy_phase'
  | 'action_phase'
  | 'planting'
  | 'drifting'
  | 'defusing'
  | 'detonated'
  | 'defused'
  | 'round_end';

export type TeamRole = 'attackers' | 'defenders';

export interface DriftBombRoundConfig {
  roundNumber: number;
  buyPhaseDuration: number;
  actionPhaseDuration: number;
  plantTimeSec: number;
  defuseTimeSec: number;
  bombDriftDuration: number;
  tetherRadius: number;
}

export interface BombPosition {
  x: number;
  y: number;
  z: number;
  epoch: number;
}

export interface DriftBombModeState {
  state: DriftBombState;
  roundConfig: DriftBombRoundConfig;
  bombPosition: BombPosition;
  bombCarrierEntityId: string | null;
  defuserEntityId: string | null;
  defuseProgress: number; // 0-1
  attackerScore: number;
  defenderScore: number;
  teamEconomy: Record<TeamRole, number>;
  roundStartFrame: number;
  determinismEpoch: number;
}

export class DriftBombModeRuntime {
  private state: DriftBombModeState;

  constructor() {
    this.state = {
      state: 'idle',
      roundConfig: {
        roundNumber: 0,
        buyPhaseDuration: 20000,
        actionPhaseDuration: 100000,
        plantTimeSec: 3,
        defuseTimeSec: 40,
        bombDriftDuration: 30000,
        tetherRadius: 15,
      },
      bombPosition: { x: 0, y: 0, z: 0, epoch: 0 },
      bombCarrierEntityId: null,
      defuserEntityId: null,
      defuseProgress: 0,
      attackerScore: 0,
      defenderScore: 0,
      teamEconomy: { attackers: 2400, defenders: 2400 },
      roundStartFrame: 0,
      determinismEpoch: 0,
    };
  }

  getState(): Readonly<DriftBombModeState> {
    return { ...this.state };
  }

  startRound(frameIndex: number): void {
    this.state.state = 'round_starting';
    this.state.roundStartFrame = frameIndex;
    this.state.roundConfig.roundNumber += 1;
    this.state.determinismEpoch += 1;
  }

  enterBuyPhase(): void {
    this.state.state = 'buy_phase';
  }

  enterActionPhase(): void {
    this.state.state = 'action_phase';
  }

  plantBomb(carrierEntityId: string, plantPosition: BombPosition): void {
    this.state.state = 'planting';
    this.state.bombCarrierEntityId = carrierEntityId;
  }

  startBombDrift(driftPath: Array<{ x: number; y: number; z: number }>): void {
    this.state.state = 'drifting';
    this.state.bombCarrierEntityId = null;
  }

  setBombPosition(position: BombPosition): void {
    this.state.bombPosition = position;
  }

  startDefuse(defuserEntityId: string): void {
    this.state.state = 'defusing';
    this.state.defuserEntityId = defuserEntityId;
    this.state.defuseProgress = 0;
  }

  updateDefuseProgress(progress: number): void {
    this.state.defuseProgress = Math.max(0, Math.min(1, progress));
  }

  completeBombDefuse(): void {
    this.state.state = 'defused';
    this.state.defenderScore += 1;
    this.state.defuseProgress = 1;
  }

  detonateBomb(): void {
    this.state.state = 'detonated';
    this.state.attackerScore += 1;
  }

  spendEconomy(team: TeamRole, amount: number): boolean {
    if (this.state.teamEconomy[team] >= amount) {
      this.state.teamEconomy[team] -= amount;
      return true;
    }
    return false;
  }

  addEconomy(team: TeamRole, amount: number): void {
    this.state.teamEconomy[team] += amount;
  }
}
