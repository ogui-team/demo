import { createHmac } from 'node:crypto';
import type { IdentitySnapshot } from './types';

interface GameApiJwtPayload {
  sub: string;
  sid: string | null;
  guest: boolean;
  permissions: string[];
  provider: IdentitySnapshot['provider'];
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

function base64UrlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function base64UrlDecode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

function parseJsonSafely<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function signGameApiJwt(snapshot: IdentitySnapshot, secret: string, ttlSeconds: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: GameApiJwtPayload = {
    sub: snapshot.userId,
    sid: snapshot.sessionId,
    guest: snapshot.isGuest,
    permissions: [...snapshot.permissions],
    provider: snapshot.provider,
    iat: issuedAt,
    exp: issuedAt + Math.max(60, ttlSeconds),
    iss: 'demo-game-server',
    aud: 'demo-game-api',
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifyGameApiJwt(token: string, secret: string): IdentitySnapshot | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac('sha256', secret).update(data).digest('base64url');
  if (encodedSignature !== expectedSignature) {
    return null;
  }

  const header = parseJsonSafely<{ alg?: string; typ?: string }>(base64UrlDecode(encodedHeader));
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  const payload = parseJsonSafely<GameApiJwtPayload>(base64UrlDecode(encodedPayload));
  if (!payload) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now || payload.iat > now + 60) {
    return null;
  }

  if (!payload.sub || !Array.isArray(payload.permissions)) {
    return null;
  }

  const provider = payload.provider === 'google' || payload.provider === 'discord' ? payload.provider : 'guest';
  return {
    userId: payload.sub,
    isGuest: Boolean(payload.guest),
    permissions: payload.permissions.filter((permission): permission is string => typeof permission === 'string'),
    provider,
    sessionId: typeof payload.sid === 'string' ? payload.sid : null,
  };
}
