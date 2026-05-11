import { describe, expect, it } from 'vitest';
import { completeOAuthSignIn } from '../../server/src/auth/oauth-routes';
import { resolveAuthFromRequest } from '../../server/src/auth/request-auth';
import { resolvePlayerIdForConnection } from '../../server/src/auth/player-id';

describe('identity propagation integration', () => {
  it('resolves an authenticated websocket handshake from oauth-issued jwt', () => {
    const oauthSignIn = completeOAuthSignIn({
      provider: 'google',
      providerUserId: 'google-user-42',
      email: 'user42@example.com',
      displayName: 'User 42',
    });

    const handshake = resolveAuthFromRequest({
      headers: {
        cookie: '',
      },
      url: `/?token=${encodeURIComponent(oauthSignIn.gameApiJwt)}`,
      socket: {
        remoteAddress: '127.0.0.1',
      },
    });

    expect(handshake.invalidToken).toBe(false);
    expect(handshake.context.identitySnapshot.userId).toBe(oauthSignIn.identitySnapshot.userId);
    expect(handshake.context.identitySnapshot.isGuest).toBe(false);

    const resolvedPlayerId = resolvePlayerIdForConnection(handshake.context, 'room_alpha', 'conn_123');
    expect(resolvedPlayerId).toBe(oauthSignIn.identitySnapshot.userId);
  });
});