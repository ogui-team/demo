import type {
  AuthProvider,
  AuthSnapshot,
  AuthState,
  AuthStatus,
  GamePlugin,
  IAuthManager,
  IProfileService,
  OpaqueUserIdentity,
  PluginInitContext,
  UserProfile,
} from '@shared/contracts';

const AUTH_MANAGER_SERVICE_ID = 'auth.manager';
const PROFILE_SERVICE_ID = 'profile.service';

const GUEST_ID_STORAGE_KEY = 'sdk.auth.guestId';
const PROFILE_STORAGE_KEY = 'sdk.auth.profile';
const JWT_STORAGE_KEY = 'sdk.auth.jwt';

interface OAuthCallbackResponse {
  ok: boolean;
  provider?: AuthProvider;
  created?: boolean;
  identitySnapshot?: OpaqueUserIdentity;
  gameApiJwt?: string;
  sessionId?: string | null;
  error?: string;
}

class AuthService implements IAuthManager {
  readonly id = AUTH_MANAGER_SERVICE_ID;

  private status: AuthStatus = {
    state: 'ANONYMOUS',
    provider: null,
    locked: false,
    updatedAt: Date.now(),
  };

  private identity: OpaqueUserIdentity | null = null;
  private profile: UserProfile | null = null;
  private readonly listeners = new Set<(snapshot: AuthSnapshot) => void>();
  private readonly waiters = new Set<(snapshot: AuthSnapshot) => void>();

  constructor(private readonly context: PluginInitContext) {}

  initialize(): void {
    const profileFromStorage = this.readProfileFromStorage();
    const jwt = this.readJwtFromStorage();

    // JWT/session artifacts are only consumed by the auth module.
    // Runtime and kernel only ever see opaque identity metadata.
    if (profileFromStorage && jwt) {
      this.setAuthenticated(profileFromStorage, 'Recovered authenticated session from local auth cache');
      return;
    }

    this.ensureGuestIdentity('Initialized guest identity');
  }

  async login(provider: AuthProvider): Promise<boolean> {
    if (provider === 'guest') {
      this.ensureGuestIdentity('Guest login requested');
      return true;
    }

    this.transition('AUTHENTICATING', provider, this.status.locked, `Starting ${provider} authentication`);

    try {
      const callbackPayload = this.collectOAuthPayload(provider);
      if (!callbackPayload) {
        this.ensureGuestIdentity(`Cancelled ${provider} login; falling back to guest`);
        return false;
      }

      const response = await fetch(`${this.resolveAuthHttpBaseUrl()}/auth/${provider}/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(callbackPayload),
      });

      const responseText = await response.text();
      const body = this.tryParseOAuthResponse(responseText);
      if (!response.ok || !body.ok || !body.identitySnapshot || !body.gameApiJwt) {
        throw new Error(body.error || `Auth callback failed with HTTP ${response.status}`);
      }

      const nextProvider: AuthProvider = body.provider === 'google' || body.provider === 'discord'
        ? body.provider
        : provider;
      const profile: UserProfile = {
        userId: body.identitySnapshot.userId,
        provider: nextProvider,
        displayName: callbackPayload.displayName || body.identitySnapshot.userId,
        isGuest: body.identitySnapshot.isGuest,
        permissions: [...body.identitySnapshot.permissions],
      };

      this.persistJwt(body.gameApiJwt);
      this.persistProfile(profile);
      this.setAuthenticated(profile, `${nextProvider} authentication completed`);
      return true;
    } catch (error) {
      console.warn('[AuthPlugin] login failed, preserving guest mode', error);
      this.ensureGuestIdentity(`Failed ${provider} login; using guest identity`);
      return false;
    }
  }

  async logout(): Promise<boolean> {
    try {
      await fetch(`${this.resolveAuthHttpBaseUrl()}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Keep local logout deterministic even if backend is unavailable.
    }
    this.clearStoredAuthArtifacts();
    this.ensureGuestIdentity('Logged out to guest profile');
    return true;
  }

  applyServerIdentitySnapshot(snapshot: OpaqueUserIdentity, provider: AuthProvider | null = null): void {
    const nextProvider = provider ?? (snapshot.isGuest ? 'guest' : this.status.provider ?? 'google');
    const profile: UserProfile = {
      userId: snapshot.userId,
      provider: nextProvider,
      displayName: snapshot.userId,
      isGuest: snapshot.isGuest,
      permissions: [...snapshot.permissions],
    };
    this.persistProfile(profile);
    this.setAuthenticated(profile, 'Applied authoritative identity snapshot from server');
  }

  getProfile(): UserProfile | null {
    return this.profile;
  }

  getStatus(): AuthStatus {
    return { ...this.status };
  }

  getIdentity(): OpaqueUserIdentity | null {
    if (!this.identity) {
      return null;
    }
    return {
      userId: this.identity.userId,
      isGuest: this.identity.isGuest,
      permissions: [...this.identity.permissions],
    };
  }

  isLocked(): boolean {
    return this.status.locked;
  }

  async waitForLock(timeoutMs = 3000): Promise<AuthSnapshot> {
    if (this.status.locked) {
      return this.snapshot();
    }

    return new Promise<AuthSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(onLocked);
        reject(new Error('Auth lock timed out before initialization completed'));
      }, Math.max(1, timeoutMs));

