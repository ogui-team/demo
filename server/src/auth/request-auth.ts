import type { IncomingMessage } from 'http';
import { sessionStore, type SessionRecord } from './session-store';
import { signGameApiJwt, verifyGameApiJwt } from './jwt';
import type { IdentitySnapshot, RequestAuthContext } from './types';

export const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME ?? 'game_session';
export const JWT_SECRET = process.env.GAME_API_JWT_SECRET ?? 'dev-insecure-secret-change-me';
export const JWT_TTL_SECONDS = Number(process.env.GAME_API_JWT_TTL_SECONDS ?? 900);
export const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7);

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

export interface AuthResolutionResult {
  snapshot: IdentitySnapshot;
  context: RequestAuthContext;
  source: 'session' | 'bearer' | 'query' | 'guest';
  invalidToken: boolean;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const result: Record<string, string> = {};
  const segments = cookieHeader.split(';');
  for (const segment of segments) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = segment.slice(0, separatorIndex).trim();
    const value = segment.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    result[name] = decodeURIComponent(value);
  }

  return result;
}

function readHeader(request: RequestLike, name: string): string | undefined {
  const direct = request.headers[name];
  const lowered = request.headers[name.toLowerCase()];
  const value = direct ?? lowered;
  return Array.isArray(value) ? value[0] : value;
}

export function buildGuestSnapshot(request: RequestLike): IdentitySnapshot {
  const fingerprintSource = request.ip
    || request.socket?.remoteAddress
    || readHeader(request, 'x-forwarded-for')
    || readHeader(request, 'user-agent')
    || 'guest';
  const fingerprint = Buffer.from(String(fingerprintSource)).toString('base64url').slice(0, 18);
  return {
    userId: `guest_${fingerprint}`,
    isGuest: true,
    permissions: ['play'],
    provider: 'guest',
    sessionId: null,
  };
}

export function snapshotFromSession(session: SessionRecord): IdentitySnapshot {
  return {
    userId: session.userId,
    isGuest: session.isGuest,
    permissions: [...session.permissions],
    provider: session.provider,
    sessionId: session.sessionId,
  };
}

export function buildRequestAuthContext(snapshot: IdentitySnapshot): RequestAuthContext {
  return {
    authState: snapshot.isGuest ? 'guest' : 'authenticated',
    sessionId: snapshot.sessionId,
    identitySnapshot: snapshot,
    gameApiJwt: signGameApiJwt(snapshot, JWT_SECRET, JWT_TTL_SECONDS),
  };
}

function readQueryToken(urlValue: string | undefined): string | null {
  if (!urlValue) {
    return null;
  }

  try {
    const parsed = new URL(urlValue, 'ws://localhost');
    return parsed.searchParams.get('token');
  } catch {
    return null;
  }
}

export function resolveAuthFromRequest(request: RequestLike): AuthResolutionResult {
  const cookies = parseCookies(readHeader(request, 'cookie'));
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
      sessionStore.refresh(sessionId, SESSION_TTL_MS);
      const snapshot = snapshotFromSession(session);
      return {
        snapshot,
        context: buildRequestAuthContext(snapshot),
        source: 'session',
        invalidToken: false,
      };
    }
  }

  const authHeader = readHeader(request, 'authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const snapshot = verifyGameApiJwt(token, JWT_SECRET);
    if (snapshot) {
      return {
        snapshot,
        context: buildRequestAuthContext(snapshot),
        source: 'bearer',
        invalidToken: false,
      };
    }
    const guestSnapshot = buildGuestSnapshot(request);
    return {
      snapshot: guestSnapshot,
      context: buildRequestAuthContext(guestSnapshot),
      source: 'guest',
      invalidToken: true,
    };
  }

  const queryToken = readQueryToken(request.url);
  if (queryToken) {
    const snapshot = verifyGameApiJwt(queryToken, JWT_SECRET);
    if (snapshot) {
      return {
        snapshot,
        context: buildRequestAuthContext(snapshot),
        source: 'query',
        invalidToken: false,
      };
    }
    const guestSnapshot = buildGuestSnapshot(request);
    return {
      snapshot: guestSnapshot,
      context: buildRequestAuthContext(guestSnapshot),
      source: 'guest',
      invalidToken: true,
    };
  }

  const snapshot = buildGuestSnapshot(request);
  return {
    snapshot,
    context: buildRequestAuthContext(snapshot),
    source: 'guest',
    invalidToken: false,
  };
}

export function toRequestLike(request: IncomingMessage): RequestLike {
  return {
    headers: request.headers,
    url: request.url,
    socket: {
      remoteAddress: request.socket.remoteAddress,
    },
  };
}
