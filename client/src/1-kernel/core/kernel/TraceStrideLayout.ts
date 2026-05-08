/**
 * Binary Trace Stride Layout (1024 bytes per frame)
 * Defines fixed offsets for zero-allocation frame recording into SharedArrayBuffer
 */

export enum TraceStrideOffset {
  // STRIDE HEADER (24 bytes - 8-byte aligned for cache efficiency)
  FRAME_INDEX = 0,           // Uint32 (4 bytes)
  PADDING_1 = 4,             // 4 bytes (alignment padding)
  TIMESTAMP = 8,             // Float64 (8 bytes - NOW 8-byte aligned)
  STATE_HASH = 16,           // Uint32 (4 bytes)
  COMMAND_COUNT = 20,        // Uint16 (2 bytes)
  PADDING_2 = 22,            // 2 bytes (alignment padding)

  // INPUT SECTION (128 bytes) - Raw input bitmasks @ offset 24
  INPUT_BASE = 24,
  INPUT_SIZE = 128,

  // TRANSFORM DELTA SECTION (400 bytes) - Top 10 active entities @ offset 152
  TRANSFORM_BASE = 152,      // 24 + 128
  ACTIVE_ENTITY_STRIDE = 40, // EntityId(2) + DeltaX(4) + DeltaY(4) + DeltaZ(4) + VelX(4) + VelY(4) + VelZ(4) + Health(1) + Padding(7)
  MAX_ACTIVE_ENTITIES = 10,
  TRANSFORM_SIZE = 400,

  // NETWORK SYNC SECTION (200 bytes) - Predicted vs Authoritative @ offset 552
  NETWORK_BASE = 552,        // 24 + 128 + 400
  NETWORK_ENTRY_SIZE = 40,   // EntityId(2) + PredX(4) + PredY(4) + PredZ(4) + AuthX(4) + AuthY(4) + AuthZ(4) + ErrorMagnitude(4) + Timestamp(8) + Padding(2)
  MAX_NETWORK_ENTRIES = 5,
  NETWORK_SIZE = 200,

  // GIZMO OVERRIDE SECTION (56 bytes) - Transform overrides from editor @ offset 752
  GIZMO_BASE = 752,          // 24 + 128 + 400 + 200
  GIZMO_ENTRY_SIZE = 14,     // EntityId(2) + OverrideFlags(1) + PosX(4) + PosY(4) + PosZ(4) + Padding(1)
  MAX_GIZMO_EVENTS = 4,
  GIZMO_SIZE = 56,

  // RECONCILIATION EVENT SECTION (216 bytes) - Network reconciliation details @ offset 808
  RECONCILIATION_BASE = 808, // 24 + 128 + 400 + 200 + 56
  RECONCILIATION_ENTRY_SIZE = 36, // Timestamp(8) + EntityId(2) + ErrorType(1) + DeltaX(4) + DeltaY(4) + DeltaZ(4) + VelX(4) + VelY(4) + VelZ(4) + Padding(1)
  MAX_RECONCILIATION_EVENTS = 6,
  RECONCILIATION_SIZE = 216,

  // TOTAL STRIDE (1024 bytes)
  STRIDE_SIZE = 1024,
}

export interface TraceStrideHeader {
  frameIndex: number;
  timestamp: number;
  stateHash: number;
  commandCount: number;
}

export interface TraceTransformDelta {
  entityId: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  velX: number;
  velY: number;
  velZ: number;
  health: number;
}

export interface TraceNetworkEntry {
  entityId: number;
  predX: number;
  predY: number;
  predZ: number;
  authX: number;
  authY: number;
  authZ: number;
  errorMagnitude: number;
  timestamp: number;
}

export interface TraceGizmoEvent {
  entityId: number;
  overrideFlags: number;
  posX: number;
  posY: number;
  posZ: number;
}

export interface TraceReconciliationEvent {
  timestamp: number;
  entityId: number;
  errorType: number; // 0=position, 1=velocity, 2=health, 3=state
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  velX: number;
  velY: number;
  velZ: number;
}
