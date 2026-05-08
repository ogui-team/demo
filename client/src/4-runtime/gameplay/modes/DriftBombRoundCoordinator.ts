/**
 * DRIFT BOMB ECONOMY & ROUND COORDINATOR
 */

export class DriftBombEconomySystem {
  private startingBudget = 2400;
  private roundWinReward = 3200;
  private roundLossReward = 1400;
  private maxBudget = 16000;

  calculateRoundEconomy(
    previousBalance: number,
    wonPreviousRound: boolean,
    lossStreak: number,
  ): number {
    let reward = wonPreviousRound ? this.roundWinReward : this.roundLossReward;

    // Loss streak bonus (Counter-Strike style)
    if (!wonPreviousRound && lossStreak > 0) {
      reward = Math.min(this.maxBudget - previousBalance, this.roundLossReward + lossStreak * 400);
    }

    return Math.min(this.maxBudget, previousBalance + reward);
  }

  getWeaponCost(weaponId: string): number {
    const prices: Record<string, number> = {
      'primary:rifle': 2900,
      'primary:smg': 1200,
      'secondary:pistol': 500,
      'secondary:heavy': 700,
      'utility:armor': 1000,
      'utility:utility': 400,
      'utility:grenade': 200,
    };
    return prices[weaponId] ?? 0;
  }

  canAfford(budget: number, cost: number): boolean {
    return budget >= cost;
  }
}

export class DriftBombRoundCoordinator {
  private round: number = 0;
  private phase: 'buy' | 'action' | 'end' = 'buy';
  private phaseStartTime: number = 0;
  private attackerWins: number = 0;
  private defenderWins: number = 0;
  private attackerLossStreak: number = 0;
  private defenderLossStreak: number = 0;

  startRound(timestamp: number): void {
    this.round += 1;
    this.phase = 'buy';
    this.phaseStartTime = timestamp;
  }

  transitionToBuyPhase(timestamp: number): void {
    this.phase = 'buy';
    this.phaseStartTime = timestamp;
  }

  transitionToActionPhase(timestamp: number): void {
    this.phase = 'action';
    this.phaseStartTime = timestamp;
  }

  endRound(attackersWon: boolean, timestamp: number): void {
    this.phase = 'end';

    if (attackersWon) {
      this.attackerWins += 1;
      this.attackerLossStreak = 0;
      this.defenderLossStreak += 1;
    } else {
      this.defenderWins += 1;
      this.defenderLossStreak = 0;
      this.attackerLossStreak += 1;
    }
  }

  getRoundState(): {
    round: number;
    phase: 'buy' | 'action' | 'end';
    attackerWins: number;
    defenderWins: number;
    attackerLossStreak: number;
    defenderLossStreak: number;
  } {
    return {
      round: this.round,
      phase: this.phase,
      attackerWins: this.attackerWins,
      defenderWins: this.defenderWins,
      attackerLossStreak: this.attackerLossStreak,
      defenderLossStreak: this.defenderLossStreak,
    };
  }
}
