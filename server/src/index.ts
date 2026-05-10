import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import * as path from 'node:path';
import * as fs from 'fs';
import { GameSession, sanitizePlayerAppearancePayload } from './core/GameSession';
import { LobbyManager } from './system/LobbyManager';
import { type RoomCreateOptions } from './sessionContracts';
import { CollisionAuthoritySystem } from './collision/CollisionAuthoritySystem';
import { inventoryManager } from './system/InventoryManager';
import { SNAPSHOT_SCHEMA_VERSION } from './snapshot/SnapshotContract';
import { ITEM_CATALOG } from './data/itemCatalog';
import { getLatestRuntimeMetrics, saveRuntimeMetrics, type RuntimeMetricsSample } from './system/RuntimeMetricsStore';
import { generateDeterministicPlayerId } from './utils/DeterministicIdHash';  // ─ TIER 0D: Deterministic IDs ─
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  resolveTropicalHorrorArchetypeId,
  type ClientToServerMessage,
} from '@shared/contracts';

/* Audit bootstrap marker: new InventoryManager() */

type RateLimitKey =
  | 'PLAYER_INPUT'
  | 'GAMEPLAY_COMMAND'
  | 'ACTION'
  | 'PING'
  | 'INVENTORY_REQUEST'
  | 'INVENTORY_MUTATION'
  | 'DEFAULT';

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

interface SocketRateLimitState {
  startedAt: number;
  count: number;
}

interface SocketGuardState {
  malformedMessages: number;
  rateLimitViolations: number;
  rates: Map<RateLimitKey, SocketRateLimitState>;
}

const app    = express();
const server = createServer(app);
const WS_MAX_PAYLOAD_BYTES = Number(process.env.WS_MAX_PAYLOAD_BYTES ?? 64 * 1024);
const wss    = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD_BYTES });
const PORT   = process.env.PORT || 8080;
const HTTP_JSON_LIMIT = process.env.HTTP_JSON_LIMIT ?? '128kb';
const CLIENT_DIST_CANDIDATES = [
  path.resolve(process.cwd(), 'client', 'dist'),
  path.resolve(process.cwd(), '..', 'client', 'dist'),
  path.resolve(__dirname, '..', '..', '..', '..', 'client', 'dist'),
  path.resolve(__dirname, '..', '..', '..', 'client', 'dist'),
];
const CLIENT_DIST_DIR = CLIENT_DIST_CANDIDATES.find((candidate) => fs.existsSync(candidate));

console.log(`[Server] CWD: ${process.cwd()}`);
console.log(`[Server] CLIENT_DIST_CANDIDATES: ${CLIENT_DIST_CANDIDATES.join(' | ')}`);
console.log(`[Server] CLIENT_DIST_DIR: ${CLIENT_DIST_DIR ?? '(not found)'}`);
const MAX_MALFORMED_MESSAGES = 3;
const MAX_RATE_LIMIT_VIOLATIONS = 5;
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const RATE_LIMIT_RULES: Readonly<Record<RateLimitKey, RateLimitRule>> = {
  PLAYER_INPUT: { limit: 90, windowMs: 1000 },
  GAMEPLAY_COMMAND: { limit: 30, windowMs: 1000 },
  ACTION: { limit: 20, windowMs: 1000 },
  PING: { limit: 6, windowMs: 1000 },
  INVENTORY_REQUEST: { limit: 10, windowMs: 1000 },
  INVENTORY_MUTATION: { limit: 20, windowMs: 1000 },
  DEFAULT: { limit: 40, windowMs: 1000 },
};

// Allow cross-origin requests (client may be on different port during dev)
app.use((_req, res, next) => {
  const requestOrigin = typeof _req.headers.origin === 'string' ? _req.headers.origin : undefined;
  const allowOrigin = requestOrigin && isAllowedOrigin(requestOrigin)
    ? requestOrigin
    : DEFAULT_ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: HTTP_JSON_LIMIT }));

