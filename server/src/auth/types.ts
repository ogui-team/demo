export type AuthProvider = 'guest' | 'google' | 'discord';

export interface IdentitySnapshot {
  userId: string;
  isGuest: boolean;
  permissions: string[];
  provider: AuthProvider;
  sessionId: string | null;
}

export interface RequestAuthContext {
  authState: 'guest' | 'authenticated';
  sessionId: string | null;
  identitySnapshot: IdentitySnapshot;
  gameApiJwt: string;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: RequestAuthContext;
    }
  }
}
