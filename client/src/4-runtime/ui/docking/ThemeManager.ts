const THEME_STYLE_ID = 'engine-suite-theme-vars';

export class ThemeManager {
  applySlateTheme(): void {
    this.ensureVariables();
    document.documentElement.classList.add('engine-suite-theme');
  }

  destroy(): void {
    document.documentElement.classList.remove('engine-suite-theme');
  }

  private ensureVariables(): void {
    if (document.getElementById(THEME_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = THEME_STYLE_ID;
    style.textContent = `
:root {
  --suite-bg-0: #11161c;
  --suite-bg-1: #151b22;
  --suite-bg-2: #1b232c;
  --suite-bg-3: #242f3a;
  --suite-fg-0: #dfe7ee;
  --suite-fg-1: #b8c5d2;
  --suite-fg-2: #93a6b8;
  --suite-border: rgba(156, 171, 186, 0.34);
  --suite-border-soft: rgba(156, 171, 186, 0.22);
  --suite-accent: #6ea8d6;
  --suite-accent-soft: rgba(110, 168, 214, 0.22);
  --suite-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
  --suite-radius: 0px;
}
.engine-suite-theme {
  color: var(--suite-fg-0);
}
`;
    document.head.appendChild(style);
  }
}