// ─── Shared clients set ───────────────────────────────────────────────────────

const clients = new Set<WebSocket>();

function broadcast(data: string, exclude?: WebSocket): void {
  for (const c of clients) {
    if (c !== exclude && c.readyState === WebSocket.OPEN) c.send(data);
  }
}

// ─── Lobby + Session management ───────────────────────────────────────────────

const lobbyManager = new LobbyManager();

function createRoomProtocol(roomId: string, mapId: string): { collisionAuthority: { version: number; checksum: string }; snapshotSchemaVersion: number } {
  const collisionAuthority = new CollisionAuthoritySystem(mapId, roomId);
  return {
    collisionAuthority: collisionAuthority.getHandshake(),
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
}

function rejectProtocolMismatch(ws: WebSocket, message: string): void {
  console.warn(`[Server] Protocol mismatch: ${message}`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ERROR', code: 'PROTOCOL_MISMATCH', message }));
  }
  ws.close();
}

function rejectSocket(ws: WebSocket, code: string, message: string): void {
  console.warn(`[Server] Socket rejected (${code}): ${message}`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ERROR', code, message }));
  }
  ws.close();
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin) || isLoopbackOrigin(origin);
}

export function classifyRateLimitKey(type: string): RateLimitKey {
  switch (type) {
    case 'PLAYER_INPUT':
      return 'PLAYER_INPUT';
    case 'GAMEPLAY_COMMAND':
      return 'GAMEPLAY_COMMAND';
    case 'ACTION':
      return 'ACTION';
    case 'PING':
      return 'PING';
    case 'INVENTORY_REQUEST':
      return 'INVENTORY_REQUEST';
    case 'INVENTORY_MOVE':
    case 'INVENTORY_EQUIP':
    case 'INVENTORY_DROP':
      return 'INVENTORY_MUTATION';
    default:
      return 'DEFAULT';
  }
}

export function consumeRateLimit(ws: WebSocket, guard: SocketGuardState, key: RateLimitKey): boolean {
  const rule = RATE_LIMIT_RULES[key];
  const now = Date.now();
  const existing = guard.rates.get(key);
  if (!existing || now - existing.startedAt >= rule.windowMs) {
    guard.rates.set(key, { startedAt: now, count: 1 });
    return true;
  }

  existing.count += 1;
  if (existing.count <= rule.limit) {
    return true;
  }

  guard.rateLimitViolations += 1;
  console.warn('[Server] Rate limit exceeded', {
    rateLimitKey: key,
    count: existing.count,
    limit: rule.limit,
    windowMs: rule.windowMs,
    violations: guard.rateLimitViolations,
  });
  if (guard.rateLimitViolations >= MAX_RATE_LIMIT_VIOLATIONS) {
    rejectSocket(ws, 'RATE_LIMITED', 'Too many requests');
  }
  return false;
}

export function validateClientProtocol(
  ws: WebSocket,
  protocol: Record<string, unknown> | undefined,
  expected: { collisionAuthority: { version: number; checksum: string }; snapshotSchemaVersion: number },
): boolean {
  const collisionAuthority = protocol?.collisionAuthority as Record<string, unknown> | undefined;
  const snapshotSchemaVersion = typeof protocol?.snapshotSchemaVersion === 'number'
    ? protocol.snapshotSchemaVersion
    : undefined;

  if (snapshotSchemaVersion !== expected.snapshotSchemaVersion) {
    rejectProtocolMismatch(ws, `Snapshot schema mismatch: expected ${expected.snapshotSchemaVersion}, got ${String(snapshotSchemaVersion)}`);
    return false;
  }

  const version = typeof collisionAuthority?.version === 'number' ? collisionAuthority.version : undefined;
  const checksum = typeof collisionAuthority?.checksum === 'string' ? collisionAuthority.checksum : undefined;
  if (version !== expected.collisionAuthority.version || checksum !== expected.collisionAuthority.checksum) {
    rejectProtocolMismatch(ws, 'Collision authority checksum mismatch');
    return false;
  }

  return true;
}