      const onLocked = (snapshot: AuthSnapshot) => {
        if (!snapshot.status.locked) {
          return;
        }
        clearTimeout(timeout);
        this.waiters.delete(onLocked);
        resolve(snapshot);
      };

      this.waiters.add(onLocked);
    });
  }

  onStatusChanged(handler: (snapshot: AuthSnapshot) => void): () => void {
    this.listeners.add(handler);
    handler(this.snapshot());
    return () => {
      this.listeners.delete(handler);
    };
  }

  dispose(): void {
    this.listeners.clear();
    this.waiters.clear();
  }

  private ensureGuestIdentity(reason: string): void {
    const guestId = this.getOrCreateGuestId();
    const profile: UserProfile = {
      userId: guestId,
      provider: 'guest',
      displayName: `Guest-${guestId.slice(-6)}`,
      isGuest: true,
      permissions: ['play'],
      progressionSummary: {
        level: 1,
      },
    };

    this.persistProfile(profile);
    this.setAuthenticated(profile, reason);
  }

  private setAuthenticated(profile: UserProfile, reason: string): void {
    this.profile = profile;
    this.identity = {
      userId: profile.userId,
      isGuest: profile.isGuest,
      permissions: [...profile.permissions],
    };

    this.transition('AUTHENTICATED', profile.provider, true, reason);
  }

  private transition(state: AuthState, provider: AuthProvider | null, locked: boolean, reason: string): void {
    const current = this.status.state;
    const validTransitions: Record<AuthState, ReadonlyArray<AuthState>> = {
      ANONYMOUS: ['AUTHENTICATING', 'AUTHENTICATED'],
      AUTHENTICATING: ['ANONYMOUS', 'AUTHENTICATED'],
      AUTHENTICATED: ['AUTHENTICATING', 'ANONYMOUS', 'AUTHENTICATED'],
    };

    if (!validTransitions[current].includes(state) && current !== state) {
      throw new Error(`Illegal auth transition: ${current} -> ${state}`);
    }

    this.status = {
      state,
      provider,
      locked,
      updatedAt: Date.now(),
      reason,
    };

    const snapshot = this.snapshot();
    this.context.eventBus.emit('auth:changed', {
      status: snapshot.status,
      identity: snapshot.identity,
      profile: snapshot.profile
        ? {
            userId: snapshot.profile.userId,
            provider: snapshot.profile.provider,
            displayName: snapshot.profile.displayName,
            avatarUrl: snapshot.profile.avatarUrl,
            isGuest: snapshot.profile.isGuest,
          }
        : null,
    });

    for (const listener of this.listeners) {
      listener(snapshot);
    }

    for (const waiter of this.waiters) {
      waiter(snapshot);
    }
  }

  private snapshot(): AuthSnapshot {
    return {
      status: { ...this.status },
      identity: this.getIdentity(),
      profile: this.profile
        ? {
            ...this.profile,
            permissions: [...this.profile.permissions],
            progressionSummary: this.profile.progressionSummary
              ? { ...this.profile.progressionSummary }
              : undefined,
          }
        : null,
    };
  }

  private getOrCreateGuestId(): string {
    const existing = this.readLocalStorageValue(GUEST_ID_STORAGE_KEY);
    if (existing && existing.startsWith('guest_')) {
      return existing;
    }

    const generated = `guest_${this.generateStableSuffix()}`;
    this.writeLocalStorageValue(GUEST_ID_STORAGE_KEY, generated);
    return generated;
  }

  private readProfileFromStorage(): UserProfile | null {
    const raw = this.readLocalStorageValue(PROFILE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<UserProfile>;
      if (!parsed || typeof parsed.userId !== 'string' || typeof parsed.displayName !== 'string') {
        return null;
      }

      const provider: AuthProvider =
        parsed.provider === 'google' || parsed.provider === 'discord' ? parsed.provider : 'guest';

      return {
        userId: parsed.userId,
        provider,
        displayName: parsed.displayName,
        avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : undefined,
        isGuest: parsed.isGuest !== false,
        permissions: Array.isArray(parsed.permissions)
          ? parsed.permissions.filter((permission): permission is string => typeof permission === 'string')
          : ['play'],
        progressionSummary:
          parsed.progressionSummary && typeof parsed.progressionSummary === 'object'
            ? { ...parsed.progressionSummary }
            : undefined,
      };
    } catch {
      return null;
    }
  }

  private persistProfile(profile: UserProfile): void {
    this.writeLocalStorageValue(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  }

  private readJwtFromStorage(): string | null {
    return this.readLocalStorageValue(JWT_STORAGE_KEY);
  }

  private persistJwt(token: string): void {
    this.writeLocalStorageValue(JWT_STORAGE_KEY, token);
  }

  private clearStoredAuthArtifacts(): void {
    this.deleteLocalStorageValue(JWT_STORAGE_KEY);
    this.deleteLocalStorageValue(PROFILE_STORAGE_KEY);
  }

  private readLocalStorageValue(key: string): string | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeLocalStorageValue(key: string, value: string): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }

  private deleteLocalStorageValue(key: string): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }

  private generateStableSuffix(): string {
    const randomPart = Math.random().toString(36).slice(2, 10);
    const timePart = Date.now().toString(36);
    return `${timePart}${randomPart}`;
  }

  private collectOAuthPayload(provider: Extract<AuthProvider, 'google' | 'discord'>): {
    providerUserId: string;
    email: string;
    displayName: string;
  } | null {
    const stableSuffix = this.generateStableSuffix().slice(0, 10);
    const fallbackHandle = `${provider}_player_${stableSuffix}`;
    const configuredHandle = this.readLocalStorageValue(`sdk.auth.${provider}.handle`)?.trim() || '';
    const displayName = configuredHandle || this.profile?.displayName || fallbackHandle;
    const configuredEmail = this.readLocalStorageValue(`sdk.auth.${provider}.email`)?.trim().toLowerCase() || '';
    const email = configuredEmail && configuredEmail.includes('@')
      ? configuredEmail
      : `${fallbackHandle}@example.local`;
    const providerUserId = `${provider}_${email.replace(/[^a-z0-9]/gi, '_')}`;

    return {
      providerUserId,
      email,
      displayName,
    };
  }

  private resolveAuthHttpBaseUrl(): string {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') {
      return '';
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('serverHttpUrl')?.trim();
      if (fromQuery) {
        return fromQuery.replace(/\/$/, '');
      }
    } catch {
      // Fallback to inferred host below.
    }

    const currentPort = window.location.port;
    const targetPort = !currentPort || currentPort === '80' || currentPort === '443' || currentPort === '8080'
      ? currentPort
      : '8080';
    const suffix = targetPort ? `:${targetPort}` : '';
    return `${window.location.protocol}//${window.location.hostname}${suffix}`.replace(/\/$/, '');
  }

  private tryParseOAuthResponse(raw: string): OAuthCallbackResponse {
    try {
      return JSON.parse(raw) as OAuthCallbackResponse;
    } catch {
      return {
        ok: false,
        error: raw.slice(0, 180) || 'OAuth callback returned non-JSON response',
      };
    }
  }
}

