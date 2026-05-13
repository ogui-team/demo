interface CommandPaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteOptions {
  commands: CommandPaletteCommand[];
}

export class CommandPalette {
  private readonly commands: CommandPaletteCommand[];
  private readonly root: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly results: HTMLDivElement;
  private visible = false;

  constructor(options: CommandPaletteOptions) {
    this.commands = options.commands;

    this.root = document.createElement('div');
    this.root.dataset.uiInteractive = 'true';
    this.root.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:none',
      'background:rgba(0,0,0,0.34)',
      'z-index:100000',
      'pointer-events:auto',
    ].join(';');

    this.dialog = document.createElement('div');
  this.dialog.dataset.uiInteractive = 'true';
    this.dialog.style.cssText = [
      'width:min(640px,92vw)',
      'margin:92px auto 0',
      'border:1px solid var(--suite-border)',
      'background:var(--suite-bg-1)',
      'box-shadow:var(--suite-shadow)',
      'border-radius:var(--suite-radius)',
      'overflow:hidden',
    ].join(';');

    this.input = document.createElement('input');
  this.input.dataset.uiInteractive = 'true';
    this.input.type = 'text';
    this.input.placeholder = 'Type a command...';
    this.input.style.cssText = [
      'width:100%',
      'height:40px',
      'box-sizing:border-box',
      'border:0',
      'border-bottom:1px solid var(--suite-border-soft)',
      'background:var(--suite-bg-0)',
      'color:var(--suite-fg-0)',
      'padding:0 12px',
      'font-size:13px',
      'outline:none',
    ].join(';');

    this.results = document.createElement('div');
  this.results.dataset.uiInteractive = 'true';
    this.results.style.cssText = [
      'max-height:360px',
      'overflow:auto',
      'padding:4px',
      'box-sizing:border-box',
    ].join(';');

    this.dialog.append(this.input, this.results);
    this.root.appendChild(this.dialog);
    document.body.appendChild(this.root);

    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) {
        this.hide();
      }
    });

    this.input.addEventListener('input', () => {
      this.renderResults(this.input.value);
    });

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    });

    window.addEventListener('keydown', this.onGlobalKeydown, true);
    this.renderResults('');
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.style.display = 'block';
    this.input.value = '';
    this.renderResults('');
    this.input.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onGlobalKeydown, true);
    this.root.remove();
  }

  private renderResults(query: string): void {
    const q = query.trim().toLowerCase();
    const filtered = q.length === 0
      ? this.commands
      : this.commands.filter((command) => command.label.toLowerCase().includes(q) || command.id.toLowerCase().includes(q));

    this.results.replaceChildren();

    for (const command of filtered.slice(0, 24)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = [
        'width:100%',
        'height:34px',
        'display:flex',
        'align-items:center',
        'justify-content:space-between',
        'padding:0 10px',
        'border:0',
        'background:transparent',
        'color:var(--suite-fg-0)',
        'cursor:pointer',
        'text-align:left',
      ].join(';');

      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--suite-accent-soft)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });
      row.addEventListener('click', () => {
        command.run();
        this.hide();
      });

      const label = document.createElement('span');
      label.textContent = command.label;
      label.style.cssText = 'font-size:12px;';

      const hint = document.createElement('span');
      hint.textContent = command.hint ?? '';
      hint.style.cssText = 'font-size:11px;color:var(--suite-fg-2);';

      row.append(label, hint);
      this.results.appendChild(row);
    }
  }

  private readonly onGlobalKeydown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.toggle();
  };
}
