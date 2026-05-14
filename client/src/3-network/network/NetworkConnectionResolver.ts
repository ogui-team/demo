/**
 * ============================================================================
 * NetworkConnectionResolver.ts
 * ============================================================================
 *
 * Flexible network endpoint resolution for the DOD Kernel era.
 *
 * Strategy (in order):
 * 1. Environment variable: VITE_SERVER_IP or process.env.SERVER_URL
 * 2. Manual input (if provided via UI)
 * 3. window.location.hostname (LAN fallback)
 * 4. 'localhost' (localhost fallback)
 *
 * Usage:
 *   const resolver = new NetworkConnectionResolver();
 *   const wsUrl = resolver.resolveWebSocketUrl();
 *   const httpUrl = resolver.resolveHttpUrl();
 *
 *   // With manual override
 *   resolver.setManualServerIP('192.168.1.50');
 *   const wsUrl = resolver.resolveWebSocketUrl(); // → ws://192.168.1.50:8080
 *
 * ============================================================================
 */

import { gameBus } from '@engine/1-kernel/core/public-api';

export interface NetworkConnectionConfig {
  wsPort?: number;      // WebSocket port (default: 8080)
  httpPort?: number;    // HTTP port (default: 8080)
  useSecure?: boolean;  // Use wss:// and https:// (default: false)
  connectTimeoutMs?: number; // Connection timeout (default: 5000ms)
}

export class NetworkConnectionResolver {
  private readonly config: Required<NetworkConnectionConfig>;
  private manualServerIP: string | null = null;
  private lastResolvedHost: string | null = null;

  constructor(config: NetworkConnectionConfig = {}) {
    this.config = {
      wsPort: config.wsPort ?? 8080,
      httpPort: config.httpPort ?? 8080,
      useSecure: config.useSecure ?? false,
      connectTimeoutMs: config.connectTimeoutMs ?? 5000,
    };
  }

  /**
   * Resolve the WebSocket URL using the resolution strategy
   */
  resolveWebSocketUrl(): string {
    const explicitWsUrl = this.getExplicitServerUrl('ws');
    if (explicitWsUrl) return explicitWsUrl;

    const explicitHttpUrl = this.getExplicitServerUrl('http');
    if (explicitHttpUrl) {
      const parsed = new URL(explicitHttpUrl);
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return parsed.toString().replace(/\/$/, '');
    }

    const browserSameOriginWsUrl = this.getBrowserSameOriginUrl('ws');
    if (browserSameOriginWsUrl) {
      return browserSameOriginWsUrl;
    }

    const host = this.resolveHost();
    const port = this.config.wsPort;
    const shouldUseSecure = this.config.useSecure || this.isSecurePageContext();
    const protocol = shouldUseSecure ? 'wss' : 'ws';
    return `${protocol}://${host}:${port}`;
  }

  /**
   * Resolve the HTTP base URL (for REST API)
   */
  resolveHttpUrl(): string {
    const explicitHttpUrl = this.getExplicitServerUrl('http');
    if (explicitHttpUrl) return explicitHttpUrl;

    const explicitWsUrl = this.getExplicitServerUrl('ws');
    if (explicitWsUrl) {
      const parsed = new URL(explicitWsUrl);
      parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
      return parsed.toString().replace(/\/$/, '');
    }

    const browserSameOriginHttpUrl = this.getBrowserSameOriginUrl('http');
    if (browserSameOriginHttpUrl) {
      return browserSameOriginHttpUrl;
    }

    const host = this.resolveHost();
    const port = this.config.httpPort;
    const protocol = this.config.useSecure || this.isSecurePageContext() ? 'https' : 'http';
    return `${protocol}://${host}:${port}`;
  }

  /**
   * Allow manual override from UI (e.g., Main Menu IP input)
   */
  setManualServerIP(ip: string | null): void {
    this.manualServerIP = ip;
    console.log(`[NetworkConnectionResolver] Manual server IP set to: ${ip ?? 'null'}`);
  }

  /**
   * Get the currently resolved host (for logging/debugging)
   */
  getResolvedHost(): string {
    if (this.lastResolvedHost === null) {
      this.lastResolvedHost = this.resolveHost();
    }
    return this.lastResolvedHost;
  }

  /**
   * Internal: Apply resolution strategy
   */
  private resolveHost(): string {
    // PRIORITY 1: Manual override (from UI)
    if (this.manualServerIP) {
      console.log(`[NetworkConnectionResolver] Using manual IP: ${this.manualServerIP}`);
      return this.manualServerIP;
    }

    // PRIORITY 2: Environment variable
    const envVar = this.getEnvironmentVariable();
    if (envVar) {
      console.log(`[NetworkConnectionResolver] Using env var: ${envVar}`);
      return envVar;
    }

    // PRIORITY 3: window.location.hostname (LAN fallback)
    if (typeof window !== 'undefined' && window.location.hostname) {
      console.log(`[NetworkConnectionResolver] Using window.location.hostname: ${window.location.hostname}`);
      return window.location.hostname;
    }

    // PRIORITY 4: localhost fallback
    console.warn('[NetworkConnectionResolver] Falling back to localhost');
    return 'localhost';
  }

