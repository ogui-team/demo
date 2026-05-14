import type { NextFunction, Request, Response } from 'express';
import type { IdentitySnapshot, RequestAuthContext } from './types';
import { buildRequestAuthContext, resolveAuthFromRequest, SESSION_COOKIE_NAME, SESSION_TTL_MS } from './request-auth';

export function attachAuthContext(req: Request, res: Response, snapshot: IdentitySnapshot): RequestAuthContext {
  const context = buildRequestAuthContext(snapshot);
  req.authContext = context;

  // Deterministic token gate: expose only opaque identity metadata to downstream plugins.
  res.locals.identitySnapshot = context.identitySnapshot;
  res.locals.gameApiJwt = context.gameApiJwt;
  res.setHeader('x-identity-snapshot', JSON.stringify(context.identitySnapshot));
  res.setHeader('x-game-api-jwt', context.gameApiJwt);
  return context;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const result = resolveAuthFromRequest(req);
  attachAuthContext(req, res, result.snapshot);
  next();
}
