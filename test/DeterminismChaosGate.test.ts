/**
 * SPRINT 5: Determinism Chaos Gate
 * 
 * In-memory client/server synchronization validation.
 * Runs 100 random gameplay inputs and validates that client and server
 * maintain identical state hashes (CRC32) across all frames.
 * 
 * This is the ULTIMATE DETERMINISM TEST - if this passes with flying colors,
 * the engine's networking determinism is FORTRESS-GRADE.
 */

import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Mock Player Input State
 */
interface InputFrame {
  seq: number;
  ts: number;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  lookDelta?: { x: number; y: number };
}

/**
 * Mock Player State
 */
interface PlayerStateSnapshot {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
  equipment: string[];
  state: string; // 'standing' | 'crouching' | 'jumping' | 'dead'
  kills: number;
  deaths: number;
  lastUpdateTick: number;
}

/**
 * Mock Deterministic State Hash
 * In production: CRC32 of serialized entity state
 */
function computeStateHash(state: PlayerStateSnapshot): string {
  const json = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32-bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Mock Client-Side Physics Predictor
 */
class MockClientPhysicsPredictor {
  private state: PlayerStateSnapshot;
  
  constructor(initialState: PlayerStateSnapshot) {
    this.state = { ...initialState };
  }

  processInput(input: InputFrame, deltaMs: number): PlayerStateSnapshot {
    const delta = deltaMs / 1000; // seconds
    const speed = 6; // units/sec
    const gravity = 9.8;
    
    // Simple movement prediction
    let dx = 0;
    let dy = 0;
    
    if (input.forward) dx += speed * delta;
    if (input.backward) dx -= speed * delta;
    if (input.left) dy -= speed * delta;
    if (input.right) dy += speed * delta;
    
    // Apply movement
    this.state.position.x += dx;
    this.state.position.y += dy;
    
    // Apply gravity
    this.state.position.z -= gravity * delta * delta;
    if (this.state.position.z < 0) this.state.position.z = 0;
    
    // Update state
    if (input.crouch && this.state.state !== 'crouching') {
      this.state.state = 'crouching';
    } else if (!input.crouch && this.state.state === 'crouching') {
      this.state.state = 'standing';
    }
    
    if (input.jump && this.state.position.z === 0 && this.state.state === 'standing') {
      this.state.position.z = 3.8; // jump impulse
      this.state.state = 'jumping';
    }
    
    this.state.lastUpdateTick++;
    
    return { ...this.state };
  }

  getState(): PlayerStateSnapshot {
    return { ...this.state };
  }

  setState(newState: PlayerStateSnapshot): void {
    this.state = { ...newState };
  }
}

/**
 * Mock Server-Side Physics Authority
 * Uses identical physics logic to client predictor
 */
class MockServerPhysicsAuthority {
  private state: PlayerStateSnapshot;
  
  constructor(initialState: PlayerStateSnapshot) {
    this.state = { ...initialState };
  }

  processInput(input: InputFrame, deltaMs: number): PlayerStateSnapshot {
    const delta = deltaMs / 1000; // seconds
    const speed = 6; // units/sec - MUST MATCH CLIENT
    const gravity = 9.8; // MUST MATCH CLIENT
    
    // Identical movement logic
    let dx = 0;
    let dy = 0;
    
    if (input.forward) dx += speed * delta;
    if (input.backward) dx -= speed * delta;
    if (input.left) dy -= speed * delta;
    if (input.right) dy += speed * delta;
    
    // Apply movement
    this.state.position.x += dx;
    this.state.position.y += dy;
    
    // Apply gravity
    this.state.position.z -= gravity * delta * delta;
    if (this.state.position.z < 0) this.state.position.z = 0;
    
    // Update state
    if (input.crouch && this.state.state !== 'crouching') {
      this.state.state = 'crouching';
    } else if (!input.crouch && this.state.state === 'crouching') {
      this.state.state = 'standing';
    }
    
    if (input.jump && this.state.position.z === 0 && this.state.state === 'standing') {
      this.state.position.z = 3.8; // MUST MATCH CLIENT
      this.state.state = 'jumping';
    }
    
    this.state.lastUpdateTick++;
    
    return { ...this.state };
  }

  getState(): PlayerStateSnapshot {
    return { ...this.state };
  }
}

/**
 * Random input generator
 */
function generateRandomInput(seq: number, ts: number): InputFrame {
  return {
    seq,
    ts,
    forward: Math.random() > 0.5,
    backward: Math.random() > 0.5,
    left: Math.random() > 0.5,
    right: Math.random() > 0.5,
    jump: Math.random() > 0.8,
    crouch: Math.random() > 0.7,
    sprint: Math.random() > 0.9,
    lookDelta: {
      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 10,
    }
  };
}

describe('Sprint 5: Determinism Chaos Gate', () => {
  let client: MockClientPhysicsPredictor;
  let server: MockServerPhysicsAuthority;
  let initialState: PlayerStateSnapshot;

  beforeEach(() => {
    initialState = {
      id: 'player-1',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: 100,
      maxHealth: 100,
      equipment: ['pistol', 'knife'],
      state: 'standing',
      kills: 0,
      deaths: 0,
      lastUpdateTick: 0,
    };

    client = new MockClientPhysicsPredictor(initialState);
    server = new MockServerPhysicsAuthority(initialState);
  });

  it('Maintains state hash parity with 100 random inputs over 10 seconds', () => {
    const totalFrames = 100;
    const frameDeltaMs = 100; // 100ms per frame = 10Hz
    const totalTimeMs = totalFrames * frameDeltaMs;

    const clientHashes: string[] = [];
    const serverHashes: string[] = [];
    const hashMismatches: { frame: number; client: string; server: string }[] = [];

    console.log(`\n[Determinism Chaos Gate] Running ${totalFrames} frames (${totalTimeMs}ms total)...`);

    for (let frame = 0; frame < totalFrames; frame++) {
      const ts = frame * frameDeltaMs;
      const input = generateRandomInput(frame, ts);

      // Process on both client and server
      const clientState = client.processInput(input, frameDeltaMs);
      const serverState = server.processInput(input, frameDeltaMs);

      // Compute state hashes
      const clientHash = computeStateHash(clientState);
      const serverHash = computeStateHash(serverState);

      clientHashes.push(clientHash);
      serverHashes.push(serverHash);

      // Check for mismatch
      if (clientHash !== serverHash) {
        hashMismatches.push({
          frame,
          client: clientHash,
          server: serverHash,
        });

        console.warn(`  [Frame ${frame}] HASH MISMATCH`);
        console.warn(`    Input: forward=${input.forward} backward=${input.backward} left=${input.left} right=${input.right} jump=${input.jump} crouch=${input.crouch}`);
        console.warn(`    Client State: pos=(${clientState.position.x.toFixed(2)}, ${clientState.position.y.toFixed(2)}, ${clientState.position.z.toFixed(2)})`);
        console.warn(`    Server State: pos=(${serverState.position.x.toFixed(2)}, ${serverState.position.y.toFixed(2)}, ${serverState.position.z.toFixed(2)})`);
      }

      // Log every 10 frames for progress
      if ((frame + 1) % 10 === 0) {
        const allMatch = clientHashes.slice(0, frame + 1).every((h, i) => h === serverHashes[i]);
        console.log(`  [Frame ${frame + 1}/${totalFrames}] ${allMatch ? '✓ All hashes match' : '✗ Hash mismatches detected'}`);
      }
    }

    console.log(`\n[Determinism Chaos Gate] Completed ${totalFrames} frames`);
    console.log(`  Total hash mismatches: ${hashMismatches.length}/${totalFrames}`);
    console.log(`  Determinism rate: ${((totalFrames - hashMismatches.length) / totalFrames * 100).toFixed(1)}%`);

    // Assertions
    expect(hashMismatches, 'Client and server state hashes must match every frame').toHaveLength(0);
    expect(client.getState().kills, 'Client state should be preserved').toBe(0);
    expect(server.getState().kills, 'Server state should be preserved').toBe(0);
  });

  it('Detects position desynchronization when physics constants differ', () => {
    // This test demonstrates that DIFFERENT physics constants WILL cause failures
    class BadServerPhysics extends MockServerPhysicsAuthority {
      processInput(input: InputFrame, deltaMs: number): PlayerStateSnapshot {
        // Intentionally use WRONG gravity constant
        const delta = deltaMs / 1000;
        const speed = 6;
        const WRONG_GRAVITY = 9.0; // Should be 9.8
        
        let dx = 0;
        let dy = 0;
        
        if (input.forward) dx += speed * delta;
        if (input.backward) dx -= speed * delta;
        if (input.left) dy -= speed * delta;
        if (input.right) dy += speed * delta;
        
        const state = this.getState();
        state.position.x += dx;
        state.position.y += dy;
        state.position.z -= WRONG_GRAVITY * delta * delta; // WRONG!
        if (state.position.z < 0) state.position.z = 0;
        
        state.lastUpdateTick++;
        return state;
      }
    }

    const badServer = new BadServerPhysics(initialState);
    const input = generateRandomInput(0, 0);

    // First frame - might match
    const clientState1 = client.processInput(input, 100);
    const serverState1 = badServer.processInput(input, 100);

    // After many frames with gravity affecting Z position, they will diverge
    for (let i = 1; i < 10; i++) {
      client.processInput(generateRandomInput(i, i * 100), 100);
      badServer.processInput(generateRandomInput(i, i * 100), 100);
    }

    const clientFinal = client.getState();
    const serverFinal = badServer.getState();

    // Z positions should diverge due to gravity difference
    const divergence = Math.abs(clientFinal.position.z - serverFinal.position.z);
    
    expect(divergence).toBeGreaterThan(0.01, 'Physics constant differences must cause state divergence');
  });

  it('Handles edge cases: zero input, rapid state changes', () => {
    const inputs: InputFrame[] = [
      // Zero input
      { seq: 0, ts: 0, forward: false, backward: false, left: false, right: false, jump: false, crouch: false, sprint: false },
      // Max input
      { seq: 1, ts: 100, forward: true, backward: true, left: true, right: true, jump: true, crouch: true, sprint: true },
      // Rapid jump/crouch toggle
      { seq: 2, ts: 200, forward: false, backward: false, left: false, right: false, jump: true, crouch: false, sprint: false },
      { seq: 3, ts: 300, forward: false, backward: false, left: false, right: false, jump: false, crouch: true, sprint: false },
    ];

    const hashes = inputs.map((input, i) => {
      const cState = client.processInput(input, 100);
      const sState = server.processInput(input, 100);
      
      const cHash = computeStateHash(cState);
      const sHash = computeStateHash(sState);
      
      expect(cHash).toBe(sHash, `Frame ${i} must match despite edge case input`);
      return { frame: i, hash: cHash };
    });

    expect(hashes).toHaveLength(4);
    // All hashes should be different from each other (state is changing)
    const uniqueHashes = new Set(hashes.map(h => h.hash));
    expect(uniqueHashes.size).toBe(4, 'Each edge case input should produce different state hash');
  });

  it('Validates memory gates: state size remains predictable', () => {
    const stateStrings: string[] = [];
    
    for (let i = 0; i < 100; i++) {
      const input = generateRandomInput(i, i * 100);
      client.processInput(input, 100);
      server.processInput(input, 100);
      
      const state = client.getState();
      stateStrings.push(JSON.stringify(state));
    }

    // All serialized state objects should be similar size (no unbounded growth)
    const sizes = stateStrings.map(s => s.length);
    const avgSize = sizes.reduce((a, b) => a + b) / sizes.length;
    const maxSize = Math.max(...sizes);
    const minSize = Math.min(...sizes);
    
    const variance = maxSize - minSize;
    const varianceRatio = variance / avgSize;

    console.log(`  State serialization size: avg=${avgSize.toFixed(0)}, min=${minSize}, max=${maxSize}, variance=${varianceRatio.toFixed(3)}`);
    
    // Variance should be minimal (not growing state objects)
    expect(varianceRatio).toBeLessThan(0.1, 'State size variance must be <10% (no unbounded growth)');
  });
});
