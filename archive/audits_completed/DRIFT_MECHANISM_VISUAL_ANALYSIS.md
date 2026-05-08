# DRIFT MECHANISM VISUAL ANALYSIS

## Frame-by-Frame Drift Accumulation

```
=== SCENARIO: Player moves FORWARD continuously ===

TIME        CLIENT POSITION    AUTH POSITION    ERROR     VELOCITY      ACTION
─────────────────────────────────────────────────────────────────────────────

T=0ms       10.0              10.0             0.0       1.0 (input)    Client starts moving
            [position = auth + error]

T=50ms      10.5              10.1             0.4       1.0 (input)    Server moved slower (lag)
(snap)      decay: 10.0 + 0.4 = 10.4           (error from before)
            input:  10.4 + 1.0*0.05 = 10.45
            
            >>> SNAPSHOT ARRIVES <<<
            Auth position = 10.1
            Client position = 10.45
            New error = 10.45 - 10.1 = 0.35
            Entity.setPosition(10.1)  ← Jump back to 10.1
            
T=100ms     10.1               10.2             0.35     1.0 (input)    Decay + input on new auth
            decay: 10.1 + 0.35*0.9 = 10.415                              (Correction window still active)
            input: 10.415 + 1.0*0.05 = 10.465
            
T=150ms     10.465             10.3             0.165    1.0 (input)    
            decay: 10.3 + 0.165*0.9 = 10.448
            input: 10.448 + 1.0*0.05 = 10.498

T=200ms     10.498             10.4             0.098    1.0 (input)
            >>> SNAPSHOT ARRIVES <<<
            Auth = 10.4, Client = 10.498
            New error = 0.098
            
T=250ms     10.4               10.5             0.098    1.0 (input)    
            decay: 10.4 + 0.098*0.9 = 10.488
            input: 10.488 + 1.0*0.05 = 10.538

RESULT AFTER 250ms:
  Server position: 10.5 (moved 0.5 units)
  Client position: 10.538 (moved 0.538 units)
  ─────────────────────────
  DRIFT = 0.038 units per 250ms = ~1.5 units/sec at THIS rate
  
With 20Hz snapshots (50ms apart):
  Each snapshot window introduces ~0.06 units drift
  4 windows per 200ms = 0.24 units/sec * 4+ windows = ~1 unit/sec OBSERVED DRIFT
```

---

## THE FUNDAMENTAL PROBLEM

### Current Architecture (BROKEN)
```
┌─────────────────────────────────────────────────────────────┐
│ FRAME N                                                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. applyPositionErrorDecay()                                │
│     ├─ error *= 0.9                                          │
│     ├─ pos = auth + error          ← Position at auth        │
│     └─ entity.setPosition(pos)                               │
│                                                               │
│  2. applyLiveLocalInput()                                    │
│     ├─ velocity += input                                     │
│     ├─ nextPos = pos + velocity*dt ← Position AWAY from auth │
│     └─ entity.setPosition(nextPos)                           │
│                                                               │
│  3. Snapshot arrives (from network)                          │
│     ├─ current = entity.getPosition()  ← NOW away from auth  │
│     ├─ error_new = current - auth                            │
│     │              (non-zero!)                               │
│     ├─ positionErrorDecayRemaining = 100ms  ← RESET TIMER    │
│     └─ entity.setPosition(auth)      ← Jump back again       │
│                                                               │
│  Result: Error never decays away! Input negates decay!       │
└─────────────────────────────────────────────────────────────┘
```

### Why Decay % Matters
```
Decay factor = 0.9 (10% reduction per frame)
At 60 FPS: frame time = 16.67ms, decay every frame

Frame  Error   After Decay   Input Adds   New Error   Net Drift
─────  ─────   ───────────   ──────────   ─────────   ─────────
  0    0.50      0.45         +0.083        0.533        0.033
  1    0.533     0.480        +0.083        0.563        0.063
  2    0.563     0.507        +0.083        0.590        0.090
  3    0.590     0.531        +0.083        0.614        0.114
  4    0.614     0.553        +0.083        0.636        0.136
  5    0.636     0.572        +0.083        0.655        0.155
  ...
  ∞    ≈0.833    ≈0.750        +0.083        0.833    STEADY STATE

Steady state error: 0.833 units
If 60 FPS and moving 5 units/sec (0.0833 per frame):
  Error accumulation rate = 0.083 units/frame * 60 fps ≈ 5 units/sec THEORETICAL
  
Observed: ~1 unit/sec (accounts for snapshot windows, averaging, multiple players)
```

---

## POSITION MODIFICATION CALLSTACK

```
Session Update Loop (every frame)
│
├─ NetworkSyncSystem.update(dt)
│  │
│  ├─ applyPositionErrorDecay(dt)                   [DECAY APPLIED]
│  │  ├─ runtime.positionErrorDecayRemaining -= dt
│  │  ├─ runtime.positionError *= (1 - 0.1)
│  │  ├─ binding.entity.setPosition(auth + error)   [SET 1]
│  │  └─ emit SMOOTHNESS_SAMPLE
│  │
│  ├─ fixedAccumulator += dt
│  │
│  └─ while (fixedAccumulator >= fixedStep)
│     │
│     └─ applyLiveLocalInput(dt)                    [INPUT APPLIED]
│        └─ applyInput(binding, input, dt)
│           ├─ runtime.velocity = calculated_velocity
│           ├─ nextPosition = currentPos + velocity*dt
│           ├─ binding.entity.setPosition(nextPos)  [SET 2]
│           └─ emit playerInput
│
└─ [Network receives snapshot (async)]
   │
   └─ NetworkSyncSystem.applyAuthoritativeSnapshot(snapshot)
      │
      ├─ before = binding.entity.getPosition()
      ├─ correctionDistance = distance(auth, before)
      │
      ├─ if correctionDistance > 0.05:
      │  │
      │  ├─ binding.entity.setPosition(auth)        [SET 3 - SNAPS BACK]
      │  ├─ runtime.positionError = after - auth    [ERROR RESET]
      │  ├─ runtime.positionErrorDecayRemaining = 100ms  [TIMER RESET]
      │  └─ runtime.velocity = snapshot.velocity    [VELOCITY REPLACEMENT]
      │
      └─ emit RECONCILIATION_BEGIN


NEXT FRAME: Back to applyPositionErrorDecay() with non-zero error!
           Cycle repeats...
```

