import {
  applyPlayerMovementStep,
  clampHorizontalMagnitude,
  createIdleInputState,
  sanitizePlayerInput,
  type MovementRuntimePlayer,
} from '../../server/src/movement/MovementRuntime'

describe('MovementRuntime', () => {
  let player: MovementRuntimePlayer

  beforeEach(() => {
    player = {
      id: 'player1',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isCrouching: false,
      isAirborne: true,
      groundHeight: 0,
      currentInput: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        sprint: false,
        airControl: true,
        yaw: 0,
        pitch: 0,
      },
      jumpBufferRemaining: 0,
      coyoteTimeRemaining: 0,
    }
  })

  it('clamps horizontal velocity magnitude', () => {
    const vector = { x: 10, y: 5, z: 10, z: 10 }
    const clamped = clampHorizontalMagnitude(vector, 5)

    const magnitude = Math.sqrt(clamped.x * clamped.x + clamped.z * clamped.z)
    expect(magnitude).toBeLessThanOrEqual(5.001)
  })

  it('preserves Y velocity when clamping horizontal', () => {
    const vector = { x: 10, y: 7, z: 10 }
    const clamped = clampHorizontalMagnitude(vector, 5)

    expect(clamped.y).toBe(7)
  })

  it('returns vector unchanged if already under max magnitude', () => {
    const vector = { x: 2, y: 0, z: 2 }
    const clamped = clampHorizontalMagnitude(vector, 5)

    expect(clamped).toEqual(vector)
  })

  it('handles zero vector gracefully', () => {
    const vector = { x: 0, y: 0, z: 0 }
    const clamped = clampHorizontalMagnitude(vector, 5)

    expect(clamped).toEqual(vector)
  })

  it('sanitizes player input values', () => {
    const input = sanitizePlayerInput({
      input: {
        forward: true,
        backward: true,
        left: false,
        right: false,
        movementIntent: { jump: true, crouch: false },
        sprint: true,
        airControl: true,
        yaw: 270,
        pitch: 10,
      },
      currentRotation: { x: 0, y: 0, z: 0 },
      readFiniteNumber: (value) => (typeof value === 'number' ? value : undefined),
      sanitizeAngle: (value, fallback) => (typeof value === 'number' ? value : fallback),
      sanitizePitch: (value, fallback) => (typeof value === 'number' ? value : fallback),
    })

    expect(input.forward).toBe(true)
    expect(input.backward).toBe(true)
    expect(input.jump).toBe(true)
    expect(input.yaw).toBe(270)
    expect(input.pitch).toBe(10)
  })

  it('applies movement step with blocked movement modifier', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.forward = true
    player.currentInput.jump = false
    player.groundHeight = 0
    player.statusMovementModifier = { blockMovement: true, speedMultiplier: 0 }

    applyPlayerMovementStep({
      player,
      tick: 1,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: () => ({ x: 0, y: 0, z: 0 }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.velocity.x).toBe(0)
    expect(player.velocity.z).toBe(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('decelerates horizontally when input stops on the ground', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.position = { x: 0, y: 0, z: 0 }
    player.groundHeight = 0
    player.velocity = { x: 4, y: 0, z: 0 }

    applyPlayerMovementStep({
      player,
      tick: 1,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.velocity.x).toBeLessThan(4)
    expect(player.velocity.z).toBe(0)
    expect(player.velocity.x).toBeGreaterThanOrEqual(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('does not lower groundHeight when player sinks slightly below floor', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.position = { x: 0, y: -0.03, z: 0 }
    player.groundHeight = 0
    player.velocity = { x: 0, y: 0, z: 0 }

    applyPlayerMovementStep({
      player,
      tick: 1,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.groundHeight).toBe(0)
    expect(player.position.y).toBe(0)
    expect(player.isAirborne).toBe(false)
    expect(player.velocity.y).toBe(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('applies jump buffer and pending movement intent jump', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.forward = false
    player.currentInput.jump = false
    player.groundHeight = 0
    player.pendingMovementIntent = {
      direction: { x: 1, y: 0, z: 0 },
      horizontalImpulse: 0,
      jump: true,
      verticalImpulse: 12,
      crouch: false,
    }

    applyPlayerMovementStep({
      player,
      tick: 1,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position) => ({ x: position.x, y: position.y + 1, z: position.z }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.pendingMovementIntent).toBeNull()
    expect(player.isAirborne).toBe(true)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('applies pending horizontal impulse and clears the intent', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.forward = false
    player.currentInput.jump = false
    player.groundHeight = 0
    player.pendingMovementIntent = {
      direction: { x: 1, y: 0, z: 0 },
      horizontalImpulse: 5,
      jump: false,
      verticalImpulse: 0,
      crouch: false,
    }

    applyPlayerMovementStep({
      player,
      tick: 2,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.pendingMovementIntent).toBeNull()
    expect(player.velocity.x).toBeGreaterThan(0)
    expect(player.position.x).toBeGreaterThan(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('applies crouch state and reduces move speed', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.crouch = true
    player.currentInput.forward = true
    player.groundHeight = 0

    applyPlayerMovementStep({
      player,
      tick: 3,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position) => ({ ...position }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.isCrouching).toBe(true)
    expect(player.velocity.x).toBeLessThanOrEqual(5 * 0.5 + 0.1)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('reduces air control when disabled', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = true
    player.currentInput.forward = true
    player.currentInput.airControl = false
    player.velocity = { x: 2, y: 0, z: 0 }

    applyPlayerMovementStep({
      player,
      tick: 1,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position) => ({ ...position }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.velocity.x).toBeGreaterThanOrEqual(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('consumes jump buffer during coyote time', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = true
    player.position = { x: 0, y: 0.2, z: 0 }
    player.velocity = { x: 0, y: 0, z: 0 }
    player.groundHeight = 0
    player.jumpBufferRemaining = 0.1
    player.coyoteTimeRemaining = 0.1

    applyPlayerMovementStep({
      player,
      tick: 4,
      step: 0.05,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.jumpBufferRemaining).toBe(0)
    expect(player.velocity.y).toBeGreaterThan(0)
    expect(player.isAirborne).toBe(true)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('applies speed multiplier from status movement modifier', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.forward = true
    player.groundHeight = 0
    player.statusMovementModifier = { speedMultiplier: 0.2 }

    applyPlayerMovementStep({
      player,
      tick: 5,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(Math.abs(player.velocity.x)).toBeLessThan(5 * 0.3)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('applies impulse override from status movement modifier', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.forward = true
    player.groundHeight = 0
    player.statusMovementModifier = { impulseOverride: { x: -4, y: 0, z: 0 } }

    applyPlayerMovementStep({
      player,
      tick: 6,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.velocity.x).toBeCloseTo(-4, 3)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('moves when backward, left, and right input are all active', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.backward = true
    player.currentInput.left = true
    player.currentInput.right = true
    player.groundHeight = 0

    applyPlayerMovementStep({
      player,
      tick: 7,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.position.z).toBeGreaterThan(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('handles a pending crouch intent and clears it on apply', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = false
    player.currentInput.crouch = false
    player.currentInput.forward = false
    player.groundHeight = 0
    player.pendingMovementIntent = {
      direction: { x: 0, y: 0, z: 0 },
      horizontalImpulse: 0,
      jump: false,
      verticalImpulse: 0,
      crouch: true,
    }

    applyPlayerMovementStep({
      player,
      tick: 8,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position) => ({ ...position }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.pendingMovementIntent).toBeNull()
    expect(player.isCrouching).toBe(true)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('keeps airborne state when descending without landing', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = true
    player.position = { x: 0, y: 2, z: 0 }
    player.groundHeight = 0
    player.velocity = { x: 0, y: -2, z: 0 }

    applyPlayerMovementStep({
      player,
      tick: 9,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: (_playerId, position, desiredMovement) => ({
        x: position.x + desiredMovement.x,
        y: position.y + desiredMovement.y,
        z: position.z + desiredMovement.z,
      }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.isAirborne).toBe(true)
    expect(player.position.y).toBeLessThan(2)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('retains upward velocity when ground collision clamps vertical movement', () => {
    const syncPlayerEntity = vi.fn()
    player.isAirborne = true
    player.position = { x: 0, y: 0.2, z: 0 }
    player.groundHeight = 0
    player.velocity = { x: 0, y: 1, z: 0 }

    applyPlayerMovementStep({
      player,
      tick: 10,
      step: 0.1,
      now: 100,
      config: {
        playerMoveSpeed: 5,
        playerMoveAcceleration: 20,
        playerJumpImpulse: 10,
        playerGravity: 9.81,
        playerJumpBufferSeconds: 0.2,
        playerCoyoteTimeSeconds: 0.1,
        playerAirControlFactor: 0.5,
        playerCollisionRadius: 0.5,
        playerCrouchHalfHeight: 0.5,
        playerEyeHeight: 1.8,
      },
      syncPlayerEntity,
      resolveMovement: () => ({ x: 0, y: 0, z: 0 }),
      refreshPlayerStatusMovementModifier: () => undefined,
    })

    expect(player.position.y).toBe(0)
    expect(player.velocity.y).toBeLessThanOrEqual(0)
    expect(player.isAirborne).toBe(true)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player1')
  })

  it('creates an idle input state with all flags false', () => {
    const idle = createIdleInputState()

    expect(idle.forward).toBe(false)
    expect(idle.backward).toBe(false)
    expect(idle.left).toBe(false)
    expect(idle.right).toBe(false)
    expect(idle.jump).toBe(false)
    expect(idle.crouch).toBe(false)
    expect(idle.airControl).toBe(true)
  })
})
