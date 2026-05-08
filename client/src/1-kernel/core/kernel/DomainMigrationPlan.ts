/**
 * DOMAIN-MIGRATION PLAN for Engine v0.1.3
 * 
 * Strategy: Migrate 67 systems in phases, grouped by Domain.
 * Each domain is migrated sequentially to maintain stability and debuggability.
 * 
 * =============================================================================
 * PHASE 1: ANALYSIS & CLASSIFICATION
 * =============================================================================
 */

/**
 * PHASE 1A: SYSTEM CLASSIFICATION
 * 
 * All 67 systems categorized into 3 buckets:
 */

// ===========================================================================
// TIER 1: KERNEL-SYSTEMS (Must be deterministic, DOD-eligible)
// ===========================================================================

const KERNEL_SYSTEMS = {
  // --- Gameplay Domain ---
  'PhysicsSystem': {
    domain: 'gameplay',
    priority: 'P1',
    reason: 'Core simulation loop; controls entity velocity, collision',
    status: 'PENDING_MIGRATION',
    buffers: ['positions', 'velocities'],
  },
  'HealthSystem': {
    domain: 'gameplay',
    priority: 'P1',
    reason: 'Mutation hook for health events; must track damage-to-frame',
    status: 'PENDING_MIGRATION',
    buffers: ['healths'],
  },
  'WeaponSystem': {
    domain: 'gameplay',
    priority: 'P1',
    reason: 'Attack resolution; deterministic hit detection',
    status: 'PENDING_MIGRATION',
    buffers: ['inventories', 'abilities'],
  },
  'SpatialPartitionSystem': {
    domain: 'gameplay',
    priority: 'P1',
    reason: 'Culling & proximity queries; must stay in sync with positions',
    status: 'PENDING_MIGRATION',
    buffers: ['positions'],
  },
  'EnemyAI': {
    domain: 'gameplay',
    priority: 'P1_HIGH',
    reason: 'AI behavior tree execution; needs deterministic pathfinding',
    status: 'PENDING_MIGRATION',
    buffers: ['positions', 'velocities'],
  },

  // --- Network Domain ---
  'ReplicationSystem': {
    domain: 'network',
    priority: 'P2',
    reason: 'Snapshot reconciliation; must execute before gameplay tick',
    status: 'PENDING_MIGRATION (Partial)',
    buffers: ['positions', 'healths', 'inventories'],
  },
  'CollisionAuthorityService': {
    domain: 'network',
    priority: 'P2',
    reason: 'Server-side hit validation; must validate against authoritative state',
    status: 'PENDING_MIGRATION',
    buffers: ['positions'],
  },
};

// ===========================================================================
// TIER 2: BRIDGE-SYSTEMS (Event-driven, read snapshots, non-deterministic)
// ===========================================================================

const BRIDGE_SYSTEMS = {
  // --- UI Domain ---
  'HUDSystem': {
    domain: 'ui',
    priority: 'P3',
    reason: 'Renders HUD; reads health/ammo snapshots but doesn\'t mutate',
    status: 'ACTIVE_AS_BRIDGE',
  },
  'ToolbarSystem': {
    domain: 'ui',
    priority: 'P3',
    reason: 'Equipment UI; listens to inventory events',
    status: 'ACTIVE_AS_BRIDGE',
  },
  'InventoryGridManager': {
    domain: 'ui',
    priority: 'P3',
    reason: 'UI for item grid; read-only access to inventory buffers',
    status: 'ACTIVE_AS_BRIDGE',
  },

  // --- Audio Domain ---
  'GameAudioManager': {
    domain: 'audio',
    priority: 'P3',
    reason: 'Plays sound effects; responds to combat/damage events',
    status: 'ACTIVE_AS_BRIDGE',
  },
  'AudioEngine': {
    domain: 'audio',
    priority: 'P3',
    reason: 'Low-level audio playback',
    status: 'ACTIVE_AS_BRIDGE',
  },

  // --- VFX Domain ---
  'VFXMaker': {
    domain: 'vfx',
    priority: 'P3',
    reason: 'Particle effects; triggered by events',
    status: 'ACTIVE_AS_BRIDGE',
  },

  // --- Animation Domain ---
  'SpriteAnimationSystem': {
    domain: 'animation',
    priority: 'P3',
    reason: '2D sprite frame updates; driven by entity state changes',
    status: 'ACTIVE_AS_BRIDGE',
  },

  // --- Rendering Domain ---
  'PS1ShaderSystem': {
    domain: 'rendering',
    priority: 'P3',
    reason: 'Shader effects; reads position snapshots',
    status: 'ACTIVE_AS_BRIDGE',
  },
  'MaterialManager': {
    domain: 'rendering',
    priority: 'P3',
    reason: 'Material library; stateless',
    status: 'ACTIVE_AS_BRIDGE',
  },
  'CullingSystem': {
    domain: 'rendering',
    priority: 'P3',
    reason: 'View frustum culling; reads position buffers',
    status: 'ACTIVE_AS_BRIDGE',
  },

  // --- Debug Domain ---
  'AnalyticsService': {
    domain: 'debug',
    priority: 'P3',
    reason: 'Telemetry collection; non-deterministic',
    status: 'ACTIVE_AS_BRIDGE',
  },
};