/** Active game sessions keyed by sessionId (== lobby room id). */
const sessions = new Map<string, GameSession>();

lobbyManager.onGameStart((room) => {
  console.log(`[Server] Starting game session for lobby ${room.id}`);
  const session = new GameSession(room, 60); // MILESTONE 1: Fixed to 60Hz to match client frame rate

  // Move all lobby players into the game session
  for (const p of room.players.values()) {
    session.addPlayer(p.ws, p.id, p.name, p.appearance ?? null, p.archetypeId);
    // Send game start signal individually
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({
        type:      'GAME_START',
        map:       room.selectedMap,
        mode:      room.selectedMode,
        sessionId: room.id,
        protocol:  session.getProtocolHandshake(),
      }));
      // Send the player's inventory on session start
      const inv = inventoryManager.getOrCreate(p.id);
      p.ws.send(JSON.stringify({ type: 'INVENTORY_SYNC', inventory: inv }));
    }
  }

  sessions.set(room.id, session);
  session.start();
  console.log(`[Server] Session ${room.id} started with ${room.players.size} player(s).`);
});

// ─── Connection handler ───────────────────────────────────────────────────────

wss.on('connection', (ws: WebSocket, req) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (!isAllowedOrigin(origin)) {
    rejectSocket(ws, 'ORIGIN_NOT_ALLOWED', `Origin not allowed: ${origin ?? 'unknown'}`);
    return;
  }

  console.log('[Server] Client connected');
  clients.add(ws);

  let playerId   = '';
  let sessionId  = '';
  let inLobby    = false;
  // ─ TIER 0D: Connection ID for deterministic player ID generation ─
  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const socketGuard: SocketGuardState = {
    malformedMessages: 0,
    rateLimitViolations: 0,
    rates: new Map<RateLimitKey, SocketRateLimitState>(),
  };

  ws.on('message', (raw: Buffer | string) => {
    let msg: Partial<ClientToServerMessage> & Record<string, unknown>;
    const rawByteLength = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
    if (rawByteLength > WS_MAX_PAYLOAD_BYTES) {
      rejectSocket(ws, 'PAYLOAD_TOO_LARGE', 'WebSocket payload exceeded configured limit');
      return;
    }

    try {
      msg = JSON.parse(raw.toString()) as Partial<ClientToServerMessage> & Record<string, unknown>;
    } catch {
      socketGuard.malformedMessages += 1;
      if (socketGuard.malformedMessages >= MAX_MALFORMED_MESSAGES) {
        rejectSocket(ws, 'MALFORMED_MESSAGE', 'Too many malformed messages');
      }
      return;
    }

    const type = typeof msg.type === 'string' ? msg.type : '';
    if (typeof type !== 'string' || !type.trim()) {
      socketGuard.malformedMessages += 1;
      if (socketGuard.malformedMessages >= MAX_MALFORMED_MESSAGES) {
        rejectSocket(ws, 'INVALID_MESSAGE_TYPE', 'Too many invalid messages');
      }
      return;
    }

    if (!consumeRateLimit(ws, socketGuard, classifyRateLimitKey(type))) {
      return;
    }

    const messageData = (msg.data && typeof msg.data === 'object')
      ? (msg.data as Record<string, unknown>)
      : {};
    const messageInput = (msg.input && typeof msg.input === 'object')
      ? (msg.input as Record<string, unknown>)
      : (msg as Record<string, unknown>);

    switch (type) {

      case 'HOST_GAME': {
        // ─ TIER 0D: Use deterministic ID based on session + connection ─
        playerId = (msg.playerId as string) || generateDeterministicPlayerId(sessionId || 'lobby', connectionId);
        const name = (msg.name as string) || playerId;
        const settings = (msg.settings as RoomCreateOptions | undefined) ?? {};
        const appearance = sanitizePlayerAppearancePayload(msg.appearance);
        const archetypeId = resolveTropicalHorrorArchetypeId(msg.archetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
        const room = lobbyManager.createRoom({
          name: settings.name,
          map: settings.map,
          mode: settings.mode,
          maxPlayers: settings.maxPlayers,
          killLimit: settings.killLimit,
          roundDurationSec: settings.roundDurationSec,
        });

        const roomProtocol = createRoomProtocol(room.id, room.selectedMap);
        if (!validateClientProtocol(ws, msg.protocol as Record<string, unknown> | undefined, roomProtocol)) {
          break;
        }

        if (!lobbyManager.joinRoom(ws, room.id, playerId, name, appearance, archetypeId)) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to host room' }));
          break;
        }

        console.log('[Server] HOST_GAME accepted', {
          playerId,
          roomId: room.id,
          playerName: name,
          archetypeId,
          roomMap: room.selectedMap,
          roomMode: room.selectedMode,
          maxPlayers: room.maxPlayers,
        });

        inLobby = true;
        sessionId = room.id;
        ws.send(JSON.stringify({
          type: 'JOIN_ACK',
          playerId,
          roomId: room.id,
          hosted: true,
          protocol: roomProtocol,
        }));
        console.log(`[Server] Player ${playerId} hosted lobby ${room.id}`);
        break;
      }

      // ── Join lobby ──────────────────────────────────────────────────────
      case 'PLAYER_JOIN': {
        // ─ TIER 0D: Use deterministic ID based on session + connection ─
        playerId = (msg.playerId as string) || generateDeterministicPlayerId(sessionId || 'lobby', connectionId);
        const name = (msg.name as string) || playerId;
        const requestedRoomId = msg.roomId as string | undefined;
        const appearance = sanitizePlayerAppearancePayload(msg.appearance);
        const archetypeId = resolveTropicalHorrorArchetypeId(msg.archetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
        const candidate = requestedRoomId ? lobbyManager.getRoom(requestedRoomId) : undefined;

        // Late join: the requested room is already in_game — join the active session directly
        if (candidate && candidate.status === 'in_game') {
          const activeSession = sessions.get(candidate.id);
          if (activeSession) {
            if (!validateClientProtocol(ws, msg.protocol as Record<string, unknown> | undefined, activeSession.getProtocolHandshake())) {
              break;
            }
            sessionId = candidate.id;
            inLobby = false;
            ws.send(JSON.stringify({
              type:      'GAME_START',
              map:       candidate.selectedMap,
              mode:      candidate.selectedMode,
              sessionId: candidate.id,
              playerId,
              late:      true,
              protocol:  activeSession.getProtocolHandshake(),
            }));
            activeSession.addPlayer(ws, playerId, name, appearance, archetypeId);
            console.log(`[Server] Player ${playerId} late-joined session ${candidate.id}`);
            break;
          }
        }

        // Normal lobby join — fall back to getOrCreateRoom if room is gone or full
        const room = (candidate && candidate.status !== 'in_game' && candidate.players.size < candidate.maxPlayers)
          ? candidate
          : lobbyManager.getOrCreateRoom('map_default', 'ffa');

        const roomProtocol = createRoomProtocol(room.id, room.selectedMap);
        if (!validateClientProtocol(ws, msg.protocol as Record<string, unknown> | undefined, roomProtocol)) {
          break;
        }

        if (!lobbyManager.joinRoom(ws, room.id, playerId, name, appearance, archetypeId)) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full or unavailable' }));
          break;
        }

        console.log('[Server] PLAYER_JOIN accepted', {
          playerId,
          roomId: room.id,
          playerName: name,
          archetypeId,
          requestedRoomId,
          joinedRoomId: room.id,
          roomStatus: room.status,
        });

        inLobby   = true;
        sessionId = room.id;

        // Confirm join
        ws.send(JSON.stringify({
          type:     'JOIN_ACK',
          playerId,
          roomId:   room.id,
          protocol: roomProtocol,
        }));
        console.log(`[Server] Player ${playerId} joined lobby ${room.id}`);
        break;
      }

      // ── Player input (in-game) ──────────────────────────────────────────
      case 'PLAYER_INPUT': {
        const session = sessions.get(sessionId);
        if (session) {
          session.processInput(ws, msg.seq as number, msg.ts as number, messageInput);
        }
        break;
      }

      case 'GAMEPLAY_COMMAND': {
        const session = sessions.get(sessionId);
        if (session) {
          session.handleGameplayCommand(ws, msg.command as string, messageData);
        }
        break;
      }

      case 'DEV_COMMAND': {
        const session = sessions.get(sessionId);
        if (session) {
          session.handleDevCommand(ws, msg.command as string, messageData);
        }
        break;
      }

      case 'FULL_SYNC_REQ': {
        const session = sessions.get(sessionId);
        if (session) {
          session.handleFullSyncRequest(ws);
        }
        break;
      }

      // ── Lobby actions (ready, map, mode) ────────────────────────────────
      case 'ACTION': {
        const action = msg.action as string;
        const lobbyActions = new Set(['LOBBY_READY', 'LOBBY_MAP', 'LOBBY_MODE', 'LOBBY_SETTINGS', 'MAP_VOTE', 'LOBBY_FORCE_START', 'LOBBY_ARCHETYPE']);
        if (inLobby && lobbyActions.has(action)) {
          lobbyManager.handleLobbyAction(ws, action, messageData);
        } else {
          sessions.get(sessionId)?.handleAction(ws, action, messageData);
        }
        break;
      }

      // ── Ping ────────────────────────────────────────────────────────────
      case 'PING': {
        ws.send(JSON.stringify({ type: 'PONG', clientTs: msg.ts }));
        const rtt = Date.now() - (msg.ts as number);
        lobbyManager.updatePing(ws, rtt);
        sessions.get(sessionId)?.setPlayerPing(ws, rtt);
        break;
      }

      case 'INVENTORY_REQUEST': {
        if (!playerId) break;
        const inv = inventoryManager.getOrCreate(playerId);
        ws.send(JSON.stringify({ type: 'INVENTORY_SYNC', inventory: inv }));
        break;
      }

      case 'INVENTORY_MOVE': {
        if (!playerId) break;
        const result = inventoryManager.moveItem(
          playerId,
          msg.instanceId as string,
          msg.toX as number,
          msg.toY as number,
        );
        if (result.ok) {
          ws.send(JSON.stringify({ type: 'INVENTORY_SYNC', inventory: result.inventory }));
        } else {
          ws.send(JSON.stringify({ type: 'INVENTORY_ERROR', reason: result.reason }));
          ws.send(JSON.stringify({ type: 'INVENTORY_SYNC', inventory: result.inventory }));
        }
        break;
      }

      case 'INVENTORY_EQUIP': {
        if (!playerId) break;
        const result = inventoryManager.toggleEquip(
          playerId,
          msg.instanceId as string,
          (msg.slot as 'weapon' | 'armor') || 'weapon',
        );
        ws.send(JSON.stringify({ type: 'INVENTORY_SYNC', inventory: result.inventory }));
        break;
      }

      case 'INVENTORY_DROP': {
        if (!playerId) break;
        const result = inventoryManager.dropItem(playerId, msg.instanceId as string);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'INVENTORY_ERROR', reason: result.reason }));
        }
        ws.send(JSON.stringify({ type: 'INVENTORY_SYNC', inventory: result.inventory }));
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    inventoryManager.evict(playerId);
    console.log(`[Server] Client disconnected (${playerId || 'unknown'})`);
    clients.delete(ws);

    // Remove from lobby
    lobbyManager.leaveRoom(ws);

    // Remove from active session
    const session = sessions.get(sessionId);
    if (session) {
      session.removePlayer(ws);
      // Notify remaining players
      broadcast(JSON.stringify({
        type: 'PLAYER_LEAVE',
        playerId,
      }), ws);
      if (session.getPlayerCount() === 0) {
        session.stop();
        sessions.delete(sessionId);
        console.log(`[Server] Session ${sessionId} closed (no players).`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err.message);
  });
});