class ProfileService implements IProfileService {
  readonly id = PROFILE_SERVICE_ID;

  constructor(private readonly auth: AuthService) {}

  async loadProfile(): Promise<UserProfile | null> {
    return this.auth.getProfile();
  }

  async refreshProfile(): Promise<UserProfile | null> {
    return this.auth.getProfile();
  }

  getCachedProfile(): UserProfile | null {
    return this.auth.getProfile();
  }

  dispose(): void {
    // No external resources are held by this scaffold implementation.
  }
}

export class AuthPlugin implements GamePlugin {
  readonly id = 'auth-plugin';
  readonly name = 'Auth Plugin';
  readonly version = '0.3.0';
  readonly description = 'Identity runtime service with guest bootstrap, auth state lock, and opaque kernel metadata.';

  private context: PluginInitContext | null = null;

  init(context: PluginInitContext): void {
    this.context = context;

    const authService = new AuthService(context);
    const profileService = new ProfileService(authService);

    authService.initialize();

    if (typeof window !== 'undefined') {
      (window as any).__authLockReady = authService.waitForLock(1);
      (window as any).__applyServerIdentitySnapshot = (snapshot: OpaqueUserIdentity, provider?: AuthProvider | null) => {
        authService.applyServerIdentitySnapshot(snapshot, provider ?? null);
      };
    }

    context.sdk.registerService(AUTH_MANAGER_SERVICE_ID, authService);
    context.sdk.registerService(PROFILE_SERVICE_ID, profileService);

    context.logger.log('[AuthPlugin] Registered auth and profile services');
  }

  dispose(): void {
    if (!this.context) {
      return;
    }

    this.context.sdk.unregisterService(PROFILE_SERVICE_ID);
    this.context.sdk.unregisterService(AUTH_MANAGER_SERVICE_ID);

    if (typeof window !== 'undefined') {
      (window as any).__authLockReady = null;
      (window as any).__applyServerIdentitySnapshot = null;
    }

    this.context = null;
  }
}