// ===========================================================================
// TIER 3: LEGACY-ADAPTER (Can remain independent, read snapshots)
// ===========================================================================

const LEGACY_ADAPTER_SYSTEMS = {
  // --- Interaction Domain ---
  'InteractionManager': {
    domain: 'interaction',
    priority: 'P4',
    reason: 'Complex UI modal logic; not suitable for DOD',
    status: 'ACTIVE_AS_LEGACY',
  },
  'ProximityInteraction': {
    domain: 'interaction',
    priority: 'P4',
    reason: 'Reads position snapshots, triggers UI prompts',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- Spawn Domain ---
  'SpawnSystem': {
    domain: 'spawn',
    priority: 'P4',
    reason: 'Entity instantiation; complex prefab logic',
    status: 'ACTIVE_AS_LEGACY',
  },
  'PrefabSystem': {
    domain: 'spawn',
    priority: 'P4',
    reason: 'Prefab asset management; stateful',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- Procedural Generation ---
  'ProceduralLevel': {
    domain: 'procedural',
    priority: 'P4',
    reason: 'Level generation; one-time initialization',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- AI Path Finding ---
  'PathfindingSystem': {
    domain: 'ai',
    priority: 'P4',
    reason: 'A* pathfinding; complex, expensive computation',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- Physics Gun ---
  'PhysGunSystem': {
    domain: 'gameplay_special',
    priority: 'P4',
    reason: 'Special power; complex physics queries',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- Adaptive Content ---
  'AdaptiveRuntimeLayer': {
    domain: 'adaptive',
    priority: 'P4',
    reason: 'Content adaptation; metadata-based',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- Resource Management ---
  'ResourceManager': {
    domain: 'resource',
    priority: 'P4',
    reason: 'Asset loading; I/O bound',
    status: 'ACTIVE_AS_LEGACY',
  },

  // --- 2D Systems (Legacy Editor) ---
  'Camera2DSystem': {
    domain: '2d',
    priority: 'P4',
    reason: '2D scene editing; orthographic view',
    status: 'ACTIVE_AS_LEGACY',
  },
  'TilemapSystem': {
    domain: '2d',
    priority: 'P4',
    reason: 'Tilemap rendering',
    status: 'ACTIVE_AS_LEGACY',
  },
  'Physics2DSystem': {
    domain: '2d',
    priority: 'P4',
    reason: '2D physics (editor mode)',
    status: 'ACTIVE_AS_LEGACY',
  },
};

/**
 * =============================================================================
 * PHASE 2: DOMAIN-MIGRATION SEQUENCE
 * =============================================================================
 * 
 * Execute migrations in this order to minimize regression risk:
 */

const MIGRATION_SEQUENCE = [
  {
    phase: 1,
    domain: 'GAMEPLAY',
    sprint: 'Sprint-A: Combat Core',
    systems: ['HealthSystem', 'WeaponSystem'],
    goals: [
      'Base health mutation kernel',
      'Weapon state tracking',
      'Damage resolution in DOD',
    ],
    blockers: [],
    estimated_days: 3,
  },
  {
    phase: 1,
    domain: 'GAMEPLAY',
    sprint: 'Sprint-B: Movement & Physics',
    systems: ['PhysicsSystem'],
    goals: [
      'Velocity integration into kernel',
      'Collision queries (read-only)',
    ],
    blockers: ['Sprint-A must pass IntegrationCheck'],
    estimated_days: 2,
  },
  {
    phase: 1,
    domain: 'GAMEPLAY',
    sprint: 'Sprint-C: Spatial Optimization',
    systems: ['SpatialPartitionSystem'],
    goals: [
      'Culling tree built from position buffer',
      'Proximity queries for AI',
    ],
    blockers: ['Sprint-B must pass'],
    estimated_days: 2,
  },
  {
    phase: 2,
    domain: 'NETWORK',
    sprint: 'Sprint-D: Multiplayer Sync',
    systems: ['ReplicationSystem', 'CollisionAuthorityService'],
    goals: [
      'Snapshot reconciliation in kernel tick',
      'Server-authority validation',
    ],
    blockers: ['Phase 1 complete'],
    estimated_days: 4,
  },
  {
    phase: 3,
    domain: 'AUXILIARY',
    sprint: 'Sprint-E: Polish Systems',
    systems: ['All BRIDGE & LEGACY systems'],
    goals: [
      'Validate as snapshot readers',
      'Event subscriptions working',
    ],
    blockers: ['Phase 2 complete'],
    estimated_days: 5,
  },
];

/**
 * =============================================================================
 * PHASE 3: SUCCESS CRITERIA
 * =============================================================================
 */

const SUCCESS_CRITERIA = [
  'All KERNEL-SYSTEMS pass IntegrationCheck',
  'Zero determinism violations in replayed sessions',
  'Bandwidth reduced by 40% (buffer sync vs. entity sync)',
  'Frame time variance < 1ms (GC-zero)',
  'Multiplayer latency reconciliation < 100ms',
];

export const DOMAIN_MIGRATION_PLAN = {
  KERNEL_SYSTEMS,
  BRIDGE_SYSTEMS,
  LEGACY_ADAPTER_SYSTEMS,
  MIGRATION_SEQUENCE,
  SUCCESS_CRITERIA,
};