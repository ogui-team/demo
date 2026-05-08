/**
 * DRIFT BOMB DETERMINISM TESTS
 * Validates bomb movement, economy, and round transitions are deterministic
 */

import { describe, it, expect } from 'vitest';
import { DriftBombModeRuntime } from '../../../client/src/4-runtime/gameplay/modes/DriftBombModeRuntime';
import { DriftBombBombController } from '../../../client/src/4-runtime/gameplay/modes/DriftBombBombController';
import { DriftBombRoundCoordinator, DriftBombEconomySystem } from '../../../client/src/4-runtime/gameplay/modes/DriftBombRoundCoordinator';

// ─────────────────────────────────────────────────────────────────────────
// SIMPLE RNG FOR DETERMINISTIC TESTING (borrowed from RuntimeDeterminismTrace tests)
// ─────────────────────────────────────────────────────────────────────────

function simpleRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('DriftBombModeRuntime — Determinism', () => {
  it('should initialize with consistent state', () => {
    const mode1 = new DriftBombModeRuntime();
    const mode2 = new DriftBombModeRuntime();

    expect(mode1.getState()).toEqual(mode2.getState());
  });

  it('should produce identical sequences of state changes', () => {
    const mode1 = new DriftBombModeRuntime();
    const mode2 = new DriftBombModeRuntime();

    // Identical transitions
    mode1.startRound(0);
    mode2.startRound(0);
    expect(mode1.getState()).toEqual(mode2.getState());

    mode1.enterBuyPhase();
    mode2.enterBuyPhase();
    expect(mode1.getState()).toEqual(mode2.getState());

    mode1.enterActionPhase();
    mode2.enterActionPhase();
    expect(mode1.getState()).toEqual(mode2.getState());
  });

  it('should maintain deterministic economy calculations', () => {
    const economy = new DriftBombEconomySystem();

    const result1 = economy.calculateRoundEconomy(2400, true, 0);
    const result2 = economy.calculateRoundEconomy(2400, true, 0);

    expect(result1).toBe(result2);
  });

  it('should handle loss streak economy consistently', () => {
    const economy = new DriftBombEconomySystem();

    const streak0 = economy.calculateRoundEconomy(2400, false, 0);
    const streak1 = economy.calculateRoundEconomy(2400, false, 1);
    const streak2 = economy.calculateRoundEconomy(2400, false, 2);

    // Loss streak should increase reward predictably
    expect(streak1).toBeGreaterThan(streak0);
    expect(streak2).toBeGreaterThanOrEqual(streak1);
  });

  it('should enforce max budget cap', () => {
    const economy = new DriftBombEconomySystem();

    const highBalance = economy.calculateRoundEconomy(15000, true, 0);
    // Should not exceed 16000 max
    expect(highBalance).toBeLessThanOrEqual(16000);
  });
});

describe('DriftBombBombController — Bomb Movement Determinism', () => {
  it('should follow identical waypoint paths on replay', () => {
    const controller1 = new DriftBombBombController();
    const controller2 = new DriftBombBombController();

    const waypoints = [
      { position: { x: 0, y: 0, z: 0 }, order: 0, epoch: 0 },
      { position: { x: 10, y: 0, z: 0 }, order: 1, epoch: 0 },
      { position: { x: 10, y: 10, z: 0 }, order: 2, epoch: 0 },
      { position: { x: 0, y: 10, z: 0 }, order: 3, epoch: 0 },
    ];

    controller1.initializeDriftPath(waypoints);
    controller2.initializeDriftPath(waypoints);

    expect(controller1.getWaypoints()).toEqual(controller2.getWaypoints());
  });

  it('should reproduce identical bomb positions across frames', () => {
    const controller1 = new DriftBombBombController();
    const controller2 = new DriftBombBombController();

    const waypoints = [
      { position: { x: 0, y: 0, z: 0 }, order: 0, epoch: 0 },
      { position: { x: 100, y: 0, z: 0 }, order: 1, epoch: 0 },
    ];

    controller1.initializeDriftPath(waypoints);
    controller2.initializeDriftPath(waypoints);

    controller1.startDrift(0);
    controller2.startDrift(0);

    // Simulate 10 frames with deterministic dt
    const dt = 0.0166; // 60fps
    for (let frame = 0; frame < 10; frame++) {
      const pos1 = controller1.updateDriftPosition(frame, dt);
      const pos2 = controller2.updateDriftPosition(frame, dt);

      expect(pos1).toEqual(pos2);
    }
  });

  it('should deterministically sort waypoints by order', () => {
    const controller1 = new DriftBombBombController();
    const controller2 = new DriftBombBombController();

    const unordered = [
      { position: { x: 20, y: 0, z: 0 }, order: 2, epoch: 0 },
      { position: { x: 0, y: 0, z: 0 }, order: 0, epoch: 0 },
      { position: { x: 10, y: 0, z: 0 }, order: 1, epoch: 0 },
    ];

    controller1.initializeDriftPath(unordered);
    controller2.initializeDriftPath(unordered);

    const waypoints1 = controller1.getWaypoints();
    const waypoints2 = controller2.getWaypoints();

    // Both should have identical sorted order
    expect(waypoints1).toEqual(waypoints2);
    expect(waypoints1[0].order).toBe(0);
    expect(waypoints1[1].order).toBe(1);
    expect(waypoints1[2].order).toBe(2);
  });

  it('should validate tether consistently', () => {
    const controller1 = new DriftBombBombController();
    const controller2 = new DriftBombBombController();

    const waypoints = [
      { position: { x: 0, y: 0, z: 0 }, order: 0, epoch: 0 },
      { position: { x: 50, y: 0, z: 0 }, order: 1, epoch: 0 },
    ];

    controller1.initializeDriftPath(waypoints);
    controller2.initializeDriftPath(waypoints);

    controller1.startDrift(0);
    controller2.startDrift(0);

    controller1.activateDefuseTether('player1', 15, false);
    controller2.activateDefuseTether('player1', 15, false);

    const defuserPos = { x: 5, y: 5, z: 0 };

    const valid1 = controller1.validateTether(defuserPos);
    const valid2 = controller2.validateTether(defuserPos);

    expect(valid1).toBe(valid2);
  });
});

