import { generateDeterministicPlayerId } from '../utils/DeterministicIdHash';
import type { RequestAuthContext } from './types';

export function resolvePlayerIdForConnection(
  authContext: RequestAuthContext,
  sessionId: string,
  connectionId: string,
  requestedPlayerId?: string,
): string {
  if (authContext.identitySnapshot.isGuest) {
    return requestedPlayerId || generateDeterministicPlayerId(sessionId || 'lobby', connectionId);
  }

  return authContext.identitySnapshot.userId;
}
