import type { AuthProvider, AuthSnapshot, IAuthManager } from '@shared/contracts';
import { OGUI } from './OGUITheme';

type RuntimeSdkLike = {
  getService?<T>(id: string): T | undefined;
  services?: {
    getService?<T>(id: string): T | undefined;
  };
};

export class AuthHudPanel {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;
  private readonly profileLine: HTMLDivElement;
  private readonly messageLine: HTMLDivElement;
  private readonly buttonBar: HTMLDivElement;
  private readonly googleButton: HTMLButtonElement;
  private readonly discordButton: HTMLButtonElement;
  private readonly guestButton: HTMLButtonElement;
  private readonly logoutButton: HTMLButtonElement;

  private authService: IAuthManager | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  private bindTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.classList.add('auth-hud-panel');
    this.root.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'padding:14px',
      `border:1px solid ${OGUI.borderDim}`,
      'border-radius:16px',
      'background:rgba(0,0,0,0.35)',
      'box-sizing:border-box',
    ].join(';');

    this.title = document.createElement('div');
    this.title.textContent = 'ACCOUNT';
    this.title.style.cssText = `font-size:11px;letter-spacing:1.4px;color:${OGUI.textHead};font-weight:700;`;
    this.root.appendChild(this.title);

    this.statusLine = document.createElement('div');
    this.statusLine.style.cssText = `font-size:12px;color:${OGUI.textPri};line-height:1.4;`;
    this.root.appendChild(this.statusLine);

    this.profileLine = document.createElement('div');
    this.profileLine.style.cssText = `font-size:12px;color:${OGUI.textSec};line-height:1.4;`;
    this.root.appendChild(this.profileLine);

    this.buttonBar = document.createElement('div');
    this.buttonBar.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;';
    this.root.appendChild(this.buttonBar);

    this.googleButton = this.createActionButton('Google');
    this.discordButton = this.createActionButton('Discord');
    this.guestButton = this.createActionButton('Guest');
    this.logoutButton = this.createActionButton('Logout');

    this.buttonBar.append(
      this.googleButton,
      this.discordButton,
      this.guestButton,
      this.logoutButton,
    );

    this.messageLine = document.createElement('div');
    this.messageLine.style.cssText = `font-size:11px;color:${OGUI.textDim};line-height:1.4;min-height:16px;`;
    this.root.appendChild(this.messageLine);

    this.googleButton.addEventListener('click', () => {
      void this.handleLogin('google');
    });
    this.discordButton.addEventListener('click', () => {
      void this.handleLogin('discord');
    });
    this.guestButton.addEventListener('click', () => {
      void this.handleLogin('guest');
    });
    this.logoutButton.addEventListener('click', () => {
      void this.handleLogout();
    });

    this.renderFallback('Connecting auth service...');
    this.startBindingLoop();
  }

  getElement(): HTMLElement {
    return this.root;
  }

  destroy(): void {
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
      this.bindTimer = null;
    }
    this.root.remove();
  }

  private createActionButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = [
      'height:32px',
      'padding:0 10px',
      `border:1px solid ${OGUI.border}`,
      'border-radius:10px',
      `background:${OGUI.bgPanel}`,
      `color:${OGUI.textPri}`,
      'cursor:pointer',
      'font-size:12px',
      'letter-spacing:0.3px',
    ].join(';');
    return button;
  }

  private startBindingLoop(): void {
    this.tryBindAuthService();
    this.bindTimer = setInterval(() => {
      this.tryBindAuthService();
    }, 1000);
  }

  private tryBindAuthService(): void {
    if (this.authService) {
      return;
    }

    const sdk = ((window as any).__gameEngineSdk || (window as any).__GAME_ENGINE_SDK__) as RuntimeSdkLike | undefined;
    const authService = sdk?.getService?.<IAuthManager>('auth.manager')
      ?? sdk?.services?.getService?.<IAuthManager>('auth.manager');
    if (!authService) {
      this.renderFallback('Auth service pending...');
      return;
    }

    this.authService = authService;
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
      this.bindTimer = null;
    }
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = authService.onStatusChanged((snapshot) => {
      this.renderSnapshot(snapshot);
    });

    this.renderSnapshot({
      status: authService.getStatus(),
      identity: authService.getIdentity(),
      profile: authService.getProfile(),
    });
  }

  private async handleLogin(provider: AuthProvider): Promise<void> {
    if (!this.authService) {
      this.renderFallback('Auth service unavailable.');
      return;
    }

    this.messageLine.textContent = `Signing in via ${provider}...`;
    const ok = await this.authService.login(provider);
    this.messageLine.textContent = ok
      ? `Signed in via ${provider}.`
      : `Sign-in via ${provider} did not complete.`;
  }

  private async handleLogout(): Promise<void> {
    if (!this.authService) {
      this.renderFallback('Auth service unavailable.');
      return;
    }

    this.messageLine.textContent = 'Signing out...';
    await this.authService.logout();
    this.messageLine.textContent = 'Signed out to guest profile.';
  }

  private renderFallback(statusText: string): void {
    this.statusLine.textContent = statusText;
    this.profileLine.textContent = 'Profile: unavailable';
  }

  private renderSnapshot(snapshot: AuthSnapshot): void {
    const provider = snapshot.status.provider ?? 'none';
    this.statusLine.textContent = `State: ${snapshot.status.state} | Provider: ${provider} | Locked: ${snapshot.status.locked ? 'yes' : 'no'}`;
    if (snapshot.profile) {
      this.profileLine.textContent = `User: ${snapshot.profile.displayName} (${snapshot.profile.userId})`;
    } else if (snapshot.identity) {
      this.profileLine.textContent = `User: ${snapshot.identity.userId}`;
    } else {
      this.profileLine.textContent = 'Profile: none';
    }
  }
}
