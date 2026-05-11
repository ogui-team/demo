import { Router, type Request, type Response } from 'express';
import { buildRequestAuthContext } from './request-auth';
import { userIdentityStore } from './user-identity-store';
import { sessionStore } from './session-store';
import { attachAuthContext, clearSessionCookie, setSessionCookie } from './session-middleware';
import type { AuthProvider, IdentitySnapshot } from './types';

const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7);

function isSupportedProvider(provider: AuthProvider): provider is Exclude<AuthProvider, 'guest'> {
  return provider === 'google' || provider === 'discord';
}

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractProviderPayload(req: Request): {
  providerUserId: string | null;
  email: string | null;
  displayName: string | null;
} {
  const query = req.query as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const providerUserId = parseString(body.providerUserId)
    ?? parseString(body.id)
    ?? parseString(query.providerUserId)
    ?? parseString(query.id)
    ?? parseString(query.sub);

  const email = parseString(body.email)
    ?? parseString(query.email);

  const displayName = parseString(body.displayName)
    ?? parseString(body.name)
    ?? parseString(query.displayName)
    ?? parseString(query.name);

  return {
    providerUserId,
    email,
    displayName,
  };
}

function ensureProviderSecrets(provider: Exclude<AuthProvider, 'guest'>): { ok: true } | { ok: false; reason: string } {
  const keyPrefix = provider.toUpperCase();
  const clientId = process.env[`${keyPrefix}_CLIENT_ID`] ?? '';
  const clientSecret = process.env[`${keyPrefix}_CLIENT_SECRET`] ?? '';
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason: `Missing ${keyPrefix}_CLIENT_ID/${keyPrefix}_CLIENT_SECRET environment stubs`,
    };
  }
  return { ok: true };
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

function handleOAuthCallback(provider: AuthProvider) {
  return (req: Request, res: Response): void => {
    if (!isSupportedProvider(provider)) {
      res.status(400).json({ ok: false, error: 'Unsupported auth provider' });
      return;
    }

    const providerSecrets = ensureProviderSecrets(provider);
    if (!providerSecrets.ok) {
      res.status(503).json({ ok: false, error: providerSecrets.reason });
      return;
    }

    const payload = extractProviderPayload(req);
    if (!payload.providerUserId || !payload.email) {
      res.status(400).json({
        ok: false,
        error: 'Missing provider payload. Provide id/providerUserId and email.',
      });
      return;
    }

    if (!isValidEmail(payload.email)) {
      res.status(400).json({ ok: false, error: 'Invalid email format' });
      return;
    }

    // Placeholder validation path:
    // In production this comes from provider token introspection/userinfo endpoint.
    const result = userIdentityStore.upsertFromOAuth({
      provider,
      providerUserId: payload.providerUserId,
      email: payload.email,
      displayName: payload.displayName ?? undefined,
    });

    const session = sessionStore.create({
      userId: result.record.userId,
      permissions: result.record.permissions,
      provider,
      isGuest: false,
      ttlMs: SESSION_TTL_MS,
    });

    setSessionCookie(res, session.sessionId);
    const snapshot = buildSnapshot({
      sessionId: session.sessionId,
      userId: result.record.userId,
      provider,
      permissions: result.record.permissions,
    });
    const context = attachAuthContext(req, res, snapshot);

    // Security boundary: never return raw OAuth provider tokens.
    res.json({
      ok: true,
      provider,
      created: result.created,
      identitySnapshot: context.identitySnapshot,
      gameApiJwt: context.gameApiJwt,
      sessionId: context.sessionId,
    });
  };
}

const router = Router();

router.get('/google/callback', handleOAuthCallback('google'));
router.post('/google/callback', handleOAuthCallback('google'));
router.get('/discord/callback', handleOAuthCallback('discord'));
router.post('/discord/callback', handleOAuthCallback('discord'));

router.post('/logout', (req: Request, res: Response) => {
  const sessionId = req.authContext?.sessionId;
  if (sessionId) {
    sessionStore.delete(sessionId);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/snapshot', (req: Request, res: Response) => {
  res.json({
    ok: true,
    identitySnapshot: req.authContext?.identitySnapshot ?? null,
  });
});

export const oauthRouter = router;