---

## VELOCITY MODIFICATION CALLSTACK

```
Prediction Phase (Client)
│
└─ applyInput(binding, input, dt)
   ├─ runtime.velocity = calculated from input        [MOD 1]
   ├─ if (movementIntent.jump):
   │  └─ runtime.velocity.y = jumpImpulse             [MOD 2]
   ├─ if (isAirborne):
   │  └─ runtime.velocity.y -= gravity * dt           [MOD 3]
   ├─ if (statusEffect.blockMovement):
   │  └─ runtime.velocity.x/z = 0                     [MOD 4]
   ├─ if (collisionResolver):
   │  └─ runtime.velocity = movement / dt             [MOD 5]
   └─ binding.entity.setPosition(nextPos)


Reconciliation Phase (when snapshot arrives)
│
└─ applyAuthoritativeSnapshot(snapshot)
   ├─ runtime.velocity = snapshot.velocity            [MOD 6 - OVERWRITES ALL]
   │
   ├─ applyAuthoritativeMovementState(runtime, auth, pos)
   │  └─ if (grounded && velocity.y < 0):
   │     └─ runtime.velocity.y = 0                    [MOD 7 - SECOND EDIT]
   │
   └─ [Next frame: back to applyInput() with snapshot velocity]


RESULT: 8 independent places modifying velocity!
        No single source of truth.
        Each modification assumes previous state is correct.
```

---

## MISMATCH BETWEEN CLIENT AND SERVER

### Server Authority Position Update
```
Server: applyPlayerMovementStep()
├─ Calculate nextVelocity (from input + physics)
├─ Resolve collision: resolvedPosition = resolveMovement(...)
├─ player.position = resolvedPosition              [ATOMIC SET]
└─ player.velocity = nextVelocity / dt             [DERIVED FROM POSITION DELTA]

Result: Position and velocity are SYNCHRONIZED
        Velocity = (position - lastPosition) / dt
```

### Client Prediction Position Update
```
Client: applyInput()
├─ Calculate nextVelocity (from input + physics)
├─ nextPosition = currentPos + velocity*dt
├─ binding.entity.setPosition(nextPosition)        [PREDICTION]
│
└─ Snapshot arrives:
   ├─ auth_velocity = snapshot.velocity
   ├─ runtime.velocity = auth_velocity             [DIRECT COPY - DESYNC!]
   └─ nextPosition = lastPos + auth_velocity*dt    [USED NEXT FRAME]

Result: Position from prediction, velocity from server
        These may not correspond!
        
        Example:
          Prediction: pos=10, vel=5
          Server: pos=10.1, vel=2  (lag/correction)
          Client after snapshot: pos=10.1, vel=2
          
          Next frame prediction:
            Expected: pos = 10.1 + 2*0.016 ≈ 10.13
            With input: pos = 10.1 + 5*0.016 ≈ 10.18
            
            MISMATCH!
```

---

## CORRECTION THRESHOLD ANALYSIS

```
CORRECTION_THRESHOLD = 0.05 (5cm)
POSITION_ERROR_DECAY_MS = 100 (100ms)
POSITION_ERROR_DECAY_FACTOR = 0.1 (10% per frame)

At 20 Hz (50ms snapshots):

Snapshot 1: error = 0.5m
  └─ Triggers correction (> 0.05)
  └─ Starts 100ms decay

Snapshot 2 (50ms later): 
  └─ If still decaying: error ≈ 0.5 * 0.9^3 ≈ 0.365m
  └─ If input added movement: error = 0.365 + input_movement
  └─ If error still > 0.05: ANOTHER correction triggered!
  └─ Timer reset to 100ms again

Result: Correction window never completes if:
  1. Input keeps moving entity (continuous movement)
  2. Snapshots arrive frequently (network latency < 100ms)
  3. Both conditions are true in typical multiplayer scenario

With moving player + 50ms server ticks:
  Every snapshot potentially resets the correction window
  Decay never catches up
  Error accumulates systematically
```

---

## ROOT CAUSE: TEMPORAL ORDERING

The fundamental issue is the ORDER OF OPERATIONS doesn't match reality:

```
WHAT WE DO (WRONG):
  Frame N:
    1. Apply decay (move toward auth)
    2. Apply input (move away from auth)  ← NEGATES DECAY
    3. Snapshot arrives (recalculate error)
    
  Frame N+1:
    1. Decay again (ineffective)
    2. Input again (more drift)
    3. ...error never resolves...

WHAT WE SHOULD DO (CORRECT):
  Frame N:
    1. Snapshot arrives → set authoritative position/velocity
    2. Apply input prediction (from authoritative state)
    3. Save next frame's predicted state
    
  Frame N+1:
    1. Snapshot arrives → update authoritative
    2. Compare prediction vs. new authority
    3. Smoothly blend to authority (no hard jumps)
    4. Apply input prediction (from blended state)
```

The decay is trying to work backwards:
- It tries to pull position toward auth WHILE
- Input is pushing position away from auth
- They work at cross purposes, causing systematic drift