  /**
   * Try to read from environment variables (Vite/build-time)
   */
  private getEnvironmentVariable(): string | null {
    // Try VITE_SERVER_IP first (Vite convention)
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SERVER_IP) {
      return (import.meta as any).env.VITE_SERVER_IP;
    }

    // Try process.env (for Node/bundler compatibility)
    if (typeof process !== 'undefined' && process.env?.SERVER_URL) {
      return process.env.SERVER_URL;
    }

    return null;
  }

  private getExplicitServerUrl(kind: 'http' | 'ws'): string | null {
    const read = (key: string): string | null => {
      if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string' && process.env[key]) {
        return String(process.env[key]);
      }
      return null;
    };

    const direct = kind === 'ws' ? read('SERVER_WS_URL') : read('SERVER_HTTP_URL');
    if (direct) {
      try {
        return new URL(direct).toString().replace(/\/$/, '');
      } catch {
        return null;
      }
    }

    const generic = read('SERVER_URL');
    if (!generic) return null;
    try {
      const parsed = new URL(generic);
      parsed.protocol = kind === 'ws'
        ? (parsed.protocol === 'https:' ? 'wss:' : 'ws:')
        : (parsed.protocol === 'wss:' ? 'https:' : 'http:');
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  private isSecurePageContext(): boolean {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
  }

  private getBrowserSameOriginUrl(kind: 'http' | 'ws'): string | null {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') {
      return null;
    }

    const { hostname, port, protocol } = window.location;
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
      return null;
    }

    const nextProtocol = kind === 'ws'
      ? (protocol === 'https:' ? 'wss:' : 'ws:')
      : protocol;
    const portSuffix = port ? `:${port}` : '';
    return `${nextProtocol}//${hostname}${portSuffix}`.replace(/\/$/, '');
  }
}

/**
 * Graceful WebSocket connection wrapper
 * Emits NETWORK_UNAVAILABLE on failure instead of throwing
 */
export class SafeWebSocketConnection {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private config: { connectTimeoutMs: number } = { connectTimeoutMs: 5000 }
  ) {}

  /**
   * Attempt connection with timeout
   * Returns WebSocket on success, null on failure (with event emission)
   */
  async connect(): Promise<WebSocket | null> {
    if (this.isConnecting) {
      console.warn('[SafeWebSocketConnection] Already connecting');
      return null;
    }

    this.isConnecting = true;

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);

        // Success
        this.ws.onopen = () => {
          console.log(`[SafeWebSocketConnection] Connected to ${this.url}`);
          this.clearTimeout();
          this.isConnecting = false;
          resolve(this.ws);
        };

        // Failure
        this.ws.onerror = (event) => {
          console.error(`[SafeWebSocketConnection] Connection error to ${this.url}`, event);
          this.handleConnectionFailure('WebSocket error');
          resolve(null);
        };

        this.ws.onclose = () => {
          console.warn(`[SafeWebSocketConnection] Connection closed to ${this.url}`);
          if (this.isConnecting) {
            this.handleConnectionFailure('Connection closed before open');
            this.isConnecting = false;
          }
        };

        // Timeout
        this.connectionTimeout = Engine.timer.setTimeout(() => {
          if (this.isConnecting) {
            console.error(
              `[SafeWebSocketConnection] Connection timeout (${this.config.connectTimeoutMs}ms) to ${this.url}`
            );
            this.handleConnectionFailure('Connection timeout');
            if (this.ws) {
              this.ws.onopen = null;
              this.ws.onerror = null;
              this.ws.onclose = null;
              this.ws.close();
              this.ws = null;
            }
            this.isConnecting = false;
            resolve(null);
          }
        }, this.config.connectTimeoutMs);
      } catch (error) {
        console.error('[SafeWebSocketConnection] Exception during WebSocket constructor', error);
        this.handleConnectionFailure(`Exception: ${String(error)}`);
        this.isConnecting = false;
        resolve(null);
      }
    });
  }

  /**
   * Get the WebSocket if connected
   */
  getSocket(): WebSocket | null {
    return this.ws && this.ws.readyState === WebSocket.OPEN ? this.ws : null;
  }

  /**
   * Clean disconnect
   */
  disconnect(): void {
    this.clearTimeout();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
  }

  /**
   * Internal: Handle connection failure
   */
  private handleConnectionFailure(reason: string): void {
    console.error(`[SafeWebSocketConnection] Connection failed: ${reason}`);

    // Emit network lifecycle event (uses existing GameEvents.networkLifecycle)
    gameBus.emit('networkLifecycle', {
      source: 'SafeWebSocketConnection',
      state: 'connection_failed',
      detail: reason,
    });
  }

  /**
   * Internal: Clear timeout
   */
  private clearTimeout(): void {
    if (this.connectionTimeout) {
      Engine.timer.clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }
}