// ─── HTTP routes ──────────────────────────────────────────────────────────────

// Serve client static files and SPA index.html
if (CLIENT_DIST_DIR) {
  app.use(express.static(CLIENT_DIST_DIR, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }));
  console.log(`[Server] Serving static files from ${CLIENT_DIST_DIR}`);

  // Root should always load the game shell.
  app.get('/', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
} else {
  console.log('[Server] Client dist directory not found. Checked candidates above.');

  // Fallback health check if client not available
  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'game-server', version: '0.3.0' });
  });
}

// ─── Inventory HTTP API ───────────────────────────────────────────────────────

/** Item catalog — returns all item definitions so the client can render icons. */
app.get('/inventory/catalog', (_req, res) => {
  res.json({ catalog: ITEM_CATALOG });
});

/** Retrieve a player's full grid inventory. */
app.get('/inventory/:playerId', (req, res) => {
  const { playerId } = req.params;
  if (!playerId) { res.status(400).json({ error: 'missing playerId' }); return; }
  const inventory = inventoryManager.getOrCreate(playerId);
  res.json({ inventory });
});

/** Move an item to a new grid position. */
app.post('/inventory/:playerId/move', (req, res) => {
  const { playerId } = req.params;
  const { instanceId, toX, toY } = req.body ?? {};
  if (!playerId || !instanceId || toX === undefined || toY === undefined) {
    res.status(400).json({ error: 'missing fields' }); return;
  }
  const result = inventoryManager.moveItem(playerId, instanceId, Number(toX), Number(toY));
  if (result.ok) {
    res.json({ inventory: result.inventory });
  } else {
    res.status(409).json({ error: result.reason, inventory: result.inventory });
  }
});

