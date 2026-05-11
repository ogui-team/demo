import type { IService } from './services';

export type AuthProvider = 'guest' | 'google' | 'discord';

export type AuthState = 'ANONYMOUS' | 'AUTHENTICATING' | 'AUTHENTICATED';

export interface OpaqueUserIdentity {
  userId: string;
  isGuest: boolean;
  permissions: string[];
}

export interface UserProfile {
  userId: string;
  provider: AuthProvider;
  displayName: string;
  avatarUrl?: string;
  isGuest: boolean;
  permissions: string[];
  progressionSummary?: {
    level?: number;
    experience?: number;
    lastWorld?: string;
    [key: string]: unknown;
  };
}

export interface AuthStatus {
  state: AuthState;
  provider: AuthProvider | null;
  locked: boolean;
  updatedAt: number;
  reason?: string;
}

export interface AuthSnapshot {
  status: AuthStatus;
  identity: OpaqueUserIdentity | null;
  profile: UserProfile | null;
}

export interface IAuthManager extends IService {
  login(provider: AuthProvider): Promise<boolean>;
  logout(): Promise<boolean>;
  getProfile(): UserProfile | null;
  getStatus(): AuthStatus;
  getIdentity(): OpaqueUserIdentity | null;
  isLocked(): boolean;
  waitForLock(timeoutMs?: number): Promise<AuthSnapshot>;
  onStatusChanged(handler: (snapshot: AuthSnapshot) => void): () => void;
}

export interface IProfileService extends IService {
  loadProfile(): Promise<UserProfile | null>;
  refreshProfile(): Promise<UserProfile | null>;
  getCachedProfile(): UserProfile | null;
}
