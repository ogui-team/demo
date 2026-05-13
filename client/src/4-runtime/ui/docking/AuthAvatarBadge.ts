import type { AuthSnapshot, IAuthManager } from '@shared/contracts';

type RuntimeSdkLike = {
  getService?<T>(id: string): T | undefined;
  services?: { getService?<T>(id: string): T | undefined };
};

export class AuthAvatarBadge {
  private readonly root: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly flyout: HTMLDivElement;
  private readonly statusRow: HTMLDivElement;
  private readonly userRow: HTMLDivElement;
  private readonly logoutButton: HTMLButtonElement;
  private authService: IAuthManager | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  private bindTimer: ReturnType<typeof setInterval> | null = null;
  private isOpen = false;
  private latestSnapshot: AuthSnapshot | null = null;

  constructor() {
    this.root = document.createElement('button');
    this.root.type = 'button';
    this.root.style.cssText = [
      'width:28px',
      'height:28px',
      'border-radius:999px',
      'border:1px solid var(--suite-border)',
      'background:var(--suite-bg-2)',
      'color:var(--suite-fg-0)',
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'cursor:pointer',
      'font-size:11px',
      'font-weight:700',
      'letter-spacing:0.03em',
      'pointer-events:auto',
    ].join(';');

    this.label = document.createElement('span');
    this.label.textContent = 'G';
    this.root.appendChild(this.label);

    this.flyout = document.createElement('div');
    this.flyout.style.cssText = [
      'position:fixed',
      'display:none',
      'min-width:220px',
      'border:1px solid var(--suite-border)',
      'background:color-mix(in srgb, var(--suite-bg-0) 96%, transparent)',
      'box-shadow:var(--suite-shadow)',
      'padding:10px',
      'z-index:99999',
      'box-sizing:border-box',
      'color:var(--suite-fg-0)',
      'pointer-events:auto',
    ].join(';');

    this.statusRow = document.createElement('div');
    this.statusRow.style.cssText = 'font-size:11px;color:var(--suite-fg-2);line-height:1.5;';
    this.statusRow.textContent = 'Sync: pending';

    this.userRow = document.createElement('div');
    this.userRow.style.cssText = 'margin-top:4px;font-size:12px;color:var(--suite-fg-0);line-height:1.5;';
    this.userRow.textContent = 'User: Guest';

    this.logoutButton = document.createElement('button');
    this.logoutButton.type = 'button';
    this.logoutButton.textContent = 'Log out';
    this.logoutButton.style.cssText = [
      'margin-top:10px',
      'width:100%',
      'height:28px',
      'border:1px solid var(--suite-border)',
      'background:var(--suite-bg-2)',
      'color:var(--suite-fg-0)',
      'font-size:12px',
      'cursor:pointer',
    ].join(';');

    this.flyout.append(this.statusRow, this.userRow, this.logoutButton);
    document.body.appendChild(this.flyout);

    this.root.addEventListener('click', () => {
      this.toggleFlyout();
    });

    this.logoutButton.addEventListener('click', () => {
      void this.handleLogout();
    });

    document.addEventListener('mousedown', this.onGlobalMouseDown, true);
    window.addEventListener('resize', this.positionFlyout);
    window.addEventListener('scroll', this.positionFlyout, true);

    this.tryBindAuthService();
    this.bindTimer = setInterval(() => this.tryBindAuthService(), 1000);
  }

  getElement(): HTMLElement {
    return this.root;
  }

  destroy(): void {
    this.unsubscribeAuth?.();
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
      this.bindTimer = null;
    }
    document.removeEventListener('mousedown', this.onGlobalMouseDown, true);
    window.removeEventListener('resize', this.positionFlyout);
    window.removeEventListener('scroll', this.positionFlyout, true);
    this.flyout.remove();
    this.root.remove();
  }

  private tryBindAuthService(): void {
    if (this.authService) {
      return;
    }

    const sdk = ((window as any).__gameEngineSdk || (window as any).__GAME_ENGINE_SDK__) as RuntimeSdkLike | undefined;
    const authService = sdk?.getService?.<IAuthManager>('auth.manager')
      ?? sdk?.services?.getService?.<IAuthManager>('auth.manager');

    if (!authService) {
      return;
    }

    this.authService = authService;
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
      this.bindTimer = null;
    }

    this.unsubscribeAuth?.();
    this.unsubscribeAuth = authService.onStatusChanged((snapshot) => {
      this.latestSnapshot = snapshot;
      this.renderSnapshot(snapshot);
    });

    this.latestSnapshot = {
      status: authService.getStatus(),
      identity: authService.getIdentity(),
      profile: authService.getProfile(),
    };
    this.renderSnapshot(this.latestSnapshot);
  }

  private renderSnapshot(snapshot: AuthSnapshot): void {
    const display = snapshot.profile?.displayName ?? snapshot.identity?.userId ?? 'Guest';
    const provider = snapshot.status.provider ?? 'guest';
    this.label.textContent = display.slice(0, 1).toUpperCase();
    this.userRow.textContent = `User: ${display}`;
    this.statusRow.textContent = `Sync: ${provider} | ${snapshot.status.state}`;
  }

  private async handleLogout(): Promise<void> {
    if (!this.authService) {
      return;
    }
    await this.authService.logout();
    this.closeFlyout();
  }

  private toggleFlyout(): void {
    this.isOpen ? this.closeFlyout() : this.openFlyout();
  }

  private openFlyout(): void {
    this.isOpen = true;
    this.flyout.style.display = 'block';
    this.positionFlyout();
  }

  private closeFlyout(): void {
    this.isOpen = false;
    this.flyout.style.display = 'none';
  }

  private readonly positionFlyout = (): void => {
    if (!this.isOpen) {
      return;
    }

    const rect = this.root.getBoundingClientRect();
    const top = rect.bottom + 8;
    const right = Math.max(8, window.innerWidth - rect.right);

    this.flyout.style.top = `${top}px`;
    this.flyout.style.right = `${right}px`;
    this.flyout.style.left = 'auto';
  };

  private readonly onGlobalMouseDown = (event: MouseEvent): void => {
    if (!this.isOpen) {
      return;
    }

    const target = event.target as Node | null;
    if (!target) {
      this.closeFlyout();
      return;
    }

    if (this.flyout.contains(target) || this.root.contains(target)) {
      return;
    }

    this.closeFlyout();
  };
}