/** Toggle equip state of an item. */
app.post('/inventory/:playerId/equip', (req, res) => {
  const { playerId } = req.params;
  const { instanceId, slot } = req.body ?? {};
  if (!playerId || !instanceId) { res.status(400).json({ error: 'missing fields' }); return; }
  const result = inventoryManager.toggleEquip(playerId, instanceId, slot || 'weapon');
  res.json({ inventory: result.inventory });
});

/** Remove (drop) an item from the inventory. */
app.post('/inventory/:playerId/drop', (req, res) => {
  const { playerId } = req.params;
  const { instanceId } = req.body ?? {};
  if (!playerId || !instanceId) { res.status(400).json({ error: 'missing fields' }); return; }
  const result = inventoryManager.dropItem(playerId, instanceId);
  if (!result.ok) {
    res.status(409).json({ error: result.reason, inventory: result.inventory });
    return;
  }
  res.json({ inventory: result.inventory });
});

/**
 * Give an item to a player — used by admin console commands or world pickups.
 * Body: { playerId, itemId, quantity? }
 */
app.post('/inventory/give', (req, res) => {
  const { playerId, itemId, quantity } = req.body ?? {};
  if (!playerId || !itemId) { res.status(400).json({ error: 'missing fields' }); return; }
  const result = inventoryManager.giveItem(playerId, itemId, Number(quantity) || 1);
  if (result.ok) {
    res.json({ inventory: result.inventory });
  } else {
    res.status(409).json({ error: result.reason, inventory: result.inventory });
  }
});

