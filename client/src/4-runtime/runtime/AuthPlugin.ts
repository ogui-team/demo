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

    // Real OAuth: redirect the browser to the server-side initiate route.
    // The server will redirect to the provider, receive the code, exchange it,
    // create a session, and redirect back to /?auth_jwt=<token>.
    if (typeof window !== 'undefined') {
      const base = this.resolveAuthHttpBaseUrl();
      window.location.href = `${base}/auth/${provider}`;
    }

    // Return false so the caller knows the flow is async (page will reload).
    return false;
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
    // 1. Build-time env variable (set in render.yaml / webpack EnvironmentPlugin)
    const fromEnv = (process.env.SERVER_HTTP_URL ?? '').trim();
    if (fromEnv) {
      return fromEnv.replace(/\/$/, '');
    }

    if (typeof window === 'undefined' || typeof window.location === 'undefined') {
      return '';
    }

    // 2. Runtime query override: ?serverHttpUrl=https://...
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('serverHttpUrl')?.trim();
      if (fromQuery) {
        return fromQuery.replace(/\/$/, '');
      }
    } catch {
      // Fallback to inferred host below.
    }

    // 3. Same host (production: client and server are on the same origin on Render)
    const { protocol, hostname, port } = window.location;
    const isDefaultPort = !port || port === '80' || port === '443';
    if (isDefaultPort) {
      return `${protocol}//${hostname}`.replace(/\/$/, '');
    }

    // 4. Local dev: client on :3000, server on :10001
    return `${protocol}//${hostname}:10001`.replace(/\/$/, '');
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

    // Pick up JWT returned from OAuth redirect-back (e.g. /?auth_jwt=<token>).
    this.applyJwtFromUrl(authService);

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

  private applyJwtFromUrl(authService: AuthService): void {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const jwt = params.get('auth_jwt');
      const err = params.get('auth_error');

      if (err) {
        console.warn('[AuthPlugin] OAuth error from server:', err);
        // Strip from URL so it doesn't persist on reload.
        params.delete('auth_error');
        const clean = params.toString() ? `?${params.toString()}` : '';
        window.history.replaceState({}, '', `${window.location.pathname}${clean}`);
        return;
      }

      if (!jwt) return;

      // Decode JWT payload (base64url, part 1).
      const parts = jwt.split('.');
      if (parts.length !== 3) return;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
        sub?: string;
        guest?: boolean;
        permissions?: string[];
        provider?: string;
        sid?: string | null;
      };

      if (!payload.sub) return;

      const provider: AuthProvider =
        payload.provider === 'google' || payload.provider === 'discord' ? payload.provider : 'guest';

      const profile: UserProfile = {
        userId: payload.sub,
        provider,
        displayName: payload.sub,
        isGuest: Boolean(payload.guest),
        permissions: Array.isArray(payload.permissions) ? payload.permissions : ['play'],
      };

      authService['persistJwt'](jwt);
      authService['persistProfile'](profile);
      // Will be applied as part of initialize() which runs after this.
      authService['writeLocalStorageValue'](PROFILE_STORAGE_KEY, JSON.stringify(profile));
      authService['writeLocalStorageValue'](JWT_STORAGE_KEY, jwt);

      // Strip jwt from URL so it doesn't linger in browser history.
      params.delete('auth_jwt');
      const clean = params.toString() ? `?${params.toString()}` : '';
      window.history.replaceState({}, '', `${window.location.pathname}${clean}`);

      console.log(`[AuthPlugin] Applied OAuth return JWT for provider: ${provider}`);
    } catch (e) {
      console.warn('[AuthPlugin] Failed to apply auth_jwt from URL', e);
    }
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
