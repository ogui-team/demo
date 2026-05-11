import { Router, type Request, type Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { buildRequestAuthContext } from './request-auth';
import { userIdentityStore } from './user-identity-store';
import { sessionStore } from './session-store';
import { attachAuthContext, clearSessionCookie, setSessionCookie } from './session-middleware';
import type { AuthProvider, IdentitySnapshot } from './types';

const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serverHttpBase(): string {
  return (process.env.SERVER_HTTP_URL ?? 'http://localhost:10001').replace(/\/$/, '');
}

function gameClientBase(): string {
  // After OAuth callback we redirect the browser back to the game frontend.
  // In production SERVER_HTTP_URL == client origin (same host on Render).
  return serverHttpBase();
}

/** Simple HTTPS GET/POST helper — no extra deps needed (Node 18+). */
function httpsJson<T>(
  method: 'GET' | 'POST',
  hostname: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers: {
        'Accept': 'application/json',
        ...headers,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };
    const req = httpsRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
        } catch (err) {
          reject(new Error('Failed to parse JSON response from provider'));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildSnapshot(input: {
  sessionId: string;
  userId: string;
  provider: Exclude<AuthProvider, 'guest'>;
  permissions: string[];
}): IdentitySnapshot {
  return {
    userId: input.userId,
    isGuest: false,
    permissions: [...input.permissions],
    provider: input.provider,
    sessionId: input.sessionId,
  };
}

// ---------------------------------------------------------------------------
// Shared sign-in finalisation (also called from tests)
// ---------------------------------------------------------------------------

export function completeOAuthSignIn(input: {
  provider: Exclude<AuthProvider, 'guest'>;
  providerUserId: string;
  email: string;
  displayName?: string;
}): {
  created: boolean;
  identitySnapshot: IdentitySnapshot;
  gameApiJwt: string;
  sessionId: string;
} {
  const result = userIdentityStore.upsertFromOAuth({
    provider: input.provider,
    providerUserId: input.providerUserId,
    email: input.email,
    displayName: input.displayName,
  });

  const session = sessionStore.create({
    userId: result.record.userId,
    permissions: result.record.permissions,
    provider: input.provider,
    isGuest: false,
    ttlMs: SESSION_TTL_MS,
  });

  const identitySnapshot = buildSnapshot({
    sessionId: session.sessionId,
    userId: result.record.userId,
    provider: input.provider,
    permissions: result.record.permissions,
  });

  return {
    created: result.created,
    identitySnapshot,
    gameApiJwt: buildRequestAuthContext(identitySnapshot).gameApiJwt,
    sessionId: session.sessionId,
  };
}

// ---------------------------------------------------------------------------
// State map — CSRF protection for OAuth flow (in-memory, enough for single node)
// ---------------------------------------------------------------------------

const pendingStates = new Map<string, { provider: AuthProvider; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

function generateState(provider: AuthProvider): string {
  const state = randomBytes(24).toString('base64url');
  pendingStates.set(state, { provider, createdAt: Date.now() });
  // Prune stale states
  for (const [k, v] of pendingStates.entries()) {
    if (Date.now() - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
  return state;
}

function consumeState(state: string): AuthProvider | null {
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return entry.provider;
}

// ---------------------------------------------------------------------------
// Redirect to provider
// ---------------------------------------------------------------------------

function buildGoogleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: `${serverHttpBase()}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function buildDiscordAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? '',
    redirect_uri: `${serverHttpBase()}/auth/discord/callback`,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Code exchange
// ---------------------------------------------------------------------------

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  name?: string;
  error?: { message?: string } | string;
}

interface DiscordTokenResponse {
  access_token?: string;
  error?: string;
}

interface DiscordUserInfo {
  id?: string;
  email?: string;
  username?: string;
  global_name?: string;
  error?: string;
}

async function exchangeGoogleCode(code: string): Promise<{ providerUserId: string; email: string; displayName?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: `${serverHttpBase()}/auth/google/callback`,
    grant_type: 'authorization_code',
  }).toString();

  const tokens = await httpsJson<GoogleTokenResponse>(
    'POST',
    'oauth2.googleapis.com',
    '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  );

  if (!tokens.access_token) {
    throw new Error(`Google token exchange failed: ${tokens.error ?? 'no access_token'}`);
  }

  const userInfo = await httpsJson<GoogleUserInfo>(
    'GET',
    'www.googleapis.com',
    '/oauth2/v3/userinfo',
    { 'Authorization': `Bearer ${tokens.access_token}` },
  );

  if (!userInfo.sub || !userInfo.email) {
    throw new Error('Google userinfo missing sub or email');
  }

  return {
    providerUserId: userInfo.sub,
    email: userInfo.email,
    displayName: userInfo.name,
  };
}

async function exchangeDiscordCode(code: string): Promise<{ providerUserId: string; email: string; displayName?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.DISCORD_CLIENT_ID ?? '',
    client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
    redirect_uri: `${serverHttpBase()}/auth/discord/callback`,
    grant_type: 'authorization_code',
  }).toString();

  const tokens = await httpsJson<DiscordTokenResponse>(
    'POST',
    'discord.com',
    '/api/oauth2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  );

  if (!tokens.access_token) {
    throw new Error(`Discord token exchange failed: ${tokens.error ?? 'no access_token'}`);
  }

  const user = await httpsJson<DiscordUserInfo>(
    'GET',
    'discord.com',
    '/api/users/@me',
    { 'Authorization': `Bearer ${tokens.access_token}` },
  );

  if (!user.id || !user.email) {
    throw new Error('Discord user info missing id or email');
  }

  const displayName = user.global_name ?? user.username;

  return {
    providerUserId: user.id,
    email: user.email,
    displayName,
  };
}

// ---------------------------------------------------------------------------
// Redirect-back helper
// ---------------------------------------------------------------------------

function redirectToGame(res: Response, jwt: string, error?: string): void {
  const base = gameClientBase();
  if (error) {
    const params = new URLSearchParams({ auth_error: error });
    res.redirect(`${base}/?${params.toString()}`);
    return;
  }
  const params = new URLSearchParams({ auth_jwt: jwt });
  res.redirect(`${base}/?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// ── Initiate OAuth ────────────────────────────────────────────────────────

router.get('/google', (req: Request, res: Response): void => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(503).send('GOOGLE_CLIENT_ID not configured');
    return;
  }
  const state = generateState('google');
  res.redirect(buildGoogleAuthorizeUrl(state));
});

router.get('/discord', (req: Request, res: Response): void => {
  if (!process.env.DISCORD_CLIENT_ID) {
    res.status(503).send('DISCORD_CLIENT_ID not configured');
    return;
  }
  const state = generateState('discord');
  res.redirect(buildDiscordAuthorizeUrl(state));
});

// ── Real callbacks from provider (Authorization Code flow) ────────────────

router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const code = parseString(req.query['code']);
  const state = parseString(req.query['state']);

  if (!code) {
    redirectToGame(res, '', 'Google sign-in cancelled or denied.');
    return;
  }

  if (!state || consumeState(state) !== 'google') {
    redirectToGame(res, '', 'Invalid OAuth state. Please try again.');
    return;
  }

  try {
    const userInfo = await exchangeGoogleCode(code);
    const { gameApiJwt, sessionId } = completeOAuthSignIn({ provider: 'google', ...userInfo });
    setSessionCookie(res, sessionId);
    redirectToGame(res, gameApiJwt);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[auth/google/callback]', message);
    redirectToGame(res, '', `Google sign-in failed: ${message}`);
  }
});

router.get('/discord/callback', async (req: Request, res: Response): Promise<void> => {
  const code = parseString(req.query['code']);
  const state = parseString(req.query['state']);

  if (!code) {
    redirectToGame(res, '', 'Discord sign-in cancelled or denied.');
    return;
  }

  if (!state || consumeState(state) !== 'discord') {
    redirectToGame(res, '', 'Invalid OAuth state. Please try again.');
    return;
  }

  try {
    const userInfo = await exchangeDiscordCode(code);
    const { gameApiJwt, sessionId } = completeOAuthSignIn({ provider: 'discord', ...userInfo });
    setSessionCookie(res, sessionId);
    redirectToGame(res, gameApiJwt);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[auth/discord/callback]', message);
    redirectToGame(res, '', `Discord sign-in failed: ${message}`);
  }
});

// ── Manual / test POST callbacks (keep for sandbox/test usage) ────────────

router.post('/google/callback', (req: Request, res: Response): void => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({ ok: false, error: 'Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const providerUserId = parseString(body.providerUserId) ?? parseString(body.id) ?? parseString(query.sub);
  const email = parseString(body.email) ?? parseString(query.email);
  const displayName = parseString(body.displayName) ?? parseString(body.name);
  if (!providerUserId || !email || !isValidEmail(email)) {
    res.status(400).json({ ok: false, error: 'Missing or invalid providerUserId/email' });
    return;
  }
  const { identitySnapshot, gameApiJwt, sessionId, created } = completeOAuthSignIn({ provider: 'google', providerUserId, email, displayName: displayName ?? undefined });
  setSessionCookie(res, sessionId);
  res.json({ ok: true, provider: 'google', created, identitySnapshot, gameApiJwt, sessionId });
});

router.post('/discord/callback', (req: Request, res: Response): void => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    res.status(503).json({ ok: false, error: 'Missing DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET' });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const providerUserId = parseString(body.providerUserId) ?? parseString(body.id) ?? parseString(query.sub);
  const email = parseString(body.email) ?? parseString(query.email);
  const displayName = parseString(body.displayName) ?? parseString(body.name);
  if (!providerUserId || !email || !isValidEmail(email)) {
    res.status(400).json({ ok: false, error: 'Missing or invalid providerUserId/email' });
    return;
  }
  const { identitySnapshot, gameApiJwt, sessionId, created } = completeOAuthSignIn({ provider: 'discord', providerUserId, email, displayName: displayName ?? undefined });
  setSessionCookie(res, sessionId);
  res.json({ ok: true, provider: 'discord', created, identitySnapshot, gameApiJwt, sessionId });
});

// ── Logout ────────────────────────────────────────────────────────────────

router.post('/logout', (req: Request, res: Response) => {
  const sessionId = req.authContext?.sessionId;
  if (sessionId) sessionStore.delete(sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── Snapshot ──────────────────────────────────────────────────────────────

router.get('/snapshot', (req: Request, res: Response) => {
  res.json({ ok: true, identitySnapshot: req.authContext?.identitySnapshot ?? null });
});

export const oauthRouter = router;