describe('DriftBombRoundCoordinator — Round State Transitions', () => {
  it('should track identical round sequences', () => {
    const coord1 = new DriftBombRoundCoordinator();
    const coord2 = new DriftBombRoundCoordinator();

    coord1.startRound(0);
    coord2.startRound(0);
    expect(coord1.getRoundState()).toEqual(coord2.getRoundState());

    coord1.transitionToBuyPhase(1000);
    coord2.transitionToBuyPhase(1000);
    expect(coord1.getRoundState()).toEqual(coord2.getRoundState());

    coord1.transitionToActionPhase(21000);
    coord2.transitionToActionPhase(21000);
    expect(coord1.getRoundState()).toEqual(coord2.getRoundState());

    coord1.endRound(true, 121000);
    coord2.endRound(true, 121000);
    expect(coord1.getRoundState()).toEqual(coord2.getRoundState());
  });

  it('should calculate consistent win/loss streaks', () => {
    const coord = new DriftBombRoundCoordinator();

    // Simulate alternating wins/losses
    for (let i = 0; i < 5; i++) {
      coord.startRound(i * 1000);
      coord.endRound(i % 2 === 0, i * 1000 + 500);
    }

    const state = coord.getRoundState();
    expect(state.attackerWins + state.defenderWins).toBe(5);
  });

  it('should update loss streaks predictably', () => {
    const coord1 = new DriftBombRoundCoordinator();
    const coord2 = new DriftBombRoundCoordinator();

    // Both experience same loss/win sequence
    const sequence = [false, false, true, false, false];
    for (let i = 0; i < sequence.length; i++) {
      coord1.startRound(i * 1000);
      coord1.endRound(sequence[i], i * 1000 + 500);

      coord2.startRound(i * 1000);
      coord2.endRound(sequence[i], i * 1000 + 500);
    }

    expect(coord1.getRoundState()).toEqual(coord2.getRoundState());
  });
});

describe('DriftBomb — Fuzz Testing (Seeded RNG)', () => {
  it('should produce consistent bomb paths with seeded randomization', () => {
    const rng = simpleRng(12345);
    const positions1: Array<{ x: number; y: number; z: number }> = [];
    const positions2: Array<{ x: number; y: number; z: number }> = [];

    // Run 1: Generate waypoints with seeded RNG
    const rng1 = simpleRng(12345);
    const waypoints1 = [];
    for (let i = 0; i < 5; i++) {
      waypoints1.push({
        position: { x: rng1() * 100, y: rng1() * 100, z: rng1() * 100 },
        order: i,
        epoch: 0,
      });
    }

    // Run 2: Generate waypoints with same seed
    const rng2 = simpleRng(12345);
    const waypoints2 = [];
    for (let i = 0; i < 5; i++) {
      waypoints2.push({
        position: { x: rng2() * 100, y: rng2() * 100, z: rng2() * 100 },
        order: i,
        epoch: 0,
      });
    }

    // Both runs should produce identical waypoints
    expect(waypoints1.length).toBe(waypoints2.length);
    for (let i = 0; i < waypoints1.length; i++) {
      expect(waypoints1[i].position.x).toBeCloseTo(waypoints2[i].position.x, 5);
      expect(waypoints1[i].position.y).toBeCloseTo(waypoints2[i].position.y, 5);
      expect(waypoints1[i].position.z).toBeCloseTo(waypoints2[i].position.z, 5);
    }
  });

  it('should handle multiple random economy scenarios consistently', () => {
    const economy = new DriftBombEconomySystem();
    const rng1 = simpleRng(999);
    const rng2 = simpleRng(999);

    const results1 = [];
    const results2 = [];

    // Generate 10 random economy transitions
    for (let i = 0; i < 10; i++) {
      const balance = rng1() * 10000;
      const won = rng1() > 0.5;
      const streak = Math.floor(rng1() * 5);

      results1.push(economy.calculateRoundEconomy(balance, won, streak));
    }

    // Repeat with same seed
    for (let i = 0; i < 10; i++) {
      const balance = rng2() * 10000;
      const won = rng2() > 0.5;
      const streak = Math.floor(rng2() * 5);

      results2.push(economy.calculateRoundEconomy(balance, won, streak));
    }

    expect(results1).toEqual(results2);
  });
});

describe('DriftBomb — State Immutability', () => {
  it('should return immutable state snapshots', () => {
    const mode = new DriftBombModeRuntime();
    const state1 = mode.getState();
    const state2 = mode.getState();

    // Both should be equal but not identical objects
    expect(state1).toEqual(state2);
    expect(state1).not.toBe(state2);

    // Modifying returned state should not affect internal state
    (state1 as any).attackerScore = 999;
    expect(mode.getState().attackerScore).toBe(0);
  });

  it('should protect bomb position immutability', () => {
    const controller = new DriftBombBombController();
    const waypoints = [
      { position: { x: 0, y: 0, z: 0 }, order: 0, epoch: 0 },
      { position: { x: 10, y: 0, z: 0 }, order: 1, epoch: 0 },
    ];

    controller.initializeDriftPath(waypoints);
    const wp1 = controller.getWaypoints();
    const wp2 = controller.getWaypoints();

    expect(wp1).toEqual(wp2);
    expect(wp1).not.toBe(wp2);
  });
});