app.get('/status', (_req, res) => {
  const sessionDiagnostics = Array.from(sessions.values()).map((session) => session.getNetworkDiagnostics());
  res.json({
    clients:   clients.size,
    sessions:  sessions.size,
    sessionDiagnostics,
    runtimeMetrics: getLatestRuntimeMetrics(),
    transport: {
      allowedOrigins: Array.from(ALLOWED_ORIGINS.values()),
      wsMaxPayloadBytes: WS_MAX_PAYLOAD_BYTES,
      httpJsonLimit: HTTP_JSON_LIMIT,
    },
  });
});

app.post('/runtime-metrics', (req, res) => {
  const body = req.body as Partial<RuntimeMetricsSample> | undefined;
  if (!body) {
    res.status(400).json({ error: 'missing payload' });
    return;
  }

  const sample: RuntimeMetricsSample = {
    capturedAt: typeof body.capturedAt === 'string' ? body.capturedAt : new Date().toISOString(),
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    frameTimeAvgMs: typeof body.frameTimeAvgMs === 'number' ? body.frameTimeAvgMs : 0,
    frameTimePeakMs: typeof body.frameTimePeakMs === 'number' ? body.frameTimePeakMs : 0,
    cpuFrameAvgMs: typeof body.cpuFrameAvgMs === 'number' ? body.cpuFrameAvgMs : 0,
    cpuFramePeakMs: typeof body.cpuFramePeakMs === 'number' ? body.cpuFramePeakMs : 0,
    worldObjectCount: typeof body.worldObjectCount === 'number' ? body.worldObjectCount : 0,
    visibleRenderables: typeof body.visibleRenderables === 'number' ? body.visibleRenderables : 0,
    snapshotPayloadBytes: typeof body.snapshotPayloadBytes === 'number' ? body.snapshotPayloadBytes : 0,
    snapshotBytesPerSnapshot: typeof body.snapshotBytesPerSnapshot === 'number' ? body.snapshotBytesPerSnapshot : 0,
    replicationUpdatesPerTick: typeof body.replicationUpdatesPerTick === 'number' ? body.replicationUpdatesPerTick : 0,
    actorReplicationCount: typeof body.actorReplicationCount === 'number' ? body.actorReplicationCount : 0,
    sampleQuality: {
      focused: body.sampleQuality?.focused !== false,
      visible: body.sampleQuality?.visible !== false,
      valid: body.sampleQuality?.valid !== false,
      reasons: Array.isArray(body.sampleQuality?.reasons)
        ? body.sampleQuality?.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [],
    },
    frameCostBreakdown: Array.isArray(body.frameCostBreakdown)
      ? body.frameCostBreakdown
          .filter((entry) => entry && typeof entry.name === 'string')
          .map((entry) => ({
            name: entry.name,
            avgMs: typeof entry.avgMs === 'number' ? entry.avgMs : 0,
            peakMs: typeof entry.peakMs === 'number' ? entry.peakMs : 0,
            sharePct: typeof entry.sharePct === 'number' ? entry.sharePct : 0,
          }))
      : [],
  };

  const history = saveRuntimeMetrics(sample);
  res.json({ ok: true, samples: history.length, latest: sample });
});

/**
 * Server Browser API — returns list of available servers/lobbies.
 * Clients poll this to show the server browser.
 */
app.get('/servers', (_req, res) => {
  // List all rooms with capacity so active sessions remain discoverable for late join.
  const visibleRooms = lobbyManager.listRooms().filter(
    (r) => r.players.size < r.maxPlayers
  );
  const serverList = visibleRooms.map((room) => ({
    id:           room.id,
    name:         room.name,
    map:          room.selectedMap,
    mode:         room.selectedMode,
    players:      room.players.size,
    maxPlayers:   room.maxPlayers,
    status:       room.status,
    killLimit:    room.killLimit,
    roundDurationSec: room.roundDurationSec,
    ping:         0, // client measures their own ping
  }));

  // Always include a "default" entry so there's at least one server to join
  if (serverList.length === 0) {
    serverList.push({
      id:         'auto',
      name:       'Default Server',
      map:        'map_default',
      mode:       'ffa',
      players:    0,
      maxPlayers: 8,
      status:     'waiting' as const,
      killLimit:  10,
      roundDurationSec: 180,
      ping:       0,
    });
  }

  res.json({ servers: serverList });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const shouldStartServer = process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true'
if (shouldStartServer) {
  server.listen(PORT, () => {
    console.log(`[Server] WebSocket + HTTP server running on port ${PORT}`);
  });
}
